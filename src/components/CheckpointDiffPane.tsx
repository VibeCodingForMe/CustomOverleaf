import { ArrowDown, ArrowUp, Eye, FileDiff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatDateTime } from "../lib/format";
import { useAppStore } from "../store/useAppStore";

function statusLabel(t: (key: string) => string, status: string) {
  if (status === "A") return t("history.status.added");
  if (status === "M") return t("history.status.modified");
  if (status === "D") return t("history.status.deleted");
  if (status === "R") return t("history.status.renamed");
  return status;
}

export function CheckpointDiffPane() {
  const { t, i18n } = useTranslation();
  const preview = useAppStore((state) => state.checkpointPreview);
  const diff = useAppStore((state) => state.checkpointDiff);
  const diffPath = useAppStore((state) => state.checkpointDiffPath);
  const loading = useAppStore((state) => state.checkpointLoading);
  const openCheckpointDiff = useAppStore((state) => state.openCheckpointDiff);
  const clearCheckpointPreview = useAppStore((state) => state.clearCheckpointPreview);
  const [changeIndex, setChangeIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const files = preview?.files ?? [];
  const currentIndex = files.findIndex((file) => file.path === diffPath);
  const previewFile = files.find((item) => item.path === diffPath) ?? null;
  const file = diff ?? previewFile;

  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun when the selected diff changes
  useEffect(() => {
    setChangeIndex(0);
    const body = bodyRef.current;
    if (!body) return;
    const frame = requestAnimationFrame(() => {
      const first = body.querySelector<HTMLElement>(".diff-line.diff-add, .diff-line.diff-remove");
      first?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [diffPath, diff]);

  if (!preview) return null;

  const changes = diff?.lines.filter((line) => line.kind !== "context") ?? [];
  const changeCount = changes.length;
  const currentChange = changes[Math.min(changeIndex, Math.max(0, changes.length - 1))] ?? null;
  const currentLine = currentChange?.newLine ?? currentChange?.oldLine ?? null;
  let changeOrdinal = 0;
  const diffRows = (diff?.lines ?? []).map((line) => {
    const ordinal = line.kind === "context" ? -1 : changeOrdinal++;
    return { line, ordinal };
  });

  const move = (direction: 1 | -1) => {
    const body = bodyRef.current;
    if (!body || changeCount === 0) return;
    const next = (changeIndex + direction + changeCount) % changeCount;
    const rows = body.querySelectorAll<HTMLElement>(".diff-line.diff-add, .diff-line.diff-remove");
    rows[next]?.scrollIntoView({ block: "center" });
    setChangeIndex(next);
  };

  const goFile = (direction: 1 | -1) => {
    if (files.length === 0) return;
    const next = (currentIndex + direction + files.length) % files.length;
    void openCheckpointDiff(files[next].path);
  };

  return (
    <section className="checkpoint-diff-pane" aria-label={t("history.preview")}>
      <div className="checkpoint-banner">
        <Eye size={13} />
        <span>
          {t("history.previewBanner", {
            name: preview.checkpoint.name || t("history.kind.auto"),
            time: formatDateTime(preview.checkpoint.createdAtMs, i18n.language),
          })}
        </span>
        <span className="checkpoint-readonly">{t("history.readOnly")}</span>
        <button
          type="button"
          className="icon-button"
          title={t("history.cancelPreview")}
          onClick={clearCheckpointPreview}
        >
          <X size={13} />
        </button>
      </div>

      <div className="checkpoint-diff-head">
        <FileDiff size={14} />
        {file ? (
          <>
            <span className={`change-badge change-${file.status.toLowerCase()}`}>
              {file.status}
            </span>
            <span className="checkpoint-file-name" title={file.path}>
              {file.path}
            </span>
            {file.oldPath && file.oldPath !== file.path ? (
              <span className="checkpoint-old-path">← {file.oldPath}</span>
            ) : null}
            <span className="checkpoint-file-stats">
              {previewFile && previewFile.additions > 0 ? (
                <span className="diff-add">+{previewFile.additions}</span>
              ) : null}
              {previewFile && previewFile.deletions > 0 ? (
                <span className="diff-remove">−{previewFile.deletions}</span>
              ) : null}
            </span>
            <span className="dim">{statusLabel(t, file.status)}</span>
          </>
        ) : (
          <span className="dim">{t("history.selectFile")}</span>
        )}
        <div className="grow" />
        <button
          type="button"
          className="icon-button"
          title={t("history.previousFile")}
          disabled={files.length < 2}
          onClick={() => goFile(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t("history.nextFile")}
          disabled={files.length < 2}
          onClick={() => goFile(1)}
        >
          <ArrowDown size={13} />
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <span className="spinner large" />
          <p>{t("history.loading")}</p>
        </div>
      ) : !file ? (
        <div className="empty-state">
          <FileDiff size={22} />
          <p>{t("history.selectFile")}</p>
        </div>
      ) : file.binary ? (
        <div className="checkpoint-binary">
          <FileDiff size={22} />
          <h3>{t("history.binaryFile")}</h3>
          <p>
            {t("history.binarySize", {
              oldSize: formatBytes(file.oldSize),
              newSize: formatBytes(file.newSize),
            })}
          </p>
        </div>
      ) : (
        <>
          <div className="diff-toolbar">
            <span>{t("history.changeCount", { count: changeCount })}</span>
            {currentLine ? (
              <span className="diff-current-line">
                {t("history.lineNumber", { line: currentLine })}
              </span>
            ) : null}
            <div className="grow" />
            <button
              type="button"
              className="tool-btn"
              onClick={() => move(-1)}
              disabled={changeCount === 0}
            >
              <ArrowUp size={12} /> {t("history.previousChange")}
            </button>
            <button
              type="button"
              className="tool-btn"
              onClick={() => move(1)}
              disabled={changeCount === 0}
            >
              <ArrowDown size={12} /> {t("history.nextChange")}
            </button>
          </div>
          <div className="diff-body" ref={bodyRef}>
            {diffRows.map(({ line, ordinal }, index) => (
              <div
                // Diff rows are immutable for a selected file.
                key={`${index}:${line.oldLine ?? "x"}:${line.newLine ?? "x"}`}
                className={`diff-line diff-${line.kind}${
                  ordinal >= 0 && ordinal === changeIndex ? " is-current" : ""
                }`}
              >
                <span className="diff-gutter">{line.oldLine ?? ""}</span>
                <span className="diff-gutter">{line.newLine ?? ""}</span>
                <span className="diff-marker">
                  {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
                </span>
                <span className="diff-text">{line.text || " "}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
