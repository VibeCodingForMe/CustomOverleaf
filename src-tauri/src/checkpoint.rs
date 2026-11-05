use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use walkdir::WalkDir;

use crate::{
    error::{AppError, AppResult},
    models::{
        CheckpointDiffLine, CheckpointFileChange, CheckpointFileDiff, CheckpointManifest,
        CheckpointManifestFile, CheckpointPreview, CheckpointSummary, RestoreResult,
    },
    project,
    state::project_history_dir,
    util::{now_ms, sha256_hex},
};

pub const DEFAULT_RETENTION: usize = 80;
const MIN_RETENTION: usize = 2;
const MAX_RETENTION: usize = 1000;
const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_FILES: usize = 6000;
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".latexstudio",
    "node_modules",
    "target",
    "build",
    ".idea",
    ".vscode",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CheckpointIndex {
    summaries: Vec<CheckpointSummary>,
}

#[derive(Debug, Clone)]
struct ScannedFile {
    path: String,
    hash: String,
    size: u64,
    binary: bool,
    bytes: Vec<u8>,
}

impl ScannedFile {
    fn manifest(&self) -> CheckpointManifestFile {
        CheckpointManifestFile {
            path: self.path.clone(),
            hash: self.hash.clone(),
            size: self.size,
            binary: self.binary,
        }
    }
}

fn checkpoints_dir(data_dir: &Path, root: &Path) -> PathBuf {
    project_history_dir(data_dir, root).join("checkpoints")
}

fn blobs_dir(data_dir: &Path, root: &Path) -> PathBuf {
    checkpoints_dir(data_dir, root).join("blobs")
}

fn index_path(data_dir: &Path, root: &Path) -> PathBuf {
    checkpoints_dir(data_dir, root).join("index.json")
}

fn manifest_path(data_dir: &Path, root: &Path, id: &str) -> PathBuf {
    checkpoints_dir(data_dir, root).join(format!("{id}.json"))
}

fn blob_path(data_dir: &Path, root: &Path, hash: &str) -> PathBuf {
    blobs_dir(data_dir, root).join(format!("{hash}.blob"))
}

fn read_index(data_dir: &Path, root: &Path) -> CheckpointIndex {
    let path = index_path(data_dir, root);
    let Ok(text) = fs::read_to_string(path) else {
        return CheckpointIndex::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_index(data_dir: &Path, root: &Path, index: &CheckpointIndex) -> AppResult<()> {
    let dir = checkpoints_dir(data_dir, root);
    fs::create_dir_all(&dir).map_err(|e| AppError::io("Could not create checkpoint folder", e))?;
    let temp = dir.join("index.json.tmp");
    let text = serde_json::to_string_pretty(index)?;
    fs::write(&temp, text).map_err(|e| AppError::io("Could not write checkpoint index", e))?;
    fs::rename(temp, index_path(data_dir, root))
        .map_err(|e| AppError::io("Could not save checkpoint index", e))
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::new("invalid_checkpoint", "Invalid checkpoint id"));
    }
    Ok(())
}

fn load_manifest(data_dir: &Path, root: &Path, id: &str) -> AppResult<CheckpointManifest> {
    validate_id(id)?;
    let path = manifest_path(data_dir, root, id);
    let text = fs::read_to_string(&path).map_err(|_| {
        AppError::new(
            "checkpoint_not_found",
            "That checkpoint is no longer available",
        )
    })?;
    serde_json::from_str(&text).map_err(|e| {
        AppError::new(
            "checkpoint_invalid",
            format!("Checkpoint metadata is damaged: {e}"),
        )
    })
}

fn latest_manifest(data_dir: &Path, root: &Path) -> Option<CheckpointManifest> {
    let index = read_index(data_dir, root);
    index
        .summaries
        .first()
        .and_then(|summary| load_manifest(data_dir, root, &summary.id).ok())
}

