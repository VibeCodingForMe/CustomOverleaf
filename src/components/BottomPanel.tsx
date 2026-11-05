import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Info,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../lib/format";
import { useAppStore } from "../store/useAppStore";
import type { Diagnostic, PanelTab } from "../types";

const tabs: Array<{ id: PanelTab; label: string }> = [
  { id: "logs", label: "panel.logs" },
  { id: "errors", label: "panel.errors" },
  { id: "warnings", label: "panel.warnings" },
  { id: "doctor", label: "panel.doctor" },
  { id: "search", label: "panel.search" },
  { id: "build", label: "panel.build" },
];

const confidenceKeys: Record<string, string> = {
  high: "doctor.confidenceHigh",
  medium: "doctor.confidenceMedium",
  low: "doctor.confidenceLow",
};

function diagnosticText(t: ReturnType<typeof useTranslation>["t"], diagnostic: Diagnostic) {
  const params = diagnostic.params as Record<string, string>;
  const title = t(`diagnostics.codes.${diagnostic.code}.title`, {
    defaultValue: diagnostic.message,
    ...params,
  });
  const body = t(`diagnostics.codes.${diagnostic.code}.body`, {
    defaultValue: "",
    ...params,
  });
  return { title, body };
}

export function BottomPanel() {
  const { t } = useTranslation();
  const build = useAppStore((state) => state.build);
  const doctorReport = useAppStore((state) => state.doctorReport);
  const doctorLoading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const doctorStale = useAppStore((state) => state.doctorStale);
  const runDoctor = useAppStore((state) => state.runDoctor);
  const panelTab = useAppStore((state) => state.panelTab);
  const panelHeight = useAppStore((state) => state.panelHeight);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchResults = useAppStore((state) => state.searchResults);
  const searchLoading = useAppStore((state) => state.searchLoading);
  const searchCaseSensitive = useAppStore((state) => state.searchCaseSensitive);
  const setPanelTab = useAppStore((state) => state.setPanelTab);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const search = useAppStore((state) => state.search);
  const setSearchCaseSensitive = useAppStore((state) => state.setSearchCaseSensitive);
  const openFile = useAppStore((state) => state.openFile);
  const openFix = useAppStore((state) => state.openFix);
  const cleanBuild = useAppStore((state) => state.cleanBuild);
  const cleanAux = useAppStore((state) => state.cleanAux);
  const toast = useAppStore((state) => state.toast);
  const [localQuery, setLocalQuery] = useState(searchQuery);

  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (panelTab !== "search") return;
    if (localQuery === searchQuery) return;
    const timer = setTimeout(() => void search(localQuery), 260);
    return () => clearTimeout(timer);
  }, [localQuery, panelTab, search, searchQuery]);

  const allDiagnostics = useMemo(() => {
    const combined = [...(build?.diagnostics ?? []), ...(doctorReport?.diagnostics ?? [])];
    const seen = new Set<string>();
    return combined.filter((diagnostic) => {
      const key = [
        diagnostic.code,
        diagnostic.file,
        diagnostic.line,
        diagnostic.message,
        diagnostic.severity,
      ].join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [build, doctorReport]);

  const errors = useMemo(
    () => allDiagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [allDiagnostics],
  );
  const warnings = useMemo(
    () => allDiagnostics.filter((diagnostic) => diagnostic.severity === "warning"),
    [allDiagnostics],
  );
  const doctorCount = doctorReport?.diagnostics.length ?? 0;

  const counts: Partial<Record<PanelTab, number>> = {
    errors: errors.length,
    warnings: warnings.length,
    doctor: doctorCount,
    search: searchResults.length,
  };

  useEffect(() => {
    if (panelTab !== "doctor" || doctorReport || doctorLoading || doctorError) return;
    void runDoctor();
  }, [doctorError, doctorLoading, doctorReport, panelTab, runDoctor]);

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast(t("common.copied"), "success");
  };

  const jump = (diagnostic: Diagnostic) => {
    if (!diagnostic.file) return;
    void openFile(diagnostic.file, diagnostic.line ?? undefined, diagnostic.column ?? undefined);
  };

  const renderDiagnostics = (items: Diagnostic[], emptyMessage?: string) => {
    if (!build && !doctorReport) {
      return <div className="panel-empty">{t("panel.notBuilt")}</div>;
    }
    if (items.length === 0) {
      return (
        <div className="panel-empty">
          {emptyMessage ?? (panelTab === "errors" ? t("panel.noErrors") : t("panel.noWarnings"))}
        </div>
      );
    }
    return (
      <div className="diagnostics-list">
        {items.map((diagnostic) => {
          const text = diagnosticText(t, diagnostic);
          return (
            <article
              key={diagnostic.id}
              className={`diag-card ${diagnostic.severity === "warning" ? "warning" : ""} ${
                diagnostic.severity === "info" ? "info" : ""
              }`}
            >
              <div className="diag-head">
                <span className="diag-severity">
                  {diagnostic.severity === "error" ? (
                    <XCircle size={13} />
                  ) : diagnostic.severity === "info" ? (
                    <Info size={13} />
                  ) : (
                    <AlertTriangle size={13} />
                  )}
                </span>
                {diagnostic.file ? (
                  <button
                    type="button"
                    className="diag-location"
                    title={t("panel.diagnosticsHelp")}
                    onClick={() => jump(diagnostic)}
                  >
                    {diagnostic.file}
                    {diagnostic.line ? `:${diagnostic.line}` : ""}
                  </button>
                ) : null}
                <span className="diag-title">{text.title}</span>
                {confidenceKeys[diagnostic.params.confidence] ? (
                  <span
                    className={`diag-confidence ${diagnostic.params.confidence}`}
                    title={t("doctor.confidence")}
                  >
                    {t(confidenceKeys[diagnostic.params.confidence])}
                  </span>
                ) : null}
              </div>
              <div className="diag-message">{diagnostic.message}</div>
              {text.body ? <div className="diag-explanation">{text.body}</div> : null}
              <div className="diag-actions">
                {diagnostic.fixable ? (
                  <button
                    type="button"
                    className="text-button small"
                    onClick={() => void openFix(diagnostic)}
                  >
                    {t("panel.fixLine")}
                  </button>
                ) : null}
                {diagnostic.file ? (
                  <button
                    type="button"
                    className="text-button small"
                    onClick={() => jump(diagnostic)}
                  >
                    {t("menu.open")}
                  </button>
                ) : null}
                {diagnostic.raw && diagnostic.raw !== diagnostic.message ? (
                  <button
                    type="button"
                    className="text-button small"
                    title={diagnostic.raw}
                    onClick={() => copyText(diagnostic.raw)}
                  >
                    <Clipboard size={11} />
                    {t("common.copy")}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
        {panelTab === "errors" ? (
          <div className="tip-card">
            <Info size={14} className="tip-icon" />
            <div>
              <div className="tip-title">{t("panel.tipTitle")}</div>
              <div className="tip-text">{t("panel.tipBody")}</div>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderBuildSummary = () => {
    if (!build) return null;
    return (
      <>
        <div className="build-summary">
          <span className={`summary-item ${build.success ? "ok" : "fail"}`}>
            {build.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            <strong>
              {build.cancelled
                ? t("panel.buildCancelled")
                : build.timedOut
                  ? t("panel.buildTimeout")
                  : build.success
                    ? t("panel.buildSuccess")
                    : t("panel.buildFailed")}
            </strong>
          </span>
          <span className="summary-item">
            {t("panel.engine")}: <strong>{build.engine}</strong>
          </span>
          <span className="summary-item">
            {t("panel.duration")}: <strong>{(build.durationMs / 1000).toFixed(2)} s</strong>
          </span>
          <span className="summary-item">
            {t("panel.exitCode")}: <strong>{build.exitCode ?? "—"}</strong>
          </span>
          <span className="summary-item">
            {t("panel.pdfSize")}:{" "}
            <strong>{build.pdfSize ? formatBytes(build.pdfSize) : "—"}</strong>
          </span>
          {!build.success && build.stalePdf ? (
            <span className="summary-item" style={{ color: "var(--warning)" }}>
              {t("panel.stale")}
            </span>
          ) : null}
          <div className="grow" />
          <button
            type="button"
            className="text-button small"
            onClick={() => copyText(build.buildOutput)}
          >
            <Clipboard size={11} />
            {t("panel.copyLogs")}
          </button>
          <button type="button" className="text-button small" onClick={() => void cleanAux()}>
            <Trash2 size={11} />
            {t("panel.cleanAux")}
          </button>
          <button type="button" className="text-button small" onClick={() => void cleanBuild()}>
            <Trash2 size={11} />
            {t("panel.clean")}
          </button>
        </div>
        <div className="command-preview">{build.commandPreview}</div>
      </>
    );
  };

  const renderBody = () => {
    if (panelTab === "logs") {
      return (
        <div className="panel-body logs">
          {build?.logs ? (
            <>
              {renderBuildSummary()}
              <pre className="log-view">{build.logs}</pre>
            </>
          ) : (
            <div className="panel-empty">{t("panel.noLogs")}</div>
          )}
        </div>
      );
    }
    if (panelTab === "build") {
      return (
        <div className="panel-body logs">
          {build ? (
            <>
              {renderBuildSummary()}
              <pre className="log-view">{build.buildOutput}</pre>
            </>
          ) : (
            <div className="panel-empty">{t("panel.notBuilt")}</div>
          )}
        </div>
      );
    }
    if (panelTab === "doctor") {
      return (
        <div className="panel-body doctor-panel">
          <div className="doctor-toolbar">
            <div className="doctor-summary">
              {doctorReport
                ? t("doctor.summary", {
                    files: doctorReport.checkedFiles,
                    labels: doctorReport.labels,
                    references: doctorReport.references,
                    citations: doctorReport.citations,
                    images: doctorReport.images,
                  })
                : t("doctor.title")}
            </div>
            <button
              type="button"
              className="text-button small"
              disabled={doctorLoading}
              onClick={() => void runDoctor()}
            >
              {doctorLoading
                ? t("doctor.checking")
                : doctorReport
                  ? t("doctor.rerun")
                  : t("doctor.run")}
            </button>
          </div>
          {doctorStale && doctorReport ? (
            <div className="doctor-stale">{t("doctor.stale")}</div>
          ) : null}
          {doctorLoading ? (
            <div className="panel-empty">
              <span className="spinner" /> {t("doctor.checking")}
            </div>
          ) : doctorError ? (
            <div className="panel-empty doctor-error">
              {t("doctor.error", { message: doctorError })}
            </div>
          ) : !doctorReport ? (
            <div className="panel-empty">{t("doctor.run")}</div>
          ) : (
            renderDiagnostics(allDiagnostics, t("doctor.clean"))
          )}
        </div>
      );
    }
    if (panelTab === "search") {
      return (
        <div className="panel-body">
          <div className="panel-search-bar">
            <div className="search-box" style={{ flex: 1 }}>
              <Search size={12} />
              <input
                value={localQuery}
                placeholder={t("search.placeholder")}
                onChange={(event) => setLocalQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search(localQuery);
                }}
              />
              {localQuery ? (
                <button
                  type="button"
                  className="icon-button"
                  style={{ width: 18, height: 18 }}
                  onClick={() => {
                    setLocalQuery("");
                    void search("");
                  }}
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={`text-button small ${searchCaseSensitive ? "primary" : ""}`}
              title={t("search.caseSensitive")}
              onClick={() => void setSearchCaseSensitive(!searchCaseSensitive)}
            >
              Aa
            </button>
          </div>
          {searchLoading ? (
            <div className="panel-empty">
              <span className="spinner" /> {t("search.searching")}
            </div>
          ) : searchQuery.trim().length === 0 ? (
            <div className="panel-empty">{t("panel.noSearch")}</div>
          ) : searchResults.length === 0 ? (
            <div className="panel-empty">{t("search.noResults")}</div>
          ) : (
            <>
              <div className="form-hint" style={{ marginBottom: 5 }}>
                {t("search.results", { count: searchResults.length })}
              </div>
              <div className="search-results">
                {searchResults.map((result, index) => (
                  <button
                    type="button"
                    key={`${result.file}-${result.line}-${result.column}-${index}`}
                    className="search-result"
                    onClick={() => void openFile(result.file, result.line, result.column)}
                  >
                    <span className="file">{result.file}</span>
                    <span className="line">{result.line}</span>
                    <span className="preview">{result.preview}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="panel-body">
        {renderDiagnostics(panelTab === "errors" ? errors : warnings)}
      </div>
    );
  };

  return (
    <div className="bottom-panel" style={{ height: panelHeight }}>
      <div className="panel-tabs" role="tablist">
        {tabs.map((tab) => {
          const count = counts[tab.id];
          return (
            <button
              type="button"
              key={tab.id}
              className={`panel-tab ${panelTab === tab.id ? "active" : ""}`}
              onClick={() => setPanelTab(tab.id)}
              role="tab"
              aria-selected={panelTab === tab.id}
            >
              {t(tab.label)}
              {count !== undefined && count > 0 ? (
                <span
                  className={`panel-count ${tab.id === "errors" ? "error" : tab.id === "warnings" ? "warning" : ""}`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="panel-tabs-spacer" />
        {build ? (
          <span
            className="status-item"
            style={{ fontSize: 9.5, paddingRight: 4 }}
            title={build.commandPreview}
          >
            <span className={`status-dot ${build.success ? "ok" : "error"}`} />
            {build.engine}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-button"
          title={t("panel.hide")}
          onClick={() => setPanelOpen(false)}
        >
          <X size={13} />
        </button>
      </div>
      {renderBody()}
    </div>
  );
}
