import {
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  Languages,
  RefreshCw,
  Settings,
  Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import { Logo } from "./Logo";

interface TitleBarProps {
  onOpenHistory: () => void;
  onOpenGit: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onOpenNewProject: () => void;
}

export function TitleBar({
  onOpenHistory,
  onOpenGit,
  onOpenSettings,
  onOpenExport,
  onOpenNewProject,
}: TitleBarProps) {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const settings = useAppStore((state) => state.settings);
  const compiling = useAppStore((state) => state.compiling);
  const activeRel = useAppStore((state) => state.activeRel);
  const compile = useAppStore((state) => state.compile);
  const cancelBuild = useAppStore((state) => state.cancelBuild);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const tools = useAppStore((state) => state.tools);

  const engine = settings?.compile.engine ?? "auto";
  const auto = settings?.compile.autoCompile ?? true;
  const language = settings?.language ?? "en";

  const setEngine = (value: string) => {
    if (!settings) return;
    void updateSettings({ compile: { ...settings.compile, engine: value } });
  };

  const toggleAuto = () => {
    if (!settings) return;
    void updateSettings({ compile: { ...settings.compile, autoCompile: !auto } });
  };

  const toggleLanguage = () => {
    if (!settings) return;
    void updateSettings({ language: language === "en" ? "ru" : "en" });
  };

  const missingEngine =
    !tools ||
    (!tools.latexmk && !tools.pdflatex && !tools.xelatex && !tools.lualatex && !tools.tectonic);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        type="button"
        className="brand"
        onClick={onOpenNewProject}
        style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
        title={t("welcome.newProject")}
      >
        <Logo />
        <span className="brand-name">{t("common.appName")}</span>
      </button>

      <div className="project-chip" title={project?.root ?? t("titlebar.noProject")}>
        <FolderOpen size={13} style={{ flex: "none", color: "var(--text-dim)" }} />
        <span className="project-chip-name">{project?.name ?? t("titlebar.noProject")}</span>
      </div>

      <div className="titlebar-spacer" data-tauri-drag-region />

      <div className="toolbar">
        <button
          type="button"
          className={`tool-btn primary ${compiling ? "running" : ""}`}
          disabled={!project}
          onClick={() => {
            if (compiling) void cancelBuild();
            else void compile();
          }}
          title={compiling ? t("titlebar.cancelBuild") : t("titlebar.recompileHint")}
        >
          {compiling ? <Square size={12} fill="currentColor" /> : <RefreshCw size={13} />}
          <span>{compiling ? t("titlebar.compiling") : t("titlebar.recompile")}</span>
        </button>

        <button
          type="button"
          className={`auto-toggle ${auto ? "on" : ""}`}
          onClick={toggleAuto}
          title={auto ? t("status.autoOn") : t("status.autoOff")}
          disabled={!settings}
        >
          <span className="dot" />
          <span>{t("titlebar.auto")}</span>
        </button>

        <select
          className="engine-select"
          value={engine}
          onChange={(event) => setEngine(event.target.value)}
          title={missingEngine ? t("status.noEngine") : t("titlebar.engine")}
          disabled={!settings}
        >
          <option value="auto">{t("settings.engineAuto")}</option>
          <option value="latexmk">{t("settings.engineLatexmk")}</option>
          <option value="pdflatex">{t("settings.enginePdflatex")}</option>
          <option value="xelatex">{t("settings.engineXelatex")}</option>
          <option value="lualatex">{t("settings.engineLualatex")}</option>
          <option value="tectonic">{t("settings.engineTectonic")}</option>
        </select>

        <div className="toolbar-sep" />

        <button
          type="button"
          className="tool-btn"
          onClick={onOpenHistory}
          disabled={!project || !activeRel}
          title={t("history.title")}
        >
          <History size={14} />
          <span className="tool-label">{t("titlebar.history")}</span>
        </button>

        <button
          type="button"
          className="tool-btn"
          onClick={onOpenGit}
          disabled={!project}
          title={t("git.title")}
        >
          <GitBranch size={14} />
          <span className="tool-label">{t("titlebar.git")}</span>
          {project?.isGit ? (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--success)",
                marginLeft: -1,
              }}
            />
          ) : null}
        </button>

        <button
          type="button"
          className="tool-btn"
          onClick={onOpenSettings}
          title={t("settings.title")}
        >
          <Settings size={14} />
          <span className="tool-label">{t("titlebar.settings")}</span>
        </button>

        <button
          type="button"
          className="tool-btn"
          onClick={onOpenExport}
          disabled={!project}
          title={t("export.title")}
        >
          <Download size={14} />
          <span className="tool-label">{t("titlebar.export")}</span>
        </button>

        <button
          type="button"
          className="tool-btn lang-btn"
          onClick={toggleLanguage}
          title={t("titlebar.language")}
        >
          <Languages size={13} />
          {language.toUpperCase()}
        </button>

        <button
          type="button"
          className="tool-btn icon-only"
          disabled={!project}
          onClick={() => {
            if (project) void api.revealProject(project.root);
          }}
          title={t("tree.reveal")}
        >
          <FileText size={14} />
        </button>
      </div>
    </header>
  );
}
