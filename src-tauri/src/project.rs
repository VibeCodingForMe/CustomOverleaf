use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use regex::RegexBuilder;
use walkdir::WalkDir;

use crate::{
    error::{AppError, AppResult},
    models::{FileNode, FileStat, ProjectSnapshot, ReadFileResult, SearchMatch, WriteFileResult},
    state::AppState,
    util::{now_ms, sha256_hex},
};

const MAX_READ_BYTES: u64 = 24 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 120 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 6000;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".latexstudio",
    "node_modules",
    "target",
    ".idea",
    ".vscode",
    "build",
];

const IGNORED_FILES: &[&str] = &[".DS_Store", "Thumbs.db"];

const IGNORED_EXTENSIONS: &[&str] = &[
    "aux",
    "log",
    "out",
    "toc",
    "lof",
    "lot",
    "fls",
    "fdb_latexmk",
    "synctex.gz",
    "bbl",
    "blg",
    "bcf",
    "run.xml",
    "nav",
    "snm",
    "vrb",
    "xdv",
    "dvi",
];

pub fn canonical_root(root: &str) -> AppResult<PathBuf> {
    let path = Path::new(root);
    let canonical = path.canonicalize().map_err(|e| {
        AppError::new(
            "invalid_project",
            format!("Project folder is unavailable: {e}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(AppError::new(
            "invalid_project",
            "The selected path is not a folder",
        ));
    }
    if canonical.parent().is_none() {
        return Err(AppError::new(
            "invalid_project",
            "Refusing to use the filesystem root as a project",
        ));
    }
    Ok(canonical)
}

fn validate_relative(rel: &str) -> AppResult<PathBuf> {
    if rel.trim().is_empty() {
        return Err(AppError::new("invalid_path", "A file path is required"));
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(AppError::new(
            "invalid_path",
            "Absolute paths are not allowed here",
        ));
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_string_lossy();
                if part == ".git" || part == ".latexstudio" {
                    return Err(AppError::new(
                        "protected_path",
                        "This location is managed by LaTeX Studio and cannot be edited",
                    ));
                }
                clean.push(part.as_ref());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::new(
                    "invalid_path",
                    "Path traversal outside the project is not allowed",
                ));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(AppError::new("invalid_path", "Invalid relative path"));
    }
    Ok(clean)
}

pub fn resolve_existing(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let clean = validate_relative(rel)?;
    let candidate = root.join(&clean);
    let canonical = candidate.canonicalize().map_err(|e| {
        AppError::new(
            "not_found",
            format!("{} could not be opened: {e}", clean.display()),
        )
    })?;
    if !canonical.starts_with(root) {
        return Err(AppError::new(
            "outside_project",
            "The path resolves outside the project folder",
        ));
    }
    Ok(canonical)
}

pub fn resolve_for_write(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let clean = validate_relative(rel)?;
    let candidate = root.join(&clean);
    let parent = candidate
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "File has no parent folder"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::new("not_found", format!("Parent folder is unavailable: {e}")))?;
    if !canonical_parent.starts_with(root) {
        return Err(AppError::new(
            "outside_project",
            "The path resolves outside the project folder",
        ));
    }
    Ok(canonical_parent.join(
        candidate
            .file_name()
            .ok_or_else(|| AppError::new("invalid_path", "File name is missing"))?,
    ))
}

pub fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

pub fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

pub(crate) fn should_skip_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

pub(crate) fn should_skip_file(name: &str) -> bool {
    if IGNORED_FILES.contains(&name) {
        return true;
    }
    let lower = name.to_lowercase();
    if lower.ends_with(".synctex.gz") {
        return true;
    }
    match lower.rsplit_once('.') {
        Some((_, ext)) => IGNORED_EXTENSIONS.contains(&ext),
        None => false,
    }
}

