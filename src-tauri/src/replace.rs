use std::fs;
use std::path::Path;

use regex::{NoExpand, Regex, RegexBuilder};
use walkdir::WalkDir;

use crate::{
    checkpoint,
    error::{AppError, AppResult},
    models::{ReplaceFilePreview, ReplacePreview, ReplaceResult},
    project,
    util::{sha256_hex, truncate_chars},
};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 4000;
const MAX_DIFF_LINES: usize = 800;

struct Compiled {
    regex: Regex,
    replacement: String,
    use_regex: bool,
}

struct TextFile {
    path: String,
    content: String,
    eol: String,
    bom: bool,
    hash: String,
    matches: u32,
}

fn compile(
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
) -> AppResult<Compiled> {
    if query.trim().is_empty() {
        return Err(AppError::new("empty_query", "Enter text to find"));
    }
    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| AppError::new("invalid_regex", format!("Invalid regular expression: {e}")))?;
    Ok(Compiled {
        regex,
        replacement: replacement.to_string(),
        use_regex,
    })
}

fn replace_content(compiled: &Compiled, content: &str) -> String {
    if compiled.use_regex {
        compiled
            .regex
            .replace_all(content, compiled.replacement.as_str())
            .to_string()
    } else {
        compiled
            .regex
            .replace_all(content, NoExpand(compiled.replacement.as_str()))
            .to_string()
    }
}

