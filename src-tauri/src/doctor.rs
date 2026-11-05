use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

use crate::{
    error::{AppError, AppResult},
    indexer,
    models::{Diagnostic, DoctorReport},
    util::now_ms,
};

const MAX_DOCTOR_FILE_BYTES: u64 = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "pdf", "eps", "webp"];

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

fn normalize_relative(path: &Path) -> Option<String> {
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
    Some(result.to_string_lossy().replace('\\', "/"))
}

fn is_dynamic_target(target: &str) -> bool {
    target.contains('\\')
        || target.contains('#')
        || target.contains('{')
        || target.contains('}')
        || target.contains('%')
}

fn image_candidates(from_rel: &str, target: &str, graphics_paths: &[String]) -> Vec<PathBuf> {
    let target = target.trim().trim_matches('"').trim();
    if target.is_empty() || is_dynamic_target(target) || Path::new(target).is_absolute() {
        return Vec::new();
    }
    let base = Path::new(from_rel)
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_path_buf();
    let mut roots = Vec::new();
    roots.push(base.clone());
    roots.push(PathBuf::new());
    for path in graphics_paths {
        let candidate = Path::new(path);
        if candidate.is_absolute() {
            continue;
        }
        roots.push(Path::new("").join(candidate));
    }
    let mut candidates = Vec::new();
    for root in roots {
        let joined = root.join(target);
        let Some(normalized) = normalize_relative(&joined) else {
            continue;
        };
        let path = PathBuf::from(&normalized);
        if path.extension().is_some() {
            candidates.push(path);
        } else {
            for extension in IMAGE_EXTENSIONS {
                candidates.push(path.with_extension(extension));
            }
        }
    }
    candidates
}

fn diagnose(
    index: &mut usize,
    severity: &str,
    code: &str,
    message: String,
    raw: String,
    file: Option<String>,
    line: Option<u32>,
    params: &[(&str, String)],
) -> Diagnostic {
    *index += 1;
    let mut map = HashMap::new();
    for (key, value) in params {
        map.insert((*key).to_string(), value.clone());
    }
    Diagnostic {
        id: format!("doctor:{code}:{}", *index),
        severity: severity.to_string(),
        code: code.to_string(),
        message,
        raw,
        file,
        line,
        column: None,
        params: map,
        fixable: false,
    }
}

fn check_labels(
    labels: &[crate::models::IndexLabel],
    references: &[crate::models::IndexReference],
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    let mut seen: HashMap<&str, &crate::models::IndexLabel> = HashMap::new();
    for label in labels {
        if let Some(first) = seen.get(label.key.as_str()) {
            out.push(diagnose(
                next,
                "warning",
                "duplicate_label",
                format!(
                    "Label '{}' is defined more than once. First definition: {}:{}.",
                    label.key, first.file, first.line
                ),
                format!("\\label{{{}}}", label.key),
                Some(label.file.clone()),
                Some(label.line),
                &[
                    ("label", label.key.clone()),
                    ("firstFile", first.file.clone()),
                    ("firstLine", first.line.to_string()),
                    ("confidence", "high".into()),
                ],
            ));
        } else {
            seen.insert(label.key.as_str(), label);
        }
    }

    let label_keys: HashSet<&str> = labels.iter().map(|label| label.key.as_str()).collect();
    for reference in references {
        if reference.command == "cite" {
            continue;
        }
        if !label_keys.contains(reference.key.as_str()) {
            out.push(diagnose(
                next,
                "warning",
                "undefined_reference",
                format!(
                    "Reference '{}' has no matching \\label in this project.",
                    reference.key
                ),
                format!("\\{}{{{}}}", reference.command, reference.key),
                Some(reference.file.clone()),
                Some(reference.line),
                &[
                    ("key", reference.key.clone()),
                    ("reference", reference.key.clone()),
                    ("command", reference.command.clone()),
                    ("confidence", "high".into()),
                ],
            ));
        }
    }
}

