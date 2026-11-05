import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

export function ReplaceModal() {
  const { t } = useTranslation();
  const preview = useAppStore((state) => state.replacePreview);
  const query = useAppStore((state) => state.searchQuery);
  const replacement = useAppStore((state) => state.replaceText);
  const loading = useAppStore((state) => state.replaceLoading);
  const applyReplace = useAppStore((state) => state.applyReplace);
  const clearReplacePreview = useAppStore((state) => state.clearReplacePreview);
  if (!preview) return null;

  return (
    <Modal
      title={t("search.replaceTitle")}
      subtitle={t("search.replaceSummary", {
        files: preview.fileCount,
        count: preview.replacementCount,
      })}
      size="wide"
      onClose={clearReplacePreview}
      closeDisabled={loading}
      footer={
        <>
          <button
            type="button"
            className="text-button"
            onClick={clearReplacePreview}
            disabled={loading}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="text-button primary"
            disabled={loading || preview.fileCount === 0}
            onClick={() => void applyReplace()}
          >
            {loading
              ? t("search.searching")
              : t("search.replaceApply", { count: preview.replacementCount })}
          </button>
        </>
      }
    >
      <div className="replace-preview">
        <div className="replace-preview-target">
          <span className="replace-preview-find">{query}</span>
          <span className="replace-preview-arrow">→</span>
          <span className="replace-preview-replacement">{replacement || "∅"}</span>
        </div>
        {preview.files.length === 0 ? (
          <div className="tree-empty">{t("search.replaceEmpty")}</div>
        ) : (
          <div className="replace-preview-files">
            {preview.files.map((file, index) => (
              <details key={file.path} className="replace-file" open={index < 2}>
                <summary className="replace-file-head">
                  <span className="replace-file-path" title={file.path}>
                    {file.path}
                  </span>
                  <span className="replace-file-stats">
                    {file.replacements} · <span className="diff-add-text">+{file.additions}</span>{" "}
                    <span className="diff-remove-text">−{file.deletions}</span>
                  </span>
                </summary>
                <div className="diff-body replace-diff">
                  {file.lines.map((line, lineIndex) => (
                    <div
                      key={`${file.path}:${lineIndex}`}
                      className={`diff-line diff-${line.kind}`}
                    >
                      <span className="diff-gutter">{line.oldLine ?? ""}</span>
                      <span className="diff-gutter">{line.newLine ?? ""}</span>
                      <span className="diff-marker">
                        {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
                      </span>
                      <span className="diff-text">{line.text || " "}</span>
                    </div>
                  ))}
                </div>
                {file.truncated ? (
                  <div className="replace-truncated">{t("search.replaceTruncated")}</div>
                ) : null}
              </details>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