fn collect_matches(root: &Path, compiled: &Compiled) -> AppResult<Vec<TextFile>> {
    let mut files = Vec::new();
    let mut scanned = 0usize;
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir() && project::should_skip_dir(&name))
                && !(entry.file_type().is_file() && project::should_skip_file(&name))
        })
        .flatten()
    {
        if files.len() >= MAX_FILES || scanned >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        if bytes.iter().take(4096).any(|b| *b == 0) {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&bytes) else {
            continue;
        };
        let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
        let body = text.strip_prefix('\u{feff}').unwrap_or(text);
        scanned += 1;
        let matches = compiled.regex.find_iter(body).count() as u32;
        if matches == 0 {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let eol = if body.contains("\r\n") { "\r\n" } else { "\n" };
        let content = body.replace("\r\n", "\n").replace('\r', "\n");
        files.push(TextFile {
            path: rel,
            content,
            eol: eol.to_string(),
            bom,
            hash: sha256_hex(&bytes),
            matches,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn preview_token(
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
    files: &[TextFile],
) -> String {
    let mut input = format!("v1\0{query}\0{replacement}\0{case_sensitive}\0{use_regex}\0");
    for file in files {
        input.push_str(&file.path);
        input.push('\0');
        input.push_str(&file.hash);
        input.push('\0');
    }
    sha256_hex(input.as_bytes())
}

fn file_preview(file: TextFile, compiled: &Compiled) -> ReplaceFilePreview {
    let new_content = replace_content(compiled, &file.content);
    let all_lines = checkpoint::diff_lines(file.content.as_bytes(), new_content.as_bytes());
    let truncated = all_lines.len() > MAX_DIFF_LINES;
    let lines = all_lines
        .into_iter()
        .take(MAX_DIFF_LINES)
        .collect::<Vec<_>>();
    let additions = lines.iter().filter(|line| line.kind == "add").count() as u32;
    let deletions = lines.iter().filter(|line| line.kind == "remove").count() as u32;
    ReplaceFilePreview {
        path: file.path,
        matches: file.matches,
        replacements: file.matches,
        additions,
        deletions,
        truncated,
        lines,
    }
}

pub fn preview(
    root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
) -> AppResult<ReplacePreview> {
    let compiled = compile(query, replacement, case_sensitive, use_regex)?;
    let files = collect_matches(root, &compiled)?;
    let token = preview_token(query, replacement, case_sensitive, use_regex, &files);
    let replacements = files.iter().map(|file| file.matches).sum();
    let previews = files
        .into_iter()
        .map(|file| file_preview(file, &compiled))
        .collect::<Vec<_>>();
    Ok(ReplacePreview {
        token,
        file_count: previews.len() as u32,
        match_count: replacements,
        replacement_count: replacements,
        files: previews,
    })
}

struct Backup {
    path: String,
    content: String,
    eol: String,
    bom: bool,
}

fn rollback(root: &Path, backups: &[Backup]) -> bool {
    let mut failed = false;
    for backup in backups.iter().rev() {
        if project::write_file(
            root,
            &backup.path,
            &backup.content,
            &backup.eol,
            backup.bom,
            None,
        )
        .is_err()
        {
            failed = true;
        }
    }
    failed
}

pub fn apply(
    data_dir: &Path,
    root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
    token: &str,
    retention: usize,
) -> AppResult<ReplaceResult> {
    let compiled = compile(query, replacement, case_sensitive, use_regex)?;
    let files = collect_matches(root, &compiled)?;
    let current_token = preview_token(query, replacement, case_sensitive, use_regex, &files);
    if current_token != token {
        return Err(AppError::new(
            "stale_preview",
            "The project changed after the replacement preview. Review it again.",
        ));
    }
    if files.is_empty() {
        return Err(AppError::new("no_matches", "No matches to replace"));
    }

    let description = format!(
        "Replace \"{}\" with \"{}\"",
        truncate_chars(query, 60),
        truncate_chars(replacement, 60)
    );
    let checkpoint = checkpoint::create_with_retention(
        data_dir,
        root,
        None,
        Some(description),
        "pre-replace",
        retention,
    )?;

    let mut backups = Vec::new();
    let mut files_changed = 0u32;
    let mut replacements = 0u32;
    for file in &files {
        if file.matches == 0 {
            continue;
        }
        let new_content = replace_content(&compiled, &file.content);
        if new_content == file.content {
            continue;
        }
        match project::write_file(
            root,
            &file.path,
            &new_content,
            &file.eol,
            file.bom,
            Some(&file.hash),
        ) {
            Ok(_) => {
                backups.push(Backup {
                    path: file.path.clone(),
                    content: file.content.clone(),
                    eol: file.eol.clone(),
                    bom: file.bom,
                });
                files_changed += 1;
                replacements += file.matches;
            }
            Err(error) => {
                let rollback_failed = rollback(root, &backups);
                let suffix = if rollback_failed {
                    " Rollback also failed; review the project manually and use history to restore it."
                } else {
                    " All changes were rolled back."
                };
                return Err(AppError::new(
                    "replace_failed",
                    format!("Could not finish replacement: {}.{suffix}", error.message),
                ));
            }
        }
    }

    Ok(ReplaceResult {
        checkpoint_id: checkpoint.map(|summary| summary.id),
        files_changed,
        replacements,
        rollback_failed: false,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::{apply, preview, replace_content, Compiled};
    use crate::checkpoint;

    fn project() -> (TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        let data = dir.path().join("data");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(
            root.join("main.tex"),
            "Hello world\n{\\section{World}}\nHello world again\n",
        )
        .unwrap();
        fs::write(root.join("chapters/one.tex"), "world\n").unwrap();
        (dir, root.canonicalize().unwrap(), data)
    }

    #[test]
    fn preview_is_read_only_and_apply_replaces_all_matches() {
        let (_dir, root, data) = project();
        let before = fs::read_to_string(root.join("main.tex")).unwrap();
        let previewed = preview(&root, "world", "planet", false, false).unwrap();
        assert_eq!(previewed.file_count, 2);
        assert_eq!(previewed.match_count, 4);
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            before,
            "preview must not write"
        );
        assert!(previewed
            .files
            .iter()
            .any(|file| file.lines.iter().any(|line| line.kind == "add")));

        let result = apply(
            &data,
            &root,
            "world",
            "planet",
            false,
            false,
            &previewed.token,
            80,
        )
        .unwrap();
        assert_eq!(result.files_changed, 2);
        assert_eq!(result.replacements, 4);
        assert!(result.checkpoint_id.is_some());
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "Hello planet\n{\\section{planet}}\nHello planet again\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("chapters/one.tex")).unwrap(),
            "planet\n"
        );
        assert_eq!(
            checkpoint::list(&data, &root).unwrap()[0].kind,
            "pre-replace"
        );
    }

    #[test]
    fn stale_token_and_invalid_regex_are_rejected() {
        let (_dir, root, data) = project();
        let previewed = preview(&root, "Hello", "Hi", true, false).unwrap();
        fs::write(root.join("main.tex"), "Hello changed\n").unwrap();
        let error = apply(
            &data,
            &root,
            "Hello",
            "Hi",
            true,
            false,
            &previewed.token,
            80,
        )
        .unwrap_err();
        assert_eq!(error.code, "stale_preview");
        assert!(preview(&root, "(", "x", true, true).is_err());
    }

    #[test]
    fn literal_replacement_does_not_expand_dollar_groups() {
        let compiled = Compiled {
            regex: regex::RegexBuilder::new("x")
                .case_insensitive(false)
                .build()
                .unwrap(),
            replacement: "$1".into(),
            use_regex: false,
        };
        assert_eq!(replace_content(&compiled, "x x"), "$1 $1");
    }

    #[test]
    fn apply_preserves_bom_and_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        let data = dir.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(root.join("main.tex"), b"\xEF\xBB\xBFhello\r\nworld\r\n").unwrap();
        let root = root.canonicalize().unwrap();
        let previewed = preview(&root, "hello", "hi", true, false).unwrap();
        apply(
            &data,
            &root,
            "hello",
            "hi",
            true,
            false,
            &previewed.token,
            80,
        )
        .unwrap();
        assert_eq!(
            fs::read(root.join("main.tex")).unwrap(),
            b"\xEF\xBB\xBFhi\r\nworld\r\n"
        );
    }
}
