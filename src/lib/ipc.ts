import { invoke } from "@tauri-apps/api/core";
import type {
  BuildResult,
  BuildStatus,
  CheckpointFileDiff,
  CheckpointPreview,
  CheckpointSummary,
  Diagnostic,
  DoctorReport,
  ExportResult,
  FileStat,
  FixSuggestion,
  GitStatus,
  LastPdf,
  ProjectIndex,
  ProjectSnapshot,
  ReadFileResult,
  ReplacePreview,
  ReplaceResult,
  RestoreResult,
  SearchMatch,
  Settings,
  SyncSource,
  SyncStatus,
  SyncTarget,
  ToolsInfo,
  WriteFileResult,
} from "../types";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Record<string, unknown>) =>
    invoke<Settings>("update_settings", { patch }),
  getTools: () => invoke<ToolsInfo>("get_tools"),
  openProject: (path: string) => invoke<ProjectSnapshot>("open_project", { path }),
  refreshProject: (root: string) => invoke<ProjectSnapshot>("refresh_project", { root }),
  createProject: (parent: string, name: string, template: string) =>
    invoke<ProjectSnapshot>("create_project", { parent, name, template }),
  removeRecent: (path: string) => invoke<void>("remove_recent", { path }),
  setMainFile: (root: string, mainFile: string) =>
    invoke<ProjectSnapshot>("set_main_file", { root, mainFile }),
  readProjectFile: (root: string, rel: string) =>
    invoke<ReadFileResult>("read_project_file", { root, rel }),
  writeProjectFile: (
    root: string,
    rel: string,
    content: string,
    eol: string,
    bom: boolean,
    expectedHash: string | null,
  ) =>
    invoke<WriteFileResult>("write_project_file", {
      root,
      rel,
      content,
      eol,
      bom,
      expectedHash,
    }),
  createProjectFile: (root: string, rel: string, content = "") =>
    invoke<void>("create_project_file", { root, rel, content }),
  createProjectFolder: (root: string, rel: string) =>
    invoke<void>("create_project_folder", { root, rel }),
  renameProjectPath: (root: string, rel: string, newRel: string) =>
    invoke<string>("rename_project_path", { root, rel, newRel }),
  deleteProjectPath: (root: string, rel: string) =>
    invoke<void>("delete_project_path", { root, rel }),
  duplicateProjectPath: (root: string, rel: string) =>
    invoke<string>("duplicate_project_path", { root, rel }),
  importProjectPaths: (root: string, sources: string[], destRel: string) =>
    invoke<string[]>("import_project_paths", { root, sources, destRel }),
  statProjectFile: (root: string, rel: string) =>
    invoke<FileStat>("stat_project_file", { root, rel }),
  getProjectRevision: (root: string) => invoke<string>("get_project_revision", { root }),
  revealProjectPath: (root: string, rel: string) =>
    invoke<void>("reveal_project_path", { root, rel }),
  revealProject: (root: string) => invoke<void>("reveal_project", { root }),
  searchProject: (root: string, query: string, caseSensitive: boolean, regex: boolean) =>
    invoke<SearchMatch[]>("search_project", { root, query, caseSensitive, regex }),
  previewReplace: (
    root: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    regex: boolean,
  ) =>
    invoke<ReplacePreview>("preview_replace", {
      root,
      query,
      replacement,
      caseSensitive,
      regex,
    }),
  applyReplace: (
    root: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    regex: boolean,
    token: string,
  ) =>
    invoke<ReplaceResult>("apply_replace", {
      root,
      query,
      replacement,
      caseSensitive,
      regex,
      token,
    }),
  getProjectIndex: (root: string) => invoke<ProjectIndex>("get_project_index", { root }),
  runProjectDoctor: (root: string) => invoke<DoctorReport>("run_project_doctor", { root }),
  compileProject: (root: string, engine: string) =>
    invoke<BuildResult>("compile_project", { root, engine }),
  cancelCompilation: () => invoke<void>("cancel_compilation"),
  getBuildStatus: () => invoke<BuildStatus>("get_build_status"),
  getLastPdf: (root: string) => invoke<LastPdf | null>("get_last_pdf", { root }),
  synctexStatus: (root: string) => invoke<SyncStatus>("synctex_status", { root }),
  forwardSynctex: (root: string, file: string, line: number) =>
    invoke<SyncTarget | null>("forward_synctex", { root, file, line }),
  reverseSynctex: (root: string, page: number, x: number, y: number) =>
    invoke<SyncSource | null>("reverse_synctex", { root, page, x, y }),
  cleanProjectBuild: (root: string) => invoke<void>("clean_project_build", { root }),
  cleanProjectAux: (root: string) => invoke<number>("clean_project_aux", { root }),
  suggestDiagnosticFix: (root: string, diagnostic: Diagnostic) =>
    invoke<FixSuggestion | null>("suggest_diagnostic_fix", { root, diagnostic }),
  backupProjectFile: (root: string, rel: string) =>
    invoke<string>("backup_project_file", { root, rel }),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),
  exportProject: (root: string, format: string, dest: string, overwrite: boolean) =>
    invoke<ExportResult>("export_project", { root, format, dest, overwrite }),
  exportPandocProject: (root: string, format: string, dest: string, overwrite: boolean) =>
    invoke<ExportResult>("export_pandoc_project", { root, format, dest, overwrite }),
  getAppDataDir: () => invoke<string>("get_app_data_dir"),
  revealAppDataDir: () => invoke<void>("reveal_app_data_dir"),
  listCheckpoints: (root: string) => invoke<CheckpointSummary[]>("list_checkpoints", { root }),
  createCheckpoint: (
    root: string,
    name: string | null,
    description: string | null,
    kind?: string | null,
  ) =>
    invoke<CheckpointSummary | null>("create_checkpoint", {
      root,
      name,
      description,
      kind: kind ?? null,
    }),
  previewCheckpoint: (root: string, id: string) =>
    invoke<CheckpointPreview>("preview_checkpoint", { root, id }),
  getCheckpointFileDiff: (root: string, id: string, path: string) =>
    invoke<CheckpointFileDiff>("get_checkpoint_file_diff", { root, id, path }),
  restoreCheckpoint: (root: string, id: string, token: string, paths: string[] | null) =>
    invoke<RestoreResult>("restore_checkpoint", { root, id, token, paths }),
  getGitStatus: (root: string) => invoke<GitStatus>("get_git_status", { root }),
  getGitDiff: (root: string, rel: string) => invoke<string>("get_git_diff", { root, rel }),
  stageGitPaths: (root: string, paths: string[]) =>
    invoke<void>("stage_git_paths", { root, paths }),
  commitGit: (root: string, message: string) => invoke<string>("commit_git", { root, message }),
  readBinaryBase64: (root: string, rel: string) =>
    invoke<string>("read_binary_base64", { root, rel }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; code?: unknown };
    if (typeof value.message === "string") return value.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
