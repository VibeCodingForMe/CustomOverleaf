use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::Value;
use tauri::State;

use crate::{
    checkpoint, compiler, diagnostics, doctor,
    error::{AppError, AppResult},
    export, git, indexer,
    models::{
        BuildResult, CheckpointFileDiff, CheckpointPreview, CheckpointSummary, Diagnostic,
        DoctorReport, ExportResult, FileStat, FixSuggestion, GitStatus, LastPdf, ProjectIndex,
        ProjectSnapshot, ReadFileResult, ReplacePreview, ReplaceResult, RestoreResult, SearchMatch,
        Settings, SyncSource, SyncStatus, SyncTarget, ToolsInfo, WriteFileResult,
    },
    project, replace,
    state::AppState,
    synctex, tools,
    util::now_ms,
};

fn checkpoint_retention(state: &AppState) -> usize {
    state
        .settings
        .lock()
        .map(|settings| settings.history.retention)
        .unwrap_or(checkpoint::DEFAULT_RETENTION)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    state.settings_snapshot()
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, patch: Value) -> AppResult<Settings> {
    state.update_settings_json(patch)
}

#[tauri::command]
pub fn get_tools() -> ToolsInfo {
    tools::detect_tools()
}

#[tauri::command]
pub fn open_project(state: State<'_, AppState>, path: String) -> AppResult<ProjectSnapshot> {
    project::open_project(&path, &state)
}

#[tauri::command]
pub fn refresh_project(state: State<'_, AppState>, root: String) -> AppResult<ProjectSnapshot> {
    let root = project::canonical_root(&root)?;
    project::load_project(&root, &state)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    parent: String,
    name: String,
    template: String,
) -> AppResult<ProjectSnapshot> {
    project::create_project(&parent, &name, &template, &state)
}

#[tauri::command]
pub fn remove_recent(state: State<'_, AppState>, path: String) -> AppResult<()> {
    state.remove_recent(&path)
}

#[tauri::command]
pub fn set_main_file(
    state: State<'_, AppState>,
    root: String,
    main_file: String,
) -> AppResult<ProjectSnapshot> {
    let root_path = project::canonical_root(&root)?;
    let resolved = project::resolve_existing(&root_path, &main_file)?;
    if !resolved.is_file() || !resolved.to_string_lossy().to_lowercase().ends_with(".tex") {
        return Err(AppError::new(
            "invalid_main",
            "The main file must be a LaTeX .tex file",
        ));
    }
    state.set_main_file(&root, Some(main_file))?;
    project::load_project(&root_path, &state)
}

#[tauri::command]
pub fn read_project_file(root: String, rel: String) -> AppResult<ReadFileResult> {
    let root = project::canonical_root(&root)?;
    project::read_file(&root, &rel)
}

#[tauri::command]
pub fn write_project_file(
    state: State<'_, AppState>,
    root: String,
    rel: String,
    content: String,
    eol: String,
    bom: bool,
    expected_hash: Option<String>,
) -> AppResult<WriteFileResult> {
    let root_path = project::canonical_root(&root)?;
    let result = project::write_file(
        &root_path,
        &rel,
        &content,
        &eol,
        bom,
        expected_hash.as_deref(),
    )?;
    if let Err(err) = checkpoint::create_with_retention(
        &state.data_dir,
        &root_path,
        None,
        None,
        "auto",
        checkpoint_retention(&state),
    ) {
        eprintln!("Checkpoint failed for {rel}: {err}");
    }
    Ok(result)
}

#[tauri::command]
pub fn create_project_file(root: String, rel: String, content: String) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    project::create_file(&root, &rel, &content)
}

#[tauri::command]
pub fn create_project_folder(root: String, rel: String) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    project::create_folder(&root, &rel)
}