fn scan_files(root: &Path) -> AppResult<Vec<ScannedFile>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .max_depth(20)
        .into_iter()
        .filter_entry(|entry| {
            !(entry.file_type().is_dir()
                && IGNORED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
        })
        .flatten()
    {
        if files.len() >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if name == ".DS_Store" || name == "Thumbs.db" {
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
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = rel.to_string_lossy().replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        let binary = bytes.contains(&0) || std::str::from_utf8(&bytes).is_err();
        files.push(ScannedFile {
            path,
            hash: sha256_hex(&bytes),
            size: bytes.len() as u64,
            binary,
            bytes,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn fingerprint(files: &[CheckpointManifestFile]) -> String {
    let mut sorted: Vec<&CheckpointManifestFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut hasher_input = String::new();
    for file in sorted {
        hasher_input.push_str(&file.path);
        hasher_input.push('\0');
        hasher_input.push_str(&file.hash);
        hasher_input.push('\n');
    }
    sha256_hex(hasher_input.as_bytes())
}

fn store_blob(data_dir: &Path, root: &Path, file: &ScannedFile) -> AppResult<()> {
    let target = blob_path(data_dir, root, &file.hash);
    if target.is_file() {
        return Ok(());
    }
    let dir = blobs_dir(data_dir, root);
    fs::create_dir_all(&dir).map_err(|e| AppError::io("Could not create blob folder", e))?;
    let temp = dir.join(format!("{}.tmp", file.hash));
    fs::write(&temp, &file.bytes)
        .map_err(|e| AppError::io("Could not store checkpoint blob", e))?;
    fs::rename(temp, target).map_err(|e| AppError::io("Could not commit checkpoint blob", e))
}

fn prune_unreferenced_blobs(data_dir: &Path, root: &Path, index: &CheckpointIndex) {
    let mut referenced = HashSet::new();
    for summary in &index.summaries {
        if let Ok(manifest) = load_manifest(data_dir, root, &summary.id) {
            for file in manifest.files {
                referenced.insert(file.hash);
            }
        }
    }
    let Ok(entries) = fs::read_dir(blobs_dir(data_dir, root)) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(hash) = name.strip_suffix(".blob") else {
            continue;
        };
        if !referenced.contains(hash) {
            let _ = fs::remove_file(path);
        }
    }
}

fn read_blob(data_dir: &Path, root: &Path, hash: &str) -> AppResult<Vec<u8>> {
    fs::read(blob_path(data_dir, root, hash))
        .map_err(|_| AppError::new("checkpoint_blob_missing", "Checkpoint data is incomplete"))
}

fn line_counts(old: &[u8], new: &[u8]) -> (u32, u32) {
    if old.contains(&0) || new.contains(&0) {
        return (0, 0);
    }
    let Ok(old_text) = std::str::from_utf8(old) else {
        return (0, 0);
    };
    let Ok(new_text) = std::str::from_utf8(new) else {
        return (0, 0);
    };
    let diff = TextDiff::from_lines(old_text, new_text);
    let mut additions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }
    (additions, deletions)
}

fn changes_between(
    old_files: &[CheckpointManifestFile],
    new_files: &[ScannedFile],
    data_dir: &Path,
    root: &Path,
) -> AppResult<Vec<CheckpointFileChange>> {
    let old_map: HashMap<&str, &CheckpointManifestFile> = old_files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let new_map: HashMap<&str, &ScannedFile> = new_files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut changes = Vec::new();
    let mut deleted: Vec<&CheckpointManifestFile> = Vec::new();
    let mut added: Vec<&ScannedFile> = Vec::new();

    for (path, old) in &old_map {
        match new_map.get(path) {
            Some(new) if new.hash == old.hash => {}
            Some(new) => {
                let old_bytes = read_blob(data_dir, root, &old.hash)?;
                let (additions, deletions) = line_counts(&old_bytes, &new.bytes);
                changes.push(CheckpointFileChange {
                    path: path.to_string(),
                    old_path: None,
                    status: "M".into(),
                    additions,
                    deletions,
                    binary: old.binary || new.binary,
                    old_size: old.size,
                    new_size: new.size,
                });
            }
            None => deleted.push(old),
        }
    }
    for (path, new) in &new_map {
        if !old_map.contains_key(path) {
            added.push(new);
        }
    }

    let mut paired_new: HashSet<&str> = HashSet::new();
    for old in &deleted {
        if let Some(new) = added.iter().find(|candidate| {
            !paired_new.contains(candidate.path.as_str()) && candidate.hash == old.hash
        }) {
            paired_new.insert(new.path.as_str());
            changes.push(CheckpointFileChange {
                path: new.path.clone(),
                old_path: Some(old.path.clone()),
                status: "R".into(),
                additions: 0,
                deletions: 0,
                binary: old.binary || new.binary,
                old_size: old.size,
                new_size: new.size,
            });
        } else {
            let old_bytes = read_blob(data_dir, root, &old.hash)?;
            let lines = if old.binary {
                0
            } else {
                String::from_utf8_lossy(&old_bytes).lines().count() as u32
            };
            changes.push(CheckpointFileChange {
                path: old.path.clone(),
                old_path: None,
                status: "D".into(),
                additions: 0,
                deletions: lines,
                binary: old.binary,
                old_size: old.size,
                new_size: 0,
            });
        }
    }
    for new in &added {
        if paired_new.contains(new.path.as_str()) {
            continue;
        }
        let lines = if new.binary {
            0
        } else {
            String::from_utf8_lossy(&new.bytes).lines().count() as u32
        };
        changes.push(CheckpointFileChange {
            path: new.path.clone(),
            old_path: None,
            status: "A".into(),
            additions: lines,
            deletions: 0,
            binary: new.binary,
            old_size: 0,
            new_size: new.size,
        });
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(changes)
}

fn summary_from_changes(
    id: String,
    name: Option<String>,
    description: Option<String>,
    created_at_ms: i64,
    kind: String,
    total_files: usize,
    changes: &[CheckpointFileChange],
) -> CheckpointSummary {
    let added = changes.iter().filter(|c| c.status == "A").count();
    let modified = changes.iter().filter(|c| c.status == "M").count();
    let deleted = changes.iter().filter(|c| c.status == "D").count();
    let renamed = changes.iter().filter(|c| c.status == "R").count();
    let additions = changes.iter().map(|c| c.additions).sum();
    let deletions = changes.iter().map(|c| c.deletions).sum();
    let binary_files = changes.iter().filter(|c| c.binary).count();
    CheckpointSummary {
        id,
        name,
        description,
        created_at_ms,
        kind,
        total_files,
        file_count: changes.len(),
        added,
        modified,
        deleted,
        renamed,
        additions,
        deletions,
        binary_files,
        files: changes.to_vec(),
    }
}

pub fn create(
    data_dir: &Path,
    root: &Path,
    name: Option<String>,
    description: Option<String>,
    kind: &str,
) -> AppResult<Option<CheckpointSummary>> {
    create_with_retention(data_dir, root, name, description, kind, DEFAULT_RETENTION)
}

pub fn create_with_retention(
    data_dir: &Path,
    root: &Path,
    name: Option<String>,
    description: Option<String>,
    kind: &str,
    retention: usize,
) -> AppResult<Option<CheckpointSummary>> {
    let retention = retention.clamp(MIN_RETENTION, MAX_RETENTION);
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let current = scan_files(&root)?;
    let current_manifest: Vec<CheckpointManifestFile> =
        current.iter().map(ScannedFile::manifest).collect();
    let previous = latest_manifest(data_dir, &root);
    if let Some(previous) = &previous {
        if fingerprint(&previous.files) == fingerprint(&current_manifest) {
            return Ok(None);
        }
    }
    let old_files = previous
        .as_ref()
        .map(|manifest| manifest.files.as_slice())
        .unwrap_or(&[]);
    let changes = changes_between(old_files, &current, data_dir, &root)?;
    for file in &current {
        store_blob(data_dir, &root, file)?;
    }
    let created_at_ms = now_ms();
    let mut id = created_at_ms.to_string();
    while manifest_path(data_dir, &root, &id).exists() {
        let next = id.parse::<i64>().unwrap_or(created_at_ms) + 1;
        id = next.to_string();
    }
    let name = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let description = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let manifest = CheckpointManifest {
        id: id.clone(),
        name: name.clone(),
        description: description.clone(),
        created_at_ms,
        kind: kind.to_string(),
        parent_id: previous.as_ref().map(|value| value.id.clone()),
        files: current_manifest,
    };
    let dir = checkpoints_dir(data_dir, &root);
    fs::create_dir_all(&dir).map_err(|e| AppError::io("Could not create checkpoint folder", e))?;
    let temp = dir.join(format!("{id}.json.tmp"));
    let text = serde_json::to_string_pretty(&manifest)?;
    fs::write(&temp, text).map_err(|e| AppError::io("Could not write checkpoint", e))?;
    fs::rename(temp, manifest_path(data_dir, &root, &id))
        .map_err(|e| AppError::io("Could not commit checkpoint", e))?;

    let summary = summary_from_changes(
        id,
        name,
        description,
        created_at_ms,
        kind.to_string(),
        manifest.files.len(),
        &changes,
    );
    let mut index = read_index(data_dir, &root);
    index.summaries.insert(0, summary.clone());
    index
        .summaries
        .sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    let mut pruned = false;
    while index.summaries.len() > retention {
        if let Some(old) = index.summaries.pop() {
            let _ = fs::remove_file(manifest_path(data_dir, &root, &old.id));
            pruned = true;
        }
    }
    write_index(data_dir, &root, &index)?;
    if pruned {
        prune_unreferenced_blobs(data_dir, &root, &index);
    }
    Ok(Some(summary))
}

pub fn list(data_dir: &Path, root: &Path) -> AppResult<Vec<CheckpointSummary>> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let mut summaries = read_index(data_dir, &root).summaries;
    summaries.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(summaries)
}

pub fn preview(data_dir: &Path, root: &Path, id: &str) -> AppResult<CheckpointPreview> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let target = load_manifest(data_dir, &root, id)?;
    let current = scan_files(&root)?;
    let changes = changes_between(&target.files, &current, data_dir, &root)?;
    let summary = summary_from_changes(
        target.id.clone(),
        target.name.clone(),
        target.description.clone(),
        target.created_at_ms,
        target.kind.clone(),
        target.files.len(),
        &changes,
    );
    let added = changes.iter().filter(|c| c.status == "A").count();
    let modified = changes.iter().filter(|c| c.status == "M").count();
    let deleted = changes.iter().filter(|c| c.status == "D").count();
    let renamed = changes.iter().filter(|c| c.status == "R").count();
    Ok(CheckpointPreview {
        checkpoint: summary,
        token: fingerprint(
            &current
                .iter()
                .map(ScannedFile::manifest)
                .collect::<Vec<_>>(),
        ),
        files: changes.clone(),
        added,
        modified,
        deleted,
        renamed,
        additions: changes.iter().map(|c| c.additions).sum(),
        deletions: changes.iter().map(|c| c.deletions).sum(),
    })
}

pub fn file_diff(
    data_dir: &Path,
    root: &Path,
    id: &str,
    path: &str,
) -> AppResult<CheckpointFileDiff> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let target = load_manifest(data_dir, &root, id)?;
    let preview = preview(data_dir, &root, id)?;
    let change = preview
        .files
        .iter()
        .find(|file| file.path == path || file.old_path.as_deref() == Some(path))
        .ok_or_else(|| {
            AppError::new(
                "file_not_affected",
                "This file is not part of the checkpoint change",
            )
        })?;
    let target_file = target.files.iter().find(|file| file.path == change.path);
    let old_bytes = match target_file {
        Some(file) => read_blob(data_dir, &root, &file.hash)?,
        None => Vec::new(),
    };
    let current_path = project::resolve_existing(&root, &change.path);
    let new_bytes = match current_path {
        Ok(path) if path.is_file() => fs::read(path).unwrap_or_default(),
        _ => Vec::new(),
    };
    let binary = change.binary || old_bytes.contains(&0) || new_bytes.contains(&0);
    let lines = if binary {
        Vec::new()
    } else {
        diff_lines(&old_bytes, &new_bytes)
    };
    Ok(CheckpointFileDiff {
        path: change.path.clone(),
        old_path: change.old_path.clone(),
        status: change.status.clone(),
        binary,
        old_size: old_bytes.len() as u64,
        new_size: new_bytes.len() as u64,
        lines,
    })
}

pub(crate) fn diff_lines(old_bytes: &[u8], new_bytes: &[u8]) -> Vec<CheckpointDiffLine> {
    let old_text = String::from_utf8_lossy(old_bytes);
    let new_text = String::from_utf8_lossy(new_bytes);
    let diff = TextDiff::from_lines(old_text.as_ref(), new_text.as_ref());
    let mut lines = Vec::new();
    let mut old_no = 0u32;
    let mut new_no = 0u32;
    for change in diff.iter_all_changes() {
        let text = change.to_string();
        let text = text.trim_end_matches('\n').to_string();
        match change.tag() {
            ChangeTag::Equal => {
                old_no += 1;
                new_no += 1;
                lines.push(CheckpointDiffLine {
                    kind: "context".into(),
                    old_line: Some(old_no),
                    new_line: Some(new_no),
                    text,
                });
            }
            ChangeTag::Delete => {
                old_no += 1;
                lines.push(CheckpointDiffLine {
                    kind: "remove".into(),
                    old_line: Some(old_no),
                    new_line: None,
                    text,
                });
            }
            ChangeTag::Insert => {
                new_no += 1;
                lines.push(CheckpointDiffLine {
                    kind: "add".into(),
                    old_line: None,
                    new_line: Some(new_no),
                    text,
                });
            }
        }
    }
    lines
}

fn all_known_paths(data_dir: &Path, root: &Path) -> HashSet<String> {
    let index = read_index(data_dir, root);
    let mut paths = HashSet::new();
    for summary in index.summaries {
        if let Ok(manifest) = load_manifest(data_dir, root, &summary.id) {
            for file in manifest.files {
                paths.insert(file.path);
            }
        }
    }
    paths
}

fn write_project_file(root: &Path, rel: &str, bytes: &[u8]) -> AppResult<()> {
    let target = project::resolve_for_write(root, rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::io("Could not create checkpoint restore folder", e))?;
    }
    let target = project::resolve_for_write(root, rel)?;
    let parent = target
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "Invalid restore target"))?;
    let temp = parent.join(format!(
        ".latexstudio-restore-{}-{}",
        std::process::id(),
        now_ms()
    ));
    let mut file =
        fs::File::create(&temp).map_err(|e| AppError::io("Could not stage restored file", e))?;
    file.write_all(bytes)
        .map_err(|e| AppError::io("Could not write restored file", e))?;
    file.sync_all().ok();
    if let Ok(meta) = fs::metadata(&target) {
        let _ = fs::set_permissions(&temp, meta.permissions());
    }
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        AppError::io("Could not replace file during restore", e)
    })
}

