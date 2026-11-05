export type Theme = "dark" | "light" | "system";
export type Language = "en" | "ru";

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedMs: number;
}

export interface ProjectMeta {
  mainFile: string | null;
  lastOpenedMs: number;
}

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  autosaveDelayMs: number;
  spellcheck: boolean;
  snippets: boolean;
}

export interface CompileSettings {
  engine: string;
  autoCompile: boolean;
  autoCompileDelayMs: number;
  timeoutSeconds: number;
  buildDir: string;
}

export interface PdfSettings {
  defaultZoom: number;
  rememberPosition: boolean;
}

export interface HistorySettings {
  retention: number;
}

export interface Settings {
  schemaVersion: number;
  language: Language;
  theme: Theme;
  editor: EditorSettings;
  compile: CompileSettings;
  pdf: PdfSettings;
  history: HistorySettings;
  recentProjects: RecentProject[];
  lastProject: string | null;
  projects: Record<string, ProjectMeta>;
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
  children: FileNode[];
}

export interface ProjectSnapshot {
  root: string;
  name: string;
  mainFile: string | null;
  files: FileNode[];
  isGit: boolean;
  texFiles: string[];
}

export interface ReadFileResult {
  content: string;
  eol: string;
  bom: boolean;
  hash: string;
  modifiedMs: number;
  size: number;
}

export interface WriteFileResult {
  hash: string;
  modifiedMs: number;
  size: number;
}

export interface FileStat {
  exists: boolean;
  modifiedMs: number;
  size: number;
}

export interface ToolInfo {
  path: string;
  version: string;
}

export interface ToolsInfo {
  latexmk: ToolInfo | null;
  pdflatex: ToolInfo | null;
  xelatex: ToolInfo | null;
  lualatex: ToolInfo | null;
  tectonic: ToolInfo | null;
  bibtex: ToolInfo | null;
  biber: ToolInfo | null;
  pandoc: ToolInfo | null;
  git: ToolInfo | null;
  synctex: ToolInfo | null;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  raw: string;
  file: string | null;
  line: number | null;
  column: number | null;
  params: Record<string, string>;
  fixable: boolean;
}

export interface DoctorReport {
  diagnostics: Diagnostic[];
  checkedFiles: number;
  labels: number;
  references: number;
  citations: number;
  images: number;
  generatedAtMs: number;
}

export interface FixEdit {
  line: number;
  kind: "insert_after_line" | "replace_line";
  expected: string | null;
  text: string;
}

export interface FixSuggestion {
  code: string;
  file: string;
  fileHash: string;
  confidence: "high" | "medium" | "low";
  edits: FixEdit[];
  params: Record<string, string>;
}

export interface BuildResult {
  id: number;
  success: boolean;
  cancelled: boolean;
  timedOut: boolean;
  exitCode: number | null;
  logs: string;
  buildOutput: string;
  diagnostics: Diagnostic[];
  durationMs: number;
  engine: string;
  enginePath: string | null;
  pdfPath: string | null;
  pdfSize: number;
  stalePdf: boolean;
  commandPreview: string;
  mainFile: string;
  startedAtMs: number;
}

export interface LastPdf {
  data: string;
  builtAtMs: number;
  size: number;
}

export interface SyncStatus {
  available: boolean;
  builtAtMs: number;
  size: number;
  pageCount: number;
}

export interface SyncTarget {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncSource {
  file: string;
  line: number;
}

export interface ExportResult {
  path: string;
  format: string;
}

export interface CheckpointFileChange {
  path: string;
  oldPath: string | null;
  status: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
  binary: boolean;
  oldSize: number;
  newSize: number;
}

export interface CheckpointSummary {
  id: string;
  name: string | null;
  description: string | null;
  createdAtMs: number;
  kind: string;
  totalFiles: number;
  fileCount: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  files: CheckpointFileChange[];
}

export interface CheckpointPreview {
  checkpoint: CheckpointSummary;
  token: string;
  files: CheckpointFileChange[];
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  additions: number;
  deletions: number;
}

export interface CheckpointDiffLine {
  kind: "context" | "add" | "remove";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface CheckpointFileDiff {
  path: string;
  oldPath: string | null;
  status: "A" | "M" | "D" | "R";
  binary: boolean;
  oldSize: number;
  newSize: number;
  lines: CheckpointDiffLine[];
}

export interface RestoreResult {
  checkpointId: string;
  recoveryId: string | null;
  restoredFiles: string[];
  deletedFiles: string[];
  rollbackFailed: boolean;
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  preview: string;
}

export interface ReplaceFilePreview {
  path: string;
  matches: number;
  replacements: number;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: CheckpointDiffLine[];
}

export interface ReplacePreview {
  token: string;
  fileCount: number;
  matchCount: number;
  replacementCount: number;
  files: ReplaceFilePreview[];
}

export interface ReplaceResult {
  checkpointId: string | null;
  filesChanged: number;
  replacements: number;
  rollbackFailed: boolean;
}

export interface IndexLabel {
  key: string;
  file: string;
  line: number;
}

export interface IndexCitation {
  key: string;
  entryType: string;
  title: string;
  author: string;
  year: string;
}

export interface IndexHeading {
  level: number;
  title: string;
  file: string;
  line: number;
  starred: boolean;
}

export interface IndexReference {
  key: string;
  file: string;
  line: number;
  command: string;
}

export interface IndexInclude {
  file: string;
  line: number;
  target: string;
  resolved: string | null;
}

export interface IndexFloat {
  kind: "figure" | "table" | "equation" | "align";
  caption: string;
  label: string | null;
  file: string;
  line: number;
}

export interface ProjectIndex {
  mainFile: string | null;
  labels: IndexLabel[];
  citations: IndexCitation[];
  headings: IndexHeading[];
  floats: IndexFloat[];
  references: IndexReference[];
  includes: IndexInclude[];
  files: string[];
  images: string[];
  packages: string[];
  generatedAtMs: number;
}

export type SidebarView = "project" | "search" | "outline";

export interface GitChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  changes: GitChange[];
  clean: boolean;
}

export interface BuildStatus {
  running: boolean;
  buildId: number;
  pid: number | null;
}

export interface AppErrorShape {
  code: string;
  message: string;
}

export interface AppTab {
  rel: string;
  name: string;
  content: string;
  hash: string;
  eol: string;
  bom: boolean;
  dirty: boolean;
  loading: boolean;
  binary?: boolean;
  error?: string | null;
  modifiedMs: number;
  size: number;
  externalChange: boolean;
}

export type PanelTab = "logs" | "errors" | "warnings" | "doctor" | "search" | "build";

export interface ToastMessage {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export interface FixState {
  diagnostic: Diagnostic;
  suggestion: FixSuggestion | null;
  loading: boolean;
  error: string | null;
}

export type ExportFormat = "pdf" | "tex" | "zip" | "docx" | "html" | "odt" | "epub" | "markdown";
