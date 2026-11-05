use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use walkdir::WalkDir;

use crate::{
    error::{AppError, AppResult},
    models::{IndexCitation, IndexFloat, IndexHeading, IndexInclude, IndexLabel, IndexReference, ProjectIndex},
    util::now_ms,
};

const MAX_INDEX_FILES: usize = 4000;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const TEXT_EXTENSIONS: &[&str] = &["tex", "bib", "sty", "cls", "md", "txt"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "pdf", "eps", "webp"];

#[derive(Default)]
struct ParsedTex {
    headings: Vec<IndexHeading>,
    labels: Vec<IndexLabel>,
    references: Vec<IndexReference>,
    includes: Vec<IndexInclude>,
    packages: BTreeSet<String>,
    floats: Vec<IndexFloat>,
}

fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".svn"
            | ".hg"
            | ".latexstudio"
            | "node_modules"
            | "target"
            | "build"
            | ".idea"
            | ".vscode"
    )
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'%' {
            continue;
        }
        let mut slashes = 0;
        let mut cursor = index;
        while cursor > 0 && bytes[cursor - 1] == b'\\' {
            slashes += 1;
            cursor -= 1;
        }
        if slashes % 2 == 0 {
            return &line[..index];
        }
    }
    line
}

fn brace_content(input: &str, open: usize) -> Option<String> {
    if input.as_bytes().get(open) != Some(&b'{') {
        return None;
    }
    let mut depth = 0usize;
    for (offset, character) in input[open..].char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(input[open + 1..open + offset].trim().to_string());
                }
            }
            _ => {}
        }
    }
    None
}