#[tauri::command]
pub fn rename_project_path(
    state: State<'_, AppState>,
    root: String,
    rel: String,
    new_rel: String,
) -> AppResult<String> {
    let root_path = project::canonical_root(&root)?;
    project::resolve_existing(&root_path, &rel)?;
    checkpoint::create_with_retention(
        &state.data_dir,
        &root_path,
        None,
        Some(format!("{rel} -> {new_rel}")),
        "pre-rename",
        checkpoint_retention(&state),
    )?;
    let renamed = project::rename_path(&root_path, &rel, &new_rel)?;
    if let Some(main) = state.main_file_for(&root) {
        if main == rel || main.starts_with(&format!("{rel}/")) {
            let suffix = main.strip_prefix(&rel).unwrap_or("");
            state.set_main_file(&root, Some(format!("{renamed}{suffix}")))?;
        }
    }
    Ok(renamed)
}

#[tauri::command]
pub fn delete_project_path(state: State<'_, AppState>, root: String, rel: String) -> AppResult<()> {
    let root_path = project::canonical_root(&root)?;
    project::resolve_existing(&root_path, &rel)?;
    checkpoint::create_with_retention(
        &state.data_dir,
        &root_path,
        None,
        Some(format!("file: {rel}")),
        "pre-delete",
        checkpoint_retention(&state),
    )?;
    project::delete_path(&root_path, &rel)?;
    if let Some(main) = state.main_file_for(&root) {
        if main == rel || main.starts_with(&format!("{rel}/")) {
            state.set_main_file(&root, None)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn duplicate_project_path(root: String, rel: String) -> AppResult<String> {
    let root = project::canonical_root(&root)?;
    project::duplicate_path(&root, &rel)
}

#[tauri::command]
pub fn import_project_paths(
    root: String,
    sources: Vec<String>,
    dest_rel: String,
) -> AppResult<Vec<String>> {
    let root = project::canonical_root(&root)?;
    project::import_paths(&root, &sources, &dest_rel)
}

#[tauri::command]
pub fn stat_project_file(root: String, rel: String) -> AppResult<FileStat> {
    let root = project::canonical_root(&root)?;
    project::stat_file(&root, &rel)
}

#[tauri::command]
pub async fn get_project_revision(root: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project::canonical_root(&root)?;
        project::revision(&root)
    })
    .await
    .map_err(|e| AppError::new("revision_failed", e.to_string()))?
}

#[tauri::command]
pub fn reveal_project_path(root: String, rel: String) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    let path = project::resolve_existing(&root, &rel)?;
    project::reveal_in_finder(&path)
}

#[tauri::command]
pub fn reveal_project(root: String) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    std::process::Command::new("open")
        .arg(root)
        .spawn()
        .map_err(|e| AppError::io("Could not open Finder", e))?;
    Ok(())
}

#[tauri::command]
pub fn search_project(
    root: String,
    query: String,
    case_sensitive: bool,
    regex: bool,
) -> AppResult<Vec<SearchMatch>> {
    let root = project::canonical_root(&root)?;
    project::search_project(&root, &query, case_sensitive, regex)
}

#[tauri::command]
pub async fn preview_replace(
    root: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
    regex: bool,
) -> AppResult<ReplacePreview> {
    let root = project::canonical_root(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        replace::preview(&root, &query, &replacement, case_sensitive, regex)
    })
    .await
    .map_err(|e| AppError::new("replace_failed", e.to_string()))?
}

#[tauri::command]
pub async fn apply_replace(
    state: State<'_, AppState>,
    root: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
    regex: bool,
    token: String,
) -> AppResult<ReplaceResult> {
    let root = project::canonical_root(&root)?;
    let data_dir = state.data_dir.clone();
    let retention = checkpoint_retention(&state);
    tauri::async_runtime::spawn_blocking(move || {
        replace::apply(
            &data_dir,
            &root,
            &query,
            &replacement,
            case_sensitive,
            regex,
            &token,
            retention,
        )
    })
    .await
    .map_err(|e| AppError::new("replace_failed", e.to_string()))?
}

#[tauri::command]
pub async fn get_project_index(
    state: State<'_, AppState>,
    root: String,
) -> AppResult<ProjectIndex> {
    let root_path = project::canonical_root(&root)?;
    let main_file = state.main_file_for(&root);
    tauri::async_runtime::spawn_blocking(move || {
        indexer::build_index(&root_path, main_file.as_deref())
    })
    .await
    .map_err(|e| AppError::new("index_failed", e.to_string()))?
}

