use std::path::Path;
use std::process::Command;

use crate::{
    error::{AppError, AppResult},
    models::{GitChange, GitStatus},
};

const MAX_OUTPUT: usize = 600_000;

fn run_git(root: &Path, args: &[&str]) -> AppResult<std::process::Output> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| AppError::io("Could not run Git", e))?;
    Ok(output)
}

pub fn status(root: &Path) -> AppResult<GitStatus> {
    if !root.join(".git").exists() {
        return Ok(GitStatus {
            is_repo: false,
            branch: None,
            changes: Vec::new(),
            clean: true,
        });
    }
    let output = run_git(root, &["status", "--porcelain=v1", "-b"])?;
    if !output.status.success() {
        return Ok(GitStatus {
            is_repo: false,
            branch: None,
            changes: Vec::new(),
            clean: true,
        });
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut branch = None;
    let mut changes = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let name = rest.split("...").next().unwrap_or(rest).trim();
            if !name.is_empty() && !name.contains("No commits yet") {
                branch = Some(name.to_string());
            }
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let mut path = line[3..].to_string();
        if let Some((_, new_path)) = path.rsplit_once(" -> ") {
            path = new_path.to_string();
        }
        path = path.trim_matches('"').to_string();
        let staged = x != ' ' && x != '?';
        let status_text = format!("{}{}", x, y).trim().to_string();
        changes.push(GitChange {
            path,
            status: if status_text.is_empty() {
                "?".into()
            } else {
                status_text
            },
            staged,
        });
    }
    Ok(GitStatus {
        is_repo: true,
        branch,
        clean: changes.is_empty(),
        changes,
    })
}

pub fn diff(root: &Path, rel: &str) -> AppResult<String> {
    let output = run_git(root, &["diff", "--no-ext-diff", "--", rel])?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        let cached = run_git(root, &["diff", "--cached", "--no-ext-diff", "--", rel])?;
        text = String::from_utf8_lossy(&cached.stdout).to_string();
    }
    if text.len() > MAX_OUTPUT {
        text.truncate(MAX_OUTPUT);
        text.push_str("\n… diff truncated");
    }
    Ok(text)
}

pub fn stage(root: &Path, paths: &[String]) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    for path in paths {
        if path.starts_with('/') || path.contains("..") {
            return Err(AppError::new("invalid_path", "Invalid Git path"));
        }
    }
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    let output = run_git(root, &args)?;
    if !output.status.success() {
        return Err(AppError::new(
            "git_failed",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

pub fn commit(root: &Path, message: &str) -> AppResult<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::new(
            "empty_commit",
            "Commit message cannot be empty",
        ));
    }
    let output = run_git(root, &["commit", "-m", message])?;
    if !output.status.success() {
        return Err(AppError::new(
            "git_failed",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