fn delete_project_file(root: &Path, rel: &str) -> AppResult<()> {
    let path = project::resolve_existing(root, rel)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|e| AppError::io("Could not remove restored file", e))?;
    }
    Ok(())
}

fn apply_manifest(
    data_dir: &Path,
    root: &Path,
    manifest: &CheckpointManifest,
    delete_paths: &[String],
    only_paths: Option<&HashSet<String>>,
) -> AppResult<(Vec<String>, Vec<String>)> {
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    for file in &manifest.files {
        if let Some(only) = only_paths {
            if !only.contains(&file.path) {
                continue;
            }
        }
        let bytes = read_blob(data_dir, root, &file.hash)?;
        write_project_file(root, &file.path, &bytes)?;
        restored.push(file.path.clone());
    }
    for path in delete_paths {
        if let Some(only) = only_paths {
            if !only.contains(path) {
                continue;
            }
        }
        delete_project_file(root, path)?;
        deleted.push(path.clone());
    }
    Ok((restored, deleted))
}

pub fn restore(
    data_dir: &Path,
    root: &Path,
    id: &str,
    token: &str,
    paths: Option<Vec<String>>,
) -> AppResult<RestoreResult> {
    restore_with_retention(data_dir, root, id, token, paths, DEFAULT_RETENTION)
}

