use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde_json::Value;
use tempfile::NamedTempFile;

use crate::{
    error::{AppError, AppResult},
    models::{ProjectMeta, RecentProject, Settings},
};

pub const SETTINGS_SCHEMA_VERSION: u32 = 2;

pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Library/Application Support")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.latexstudio.desktop")
}

pub fn load_settings(path: &Path) -> Settings {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Settings::default();
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(mut settings) => {
            settings.normalize();
            settings
        }
        Err(err) => {
            eprintln!("Could not parse settings at {}: {err}", path.display());
            let backup = path.with_extension("json.corrupt");
            let _ = std::fs::rename(path, backup);
            Settings::default()
        }
    }
}

pub fn write_settings(path: &Path, settings: &Settings) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_settings_path", "Settings path has no parent"))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| AppError::io("Could not create settings directory", e))?;
    let json = serde_json::to_vec_pretty(settings)?;
    let mut temp = NamedTempFile::new_in(parent)
        .map_err(|e| AppError::io("Could not create settings temp file", e))?;
    std::io::Write::write_all(&mut temp, &json)
        .map_err(|e| AppError::io("Could not write settings", e))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| AppError::io("Could not flush settings", e))?;
    temp.persist(path)
        .map_err(|e| AppError::io("Could not commit settings", e.error))?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct BuildSlot {
    pub running: bool,
    pub active_pid: Option<u32>,
    pub build_id: u64,
    pub cancel_requested: bool,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub data_dir: PathBuf,
    pub build_slot: Mutex<BuildSlot>,
    pub next_build_id: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = app_data_dir();
        let settings_path = data_dir.join("settings.json");
        let settings = load_settings(&settings_path);
        Self {
            settings: Mutex::new(settings),
            settings_path,
            data_dir,
            build_slot: Mutex::new(BuildSlot::default()),
            next_build_id: AtomicU64::new(1),
        }
    }

    pub fn persist_settings(&self) -> AppResult<()> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?
            .clone();
        write_settings(&self.settings_path, &settings)
    }

    pub fn next_build_id(&self) -> u64 {
        self.next_build_id.fetch_add(1, Ordering::SeqCst)
    }

    pub fn touch_project(&self, root: &Path) -> AppResult<()> {
        let canonical = root.to_string_lossy().to_string();
        let name = root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| canonical.clone());
        let now = chrono::Utc::now().timestamp_millis();
        {
            let mut settings = self
                .settings
                .lock()
                .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?;
            settings.recent_projects.retain(|p| p.path != canonical);
            settings.recent_projects.insert(
                0,
                RecentProject {
                    path: canonical.clone(),
                    name,
                    last_opened_ms: now,
                },
            );
            settings.recent_projects.truncate(12);
            settings.last_project = Some(canonical.clone());
            settings
                .projects
                .entry(canonical)
                .and_modify(|m| m.last_opened_ms = now)
                .or_insert(ProjectMeta {
                    main_file: None,
                    last_opened_ms: now,
                });
        }
        self.persist_settings()
    }

    pub fn remove_recent(&self, path: &str) -> AppResult<()> {
        {
            let mut settings = self
                .settings
                .lock()
                .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?;
            settings.recent_projects.retain(|p| p.path != path);
            if settings.last_project.as_deref() == Some(path) {
                settings.last_project = None;
            }
        }
        self.persist_settings()
    }

    pub fn main_file_for(&self, root: &str) -> Option<String> {
        self.settings
            .lock()
            .ok()
            .and_then(|s| s.projects.get(root).and_then(|m| m.main_file.clone()))
    }

    pub fn set_main_file(&self, root: &str, main_file: Option<String>) -> AppResult<()> {
        {
            let mut settings = self
                .settings
                .lock()
                .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?;
            let meta = settings
                .projects
                .entry(root.to_string())
                .or_insert_with(ProjectMeta::default);
            meta.main_file = main_file;
        }
        self.persist_settings()
    }

    pub fn update_settings_json(&self, patch: Value) -> AppResult<Settings> {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?;
        let mut current = serde_json::to_value(&*settings)?;
        merge_json(&mut current, patch);
        let mut updated: Settings = serde_json::from_value(current)
            .map_err(|e| AppError::new("invalid_settings", e.to_string()))?;
        updated.schema_version = SETTINGS_SCHEMA_VERSION;
        updated.normalize();
        *settings = updated.clone();
        drop(settings);
        self.persist_settings()?;
        Ok(updated)
    }

    pub fn settings_snapshot(&self) -> AppResult<Settings> {
        Ok(self
            .settings
            .lock()
            .map_err(|_| AppError::new("state_error", "Settings lock poisoned"))?
            .clone())
    }
}

fn merge_json(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                merge_json(base_map.entry(key).or_insert(Value::Null), value);
            }
        }
        (base_slot, value) => *base_slot = value,
    }
}

pub fn project_history_dir(data_dir: &Path, root: &Path) -> PathBuf {
    let key = crate::util::sha256_hex(root.to_string_lossy().as_bytes());
    data_dir.join("history").join(&key[..24.min(key.len())])
}

pub fn project_last_pdf_path(root: &Path) -> PathBuf {
    root.join(".latexstudio").join("last-success.pdf")
}

pub fn project_last_synctex_path(root: &Path) -> PathBuf {
    root.join(".latexstudio").join("last-success.synctex.gz")
}

pub fn project_build_dir(root: &Path) -> PathBuf {
    root.join(".latexstudio").join("build")
}

pub fn projects_meta_map(settings: &Settings) -> &HashMap<String, ProjectMeta> {
    &settings.projects
}
