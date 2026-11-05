import {
  Book,
  BookOpen,
  File,
  FileText,
  FolderOpen,
  Library,
  Mail,
  Presentation,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TemplateId, templates } from "../i18n";
import { pickProjectFolder } from "../lib/dialogs";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

const icons = {
  "file-text": FileText,
  "book-open": BookOpen,
  library: Library,
  book: Book,
  presentation: Presentation,
  mail: Mail,
  file: File,
} as const;

interface NewProjectModalProps {
  onClose: () => void;
  initialTemplate?: TemplateId;
}

function parentOf(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function NewProjectModal({ onClose, initialTemplate }: NewProjectModalProps) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const createProject = useAppStore((state) => state.createProject);
  const [template, setTemplate] = useState<TemplateId>(initialTemplate ?? "article");
  const [name, setName] = useState("");
  const [location, setLocation] = useState(() =>
    parentOf(settings?.lastProject ?? settings?.recentProjects[0]?.path),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTemplate) setTemplate(initialTemplate);
  }, [initialTemplate]);

  const chooseFolder = async () => {
    const path = await pickProjectFolder(t("newProject.location"));
    if (path) setLocation(path);
  };

  const create = async () => {
    if (!name.trim() || !location) {
      setError(!location ? t("newProject.noLocation") : t("newProject.invalidName"));
      return;
    }
    if (/[/\\]/.test(name) || name.trim().startsWith(".")) {
      setError(t("newProject.invalidName"));
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await createProject(location, name.trim(), template);
    setBusy(false);
    if (ok) onClose();
    else setError(t("newProject.exists"));
  };

  return (
    <Modal
      title={t("newProject.title")}
      subtitle={t("newProject.subtitle")}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <div className="grow" />
          <button type="button" className="text-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="text-button primary"
            onClick={() => void create()}
            disabled={busy || !name.trim() || !location}
          >
            {busy ? <span className="spinner" /> : null}
            {busy ? t("newProject.creating") : t("newProject.create")}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="project-name">
          {t("newProject.name")}
        </label>
        <input
          id="project-name"
          className="text-input"
          value={name}
          autoFocus
          placeholder={t("newProject.namePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
      </div>

      <div className="form-group">
        <span className="form-label">{t("newProject.location")}</span>
        <div className="row-input">
          <input
            className="text-input mono"
            value={location}
            placeholder="/Users/you/Documents"
            onChange={(event) => setLocation(event.target.value)}
            style={{ fontSize: 11 }}
          />
          <button type="button" className="text-button" onClick={() => void chooseFolder()}>
            <FolderOpen size={13} />
            {t("newProject.chooseFolder")}
          </button>
        </div>
      </div>

      <div className="form-group">
        <span className="form-label">{t("newProject.template")}</span>
        <div className="template-grid">
          {templates.map((item) => {
            const Icon = icons[item.icon];
            return (
              <button
                type="button"
                key={item.id}
                className={`template-option ${template === item.id ? "selected" : ""}`}
                onClick={() => setTemplate(item.id)}
              >
                <span className="template-icon">
                  <Icon size={16} />
                </span>
                <span className="template-name">{t(`templates.${item.id}.name`)}</span>
                <span className="template-description">
                  {t(`templates.${item.id}.description`)}
                </span>
                <span className="template-license">{t(`templates.${item.id}.license`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? <div className="fix-error">{error}</div> : null}
      <div className="form-hint">
        {location ? `${location}/${name.trim() || "…"}` : t("newProject.noLocation")}
      </div>
    </Modal>
  );
}