pub fn restore_with_retention(
    data_dir: &Path,
    root: &Path,
    id: &str,
    token: &str,
    paths: Option<Vec<String>>,
    retention: usize,
) -> AppResult<RestoreResult> {
    let retention = retention.clamp(MIN_RETENTION, MAX_RETENTION);
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    let target = load_manifest(data_dir, &root, id)?;
    let current = scan_files(&root)?;
    let current_manifest: Vec<CheckpointManifestFile> =
        current.iter().map(ScannedFile::manifest).collect();
    if fingerprint(&current_manifest) != token {
        return Err(AppError::new(
            "preview_stale",
            "Project files changed after the preview was built. Review the changes again.",
        ));
    }
    let target_files: HashMap<&str, &CheckpointManifestFile> = target
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let current_map: HashMap<&str, &ScannedFile> = current
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let known = all_known_paths(data_dir, &root);
    let mut selected: Option<HashSet<String>> = None;
    let mut delete_paths: Vec<String> = Vec::new();
    if let Some(paths) = paths {
        let mut set: HashSet<String> = paths.into_iter().collect();
        for change in preview(data_dir, &root, id)?.files {
            for selected_path in set.clone() {
                if change.old_path.as_deref() == Some(selected_path.as_str()) {
                    set.insert(change.path.clone());
                    delete_paths.push(selected_path.clone());
                }
            }
        }
        selected = Some(set);
    } else {
        for path in current_map.keys() {
            if !target_files.contains_key(path) && known.contains(*path) {
                delete_paths.push((*path).to_string());
            }
        }
    }
    let has_work = target.files.iter().any(|file| {
        selected
            .as_ref()
            .map(|set| set.contains(&file.path))
            .unwrap_or(true)
    }) || !delete_paths.is_empty();
    if !has_work {
        return Ok(RestoreResult {
            checkpoint_id: id.to_string(),
            recovery_id: None,
            restored_files: Vec::new(),
            deleted_files: Vec::new(),
            rollback_failed: false,
        });
    }

    let recovery = create_with_retention(
        data_dir,
        &root,
        Some("Before restore".into()),
        Some(format!(
            "Automatic recovery checkpoint before restoring {}",
            id
        )),
        "pre-restore",
        retention,
    )?;
    let recovery_id = recovery
        .as_ref()
        .map(|summary| summary.id.clone())
        .or_else(|| {
            list(data_dir, &root)
                .ok()
                .and_then(|items| items.first().map(|summary| summary.id.clone()))
        });
    let recovery_manifest = recovery_id
        .as_ref()
        .and_then(|recovery_id| load_manifest(data_dir, &root, recovery_id).ok());

    let apply = apply_manifest(data_dir, &root, &target, &delete_paths, selected.as_ref());
    match apply {
        Ok((restored, deleted)) => Ok(RestoreResult {
            checkpoint_id: id.to_string(),
            recovery_id,
            restored_files: restored,
            deleted_files: deleted,
            rollback_failed: false,
        }),
        Err(error) => {
            let mut rollback_failed = false;
            if let Some(recovery_manifest) = recovery_manifest {
                let rollback_deletes: Vec<String> = current_map
                    .keys()
                    .filter(|path| {
                        known.contains(**path)
                            && !recovery_manifest
                                .files
                                .iter()
                                .any(|file| file.path == **path)
                    })
                    .map(|path| (*path).to_string())
                    .collect();
                if apply_manifest(data_dir, &root, &recovery_manifest, &rollback_deletes, None)
                    .is_err()
                {
                    rollback_failed = true;
                }
            }
            Err(AppError::new(
                if rollback_failed {
                    "restore_failed_rollback_failed"
                } else {
                    "restore_failed"
                },
                format!(
                    "Restore failed: {}. {}",
                    error.message,
                    if rollback_failed {
                        "Automatic rollback also failed; use the recovery checkpoint."
                    } else {
                        "The previous state was restored."
                    }
                ),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(&root).unwrap();
        let data = dir.path().join("data");
        fs::write(root.join("main.tex"), "one\ntwo\n").unwrap();
        fs::write(root.join("chapter.tex"), "chapter\n").unwrap();
        (dir, root.canonicalize().unwrap(), data)
    }

    #[test]
    fn preview_is_read_only_and_diff_is_correct() {
        let (_dir, root, data) = setup();
        let first = create(&data, &root, Some("First".into()), None, "manual")
            .unwrap()
            .unwrap();
        assert_eq!(first.added, 2);
        fs::write(root.join("main.tex"), "one\ntwo changed\nthree\n").unwrap();
        let before = fs::read(root.join("main.tex")).unwrap();
        let preview = preview(&data, &root, &first.id).unwrap();
        assert_eq!(preview.modified, 1);
        assert_eq!(preview.additions, 2);
        assert_eq!(preview.deletions, 1);
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), before);
        let diff = file_diff(&data, &root, &first.id, "main.tex").unwrap();
        assert!(diff.lines.iter().any(|line| line.kind == "add"));
        assert!(diff.lines.iter().any(|line| line.kind == "remove"));
    }

    #[test]
    fn restore_full_handles_add_modify_delete_and_recovery() {
        let (_dir, root, data) = setup();
        let first = create(&data, &root, Some("First".into()), None, "manual")
            .unwrap()
            .unwrap();
        fs::write(root.join("main.tex"), "changed\n").unwrap();
        fs::write(root.join("new.tex"), "new\n").unwrap();
        fs::remove_file(root.join("chapter.tex")).unwrap();
        create(&data, &root, Some("Second".into()), None, "manual").unwrap();
        let preview = preview(&data, &root, &first.id).unwrap();
        assert_eq!(preview.modified, 1);
        assert_eq!(preview.added, 1);
        assert_eq!(preview.deleted, 1);
        let result = restore(&data, &root, &first.id, &preview.token, None).unwrap();
        assert!(result.recovery_id.is_some());
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "one\ntwo\n"
        );
        assert!(root.join("chapter.tex").is_file());
        assert!(!root.join("new.tex").exists());
    }

    #[test]
    fn stale_preview_is_rejected() {
        let (_dir, root, data) = setup();
        let first = create(&data, &root, Some("First".into()), None, "manual")
            .unwrap()
            .unwrap();
        fs::write(root.join("main.tex"), "changed\n").unwrap();
        let preview = preview(&data, &root, &first.id).unwrap();
        fs::write(root.join("main.tex"), "changed again\n").unwrap();
        let error = restore(&data, &root, &first.id, &preview.token, None).unwrap_err();
        assert_eq!(error.code, "preview_stale");
    }

    #[test]
    fn retention_prunes_manifests_and_unreferenced_blobs() {
        let (_dir, root, data) = setup();
        let first = create_with_retention(&data, &root, Some("First".into()), None, "manual", 2)
            .unwrap()
            .unwrap();
        let first_blob = blob_path(&data, &root, &sha256_hex(b"one\ntwo\n"));
        assert!(first_blob.is_file());

        fs::write(root.join("main.tex"), "second\n").unwrap();
        create_with_retention(&data, &root, Some("Second".into()), None, "manual", 2)
            .unwrap()
            .unwrap();
        fs::write(root.join("main.tex"), "third\n").unwrap();
        create_with_retention(&data, &root, Some("Third".into()), None, "manual", 2)
            .unwrap()
            .unwrap();

        let items = list(&data, &root).unwrap();
        assert_eq!(items.len(), 2);
        assert!(!items.iter().any(|item| item.id == first.id));
        assert!(!manifest_path(&data, &root, &first.id).exists());
        assert!(!first_blob.exists());
    }
}