fn read_tree(root: &Path, dir: &Path, depth: usize, counter: &mut usize) -> Vec<FileNode> {
    if depth > 14 || *counter >= MAX_TREE_ENTRIES {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut nodes = Vec::new();
    for entry in entries.flatten() {
        if *counter >= MAX_TREE_ENTRIES {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let is_dir = meta.is_dir();
        if is_dir {
            if should_skip_dir(&name) {
                continue;
            }
        } else if should_skip_file(&name) {
            continue;
        }
        *counter += 1;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let children = if is_dir {
            read_tree(root, &path, depth + 1, counter)
        } else {
            Vec::new()
        };
        nodes.push(FileNode {
            name,
            path: relative_path(root, &path).unwrap_or_default(),
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            modified_ms,
            children,
        });
    }
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    nodes
}

fn collect_tex_files(nodes: &[FileNode], out: &mut Vec<String>) {
    for node in nodes {
        if node.is_dir {
            collect_tex_files(&node.children, out);
        } else if node.path.to_lowercase().ends_with(".tex") {
            out.push(node.path.clone());
        }
    }
}

pub fn detect_main_file(root: &Path, tex_files: &[String]) -> Option<String> {
    const PREFERRED: &[&str] = &[
        "main.tex",
        "document.tex",
        "paper.tex",
        "thesis.tex",
        "report.tex",
        "article.tex",
        "presentation.tex",
    ];
    for preferred in PREFERRED {
        if let Some(found) = tex_files.iter().find(|p| p.as_str() == *preferred) {
            return Some(found.clone());
        }
    }
    let mut candidates: Vec<(usize, &String)> = tex_files
        .iter()
        .map(|p| (p.matches('/').count(), p))
        .collect();
    candidates.sort_by_key(|(depth, _)| *depth);
    for (_, rel) in candidates {
        if let Ok(path) = resolve_existing(root, rel) {
            let mut buffer = String::new();
            if fs::File::open(path)
                .and_then(|f| f.take(128 * 1024).read_to_string(&mut buffer))
                .is_ok()
                && buffer.contains("\\documentclass")
            {
                return Some((*rel).clone());
            }
        }
    }
    tex_files.first().cloned()
}

pub fn load_project(root: &Path, state: &AppState) -> AppResult<ProjectSnapshot> {
    let root_str = root.to_string_lossy().to_string();
    let mut counter = 0usize;
    let files = read_tree(root, root, 0, &mut counter);
    let mut tex_files = Vec::new();
    collect_tex_files(&files, &mut tex_files);
    let stored = state.main_file_for(&root_str);
    let main_file = stored
        .as_ref()
        .filter(|rel| {
            resolve_existing(root, rel)
                .map(|p| p.is_file())
                .unwrap_or(false)
        })
        .cloned()
        .or_else(|| detect_main_file(root, &tex_files));
    if let Some(ref main) = main_file {
        if stored.as_ref() != Some(main) {
            let _ = state.set_main_file(&root_str, Some(main.clone()));
        }
    }
    Ok(ProjectSnapshot {
        root: root_str,
        name: root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".into()),
        main_file,
        files,
        is_git: is_git_repo(root),
        tex_files,
    })
}

pub fn open_project(path: &str, state: &AppState) -> AppResult<ProjectSnapshot> {
    let root = canonical_root(path)?;
    state.touch_project(&root)?;
    load_project(&root, state)
}

pub fn sanitize_project_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "invalid_name",
            "Project name cannot be empty",
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.starts_with('.') {
        return Err(AppError::new(
            "invalid_name",
            "Project name cannot start with a dot",
        ));
    }
    if trimmed.contains(['/', '\\', ':', '\0']) {
        return Err(AppError::new(
            "invalid_name",
            "Project name contains characters that are not allowed",
        ));
    }
    if trimmed.chars().count() > 120 {
        return Err(AppError::new("invalid_name", "Project name is too long"));
    }
    Ok(trimmed.to_string())
}

pub fn create_project(
    parent: &str,
    name: &str,
    template: &str,
    state: &AppState,
) -> AppResult<ProjectSnapshot> {
    let parent = canonical_root(parent)?;
    let name = sanitize_project_name(name)?;
    let target = parent.join(&name);
    if target.exists() {
        return Err(AppError::new(
            "exists",
            "A file or folder with that name already exists",
        ));
    }
    fs::create_dir(&target).map_err(|e| AppError::io("Could not create project folder", e))?;
    if let Err(err) = crate::templates::write_template(template, &target) {
        let _ = fs::remove_dir_all(&target);
        return Err(err);
    }
    state.touch_project(&target)?;
    load_project(&target, state)
}

pub fn read_file(root: &Path, rel: &str) -> AppResult<ReadFileResult> {
    let path = resolve_existing(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| AppError::io("Could not read file info", e))?;
    if !meta.is_file() {
        return Err(AppError::new("not_a_file", "This path is not a file"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::new(
            "file_too_large",
            "This file is too large to edit in LaTeX Studio",
        ));
    }
    let bytes = fs::read(&path).map_err(|e| AppError::io("Could not read file", e))?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Err(AppError::new(
            "binary_file",
            "This file appears to be binary and cannot be edited as text",
        ));
    }
    let (bom, body) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (true, &bytes[3..])
    } else {
        (false, bytes.as_slice())
    };
    let text = std::str::from_utf8(body).map_err(|_| {
        AppError::new(
            "unsupported_encoding",
            "This file is not UTF-8. LaTeX Studio supports UTF-8 source files; convert the file to UTF-8 first.",
        )
    })?;
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    Ok(ReadFileResult {
        content: normalized,
        eol: eol.to_string(),
        bom,
        hash: sha256_hex(&bytes),
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        size: meta.len(),
    })
}

