use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub main_file: Option<String>,
    #[serde(default)]
    pub last_opened_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorSettings {
    pub font_size: u32,
    pub font_family: String,
    pub tab_size: u32,
    pub word_wrap: bool,
    pub line_numbers: bool,
    pub autosave_delay_ms: u64,
    pub spellcheck: bool,
    pub snippets: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_size: 13,
            font_family: "SF Mono".into(),
            tab_size: 2,
            word_wrap: false,
            line_numbers: true,
            autosave_delay_ms: 900,
            spellcheck: true,
            snippets: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompileSettings {
    pub engine: String,
    pub auto_compile: bool,
    pub auto_compile_delay_ms: u64,
    pub timeout_seconds: u64,
    pub build_dir: String,
}

impl Default for CompileSettings {
    fn default() -> Self {
        Self {
            engine: "auto".into(),
            auto_compile: true,
            auto_compile_delay_ms: 1400,
            timeout_seconds: 300,
            build_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PdfSettings {
    pub default_zoom: f64,
    pub remember_position: bool,
}

impl Default for PdfSettings {
    fn default() -> Self {
        Self {
            default_zoom: 1.0,
            remember_position: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistorySettings {
    pub retention: usize,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self { retention: 80 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub language: String,
    pub theme: String,
    pub editor: EditorSettings,
    pub compile: CompileSettings,
    pub pdf: PdfSettings,
    pub history: HistorySettings,
    pub recent_projects: Vec<RecentProject>,
    pub last_project: Option<String>,
    pub projects: HashMap<String, ProjectMeta>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 2,
            language: "en".into(),
            theme: "dark".into(),
            editor: EditorSettings::default(),
            compile: CompileSettings::default(),
            pdf: PdfSettings::default(),
            history: HistorySettings::default(),
            recent_projects: Vec::new(),
            last_project: None,
            projects: HashMap::new(),
        }
    }
}

impl Settings {
    pub fn normalize(&mut self) {
        if self.schema_version < 2 {
            self.schema_version = 2;
        }
        if self.language != "en" && self.language != "ru" {
            self.language = "en".into();
        }
        if !matches!(self.theme.as_str(), "dark" | "light" | "system") {
            self.theme = "dark".into();
        }
        self.editor.font_size = self.editor.font_size.clamp(9, 32);
        self.editor.tab_size = self.editor.tab_size.clamp(1, 8);
        self.editor.autosave_delay_ms = self.editor.autosave_delay_ms.clamp(300, 10_000);
        self.compile.auto_compile_delay_ms = self.compile.auto_compile_delay_ms.clamp(400, 30_000);
        self.compile.timeout_seconds = self.compile.timeout_seconds.clamp(15, 1800);
        self.pdf.default_zoom = self.pdf.default_zoom.clamp(0.25, 4.0);
        self.history.retention = self.history.retention.clamp(10, 500);
        let build_dir = self.compile.build_dir.trim().replace('\\', "/");
        self.compile.build_dir = if build_dir.is_empty()
            || build_dir.starts_with('/')
            || build_dir.split('/').any(|part| part == ".." || part == ".git" || part == ".latexstudio")
        {
            String::new()
        } else {
            build_dir
        };
        self.recent_projects.truncate(12);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: i64,
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub root: String,
    pub name: String,
    pub main_file: Option<String>,
    pub files: Vec<FileNode>,
    pub is_git: bool,
    pub tex_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub content: String,
    pub eol: String,
    pub bom: bool,
    pub hash: String,
    pub modified_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub hash: String,
    pub modified_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub exists: bool,
    pub modified_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsInfo {
    pub latexmk: Option<ToolInfo>,
    pub pdflatex: Option<ToolInfo>,
    pub xelatex: Option<ToolInfo>,
    pub lualatex: Option<ToolInfo>,
    pub tectonic: Option<ToolInfo>,
    pub bibtex: Option<ToolInfo>,
    pub biber: Option<ToolInfo>,
    pub pandoc: Option<ToolInfo>,
    pub git: Option<ToolInfo>,
    pub synctex: Option<ToolInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub id: String,
    pub severity: String,
    pub code: String,
    pub message: String,
    pub raw: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    #[serde(default)]
    pub params: HashMap<String, String>,
    pub fixable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixEdit {
    pub line: u32,
    pub kind: String,
    pub expected: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixSuggestion {
    pub code: String,
    pub file: String,
    pub file_hash: String,
    pub confidence: String,
    pub edits: Vec<FixEdit>,
    #[serde(default)]
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub id: u64,
    pub success: bool,
    pub cancelled: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub logs: String,
    pub build_output: String,
    pub diagnostics: Vec<Diagnostic>,
    pub duration_ms: u64,
    pub engine: String,
    pub engine_path: Option<String>,
    pub pdf_path: Option<String>,
    pub pdf_size: u64,
    pub stale_pdf: bool,
    pub command_preview: String,
    pub main_file: String,
    pub started_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastPdf {
    pub data: String,
    pub built_at_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub available: bool,
    pub built_at_ms: i64,
    pub size: u64,
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTarget {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSource {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub changes: Vec<GitChange>,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub old_size: u64,
    pub new_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub created_at_ms: i64,
    pub kind: String,
    pub total_files: usize,
    pub file_count: usize,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub additions: u32,
    pub deletions: u32,
    pub binary_files: usize,
    #[serde(default)]
    pub files: Vec<CheckpointFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointManifestFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointManifest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub created_at_ms: i64,
    pub kind: String,
    pub parent_id: Option<String>,
    pub files: Vec<CheckpointManifestFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointPreview {
    pub checkpoint: CheckpointSummary,
    pub token: String,
    pub files: Vec<CheckpointFileChange>,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiffLine {
    pub kind: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub binary: bool,
    pub old_size: u64,
    pub new_size: u64,
    pub lines: Vec<CheckpointDiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub checkpoint_id: String,
    pub recovery_id: Option<String>,
    pub restored_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub rollback_failed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFilePreview {
    pub path: String,
    pub matches: u32,
    pub replacements: u32,
    pub additions: u32,
    pub deletions: u32,
    pub truncated: bool,
    pub lines: Vec<CheckpointDiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreview {
    pub token: String,
    pub file_count: u32,
    pub match_count: u32,
    pub replacement_count: u32,
    pub files: Vec<ReplaceFilePreview>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub checkpoint_id: Option<String>,
    pub files_changed: u32,
    pub replacements: u32,
    pub rollback_failed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexLabel {
    pub key: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexCitation {
    pub key: String,
    pub entry_type: String,
    pub title: String,
    pub author: String,
    pub year: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexHeading {
    pub level: u8,
    pub title: String,
    pub file: String,
    pub line: u32,
    pub starred: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReference {
    pub key: String,
    pub file: String,
    pub line: u32,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInclude {
    pub file: String,
    pub line: u32,
    pub target: String,
    pub resolved: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexFloat {
    pub kind: String,
    pub caption: String,
    pub label: Option<String>,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIndex {
    pub main_file: Option<String>,
    pub labels: Vec<IndexLabel>,
    pub citations: Vec<IndexCitation>,
    pub headings: Vec<IndexHeading>,
    pub floats: Vec<IndexFloat>,
    pub references: Vec<IndexReference>,
    pub includes: Vec<IndexInclude>,
    pub files: Vec<String>,
    pub images: Vec<String>,
    pub packages: Vec<String>,
    pub generated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub diagnostics: Vec<Diagnostic>,
    pub checked_files: usize,
    pub labels: usize,
    pub references: usize,
    pub citations: usize,
    pub images: usize,
    pub generated_at_ms: i64,
}
