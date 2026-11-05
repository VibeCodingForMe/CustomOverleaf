use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::{ToolInfo, ToolsInfo};

pub fn path_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for extra in [
        "/Library/TeX/texbin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        let path = PathBuf::from(extra);
        if !dirs.contains(&path) {
            dirs.push(path);
        }
    }
    dirs
}

pub fn find_tool(name: &str) -> Option<PathBuf> {
    for dir in path_candidates() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn tool_info(name: &str) -> Option<ToolInfo> {
    let path = find_tool(name)?;
    let version = Command::new(&path)
        .arg("--version")
        .output()
        .ok()
        .map(|output| {
            let text = if output.stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).to_string()
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            text.lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("")
                .trim()
                .to_string()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "installed".into());
    Some(ToolInfo {
        path: path.to_string_lossy().to_string(),
        version,
    })
}

pub fn detect_tools() -> ToolsInfo {
    ToolsInfo {
        latexmk: tool_info("latexmk"),
        pdflatex: tool_info("pdflatex"),
        xelatex: tool_info("xelatex"),
        lualatex: tool_info("lualatex"),
        tectonic: tool_info("tectonic"),
        bibtex: tool_info("bibtex"),
        biber: tool_info("biber"),
        pandoc: tool_info("pandoc"),
        git: tool_info("git"),
        synctex: tool_info("synctex"),
    }
}

pub fn run_capture(program: &Path, args: &[&str], cwd: &Path) -> Result<(bool, String), String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok((
        output.status.success(),
        text.lines().take(400).collect::<Vec<_>>().join("\n"),
    ))
}
