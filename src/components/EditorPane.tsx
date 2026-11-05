import { FileCode2, PanelBottom, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { CheckpointDiffPane } from "./CheckpointDiffPane";
import { LatexEditor } from "./LatexEditor";

interface EditorPaneProps {
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function EditorPane({ panelOpen, onTogglePanel }: EditorPaneProps) {
  const { t } = useTranslation();
  const tabs = useAppStore((state) => state.tabs);
  const activeRel = useAppStore((state) => state.activeRel);
  const gotoLine = useAppStore((state) => state.gotoLine);
  const gotoToken = useAppStore((state) => state.gotoToken);
  const settings = useAppStore((state) => state.settings);
  const projectIndex = useAppStore((state) => state.projectIndex);
  const build = useAppStore((state) => state.build);
  const doctorReport = useAppStore((state) => state.doctorReport);
  const setTabContent = useAppStore((state) => state.setTabContent);
  const saveTab = useAppStore((state) => state.saveTab);
  const compile = useAppStore((state) => state.compile);
  const closeTab = useAppStore((state) => state.closeTab);
  const openFile = useAppStore((state) => state.openFile);
  const reloadTab = useAppStore((state) => state.reloadTab);
  const keepExternal = useAppStore((state) => state.keepExternal);
  const setCursor = useAppStore((state) => state.setCursor);
  const checkpointPreview = useAppStore((state) => state.checkpointPreview);

  const active = tabs.find((tab) => tab.rel === activeRel) ?? null;

  useEffect(() => {
    document.title = active ? `${active.name} — LaTeX Studio` : "LaTeX Studio";
  }, [active]);

  const editorSettings = settings?.editor;

  return (
    <section className="editor-pane">
      <div className="tabbar" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.rel}
            className={`tab ${tab.rel === activeRel ? "active" : ""}`}
            role="tab"
            aria-selected={tab.rel === activeRel}
            tabIndex={0}
            title={tab.rel}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void openFile(tab.rel);
              }
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void closeTab(tab.rel);
              } else if (event.button === 0) {
                void openFile(tab.rel);
              }
            }}
          >
            <span className="tab-icon">
              <FileCode2 size={12} />
            </span>
            <span className="tab-name">{tab.name}</span>
            {tab.dirty ? <span className="tab-dot" /> : null}
            <button
              type="button"
              className="tab-close"
              aria-label={t("common.close")}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void closeTab(tab.rel);
              }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <div className="tabbar-actions">
          <button
            type="button"
            className={`icon-button ${panelOpen ? "active" : ""}`}
            title={panelOpen ? t("panel.hide") : t("panel.show")}
            onClick={onTogglePanel}
          >
            <PanelBottom size={14} />
          </button>
        </div>
      </div>

      {checkpointPreview ? (
        <CheckpointDiffPane />
      ) : active ? (
        active.error ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <div className="editor-banner error">
              <span>{active.error}</span>
              <button type="button" className="tool-btn" onClick={() => void reloadTab(active.rel)}>
                {t("common.retry")}
              </button>
            </div>
            <div className="empty-state">
              <div className="empty-icon">
                <FileCode2 size={22} />
              </div>
              <h3>{t("editor.error")}</h3>
              <p>{active.rel}</p>
            </div>
          </div>
        ) : active.loading ? (
          <div className="empty-state">
            <span className="spinner large" />
            <p>{t("editor.loading")}</p>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {active.externalChange ? (
              <div className="editor-banner">
                <span>{t("editor.externalChange")}</span>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => void reloadTab(active.rel)}
                >
                  {t("editor.externalReload")}
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => void keepExternal(active.rel)}
                >
                  {t("editor.externalKeep")}
                </button>
              </div>
            ) : null}
            <div className="editor-body">
              {editorSettings ? (
                <LatexEditor
                  key={active.rel}
                  rel={active.rel}
                  content={active.content}
                  settings={editorSettings}
                  theme={settings.theme}
                  index={projectIndex}
                  diagnostics={[
                    ...(build?.diagnostics ?? []),
                    ...(doctorReport?.diagnostics ?? []),
                  ]}
                  gotoLine={gotoLine}
                  gotoToken={gotoToken}
                  onChange={(value) => setTabContent(active.rel, value)}
                  onCursor={(line, column) => setCursor(line, column)}
                  onSave={() => void saveTab(active.rel, true)}
                  onCompile={() => void compile()}
                />
              ) : null}
            </div>
          </div>
        )
      ) : (
        <div className="empty-state">
          <div className="empty-icon">
            <FileCode2 size={22} />
          </div>
          <h3>{t("editor.emptyTitle")}</h3>
          <p>{t("editor.emptyBody")}</p>
        </div>
      )}
    </section>
  );
}