pub fn write_file(
    root: &Path,
    rel: &str,
    content: &str,
    eol: &str,
    bom: bool,
    expected_hash: Option<&str>,
) -> AppResult<WriteFileResult> {
    if eol != "\n" && eol != "\r\n" {
        return Err(AppError::new(
            "invalid_eol",
            "Unsupported line ending style",
        ));
    }
    let path = resolve_for_write(root, rel)?;
    let exists = path.exists();
    if exists {
        let current =
            fs::read(&path).map_err(|e| AppError::io("Could not read existing file", e))?;
        if let Some(expected) = expected_hash {
            if sha256_hex(&current) != expected {
                return Err(AppError::new(
                    "file_changed",
                    "The file changed on disk since it was opened",
                ));
            }
        }
    } else if expected_hash.is_some() {
        return Err(AppError::new(
            "file_changed",
            "The file no longer exists on disk",
        ));
    } else {
        return Err(AppError::new("not_found", "The target file does not exist"));
    }

    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let final_text = if eol == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    let mut bytes = Vec::with_capacity(final_text.len() + 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(final_text.as_bytes());

    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "File has no parent folder"))?;
    let existing_permissions = fs::metadata(&path).ok().map(|m| m.permissions());
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::io("Could not create temporary file", e))?;
    temp.write_all(&bytes)
        .map_err(|e| AppError::io("Could not write file", e))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| AppError::io("Could not flush file", e))?;
    if let Some(perms) = existing_permissions {
        let _ = temp.as_file().set_permissions(perms);
    }
    temp.persist(&path)
        .map_err(|e| AppError::io("Could not replace file", e.error))?;
    let meta = fs::metadata(&path).map_err(|e| AppError::io("Could not verify file", e))?;
    Ok(WriteFileResult {
        hash: sha256_hex(&bytes),
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        size: bytes.len() as u64,
    })
}

pub fn create_file(root: &Path, rel: &str, content: &str) -> AppResult<()> {
    let path = resolve_for_write(root, rel)?;
    if path.exists() {
        return Err(AppError::new(
            "exists",
            "A file with that name already exists",
        ));
    }
    let mut file = fs::File::create(path).map_err(|e| AppError::io("Could not create file", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| AppError::io("Could not write file", e))?;
    file.sync_all()
        .map_err(|e| AppError::io("Could not flush file", e))?;
    Ok(())
}

pub fn create_folder(root: &Path, rel: &str) -> AppResult<()> {
    let path = resolve_for_write(root, rel)?;
    if path.exists() {
        return Err(AppError::new(
            "exists",
            "A file or folder with that name already exists",
        ));
    }
    fs::create_dir(&path).map_err(|e| AppError::io("Could not create folder", e))?;
    Ok(())
}

pub fn rename_path(root: &Path, rel: &str, new_rel: &str) -> AppResult<String> {
    let source = resolve_existing(root, rel)?;
    let target = resolve_for_write(root, new_rel)?;
    if target.exists() {
        return Err(AppError::new(
            "exists",
            "A file or folder with that name already exists",
        ));
    }
    fs::rename(&source, &target).map_err(|e| AppError::io("Could not rename", e))?;
    relative_path(root, &target)
        .ok_or_else(|| AppError::new("invalid_path", "Could not compute the new path"))
}

pub fn delete_path(root: &Path, rel: &str) -> AppResult<()> {
    let path = resolve_existing(root, rel)?;
    if path == root {
        return Err(AppError::new(
            "invalid_path",
            "The project folder itself cannot be deleted",
        ));
    }
    trash::delete(&path)
        .map_err(|e| AppError::new("delete_failed", format!("Could not move to Trash: {e}")))
}

pub fn duplicate_path(root: &Path, rel: &str) -> AppResult<String> {
    let source = resolve_existing(root, rel)?;
    let name = source
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| AppError::new("invalid_path", "Missing file name"))?;
    let parent = source
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "Missing parent folder"))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (name.clone(), String::new()),
    };
    let mut index = 1;
    let target = loop {
        let candidate_name = if index == 1 {
            format!("{stem} copy{ext}")
        } else {
            format!("{stem} copy {index}{ext}")
        };
        let candidate = parent.join(&candidate_name);
        if !candidate.exists() {
            break candidate;
        }
        index += 1;
        if index > 200 {
            return Err(AppError::new(
                "duplicate_failed",
                "Could not find an available duplicate name",
            ));
        }
    };
    if source.is_dir() {
        copy_directory(&source, &target)?;
    } else {
        fs::copy(&source, &target).map_err(|e| AppError::io("Could not duplicate file", e))?;
    }
    relative_path(root, &target)
        .ok_or_else(|| AppError::new("invalid_path", "Could not compute duplicate path"))
}