fn check_citations(
    index: &crate::models::ProjectIndex,
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    let citation_keys: HashSet<&str> = index
        .citations
        .iter()
        .map(|citation| citation.key.as_str())
        .collect();
    let mut first_cite: Option<&crate::models::IndexReference> = None;
    for reference in &index.references {
        if reference.command != "cite" {
            continue;
        }
        first_cite.get_or_insert(reference);
        if !citation_keys.contains(reference.key.as_str()) {
            out.push(diagnose(
                next,
                "warning",
                "undefined_citation",
                format!(
                    "Citation '{}' was not found in the project bibliography.",
                    reference.key
                ),
                format!("\\cite{{{}}}", reference.key),
                Some(reference.file.clone()),
                Some(reference.line),
                &[
                    ("key", reference.key.clone()),
                    ("citation", reference.key.clone()),
                    (
                        "confidence",
                        if citation_keys.is_empty() {
                            "medium".into()
                        } else {
                            "high".into()
                        },
                    ),
                ],
            ));
        }
    }
    if citation_keys.is_empty() {
        if let Some(reference) = first_cite {
            out.push(diagnose(
                next,
                "warning",
                "missing_bibliography",
                "The project contains citations but no readable .bib bibliography was found."
                    .into(),
                "\\cite".into(),
                Some(reference.file.clone()),
                Some(reference.line),
                &[("confidence", "medium".into())],
            ));
        }
    }
}

fn check_includes(
    index: &crate::models::ProjectIndex,
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    for include in &index.includes {
        if include.resolved.is_some() {
            continue;
        }
        let target = include.target.trim();
        if target.is_empty() || is_dynamic_target(target) {
            continue;
        }
        out.push(diagnose(
            next,
            "error",
            "missing_include",
            format!("Included file '{}' was not found.", target),
            format!("\\input{{{}}}", target),
            Some(include.file.clone()),
            Some(include.line),
            &[("target", target.into()), ("confidence", "high".into())],
        ));
    }
}