fn clean_title(value: &str) -> String {
    static COMMAND: OnceLock<Regex> = OnceLock::new();
    let command = COMMAND.get_or_init(|| Regex::new(r"\\[a-zA-Z@]+\*?").unwrap());
    let without = command.replace_all(value, "");
    without
        .replace(['{', '}'], "")
        .replace('~', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_relative(path: &Path) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => result.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(result)
}

fn resolve_include(root: &Path, from_rel: &str, target: &str) -> Option<String> {
    let target = target.trim();
    if target.is_empty() || Path::new(target).is_absolute() {
        return None;
    }
    let base = Path::new(from_rel)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let mut joined = Vec::new();
    if let Some(relative) = normalize_relative(&base.join(target)) {
        joined.push(relative);
    }
    if let Some(relative) = normalize_relative(Path::new(target)) {
        if !joined.contains(&relative) {
            joined.push(relative);
        }
    }
    for joined in joined {
        let mut candidates = vec![joined.clone()];
        if joined.extension().is_none() {
            candidates.push(joined.with_extension("tex"));
        }
        for candidate in candidates {
            let absolute = root.join(&candidate);
            if absolute.is_file() {
                return Some(candidate.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    None
}

fn parse_tex(root: &Path, rel: &str, text: &str) -> ParsedTex {
    static HEADING: OnceLock<Regex> = OnceLock::new();
    static LABEL: OnceLock<Regex> = OnceLock::new();
    static CITE: OnceLock<Regex> = OnceLock::new();
    static INPUT: OnceLock<Regex> = OnceLock::new();
    static PACKAGE: OnceLock<Regex> = OnceLock::new();
    static CAPTION: OnceLock<Regex> = OnceLock::new();

    let heading_re = HEADING.get_or_init(|| {
        Regex::new(r"\\(part|chapter|section|subsection|subsubsection)(\*?)\s*\{").unwrap()
    });
    let label_re = LABEL
        .get_or_init(|| Regex::new(r"\\(label|ref|eqref|pageref|autoref|cref|Cref)\s*\{").unwrap());
    let cite_re = CITE.get_or_init(|| {
        Regex::new(
            r"\\(cite|citep|citet|parencite|textcite|autocite|footcite)\*?\s*(?:\[[^\]]*\]\s*)*\{",
        )
        .unwrap()
    });
    let input_re =
        INPUT.get_or_init(|| Regex::new(r"\\(input|include|subfile)\s*\{([^}]*)\}").unwrap());
    let package_re = PACKAGE
        .get_or_init(|| Regex::new(r"\\usepackage\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}").unwrap());
    let caption_re = CAPTION
        .get_or_init(|| Regex::new(r"\\(?:caption|captionof\{[^}]*\})\s*\{").unwrap());

    let mut float: Option<IndexFloat> = None;
    let mut parsed = ParsedTex::default();
    for (index, raw_line) in text.lines().enumerate() {
        let line_number = index as u32 + 1;
        let line = strip_comment(raw_line);
        if line.trim().is_empty() {
            continue;
        }

        if float.is_none() {
            let kind = ["figure", "table", "equation", "align"]
                .iter()
                .find(|kind| line.contains(&format!("\\begin{{{kind}}}")))
                .copied();
            if let Some(kind) = kind {
                float = Some(IndexFloat {
                    kind: kind.into(),
                    caption: String::new(),
                    label: None,
                    file: rel.to_string(),
                    line: line_number,
                });
            }
        }
        if let Some(active) = float.as_mut() {
            if let Some(captures) = caption_re.captures(line) {
                if let Some(open) = captures.get(0).map(|matched| matched.end() - 1) {
                    if let Some(caption) = brace_content(line, open) {
                        active.caption = clean_title(&caption);
                    }
                }
            }
            if active.label.is_none() {
                if let Some(captures) = label_re.captures(line) {
                    if captures.get(1).map(|value| value.as_str()) == Some("label") {
                        if let Some(open) = captures.get(0).map(|matched| matched.end() - 1) {
                            active.label = brace_content(line, open);
                        }
                    }
                }
            }
            let end = format!("\\end{{{}}}", active.kind);
            if line.contains(&end) {
                parsed.floats.push(float.take().unwrap());
            }
        }

        for captures in heading_re.captures_iter(line) {
            let Some(open) = captures.get(0).map(|matched| matched.end() - 1) else {
                continue;
            };
            let Some(title) = brace_content(line, open) else {
                continue;
            };
            let command = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let level = match command {
                "part" => 1,
                "chapter" => 2,
                "section" => 3,
                "subsection" => 4,
                "subsubsection" => 5,
                _ => continue,
            };
            parsed.headings.push(IndexHeading {
                level,
                title: clean_title(&title),
                file: rel.to_string(),
                line: line_number,
                starred: captures
                    .get(2)
                    .map(|value| !value.as_str().is_empty())
                    .unwrap_or(false),
            });
        }

        for captures in label_re.captures_iter(line) {
            let Some(open) = captures.get(0).map(|matched| matched.end() - 1) else {
                continue;
            };
            let Some(key) = brace_content(line, open) else {
                continue;
            };
            let command = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let key = key.trim().to_string();
            if key.is_empty() {
                continue;
            }
            if command == "label" {
                parsed.labels.push(IndexLabel {
                    key,
                    file: rel.to_string(),
                    line: line_number,
                });
            } else {
                parsed.references.push(IndexReference {
                    key,
                    file: rel.to_string(),
                    line: line_number,
                    command: command.to_string(),
                });
            }
        }

        for captures in cite_re.captures_iter(line) {
            let Some(open) = captures.get(0).map(|matched| matched.end() - 1) else {
                continue;
            };
            let Some(keys) = brace_content(line, open) else {
                continue;
            };
            for key in keys.split(',') {
                let key = key.trim();
                if !key.is_empty() {
                    parsed.references.push(IndexReference {
                        key: key.to_string(),
                        file: rel.to_string(),
                        line: line_number,
                        command: "cite".into(),
                    });
                }
            }
        }

        for captures in input_re.captures_iter(line) {
            let target = captures
                .get(2)
                .map(|value| value.as_str())
                .unwrap_or("")
                .trim();
            if target.is_empty() {
                continue;
            }
            parsed.includes.push(IndexInclude {
                file: rel.to_string(),
                line: line_number,
                target: target.to_string(),
                resolved: resolve_include(root, rel, target),
            });
        }

        for captures in package_re.captures_iter(line) {
            if let Some(packages) = captures.get(1) {
                for package in packages.as_str().split(',') {
                    let package = package.trim();
                    if !package.is_empty() {
                        parsed.packages.insert(package.to_string());
                    }
                }
            }
        }
    }
    if let Some(active) = float {
        parsed.floats.push(active);
    }
    parsed
}

fn parse_bib(text: &str) -> Vec<IndexCitation> {
    let field_re = Regex::new(r#"([A-Za-z][A-Za-z0-9_-]*)\s*=\s*[\{"]([^"}]*)"#).unwrap();
    let mut citations = Vec::new();
    let mut seen = HashSet::new();
    let mut entry_type = String::new();
    let mut key = String::new();
    let mut depth = 0i32;
    let mut fields: HashMap<String, String> = HashMap::new();
    let mut active = false;

    let flush = |entry_type: &str,
                 key: &str,
                 fields: &HashMap<String, String>,
                 citations: &mut Vec<IndexCitation>,
                 seen: &mut HashSet<String>| {
        if key.is_empty() || !seen.insert(key.to_string()) {
            return;
        }
        citations.push(IndexCitation {
            key: key.to_string(),
            entry_type: entry_type.to_string(),
            title: clean_title(fields.get("title").map(String::as_str).unwrap_or("")),
            author: clean_title(fields.get("author").map(String::as_str).unwrap_or("")),
            year: fields.get("year").cloned().unwrap_or_default(),
        });
    };

    for line in text.lines() {
        let trimmed = line.trim();
        if !active {
            if let Some(rest) = trimmed.strip_prefix('@') {
                let Some(open) = rest.find('{').or_else(|| rest.find('(')) else {
                    continue;
                };
                entry_type = rest[..open].trim().to_lowercase();
                if entry_type.is_empty()
                    || matches!(entry_type.as_str(), "string" | "comment" | "preamble")
                {
                    continue;
                }
                let after = &rest[open + 1..];
                let Some(comma) = after.find(',') else {
                    continue;
                };
                key = after[..comma].trim().trim_matches('"').to_string();
                fields.clear();
                depth = line.chars().filter(|c| *c == '{').count() as i32
                    - line.chars().filter(|c| *c == '}').count() as i32;
                active = true;
                for captures in field_re.captures_iter(line) {
                    if let (Some(name), Some(value)) = (captures.get(1), captures.get(2)) {
                        fields
                            .entry(name.as_str().to_lowercase())
                            .or_insert_with(|| value.as_str().to_string());
                    }
                }
                if depth <= 0 {
                    flush(&entry_type, &key, &fields, &mut citations, &mut seen);
                    active = false;
                }
            }
            continue;
        }

        depth += line.chars().filter(|c| *c == '{').count() as i32;
        depth -= line.chars().filter(|c| *c == '}').count() as i32;
        for captures in field_re.captures_iter(line) {
            if let (Some(name), Some(value)) = (captures.get(1), captures.get(2)) {
                fields
                    .entry(name.as_str().to_lowercase())
                    .or_insert_with(|| value.as_str().to_string());
            }
        }
        if depth <= 0 {
            flush(&entry_type, &key, &fields, &mut citations, &mut seen);
            active = false;
        }
    }
    citations
}

fn ordered_headings(
    main_file: Option<&str>,
    parsed: &HashMap<String, ParsedTex>,
) -> Vec<IndexHeading> {
    enum Event<'a> {
        Heading(&'a IndexHeading),
        Include(&'a IndexInclude),
    }

    fn visit(
        key: &str,
        parsed: &HashMap<String, ParsedTex>,
        headings: &mut Vec<IndexHeading>,
        visited: &mut HashSet<String>,
    ) {
        if !visited.insert(key.to_string()) {
            return;
        }
        let Some(file) = parsed.get(key) else {
            return;
        };
        let mut events: Vec<Event> = file
            .headings
            .iter()
            .map(Event::Heading)
            .chain(file.includes.iter().map(Event::Include))
            .collect();
        events.sort_by_key(|event| match event {
            Event::Heading(heading) => heading.line,
            Event::Include(include) => include.line,
        });
        for event in events {
            match event {
                Event::Heading(heading) => headings.push(heading.clone()),
                Event::Include(include) => {
                    if let Some(resolved) = &include.resolved {
                        if parsed.contains_key(resolved) {
                            visit(resolved, parsed, headings, visited);
                        }
                    }
                }
            }
        }
    }

    let mut headings = Vec::new();
    let mut visited = HashSet::new();
    if let Some(main) = main_file {
        if parsed.contains_key(main) {
            visit(main, parsed, &mut headings, &mut visited);
        }
    }
    let mut remaining: Vec<&String> = parsed.keys().collect();
    remaining.sort();
    for file in remaining {
        if !visited.contains(file) {
            visit(file, parsed, &mut headings, &mut visited);
        }
    }
    headings
}

pub fn build_index(root: &Path, main_file: Option<&str>) -> AppResult<ProjectIndex> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let mut text_files = Vec::new();
    let mut images = Vec::new();
    let mut scanned = 0usize;

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir() && skip_dir(&name))
        })
        .flatten()
    {
        if scanned >= MAX_INDEX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        scanned += 1;
        let ext = extension(entry.path());
        let rel = relative(&root, entry.path());
        if TEXT_EXTENSIONS.contains(&ext.as_str()) {
            text_files.push(rel);
        } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            images.push(rel);
        }
    }
    text_files.sort();
    images.sort();

    let mut parsed: HashMap<String, ParsedTex> = HashMap::new();
    let mut labels = Vec::new();
    let mut references = Vec::new();
    let mut includes = Vec::new();
    let mut packages = BTreeSet::new();
    let mut floats = Vec::new();
    let mut citations = Vec::new();
    let mut seen_citations = HashSet::new();

    for rel in &text_files {
        let path = root.join(rel);
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_SOURCE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.iter().take(4096).any(|byte| *byte == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let lower = rel.to_lowercase();
        if lower.ends_with(".tex") {
            let file = parse_tex(&root, rel, &text);
            labels.extend(file.labels.iter().cloned());
            references.extend(file.references.iter().cloned());
            includes.extend(file.includes.iter().cloned());
            packages.extend(file.packages.iter().cloned());
            floats.extend(file.floats.iter().cloned());
            parsed.insert(rel.clone(), file);
        } else if lower.ends_with(".bib") {
            for citation in parse_bib(&text) {
                if seen_citations.insert(citation.key.clone()) {
                    citations.push(citation);
                }
            }
        }
    }

    let headings = ordered_headings(main_file, &parsed);

    labels.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    references.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    includes.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    floats.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    citations.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(ProjectIndex {
        main_file: main_file.map(str::to_string),
        labels,
        citations,
        headings,
        floats,
        references,
        includes,
        files: text_files,
        images,
        packages: packages.into_iter().collect(),
        generated_at_ms: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_multifile_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(
            root.join("main.tex"),
            r#"\documentclass{article}
\usepackage{amsmath,graphicx}
\begin{document}
\section{Introduction}\label{sec:intro}
See \ref{sec:details} and \cite{knuth84}.
\input{chapters/details}
\section{Conclusion}
\end{document}"#,
        )
        .unwrap();
        fs::write(
            root.join("chapters/details.tex"),
            "\\subsection{Details}\\label{sec:details}\n",
        )
        .unwrap();
        fs::write(
            root.join("refs.bib"),
            "@book{knuth84,\n  title={The TeXbook},\n  author={Donald Knuth},\n  year={1984}\n}\n",
        )
        .unwrap();
        fs::write(root.join("figure.png"), b"not-an-image").unwrap();

        let index = build_index(&root, Some("main.tex")).unwrap();
        assert_eq!(index.headings.len(), 3);
        assert_eq!(
            index
                .headings
                .iter()
                .map(|heading| heading.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Introduction", "Details", "Conclusion"]
        );
        assert_eq!(index.labels.len(), 2);
        assert_eq!(index.citations[0].title, "The TeXbook");
        assert_eq!(
            index.includes[0].resolved.as_deref(),
            Some("chapters/details.tex")
        );
        assert!(index.images.contains(&"figure.png".to_string()));
        assert!(index.packages.contains(&"amsmath".to_string()));
    }
}