#[tauri::command]
pub async fn run_project_doctor(
    state: State<'_, AppState>,
    root: String,
) -> AppResult<DoctorReport> {
    let root_path = project::canonical_root(&root)?;
    let main_file = state.main_file_for(&root);
    tauri::async_runtime::spawn_blocking(move || doctor::analyze(&root_path, main_file.as_deref()))
        .await
        .map_err(|e| AppError::new("doctor_failed", e.to_string()))?
}

#[tauri::command]
pub async fn compile_project(
    state: State<'_, AppState>,
    root: String,
    engine: String,
) -> AppResult<BuildResult> {
    let root_path = project::canonical_root(&root)?;
    let snapshot = project::load_project(&root_path, &state)?;
    let main_file = snapshot
        .main_file
        .ok_or_else(|| AppError::new("no_main_file", "Select a main .tex file for this project"))?;
    let settings = state.settings_snapshot()?;
    compiler::compile(&root_path, &main_file, &engine, &settings.compile, &state).await
}

#[tauri::command]
pub fn cancel_compilation(state: State<'_, AppState>) -> AppResult<()> {
    compiler::cancel(&state)
}

#[tauri::command]
pub fn get_build_status(state: State<'_, AppState>) -> AppResult<compiler::BuildStatus> {
    compiler::status(&state)
}

#[tauri::command]
pub fn get_last_pdf(root: String) -> AppResult<Option<LastPdf>> {
    let root = project::canonical_root(&root)?;
    compiler::last_pdf(&root)
}

#[tauri::command]
pub fn clean_project_build(state: State<'_, AppState>, root: String) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    let build_dir = state
        .settings
        .lock()
        .map(|settings| settings.compile.build_dir.clone())
        .unwrap_or_default();
    compiler::clean(&root, &build_dir)
}

#[tauri::command]
pub fn clean_project_aux(state: State<'_, AppState>, root: String) -> AppResult<u64> {
    let root = project::canonical_root(&root)?;
    let build_dir = state
        .settings
        .lock()
        .map(|settings| settings.compile.build_dir.clone())
        .unwrap_or_default();
    compiler::clean_aux(&root, &build_dir)
}

#[tauri::command]
pub fn suggest_diagnostic_fix(
    root: String,
    diagnostic: Diagnostic,
) -> AppResult<Option<FixSuggestion>> {
    let root = project::canonical_root(&root)?;
    diagnostics::suggest_fix(&root, &diagnostic)
}