fn copy_directory(from: &Path, to: &Path) -> AppResult<()> {
    fs::create_dir_all(to).map_err(|e| AppError::io("Could not create folder", e))?;
    for entry in WalkDir::new(from).min_depth(1).follow_links(false) {
        let entry = entry.map_err(|e| AppError::new("copy_failed", e.to_string()))?;
        let rel = entry
            .path()
            .strip_prefix(from)
            .map_err(|_| AppError::new("copy_failed", "Unexpected source path"))?;
        let target = to.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| AppError::io("Could not create folder", e))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| AppError::io("Could not create folder", e))?;
            }
            fs::copy(entry.path(), &target).map_err(|e| AppError::io("Could not copy file", e))?;
        }
    }
    Ok(())
}

pub fn import_paths(root: &Path, sources: &[String], dest_rel: &str) -> AppResult<Vec<String>> {
    let dest_dir = if dest_rel.trim().is_empty() {
        root.to_path_buf()
    } else {
        resolve_existing(root, dest_rel)?
    };
    if !dest_dir.is_dir() {
        return Err(AppError::new(
            "invalid_path",
            "Import destination must be a folder",
        ));
    }
    let mut imported = Vec::new();
    for source in sources {
        let source_path = Path::new(source)
            .canonicalize()
            .map_err(|e| AppError::new("not_found", format!("Import source unavailable: {e}")))?;
        let name = source_path
            .file_name()
            .ok_or_else(|| AppError::new("invalid_path", "Import source has no name"))?;
        let target = dest_dir.join(name);
        if !target.starts_with(root) {
            return Err(AppError::new(
                "outside_project",
                "Import target is outside the project",
            ));
        }
        if target.exists() {
            return Err(AppError::new(
                "exists",
                format!("“{}” already exists in the project", name.to_string_lossy()),
            ));
        }
        if source_path.is_dir() {
            if target.starts_with(&source_path) {
                return Err(AppError::new(
                    "invalid_path",
                    "Cannot import a folder into itself",
                ));
            }
            copy_directory(&source_path, &target)?;
        } else if source_path.is_file() {
            fs::copy(&source_path, &target).map_err(|e| AppError::io("Could not copy file", e))?;
        } else {
            return Err(AppError::new("invalid_path", "Unsupported import source"));
        }
        if let Some(rel) = relative_path(root, &target) {
            imported.push(rel);
        }
    }
    Ok(imported)
}

pub fn revision(root: &Path) -> AppResult<String> {
    let root = canonical_root(&root.to_string_lossy())?;
    let mut files = 0u64;
    let mut total = 0u64;
    let mut newest = 0i64;
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            !(entry.file_type().is_dir()
                && should_skip_dir(&entry.file_name().to_string_lossy()))
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if should_skip_file(&name) {
            continue;
        }
        files += 1;
        if let Ok(metadata) = entry.metadata() {
            total = total.saturating_add(metadata.len());
            if let Ok(modified) = metadata.modified() {
                newest = newest.max(
                    modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|value| value.as_millis() as i64)
                        .unwrap_or(0),
                );
            }
        }
    }
    Ok(format!("{files}:{total}:{newest}"))
}

pub fn stat_file(root: &Path, rel: &str) -> AppResult<FileStat> {
    let path = root.join(validate_relative(rel)?);
    if !path.exists() {
        return Ok(FileStat {
            exists: false,
            modified_ms: 0,
            size: 0,
        });
    }
    let canonical = path.canonicalize().unwrap_or(path);
    if !canonical.starts_with(root) {
        return Err(AppError::new(
            "outside_project",
            "The path resolves outside the project folder",
        ));
    }
    let meta = fs::metadata(&canonical).map_err(|e| AppError::io("Could not read file info", e))?;
    Ok(FileStat {
        exists: true,
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        size: meta.len(),
    })
}

