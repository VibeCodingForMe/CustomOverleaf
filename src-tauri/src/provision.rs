use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::state::AppState;

const FONTS: &[&str] = &[
    "lmmono10-regular.otf",
    "lmmono10-italic.otf",
    "lmmonolt10-bold.otf",
    "lmmonolt10-boldoblique.otf",
    "latinmodern-math.otf",
];

fn resource_base(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    candidates
}

fn find_resource(app: &tauri::AppHandle, relative: &[&str]) -> Option<PathBuf> {
    for base in resource_base(app) {
        let mut candidate = base;
        for part in relative {
            candidate = candidate.join(part);
        }
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn copy_if_needed(source: &Path, target: &Path) -> Result<bool, String> {
    let source_len = fs::metadata(source)
        .map_err(|e| format!("Cannot read {}: {e}", source.display()))?
        .len();
    if let Ok(meta) = fs::metadata(target) {
        if meta.len() == source_len {
            return Ok(false);
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    fs::copy(source, target).map_err(|e| {
        format!(
            "Cannot copy {} to {}: {e}",
            source.display(),
            target.display()
        )
    })?;
    Ok(true)
}

fn provision_fonts(app: &tauri::AppHandle, log: &mut Vec<String>) {
    let Some(fonts_dir) =
        find_resource(app, &["fonts"]).or_else(|| find_resource(app, &["resources", "fonts"]))
    else {
        log.push("bundled fonts not found".into());
        return;
    };
    let Some(home) = dirs::home_dir() else {
        log.push("home directory not found; fonts not installed".into());
        return;
    };
    let target_dir = home.join("Library/Fonts");
    if let Err(err) = fs::create_dir_all(&target_dir) {
        log.push(format!("cannot create font directory: {err}"));
        return;
    }
    for name in FONTS {
        let source = fonts_dir.join(name);
        if !source.is_file() {
            log.push(format!("missing bundled font {name}"));
            continue;
        }
        let target = target_dir.join(format!("latexstudio-{name}"));
        match copy_if_needed(&source, &target) {
            Ok(true) => log.push(format!("installed font {name}")),
            Ok(false) => {}
            Err(err) => log.push(err),
        }
    }
}

fn provision_biber(
    app: &tauri::AppHandle,
    state: &AppState,
    log: &mut Vec<String>,
) -> Result<PathBuf, String> {
    let Some(source) = find_resource(app, &["bin", "biber"])
        .or_else(|| find_resource(app, &["resources", "bin", "biber"]))
    else {
        return Err("bundled biber not found".into());
    };
    let bin_dir = state.data_dir.join("bin");
    let target = bin_dir.join("biber");
    let copied = copy_if_needed(&source, &target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o755);
        fs::set_permissions(&target, permissions)
            .map_err(|e| format!("cannot make biber executable: {e}"))?;
    }
    if copied {
        log.push("installed bundled biber 2.17".into());
    }
    Ok(bin_dir)
}

/// Installs the fonts and bibliography tool that Tectonic needs into per-user
/// locations. This keeps the bundled app self-contained without requiring
/// Homebrew or a TeX Live installation.
pub fn provision(app: &tauri::AppHandle, state: &AppState) {
    let mut log = Vec::new();
    provision_fonts(app, &mut log);
    match provision_biber(app, state, &mut log) {
        Ok(_) => {}
        Err(err) => log.push(err),
    }
    if !log.is_empty() {
        let message = log.join("\n");
        eprintln!("[provision] {message}");
        let _ = fs::create_dir_all(&state.data_dir);
        let _ = fs::write(state.data_dir.join("provision.log"), format!("{message}\n"));
    }
}
