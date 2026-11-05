use std::collections::{HashMap, HashSet};
use std::path::Path;

use regex::Regex;

use crate::error::{AppError, AppResult};
use crate::models::{Diagnostic, FixEdit, FixSuggestion};
use crate::project;

const MAX_DIAGNOSTICS: usize = 400;

fn param(pairs: &[(&str, String)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect()
}

fn clean_file(raw: &str, root: &Path, fallback: &str) -> String {
    let mut value = raw
        .trim()
        .trim_matches(|c| c == '(' || c == ')' || c == '"' || c == '\'');
    for prefix in ["error: ", "warning: "] {
        if let Some(stripped) = value.strip_prefix(prefix) {
            value = stripped.trim();
        }
    }
    let root_text = root.to_string_lossy();
    if let Some(rel) = value.strip_prefix(root_text.as_ref()) {
        value = rel.trim_start_matches('/');
    }
    let value = value.strip_prefix("./").unwrap_or(value);
    if value.is_empty() || (value.contains(' ') && !value.ends_with(".tex")) {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn line_from_input(msg: &str) -> Option<u32> {
    let re = Regex::new(r"(?i)(?:on input line|on line|at line|l\.)\s*(\d+)").ok()?;
    re.captures(msg)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

fn expand_params(params: &mut HashMap<String, String>, key: &str, value: impl Into<String>) {
    let value = value.into();
    if !value.trim().is_empty() {
        params.insert(key.to_string(), value);
    }
}

pub fn parse_diagnostics(
    root: &Path,
    main_file: &str,
    logs: &str,
    success: bool,
) -> Vec<Diagnostic> {
    let file_line_re = Regex::new(
        r"^(?P<file>(?:error: |warning: )?(?:\./)?[^:\n]+):(?P<line>\d+)(?::(?P<col>\d+))?:\s*(?P<msg>.+)$",
    )
    .expect("valid regex");
    let file_hint_re =
        Regex::new(r"(?:\(|^|\s)((?:\./)?[^\s()]+\.(?:tex|sty|cls))").expect("valid regex");
    let l_line_re = Regex::new(r"^l\.(\d+)\s*(.*)$").expect("valid regex");
    let command_re = Regex::new(r"\\([A-Za-z@]+)").expect("valid regex");
    let suggestion_re = Regex::new(r"(?i)did you mean\s+`?(\\[A-Za-z@]+)'?").expect("valid regex");
    let missing_file_re =
        Regex::new(r#"(?i)File [`']([^`']+)[`'] not found"#).expect("valid regex");
    let undefined_ref_re = Regex::new(
        r#"(?i)Reference [`']([^`']+)' (?:on page \S+ )?undefined(?: on input line (\d+))?"#,
    )
    .expect("valid regex");
    let undefined_cite_re = Regex::new(
        r#"(?i)Citation [`']([^`']+)' (?:on page \S+ )?undefined(?: on input line (\d+))?"#,
    )
    .expect("valid regex");
    let duplicate_label_re =
        Regex::new(r#"(?i)Label [`']([^`']+)' multiply defined"#).expect("valid regex");
    let package_warning_re =
        Regex::new(r"(?i)^Package (.+?) Warning: (.+?)(?: on input line (\d+))?\.?$")
            .expect("valid regex");
    let missing_env_re = Regex::new(r"(?i)Environment (.+?) undefined").expect("valid regex");
    let font_re =
        Regex::new(r"(?i)Font .+ not found|Font shape .+ undefined").expect("valid regex");
    let unicode_re = Regex::new(r"(?i)Unicode character .+ not set up|Unicode text .+ not set up")
        .expect("valid regex");

    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut seen: HashSet<(String, String, Option<u32>, String)> = HashSet::new();
    let mut last_file = main_file.to_string();
    let lines: Vec<&str> = logs.lines().collect();
    let mut index = 0usize;

    while index < lines.len() && diagnostics.len() < MAX_DIAGNOSTICS {
        let raw_line = lines[index];
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            index += 1;
            continue;
        }

        if let Some(caps) = file_hint_re.captures(trimmed) {
            if let Some(hint) = caps.get(1) {
                last_file = clean_file(hint.as_str(), root, &last_file);
            }
        }

        if let Some(caps) = file_line_re.captures(trimmed) {
            let file = clean_file(
                caps.name("file").map(|m| m.as_str()).unwrap_or(""),
                root,
                &last_file,
            );
            let line = caps
                .name("line")
                .and_then(|m| m.as_str().parse::<u32>().ok());
            let column = caps
                .name("col")
                .and_then(|m| m.as_str().parse::<u32>().ok());
            let message = caps
                .name("msg")
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let lower = message.to_lowercase();
            let severity = if trimmed.starts_with("warning:")
                || lower.contains("warning:")
                || lower.starts_with("overfull")
            {
                "warning"
            } else {
                "error"
            };
            let mut params = param(&[("file", file.clone())]);
            if let Some(line) = line {
                expand_params(&mut params, "line", line.to_string());
            }
            let (code, fixable) = if severity == "error" {
                ("compile_error".to_string(), false)
            } else {
                ("compile_warning".to_string(), false)
            };
            let key = (severity.to_string(), code.clone(), line, message.clone());
            if seen.insert(key) {
                diagnostics.push(Diagnostic {
                    id: format!("diag-{}-{}", diagnostics.len() + 1, code),
                    severity: severity.into(),
                    code,
                    message,
                    raw: raw_line.to_string(),
                    file: Some(file),
                    line,
                    column,
                    params,
                    fixable,
                });
            }
            index += 1;
            continue;
        }

        if trimmed.starts_with('!') {
            let message = trimmed.trim_start_matches('!').trim().to_string();
            let mut context = String::new();
            let mut context_line: Option<u32> = None;
            let mut command: Option<String> = None;
            for offset in 1..=4 {
                if index + offset >= lines.len() {
                    break;
                }
                let next = lines[index + offset];
                context.push_str(next);
                context.push('\n');
                if let Some(caps) = l_line_re.captures(next.trim()) {
                    context_line = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
                    if let Some(body) = caps.get(2) {
                        if let Some(cmd) = command_re.captures(body.as_str()) {
                            command = Some(cmd.get(1).map(|m| m.as_str().to_string()).unwrap());
                        }
                    }
                }
            }
            let mut params = param(&[("file", last_file.clone())]);
            if let Some(line) = context_line {
                expand_params(&mut params, "line", line.to_string());
            }
            let mut fixable = false;
            let code = if message.contains("Undefined control sequence") {
                if let Some(cmd) = &command {
                    expand_params(&mut params, "command", format!("\\{cmd}"));
                }
                if let Some(caps) = suggestion_re.captures(&context) {
                    if let Some(m) = caps.get(1) {
                        expand_params(&mut params, "suggestion", m.as_str());
                    }
                }
                fixable = command.is_some();
                "undefined_control_sequence"
            } else if let Some(caps) = missing_file_re.captures(&message) {
                let missing = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                expand_params(&mut params, "missing", missing);
                if missing.to_lowercase().ends_with(".sty") {
                    expand_params(&mut params, "package", missing.trim_end_matches(".sty"));
                    fixable = true;
                    "missing_package"
                } else if missing.to_lowercase().ends_with(".cls") {
                    "missing_class"
                } else {
                    "missing_file"
                }
            } else if let Some(caps) = missing_env_re.captures(&message) {
                if let Some(env) = caps.get(1) {
                    expand_params(&mut params, "environment", env.as_str());
                }
                "missing_environment"
            } else if message.contains("Runaway argument") {
                "runaway_argument"
            } else if message.contains("Missing $ inserted") {
                "missing_math"
            } else if message.contains("Missing } inserted")
                || message.contains("Missing { inserted")
                || message.contains("Extra }")
            {
                "brace_mismatch"
            } else if message.contains("Emergency stop") {
                "emergency_stop"
            } else if unicode_re.is_match(&message) {
                "unicode_pdftex"
            } else if font_re.is_match(&message) {
                "font_missing"
            } else if message.contains("I can't find file") {
                "missing_file"
            } else if message.contains("Missing \\begin{document}") {
                "missing_document"
            } else if message.contains("Missing \\item") {
                "missing_item"
            } else if message.contains("Extra alignment tab") {
                "table_alignment"
            } else {
                "latex_error"
            };
            let key = (
                "error".to_string(),
                code.to_string(),
                context_line,
                message.clone(),
            );
            if seen.insert(key) {
                diagnostics.push(Diagnostic {
                    id: format!("diag-{}-{}", diagnostics.len() + 1, code),
                    severity: "error".into(),
                    code: code.into(),
                    message,
                    raw: format!("{raw_line}\n{context}"),
                    file: Some(last_file.clone()),
                    line: context_line,
                    column: None,
                    params,
                    fixable,
                });
            }
            index += 1;
            continue;
        }

        let lower = trimmed.to_lowercase();
        if lower.starts_with("warning:") || lower.contains("latex warning:") {
            let message = trimmed
                .strip_prefix("warning: ")
                .unwrap_or(trimmed)
                .to_string();
            let mut params = param(&[("file", last_file.clone())]);
            let mut line = line_from_input(&message);
            let code;
            let mut fixable = false;
            if let Some(caps) = undefined_ref_re.captures(&message) {
                expand_params(
                    &mut params,
                    "reference",
                    caps.get(1).map(|m| m.as_str()).unwrap_or(""),
                );
                if let Some(l) = caps.get(2).and_then(|m| m.as_str().parse().ok()) {
                    line = Some(l);
                }
                code = "undefined_reference";
            } else if let Some(caps) = undefined_cite_re.captures(&message) {
                expand_params(
                    &mut params,
                    "citation",
                    caps.get(1).map(|m| m.as_str()).unwrap_or(""),
                );
                if let Some(l) = caps.get(2).and_then(|m| m.as_str().parse().ok()) {
                    line = Some(l);
                }
                code = "undefined_citation";
            } else if let Some(caps) = duplicate_label_re.captures(&message) {
                expand_params(
                    &mut params,
                    "label",
                    caps.get(1).map(|m| m.as_str()).unwrap_or(""),
                );
                code = "duplicate_label";
            } else if lower.contains("rerun to get cross-references right") {
                code = "rerun_needed";
            } else if lower.contains("please (re)run biber")
                || lower.contains("please (re)run bibtex")
                || lower.contains("there were undefined citations")
            {
                code = "bibliography_tool";
            } else if font_re.is_match(&message) {
                code = "font_substitution";
            } else if lower.contains("missing character") {
                code = "missing_glyph";
                fixable = false;
            } else {
                code = "latex_warning";
            }
            if let Some(line) = line {
                expand_params(&mut params, "line", line.to_string());
            }
            let key = (
                "warning".to_string(),
                code.to_string(),
                line,
                message.clone(),
            );
            if seen.insert(key) {
                diagnostics.push(Diagnostic {
                    id: format!("diag-{}-{}", diagnostics.len() + 1, code),
                    severity: "warning".into(),
                    code: code.into(),
                    message,
                    raw: raw_line.to_string(),
                    file: Some(last_file.clone()),
                    line,
                    column: None,
                    params,
                    fixable,
                });
            }
            index += 1;
            continue;
        }

        if let Some(caps) = package_warning_re.captures(trimmed) {
            let package = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let message = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let line = caps
                .get(3)
                .and_then(|m| m.as_str().parse::<u32>().ok())
                .or_else(|| line_from_input(trimmed));
            let mut params = param(&[
                ("file", last_file.clone()),
                ("package", package.to_string()),
            ]);
            if let Some(line) = line {
                expand_params(&mut params, "line", line.to_string());
            }
            let key = (
                "warning".to_string(),
                "package_warning".to_string(),
                line,
                message.to_string(),
            );
            if seen.insert(key) {
                diagnostics.push(Diagnostic {
                    id: format!("diag-{}-package_warning", diagnostics.len() + 1),
                    severity: "warning".into(),
                    code: "package_warning".into(),
                    message: message.to_string(),
                    raw: raw_line.to_string(),
                    file: Some(last_file.clone()),
                    line,
                    column: None,
                    params,
                    fixable: false,
                });
            }
        }

        index += 1;
    }

    if !success {
        let has_error = diagnostics.iter().any(|d| d.severity == "error");
        if !has_error {
            let code = if logs.contains("Emergency stop") {
                "emergency_stop"
            } else if logs.trim().is_empty() {
                "empty_compiler_output"
            } else {
                "compile_failed"
            };
            diagnostics.push(Diagnostic {
                id: "diag-compile-failed".into(),
                severity: "error".into(),
                code: code.into(),
                message:
                    "The compiler exited with an error, but did not report a structured message."
                        .into(),
                raw: logs
                    .lines()
                    .rev()
                    .take(8)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n"),
                file: Some(main_file.to_string()),
                line: None,
                column: None,
                params: param(&[("file", main_file.to_string())]),
                fixable: false,
            });
        }
    }

    diagnostics
}

fn typo_replacement(command: &str) -> Option<&'static str> {
    const TYPOS: &[(&str, &str)] = &[
        ("includgraphics", "includegraphics"),
        ("includegrahpics", "includegraphics"),
        ("includegraphic", "includegraphics"),
        ("uspackage", "usepackage"),
        ("usepacakge", "usepackage"),
        ("secton", "section"),
        ("subsecton", "subsection"),
        ("begn", "begin"),
        ("documnetclass", "documentclass"),
        ("maketitel", "maketitle"),
        ("tableofcontens", "tableofcontents"),
        ("centring", "centering"),
        ("cptation", "caption"),
        ("lable", "label"),
        ("refrence", "reference"),
        ("bibliograph", "bibliography"),
        ("figrue", "figure"),
        ("equaton", "equation"),
        ("itemze", "itemize"),
    ];
    TYPOS
        .iter()
        .find(|(typo, _)| *typo == command)
        .map(|(_, correct)| *correct)
}

pub fn suggest_fix(root: &Path, diagnostic: &Diagnostic) -> AppResult<Option<FixSuggestion>> {
    let file_rel = diagnostic
        .file
        .clone()
        .ok_or_else(|| AppError::new("no_file", "This diagnostic has no source file"))?;
    if !file_rel.ends_with(".tex") {
        return Ok(None);
    }
    let read = project::read_file(root, &file_rel)?;
    let lines: Vec<&str> = read.content.split('\n').collect();

    if diagnostic.code == "missing_package" {
        let package = diagnostic
            .params
            .get("package")
            .map(|p| p.trim())
            .unwrap_or("");
        if package.is_empty()
            || !package
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        {
            return Ok(None);
        }
        if read.content.contains(&format!("\\usepackage{{{package}}}"))
            || read.content.contains(&format!("\\usepackage["))
                && read.content.lines().any(|l| {
                    l.split('{')
                        .nth(1)
                        .map(|s| s.starts_with(package))
                        .unwrap_or(false)
                })
        {
            return Ok(None);
        }
        let begin_doc = lines
            .iter()
            .position(|l| l.contains("\\begin{document}"))
            .map(|i| i as u32 + 1);
        let insert_after = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| !l.trim_start().starts_with('%') && l.contains("\\usepackage"))
            .map(|(i, _)| i as u32 + 1)
            .last()
            .or_else(|| {
                lines
                    .iter()
                    .position(|l| l.contains("\\documentclass"))
                    .map(|i| i as u32 + 1)
            });
        let Some(insert_after) = insert_after else {
            return Ok(None);
        };
        if let Some(begin_doc) = begin_doc {
            if insert_after >= begin_doc {
                return Ok(None);
            }
        }
        let expected = lines
            .get(insert_after as usize - 1)
            .map(|l| l.to_string())
            .unwrap_or_default();
        return Ok(Some(FixSuggestion {
            code: "add_package".into(),
            file: file_rel,
            file_hash: read.hash,
            confidence: "high".into(),
            edits: vec![FixEdit {
                line: insert_after,
                kind: "insert_after_line".into(),
                expected: Some(expected),
                text: format!("\\usepackage{{{package}}}"),
            }],
            params: param(&[("package", package.to_string())]),
        }));
    }

    if diagnostic.code == "undefined_control_sequence" {
        let command = diagnostic
            .params
            .get("command")
            .cloned()
            .unwrap_or_default();
        let bare = command.trim_start_matches('\\');
        if bare == "includegraphics" && !read.content.contains("\\usepackage{graphicx}") {
            return Ok(Some(FixSuggestion {
                code: "add_package".into(),
                file: file_rel,
                file_hash: read.hash,
                confidence: "high".into(),
                edits: vec![FixEdit {
                    line: lines
                        .iter()
                        .position(|l| l.contains("\\documentclass"))
                        .map(|i| i as u32 + 1)
                        .unwrap_or(1),
                    kind: "insert_after_line".into(),
                    expected: lines
                        .iter()
                        .find(|l| l.contains("\\documentclass"))
                        .map(|l| l.to_string()),
                    text: "\\usepackage{graphicx}".into(),
                }],
                params: param(&[("package", "graphicx".into())]),
            }));
        }
        let replacement = diagnostic
            .params
            .get("suggestion")
            .map(|s| s.trim_start_matches('\\').to_string())
            .or_else(|| typo_replacement(bare).map(|s| s.to_string()));
        let Some(replacement) = replacement else {
            return Ok(None);
        };
        if replacement == bare {
            return Ok(None);
        }
        let line_no = diagnostic
            .line
            .ok_or_else(|| AppError::new("no_line", "The diagnostic has no line number"))?;
        let original = lines
            .get(line_no as usize - 1)
            .map(|l| l.to_string())
            .unwrap_or_default();
        if !original.contains(&format!("\\{bare}")) {
            return Ok(None);
        }
        let changed = original.replace(&format!("\\{bare}"), &format!("\\{replacement}"));
        return Ok(Some(FixSuggestion {
            code: "replace_command".into(),
            file: file_rel,
            file_hash: read.hash,
            confidence: "high".into(),
            edits: vec![FixEdit {
                line: line_no,
                kind: "replace_line".into(),
                expected: Some(original),
                text: changed,
            }],
            params: param(&[
                ("command", format!("\\{bare}")),
                ("replacement", format!("\\{replacement}")),
            ]),
        }));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(log: &str) -> Vec<Diagnostic> {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        parse_diagnostics(&root, "main.tex", log, false)
    }

    #[test]
    fn finds_undefined_command() {
        let log = "(./main.tex\n! Undefined control sequence.\nl.5 \\includgraphics{image}\n";
        let diagnostics = parse(log);
        let diag = diagnostics
            .iter()
            .find(|d| d.code == "undefined_control_sequence")
            .expect("diagnostic");
        assert_eq!(diag.line, Some(5));
        assert_eq!(
            diag.params.get("command").map(String::as_str),
            Some("\\includgraphics")
        );
        assert!(diag.fixable);
    }

    #[test]
    fn finds_missing_package() {
        let log = "! LaTeX Error: File `booktabs.sty' not found.\n";
        let diagnostics = parse(log);
        let diag = diagnostics
            .iter()
            .find(|d| d.code == "missing_package")
            .unwrap();
        assert_eq!(
            diag.params.get("package").map(String::as_str),
            Some("booktabs")
        );
        assert!(diag.fixable);
    }

    #[test]
    fn finds_undefined_reference_with_line() {
        let log = "LaTeX Warning: Reference `fig:a' on page 1 undefined on input line 12.\n";
        let diagnostics = parse(log);
        let diag = diagnostics
            .iter()
            .find(|d| d.code == "undefined_reference")
            .unwrap();
        assert_eq!(diag.line, Some(12));
        assert_eq!(
            diag.params.get("reference").map(String::as_str),
            Some("fig:a")
        );
    }

    #[test]
    fn recognizes_tectonic_file_line_errors() {
        let log = "error: main.tex:7: Undefined control sequence.\n";
        let diagnostics = parse(log);
        assert!(diagnostics.iter().any(|d| d.line == Some(7)));
    }

    #[test]
    fn suggests_package_insertion() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n",
        )
        .unwrap();
        let diagnostic = Diagnostic {
            id: "1".into(),
            severity: "error".into(),
            code: "missing_package".into(),
            message: "File booktabs.sty not found".into(),
            raw: String::new(),
            file: Some("main.tex".into()),
            line: None,
            column: None,
            params: param(&[("package", "booktabs".into())]),
            fixable: true,
        };
        let fix = suggest_fix(&root, &diagnostic).unwrap().unwrap();
        assert_eq!(fix.code, "add_package");
        assert!(fix.edits[0].text.contains("booktabs"));
    }
}
