import {
  Book,
  BookOpen,
  File,
  FileText,
  FolderOpen,
  Library,
  Mail,
  Plus,
  Presentation,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { type TemplateId, templates } from "../i18n";
import { pickProjectFolder } from "../lib/dialogs";
import { formatRelativeTime, shortenPath } from "../lib/format";
import { useAppStore } from "../store/useAppStore";

const templateIcons = {
  "file-text": FileText,
  "book-open": BookOpen,
  library: Library,
  book: Book,
  presentation: Presentation,
  mail: Mail,
  file: File,
} as const;

interface WelcomeScreenProps {
  onNewProject: (template?: TemplateId) => void;
}

export function WelcomeScreen({ onNewProject }: WelcomeScreenProps) {
  const { t, i18n } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const backendMissing = useAppStore((state) => state.backendMissing);
  const openProject = useAppStore((state) => state.openProject);
  const removeRecent = useAppStore((state) => state.removeRecent);

  const openExisting = async () => {
    const path = await pickProjectFolder(t("welcome.openProject"));
    if (path) await openProject(path);
  };

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <section className="welcome-hero">
          <div className="welcome-brand">
            <span className="welcome-logo">
              <FileText size={27} strokeWidth={1.9} />
            </span>
            <div>
              <h1>LaTeX Studio</h1>
              <p className="welcome-tagline">{t("welcome.tagline")}</p>
            </div>
          </div>
          <div className="welcome-actions">
            <button type="button" className="text-button primary" onClick={() => onNewProject()}>
              <Plus size={14} />
              {t("welcome.newProject")}
            </button>
            <button type="button" className="text-button" onClick={() => void openExisting()}>
              <FolderOpen size={14} />
              {t("welcome.openProject")}
            </button>
          </div>
          <div className="welcome-shortcuts">
            <span>{t("welcome.shortcutNew")}</span>
            <span>{t("welcome.shortcutOpen")}</span>
          </div>
          {backendMissing ? (
            <div className="pandoc-warning" style={{ marginTop: 10 }}>
              {t("errors.tauriUnavailable")}
            </div>
          ) : null}
        </section>

        <div className="welcome-grid">
          <section className="welcome-section" style={{ marginTop: 0 }}>
            <h2 className="section-title">
              <FolderOpen size={12} />
              {t("welcome.recent")}
            </h2>
            <div className="recent-list">
              {settings && settings.recentProjects.length > 0 ? (
                settings.recentProjects.map((recent) => (
                  <button
                    type="button"
                    className="recent-item"
                    key={recent.path}
                    onClick={() => void openProject(recent.path)}
                    title={recent.path}
                  >
                    <span className="recent-icon">
                      <FolderOpen size={15} />
                    </span>
                    <span className="recent-body">
                      <span className="recent-name">{recent.name}</span>
                      <span className="recent-path">{shortenPath(recent.path, 64)}</span>
                    </span>
                    <span className="recent-path" style={{ flex: "none" }}>
                      {formatRelativeTime(recent.lastOpenedMs, i18n.language)}
                    </span>
                    <span
                      className="icon-button recent-remove"
                      role="button"
                      tabIndex={0}
                      aria-label={t("welcome.removeRecent")}
                      title={t("welcome.removeRecent")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void removeRecent(recent.path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          void removeRecent(recent.path);
                        }
                      }}
                    >
                      <X size={12} />
                    </span>
                  </button>
                ))
              ) : (
                <div className="recent-empty">
                  <div>{t("welcome.noRecent")}</div>
                  <div style={{ marginTop: 3, fontSize: 10.5 }}>{t("welcome.noRecentHint")}</div>
                </div>
              )}
            </div>
          </section>

          <section className="welcome-section" style={{ marginTop: 0 }}>
            <h2 className="section-title">
              <FileText size={12} />
              {t("welcome.templates")}
            </h2>
            <div className="welcome-templates">
              {templates.map((template) => {
                const Icon = templateIcons[template.icon];
                return (
                  <button
                    type="button"
                    className="template-card"
                    key={template.id}
                    onClick={() => onNewProject(template.id)}
                  >
                    <span className="template-icon">
                      <Icon size={16} />
                    </span>
                    <span className="template-name">{t(`templates.${template.id}.name`)}</span>
                    <span className="template-description">
                      {t(`templates.${template.id}.description`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="local-note">
          <ShieldCheck size={13} />
          {t("welcome.localFirst")}
        </div>
      </div>
    </main>
  );
}
