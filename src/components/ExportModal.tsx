import { Archive, Book, BookOpen, FileCode2, FileText, FileType, Globe, Hash } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { pickExportDestination } from "../lib/dialogs";
import { localizedError } from "../lib/errors";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { ExportFormat } from "../types";
import { Modal } from "./Modal";

interface ExportModalProps {
  onClose: () => void;
  preset?: ExportFormat | null;
}

const options: Array<{
  format: ExportFormat;
  icon: typeof FileText;
  extension: string;
  label: string;
  hint: string;
  pandoc: boolean;
}> = [
  {
    format: "pdf",
    icon: FileText,
    extension: "pdf",
    label: "export.pdf",
    hint: "export.pdfHint",
    pandoc: false,
  },
  {
    format: "tex",
    icon: FileCode2,
    extension: "tex",
    label: "export.tex",
    hint: "export.texHint",
    pandoc: false,
  },
  {
    format: "zip",
    icon: Archive,
    extension: "zip",
    label: "export.zip",
    hint: "export.zipHint",
    pandoc: false,
  },
  {
    format: "docx",
    icon: FileType,
    extension: "docx",
    label: "export.docx",
    hint: "export.docxHint",
    pandoc: true,
  },
  {
    format: "html",
    icon: Globe,
    extension: "html",
    label: "export.html",
    hint: "export.htmlHint",
    pandoc: true,
  },
  {
    format: "odt",
    icon: BookOpen,
    extension: "odt",
    label: "export.odt",
    hint: "export.odtHint",
    pandoc: true,
  },
  {
    format: "epub",
    icon: Book,
    extension: "epub",
    label: "export.epub",
    hint: "export.epubHint",
    pandoc: true,
  },
  {
    format: "markdown",
    icon: Hash,
    extension: "md",
    label: "export.markdown",
    hint: "export.markdownHint",
    pandoc: true,
  },
];

export function ExportModal({ onClose, preset }: ExportModalProps) {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const pdf = useAppStore((state) => state.pdf);
  const tools = useAppStore((state) => state.tools);
  const toast = useAppStore((state) => state.toast);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  if (!project) return null;

  const exportFormat = async (format: ExportFormat, extension: string) => {
    if (format === "pdf" && !pdf) {
      toast(t("export.noPdf"), "error");
      return;
    }
    if (format !== "pdf" && format !== "tex" && format !== "zip" && !tools?.pandoc) {
      toast(t("export.pandocMissing"), "error");
      return;
    }
    const destination = await pickExportDestination(
      format,
      `${project.name}.${extension}`,
      t("export.chooseDestination"),
    );
    if (!destination) return;
    let overwrite = false;
    try {
      if (await api.pathExists(destination)) {
        overwrite = await askConfirm({
          title: t("export.overwriteTitle"),
          body: t("export.overwriteBody"),
          confirmLabel: t("export.replace"),
          danger: true,
        });
        if (!overwrite) return;
      }
    } catch {
      // If the existence check fails, let the backend make the final decision.
    }
    setBusy(format);
    try {
      const result =
        format === "pdf" || format === "tex" || format === "zip"
          ? await api.exportProject(project.root, format, destination, overwrite)
          : await api.exportPandocProject(project.root, format, destination, overwrite);
      toast(t("export.exported", { path: result.path }), "success");
      onClose();
    } catch (error) {
      toast(localizedError(t, error), "error");
    } finally {
      setBusy(null);
    }
  };

  const pandocMissing = !tools?.pandoc;

  return (
    <Modal
      title={t("export.title")}
      subtitle={t("export.subtitle")}
      onClose={onClose}
      closeDisabled={busy !== null}
      footer={
        <>
          <span className="form-hint">
            {project.name}
            {pandocMissing ? ` · ${t("export.pandocMissing")}` : ""}
          </span>
          <div className="grow" />
          <button type="button" className="text-button" onClick={onClose} disabled={busy !== null}>
            {t("common.close")}
          </button>
        </>
      }
    >
      {pandocMissing ? (
        <div className="pandoc-warning">
          <FileType size={14} style={{ flex: "none" }} />
          {t("export.pandocMissing")}
        </div>
      ) : null}
      <div className="export-grid">
        {options.map((option) => {
          const Icon = option.icon;
          const disabled = option.format === "pdf" && !pdf;
          const isPreset = preset === option.format;
          return (
            <button
              type="button"
              key={option.format}
              className={`export-option ${disabled ? "disabled" : ""} ${isPreset ? "preset" : ""}`}
              style={isPreset ? { borderColor: "var(--accent)" } : undefined}
              disabled={busy !== null || disabled || (option.pandoc && pandocMissing)}
              onClick={() => void exportFormat(option.format, option.extension)}
            >
              <span className="export-icon">
                {busy === option.format ? <span className="spinner" /> : <Icon size={16} />}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="name">{t(option.label)}</span>
                <span className="hint" style={{ display: "block" }}>
                  {t(option.hint)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