fn check_circular_includes(
    index: &crate::models::ProjectIndex,
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    type Edge = (String, String, u32);
    let mut graph: HashMap<String, Vec<Edge>> = HashMap::new();
    for include in &index.includes {
        let Some(resolved) = &include.resolved else {
            continue;
        };
        graph.entry(include.file.clone()).or_default().push((
            resolved.clone(),
            include.file.clone(),
            include.line,
        ));
    }

    fn visit(
        node: &str,
        graph: &HashMap<String, Vec<Edge>>,
        state: &mut HashMap<String, u8>,
        stack: &mut Vec<String>,
        reported: &mut HashSet<String>,
        out: &mut Vec<Diagnostic>,
        next: &mut usize,
    ) {
        state.insert(node.to_string(), 1);
        stack.push(node.to_string());
        if let Some(edges) = graph.get(node) {
            for (target, from_file, line) in edges {
                match state.get(target).copied().unwrap_or(0) {
                    0 => visit(target, graph, state, stack, reported, out, next),
                    1 => {
                        let position = stack.iter().position(|item| item == target).unwrap_or(0);
                        let mut cycle: Vec<String> = stack[position..].to_vec();
                        cycle.push(target.clone());
                        let key = format!("{from_file}:{line}");
                        if reported.insert(key) {
                            out.push(diagnose(
                                next,
                                "error",
                                "circular_include",
                                format!("Circular include detected: {}.", cycle.join(" -> ")),
                                format!("\\input{{{}}}", target),
                                Some(from_file.clone()),
                                Some(*line),
                                &[("cycle", cycle.join(" -> ")), ("confidence", "high".into())],
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }
        stack.pop();
        state.insert(node.to_string(), 2);
    }

    let mut state: HashMap<String, u8> = HashMap::new();
    let mut stack = Vec::new();
    let mut reported = HashSet::new();
    let mut nodes: Vec<String> = graph.keys().cloned().collect();
    nodes.sort();
    for node in nodes {
        if state.get(&node).copied().unwrap_or(0) == 0 {
            visit(
                &node,
                &graph,
                &mut state,
                &mut stack,
                &mut reported,
                out,
                next,
            );
        }
    }
}

fn graphics_paths(text: &str) -> Vec<String> {
    static GRAPHICSPATH: OnceLock<Regex> = OnceLock::new();
    static INNER: OnceLock<Regex> = OnceLock::new();
    let graphics_path = GRAPHICSPATH
        .get_or_init(|| Regex::new(r"\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}").unwrap());
    let inner = INNER.get_or_init(|| Regex::new(r"\{([^}]*)\}").unwrap());
    let mut result = Vec::new();
    for captures in graphics_path.captures_iter(text) {
        let Some(list) = captures.get(1) else {
            continue;
        };
        for item in inner.captures_iter(list.as_str()) {
            if let Some(value) = item.get(1) {
                let directory = value.as_str().trim();
                if !directory.is_empty() {
                    result.push(directory.to_string());
                }
            }
        }
    }
    result
}

fn check_images(
    root: &Path,
    index: &crate::models::ProjectIndex,
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    static GRAPHICS: OnceLock<Regex> = OnceLock::new();
    let graphics = GRAPHICS.get_or_init(|| {
        Regex::new(r"\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}").unwrap()
    });
    let tex_files: Vec<String> = index
        .files
        .iter()
        .filter(|file| file.to_lowercase().ends_with(".tex"))
        .cloned()
        .collect();
    let mut referenced: HashSet<String> = HashSet::new();
    let mut has_graphicspath = false;
    let mut has_dynamic_reference = false;

    for rel in &tex_files {
        let path = root.join(rel);
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_DOCTOR_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.iter().take(4096).any(|byte| *byte == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let paths = graphics_paths(&text);
        if !paths.is_empty() {
            has_graphicspath = true;
        }
        for (line_index, line) in text.lines().enumerate() {
            let line_number = line_index as u32 + 1;
            for captures in graphics.captures_iter(strip_comment(line)) {
                let Some(target) = captures.get(1) else {
                    continue;
                };
                let target = target.as_str().trim();
                if target.is_empty() {
                    continue;
                }
                if is_dynamic_target(target) || Path::new(target).is_absolute() {
                    has_dynamic_reference = true;
                    continue;
                }
                let candidates = image_candidates(rel, target, &paths);
                if candidates.is_empty() {
                    has_dynamic_reference = true;
                    continue;
                }
                let mut found = None;
                for candidate in candidates {
                    if root.join(&candidate).is_file() {
                        found = Some(candidate.to_string_lossy().replace('\\', "/"));
                        break;
                    }
                }
                match found {
                    Some(path) => {
                        referenced.insert(path);
                    }
                    None => out.push(diagnose(
                        next,
                        "error",
                        "missing_image",
                        format!("Image '{}' was not found.", target),
                        format!("\\includegraphics{{{}}}", target),
                        Some(rel.clone()),
                        Some(line_number),
                        &[
                            ("target", target.into()),
                            (
                                "confidence",
                                if has_graphicspath { "medium" } else { "high" }.into(),
                            ),
                        ],
                    )),
                }
            }
        }
    }

    if has_dynamic_reference {
        return;
    }
    let mut unused: Vec<&String> = index
        .images
        .iter()
        .filter(|image| !referenced.contains(image.as_str()))
        .collect();
    unused.sort();
    for image in unused {
        out.push(diagnose(
            next,
            "info",
            "unused_image",
            format!(
                "Image '{}' is not referenced by any \\includegraphics.",
                image
            ),
            image.clone(),
            Some(image.clone()),
            None,
            &[
                (
                    "confidence",
                    if has_graphicspath { "low" } else { "medium" }.into(),
                ),
                ("image", image.clone()),
            ],
        ));
    }
}

fn check_structure(root: &Path, tex_files: &[String], out: &mut Vec<Diagnostic>, next: &mut usize) {
    static ENV: OnceLock<Regex> = OnceLock::new();
    let env_re = ENV.get_or_init(|| Regex::new(r"\\(begin|end)\s*\{([^}]*)\}").unwrap());
    let verbatim = ["verbatim", "verbatim*", "lstlisting", "minted", "comment"];

    for rel in tex_files {
        let path = root.join(rel);
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_DOCTOR_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.iter().take(4096).any(|byte| *byte == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut stack: Vec<(String, u32)> = Vec::new();
        let mut braces = 0i32;
        let mut in_verbatim = false;
        let mut last_line = 1u32;

        for (line_index, raw_line) in text.lines().enumerate() {
            let line_number = line_index as u32 + 1;
            last_line = line_number;
            let line = strip_comment(raw_line);
            if line.contains("\\verb") {
                continue;
            }
            for captures in env_re.captures_iter(line) {
                let Some(kind) = captures.get(1) else {
                    continue;
                };
                let Some(name) = captures.get(2) else {
                    continue;
                };
                let name = name.as_str().trim();
                if name.is_empty() {
                    continue;
                }
                if kind.as_str() == "begin" {
                    if verbatim.contains(&name) {
                        in_verbatim = true;
                    }
                    stack.push((name.to_string(), line_number));
                } else {
                    if verbatim.contains(&name) {
                        in_verbatim = false;
                    }
                    match stack.last() {
                        Some((open, _)) if open == name => {
                            stack.pop();
                        }
                        Some((open, _)) => {
                            let expected = open.clone();
                            out.push(diagnose(
                                next,
                                "warning",
                                "mismatched_environment",
                                format!(
                                    "Environment '{}' is closed while '{}' is still open.",
                                    name, expected
                                ),
                                format!("\\end{{{}}}", name),
                                Some(rel.clone()),
                                Some(line_number),
                                &[
                                    ("name", name.to_string()),
                                    ("expected", expected),
                                    ("confidence", "medium".into()),
                                ],
                            ));
                            if let Some(position) = stack.iter().rposition(|(item, _)| item == name)
                            {
                                stack.truncate(position);
                            }
                        }
                        None => {
                            out.push(diagnose(
                                next,
                                "warning",
                                "mismatched_environment",
                                format!("Environment '{}' is closed without being opened.", name),
                                format!("\\end{{{}}}", name),
                                Some(rel.clone()),
                                Some(line_number),
                                &[
                                    ("name", name.to_string()),
                                    ("expected", "".into()),
                                    ("confidence", "medium".into()),
                                ],
                            ));
                        }
                    }
                }
            }

            if in_verbatim {
                continue;
            }
            let bytes = line.as_bytes();
            let mut escaped = false;
            for byte in bytes {
                if escaped {
                    escaped = false;
                    continue;
                }
                if *byte == b'\\' {
                    escaped = true;
                    continue;
                }
                match *byte {
                    b'{' => braces += 1,
                    b'}' => braces -= 1,
                    _ => {}
                }
                if braces < 0 {
                    out.push(diagnose(
                        next,
                        "warning",
                        "unbalanced_braces",
                        "A closing brace has no matching opening brace.".into(),
                        "}".into(),
                        Some(rel.clone()),
                        Some(line_number),
                        &[("confidence", "medium".into())],
                    ));
                    braces = 0;
                }
            }
        }

        if braces > 0 {
            out.push(diagnose(
                next,
                "warning",
                "unbalanced_braces",
                format!("{} opening brace(s) are never closed.", braces),
                "{".into(),
                Some(rel.clone()),
                Some(last_line),
                &[
                    ("count", braces.to_string()),
                    ("confidence", "medium".into()),
                ],
            ));
        }
        if let Some((name, line)) = stack.last() {
            out.push(diagnose(
                next,
                "warning",
                "unclosed_environment",
                format!("Environment '{}' is never closed.", name),
                format!("\\begin{{{}}}", name),
                Some(rel.clone()),
                Some(*line),
                &[("name", name.clone()), ("confidence", "medium".into())],
            ));
        }
    }
}

fn check_unused_files(
    index: &crate::models::ProjectIndex,
    out: &mut Vec<Diagnostic>,
    next: &mut usize,
) {
    let Some(main) = index.main_file.as_deref() else {
        return;
    };
    let mut reachable: HashSet<String> = HashSet::new();
    reachable.insert(main.to_string());
    let mut changed = true;
    while changed {
        changed = false;
        for include in &index.includes {
            let Some(resolved) = &include.resolved else {
                continue;
            };
            if reachable.contains(&include.file) && reachable.insert(resolved.clone()) {
                changed = true;
            }
        }
    }
    for file in &index.files {
        if !file.to_lowercase().ends_with(".tex")
            || file == main
            || reachable.contains(file)
            || file.starts_with(".latexstudio/")
        {
            continue;
        }
        out.push(diagnose(
            next,
            "info",
            "unused_file",
            format!("'{file}' is not reachable from the main file through \\input or \\include."),
            String::new(),
            Some(file.clone()),
            Some(1),
            &[("file", file.clone()), ("confidence", "medium".into())],
        ));
    }
}

pub fn analyze(root: &Path, main_file: Option<&str>) -> AppResult<DoctorReport> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let index = indexer::build_index(&root, main_file)?;
    let tex_files: Vec<String> = index
        .files
        .iter()
        .filter(|file| file.to_lowercase().ends_with(".tex"))
        .cloned()
        .collect();
    let mut diagnostics = Vec::new();
    let mut next = 0usize;

    check_labels(
        &index.labels,
        &index.references,
        &mut diagnostics,
        &mut next,
    );
    check_citations(&index, &mut diagnostics, &mut next);
    check_includes(&index, &mut diagnostics, &mut next);
    check_circular_includes(&index, &mut diagnostics, &mut next);
    check_images(&root, &index, &mut diagnostics, &mut next);
    check_unused_files(&index, &mut diagnostics, &mut next);
    check_structure(&root, &tex_files, &mut diagnostics, &mut next);

    diagnostics.sort_by(|a, b| {
        let severity = |value: &str| match value {
            "error" => 0,
            "warning" => 1,
            _ => 2,
        };
        severity(&a.severity)
            .cmp(&severity(&b.severity))
            .then(a.file.cmp(&b.file))
            .then(a.line.cmp(&b.line))
            .then(a.code.cmp(&b.code))
    });
    let mut seen = HashSet::new();
    diagnostics.retain(|diagnostic| {
        seen.insert((
            diagnostic.code.clone(),
            diagnostic.file.clone(),
            diagnostic.line,
            diagnostic.message.clone(),
        ))
    });

    Ok(DoctorReport {
        diagnostics,
        checked_files: tex_files.len(),
        labels: index.labels.len(),
        references: index.references.len(),
        citations: index.citations.len(),
        images: index.images.len(),
        generated_at_ms: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(report: &DoctorReport) -> Vec<&str> {
        report
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect()
    }

    #[test]
    fn finds_structural_and_reference_problems() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(
            root.join("main.tex"),
            r#"\documentclass{article}
\begin{document}
\section{One}\label{sec:one}
\label{sec:one}
See \ref{sec:missing} and \cite{nope}.
\input{chapters/a}
\input{chapters/does-not-exist}
\includegraphics{images/missing}
\end{document}"#,
        )
        .unwrap();
        fs::write(
            root.join("chapters/a.tex"),
            "\\input{chapters/b}\n\\begin{itemize}\n\\item A\n",
        )
        .unwrap();
        fs::write(root.join("chapters/b.tex"), "\\input{chapters/a}\n").unwrap();
        fs::write(root.join("unused.png"), b"not-an-image").unwrap();

        let report = analyze(&root, Some("main.tex")).unwrap();
        let found = codes(&report);
        assert!(found.contains(&"duplicate_label"));
        assert!(found.contains(&"undefined_reference"));
        assert!(found.contains(&"undefined_citation"));
        assert!(found.contains(&"missing_bibliography"));
        assert!(found.contains(&"missing_include"));
        assert!(found.contains(&"circular_include"));
        assert!(found.contains(&"missing_image"));
        assert!(found.contains(&"unused_image"));
        assert!(found.contains(&"unclosed_environment"));
        assert_eq!(report.checked_files, 3);
    }

    #[test]
    fn detects_tex_files_not_reachable_from_main() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\input{used}\n\\end{document}",
        )
        .unwrap();
        fs::write(root.join("used.tex"), "Used").unwrap();
        fs::write(root.join("orphan.tex"), "Orphan").unwrap();
        let report = analyze(&root, Some("main.tex")).unwrap();
        let unused = report
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "unused_file")
            .collect::<Vec<_>>();
        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].file.as_deref(), Some("orphan.tex"));
        assert_eq!(unused[0].severity, "info");
    }

    #[test]
    #[ignore = "requires LATEX_STUDIO_TEST_PROJECT"]
    fn checks_a_real_project() {
        let Ok(root) = std::env::var("LATEX_STUDIO_TEST_PROJECT") else {
            return;
        };
        let main = std::env::var("LATEX_STUDIO_TEST_MAIN").unwrap_or_else(|_| "main.tex".into());
        let report = analyze(Path::new(&root), Some(&main)).unwrap();
        eprintln!("doctor: {} diagnostics", report.diagnostics.len());
        for diagnostic in &report.diagnostics {
            eprintln!(
                "{} {} {}:{} {}",
                diagnostic.severity,
                diagnostic.code,
                diagnostic.file.as_deref().unwrap_or("-"),
                diagnostic.line.unwrap_or(0),
                diagnostic.message
            );
        }
    }

    #[test]
    fn clean_project_has_no_structural_errors() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(
            root.join("main.tex"),
            r#"\documentclass{article}
\begin{document}
\section{One}\label{sec:one}
See \ref{sec:one}.
\end{document}"#,
        )
        .unwrap();
        let report = analyze(&root, Some("main.tex")).unwrap();
        assert!(report.diagnostics.is_empty());
    }
}
