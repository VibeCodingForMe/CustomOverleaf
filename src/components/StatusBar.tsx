import { CloudOff, Cpu, HardDrive, WifiOff } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { shortenPath } from "../lib/format";
import { useAppStore } from "../store/useAppStore";

export function StatusBar() {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const tabs = useAppStore((state) => state.tabs);
  const activeRel = useAppStore((state) => state.activeRel);
  const activeLine = useAppStore((state) => state.activeLine);
  const activeColumn = useAppStore((state) => state.activeColumn);
  const compiling = useAppStore((state) => state.compiling);
  const build = useAppStore((state) => state.build);
  const tools = useAppStore((state) => state.tools);
  const settings = useAppStore((state) => state.settings);

  const active = tabs.find((tab) => tab.rel === activeRel);
  const dirty = tabs.some((tab) => tab.dirty);

  const stats = useMemo(() => {
    if (!active) return null;
    const lines = active.content.length === 0 ? 1 : active.content.split("\n").length;
    const words = active.content.trim() ? active.content.trim().split(/\s+/).length : 0;
    return { lines, words };
  }, [active]);

  const noEngine =
    !tools ||
    (!tools.latexmk && !tools.pdflatex && !tools.xelatex && !tools.lualatex && !tools.tectonic);
  const engine = build?.engine ?? settings?.compile.engine ?? "auto";
  const errorCount =
    build?.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length ?? 0;

  return (
    <footer className="statusbar">
      <span className="status-item" title={project?.root}>
        <span className={`status-dot ${compiling ? "busy" : dirty ? "" : "ok"}`} />
        {compiling
          ? t("status.saving")
          : dirty
            ? t("status.unsaved")
            : active
              ? t("status.saved")
              : t("status.buildIdle")}
      </span>
      {project ? (
        <span className="status-item" title={project.root}>
          <HardDrive size={10} />
          <strong>{shortenPath(project.root, 44)}</strong>
        </span>
      ) : null}
      {build ? (
        <span className={`status-item ${build.success ? "" : "danger"}`}>
          <span className={`status-dot ${build.success ? "ok" : "error"}`} />
          {build.success
            ? t("status.buildOk")
            : errorCount > 0
              ? `${t("status.buildError")} · ${t("panel.problems", { count: errorCount })}`
              : t("status.buildError")}
        </span>
      ) : null}
      <div className="grow" />
      {noEngine ? (
        <span className="status-item danger" title={t("errors.noEngine")}>
          <WifiOff size={10} />
          {t("status.noEngine")}
        </span>
      ) : (
        <span className="status-item" title={t("titlebar.engine")}>
          <Cpu size={10} />
          {t("status.engineReady", { engine })}
        </span>
      )}
      {stats ? (
        <>
          <span className="status-item">{t("editor.lines", { count: stats.lines })}</span>
          <span className="status-item">{t("editor.words", { count: stats.words })}</span>
        </>
      ) : null}
      {active ? (
        <span className="status-item mono">
          {t("status.cursor", { line: activeLine ?? 1, column: activeColumn ?? 1 })}
        </span>
      ) : null}
      <span className="status-item" title={t("welcome.localFirst")}>
        <CloudOff size={10} />
        {t("status.offline")}
      </span>
    </footer>
  );
}