pub fn read_binary(root: &Path, rel: &str) -> AppResult<Vec<u8>> {
    let path = resolve_existing(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| AppError::io("Could not read file info", e))?;
    if meta.len() > MAX_BINARY_BYTES {
        return Err(AppError::new(
            "file_too_large",
            "The compiled PDF is too large to preview",
        ));
    }
    fs::read(&path).map_err(|e| AppError::io("Could not read file", e))
}

pub fn reveal_in_finder(path: &Path) -> AppResult<()> {
    let path = path
        .canonicalize()
        .map_err(|e| AppError::new("not_found", format!("Path unavailable: {e}")))?;
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|e| AppError::io("Could not open Finder", e))?;
    Ok(())
}

pub fn search_project(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
) -> AppResult<Vec<SearchMatch>> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let regex = if use_regex {
        Some(
            RegexBuilder::new(needle)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|e| {
                    AppError::new("invalid_regex", format!("Invalid regular expression: {e}"))
                })?,
        )
    } else {
        None
    };
    let needle_cmp = if case_sensitive {
        needle.to_string()
    } else {
        needle.to_lowercase()
    };
    let mut matches = Vec::new();
    let mut scanned = 0usize;
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir() && should_skip_dir(&name))
                && !(entry.file_type().is_file() && should_skip_file(&name))
        })
        .flatten()
    {
        if matches.len() >= 500 || scanned >= 4000 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.len() > 2 * 1024 * 1024 {
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
        scanned += 1;
        let rel = relative_path(root, entry.path()).unwrap_or_default();
        for (line_index, line) in text.lines().enumerate() {
            let found = if let Some(regex) = &regex {
                regex.find(line).map(|found| found.start())
            } else if case_sensitive {
                line.find(needle_cmp.as_str())
            } else {
                line.to_lowercase().find(needle_cmp.as_str())
            };
            if let Some(byte_idx) = found {
                let column = line[..byte_idx.min(line.len())].chars().count() as u32 + 1;
                matches.push(SearchMatch {
                    file: rel.clone(),
                    line: line_index as u32 + 1,
                    column,
                    preview: crate::util::truncate_chars(line.trim(), 240),
                });
                if matches.len() >= 500 {
                    break;
                }
            }
        }
    }
    Ok(matches)
}

pub fn project_file_count(root: &Path) -> usize {
    let mut counter = 0usize;
    let _ = read_tree(root, root, 0, &mut counter);
    counter
}

pub fn now_timestamp() -> i64 {
    now_ms()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn rejects_traversal() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        assert!(resolve_existing(&root, "../escape.tex").is_err());
        assert!(resolve_existing(&root, "/etc/passwd").is_err());
        assert!(resolve_for_write(&root, "sub/../../escape.tex").is_err());
    }

    #[test]
    fn writes_and_preserves_line_endings() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("a.tex"), "hello\r\nworld\r\n").unwrap();
        let read = read_file(&root, "a.tex").unwrap();
        assert_eq!(read.eol, "\r\n");
        assert_eq!(read.content, "hello\nworld\n");
        write_file(
            &root,
            "a.tex",
            "hello\nnext\n",
            "\r\n",
            false,
            Some(&read.hash),
        )
        .unwrap();
        let raw = fs::read(root.join("a.tex")).unwrap();
        assert_eq!(raw, b"hello\r\nnext\r\n");
    }

    #[test]
    fn detects_changed_file() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("a.tex"), "one").unwrap();
        let read = read_file(&root, "a.tex").unwrap();
        fs::write(root.join("a.tex"), "two").unwrap();
        let err = write_file(&root, "a.tex", "three", "\n", false, Some(&read.hash)).unwrap_err();
        assert_eq!(err.code, "file_changed");
    }

    #[test]
    fn detects_main_file() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("chapters")).unwrap();
        fs::write(root.join("chapters/intro.tex"), "text").unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\\begin{document}x\\end{document}",
        )
        .unwrap();
        let tex = vec!["chapters/intro.tex".into(), "main.tex".into()];
        assert_eq!(detect_main_file(&root, &tex), Some("main.tex".into()));
    }

    #[test]
    fn prevents_git_writes() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        assert!(resolve_for_write(&root, ".git/config").is_err());
        assert!(resolve_for_write(&root, ".latexstudio/build/x").is_err());
    }

    #[test]
    fn searches_with_regex_and_case_options() {
        let dir = temp_project();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("main.tex"), "Section 12\nsection 7\n").unwrap();
        let matches = search_project(&root, r"Section\s+\d+", false, true).unwrap();
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 1);
        let exact = search_project(&root, "Section", true, false).unwrap();
        assert_eq!(exact.len(), 1);
        assert!(search_project(&root, "(", false, true).is_err());
    }
}