#[tauri::command]
pub fn backup_project_file(
    state: State<'_, AppState>,
    root: String,
    rel: String,
) -> AppResult<String> {
    let root_path = project::canonical_root(&root)?;
    let source = project::resolve_existing(&root_path, &rel)?;
    let key = crate::util::sha256_hex(root_path.to_string_lossy().as_bytes());
    let dir = state
        .data_dir
        .join("backups")
        .join(&key[..16.min(key.len())]);
    fs::create_dir_all(&dir).map_err(|e| AppError::io("Could not create backup folder", e))?;
    let name = source
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let target = dir.join(format!("{}-{name}", now_ms()));
    fs::copy(&source, &target).map_err(|e| AppError::io("Could not create backup", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    export::path_exists(&path)
}

#[tauri::command]
pub fn export_project(
    state: State<'_, AppState>,
    root: String,
    format: String,
    dest: String,
    overwrite: bool,
) -> AppResult<ExportResult> {
    let root_path = project::canonical_root(&root)?;
    let main_file = if format == "tex" {
        state
            .main_file_for(&root)
            .ok_or_else(|| AppError::new("no_main_file", "Select a main .tex file first"))?
    } else {
        state.main_file_for(&root).unwrap_or_default()
    };
    export::export(&root_path, &format, &dest, overwrite, &main_file)
}

#[tauri::command]
pub async fn export_pandoc_project(
    state: State<'_, AppState>,
    root: String,
    format: String,
    dest: String,
    overwrite: bool,
) -> AppResult<ExportResult> {
    let root_path = project::canonical_root(&root)?;
    let main_file = state
        .main_file_for(&root)
        .ok_or_else(|| AppError::new("no_main_file", "Select a main .tex file first"))?;
    export::export_pandoc(&root_path, &format, &dest, overwrite, &main_file).await
}

#[tauri::command]
pub fn get_app_data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub fn reveal_app_data_dir(state: State<'_, AppState>) -> AppResult<()> {
    fs::create_dir_all(&state.data_dir)
        .map_err(|e| AppError::io("Could not create the application data folder", e))?;
    std::process::Command::new("open")
        .arg(&state.data_dir)
        .spawn()
        .map_err(|e| AppError::io("Could not open the data folder", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_git_status(root: String) -> AppResult<GitStatus> {
    let root = project::canonical_root(&root)?;
    git::status(&root)
}

#[tauri::command]
pub fn get_git_diff(root: String, rel: String) -> AppResult<String> {
    let root = project::canonical_root(&root)?;
    git::diff(&root, &rel)
}

#[tauri::command]
pub fn stage_git_paths(root: String, paths: Vec<String>) -> AppResult<()> {
    let root = project::canonical_root(&root)?;
    git::stage(&root, &paths)
}

#[tauri::command]
pub fn commit_git(root: String, message: String) -> AppResult<String> {
    let root = project::canonical_root(&root)?;
    git::commit(&root, &message)
}

#[tauri::command]
pub fn read_binary_base64(root: String, rel: String) -> AppResult<String> {
    let root = project::canonical_root(&root)?;
    let bytes = project::read_binary(&root, &rel)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn report_frontend_error(text: String) {
    eprintln!("[frontend] {text}");
}

#[tauri::command]
pub fn list_checkpoints(
    state: State<'_, AppState>,
    root: String,
) -> AppResult<Vec<CheckpointSummary>> {
    let root = project::canonical_root(&root)?;
    checkpoint::list(&state.data_dir, &root)
}

#[tauri::command]
pub fn create_checkpoint(
    state: State<'_, AppState>,
    root: String,
    name: Option<String>,
    description: Option<String>,
    kind: Option<String>,
) -> AppResult<Option<CheckpointSummary>> {
    let root = project::canonical_root(&root)?;
    checkpoint::create_with_retention(
        &state.data_dir,
        &root,
        name,
        description,
        kind.as_deref().unwrap_or("manual"),
        checkpoint_retention(&state),
    )
}

#[tauri::command]
pub fn preview_checkpoint(
    state: State<'_, AppState>,
    root: String,
    id: String,
) -> AppResult<CheckpointPreview> {
    let root = project::canonical_root(&root)?;
    checkpoint::preview(&state.data_dir, &root, &id)
}

#[tauri::command]
pub fn get_checkpoint_file_diff(
    state: State<'_, AppState>,
    root: String,
    id: String,
    path: String,
) -> AppResult<CheckpointFileDiff> {
    let root = project::canonical_root(&root)?;
    checkpoint::file_diff(&state.data_dir, &root, &id, &path)
}

#[tauri::command]
pub fn restore_checkpoint(
    state: State<'_, AppState>,
    root: String,
    id: String,
    token: String,
    paths: Option<Vec<String>>,
) -> AppResult<RestoreResult> {
    let root = project::canonical_root(&root)?;
    checkpoint::restore_with_retention(
        &state.data_dir,
        &root,
        &id,
        &token,
        paths,
        checkpoint_retention(&state),
    )
}

#[tauri::command]
pub fn synctex_status(root: String) -> AppResult<SyncStatus> {
    let root = project::canonical_root(&root)?;
    Ok(synctex::status(&root))
}

#[tauri::command]
pub fn forward_synctex(root: String, file: String, line: u32) -> AppResult<Option<SyncTarget>> {
    let root = project::canonical_root(&root)?;
    let resolved = project::resolve_existing(&root, &file)?;
    let relative = project::relative_path(&root, &resolved).ok_or_else(|| {
        AppError::new("outside_project", "The source file is outside the project")
    })?;
    synctex::forward(&root, &relative, line)
}

#[tauri::command]
pub fn reverse_synctex(root: String, page: u32, x: f64, y: f64) -> AppResult<Option<SyncSource>> {
    let root = project::canonical_root(&root)?;
    synctex::reverse(&root, page, x, y)
}

#[allow(dead_code)]
fn _assert_path(_: &Path, _: &PathBuf) {}
