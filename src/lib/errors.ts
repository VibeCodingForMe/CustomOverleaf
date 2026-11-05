import type { TFunction } from "i18next";
import { errorCode, errorMessage } from "./ipc";

const codeKeys: Record<string, string> = {
  invalid_path: "errors.notFound",
  protected_path: "errors.permission",
  not_found: "errors.notFound",
  file_not_found: "errors.notFound",
  hash_mismatch: "errors.conflict",
  conflict: "errors.conflict",
  too_large: "errors.fileTooLarge",
  binary_file: "errors.binaryFile",
  invalid_utf8: "errors.binaryFile",
  no_main_file: "errors.noMainFile",
  missing_engine: "errors.noEngine",
  no_engine: "errors.noEngine",
  pandoc_missing: "export.pandocMissing",
  no_pdf: "export.noPdf",
  invalid_main: "errors.noMainFile",
  build_in_progress: "status.saving",
  permission_denied: "errors.permission",
  invalid_name: "newProject.invalidName",
  export_exists: "export.overwriteTitle",
  git_failed: "errors.gitFailed",
  empty_commit: "git.commitPlaceholder",
  synctex_unavailable: "sync.unavailable",
  synctex_invalid: "sync.invalid",
};

export function localizedError(t: TFunction, error: unknown): string {
  const code = errorCode(error);
  const key = code ? codeKeys[code] : undefined;
  if (key) return t(key);
  const message = errorMessage(error);
  if (!message || message === "undefined") return t("errors.generic");
  if (/not found|does not exist/i.test(message) && !message.includes("command")) {
    return t("errors.notFound");
  }
  return message;
}
