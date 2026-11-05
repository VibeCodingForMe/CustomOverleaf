import { Check, FolderOpen, Info, RefreshCw, Settings2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/ipc";
import {
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  normalizeShortcut,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type Shortcuts,
  saveShortcuts,
} from "../lib/shortcuts";
import { useAppStore } from "../store/useAppStore";
import type {
  CompileSettings,
  EditorSettings,
  HistorySettings,
  PdfSettings,
  Theme,
} from "../types";
import { Modal } from "./Modal";

interface SettingsModalProps {
  onClose: () => void;
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        {description ? <div className="setting-description">{description}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const tools = useAppStore((state) => state.tools);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const refreshTools = useAppStore((state) => state.refreshTools);
  const [dataDir, setDataDir] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [shortcuts, setShortcuts] = useState<Shortcuts>(() => loadShortcuts());

  useEffect(() => {
    void api
      .getAppDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(""));
  }, []);

  if (!settings) return null;

  const editor = (patch: Partial<EditorSettings>) =>
    void updateSettings({ editor: { ...settings.editor, ...patch } });
  const compile = (patch: Partial<CompileSettings>) =>
    void updateSettings({ compile: { ...settings.compile, ...patch } });
  const pdf = (patch: Partial<PdfSettings>) =>
    void updateSettings({ pdf: { ...settings.pdf, ...patch } });
  const history = (patch: Partial<HistorySettings>) =>
    void updateSettings({ history: { ...settings.history, ...patch } });

  const updateShortcut = (action: ShortcutAction, value: string) => {
    const next = { ...shortcuts, [action]: value };
    setShortcuts(next);
    if (SHORTCUT_ACTIONS.every((item) => normalizeShortcut(next[item]))) {
      saveShortcuts(next);
    }
  };
  const resetShortcuts = () => {
    const next = { ...DEFAULT_SHORTCUTS };
    setShortcuts(next);
    saveShortcuts(next);
  };

  const toolList = [
    { key: "tectonic", label: "Tectonic" },
    { key: "latexmk", label: "latexmk" },
    { key: "pdflatex", label: "pdfLaTeX" },
    { key: "xelatex", label: "XeLaTeX" },
    { key: "lualatex", label: "LuaLaTeX" },
    { key: "bibtex", label: "BibTeX" },
    { key: "biber", label: "Biber" },
    { key: "pandoc", label: "Pandoc" },
    { key: "git", label: "Git" },
    { key: "synctex", label: "SyncTeX" },
  ] as const;

  const needle = query.trim().toLowerCase();
  const matches = (...values: string[]) =>
    !needle || values.join(" ").toLowerCase().includes(needle);
  const matchAppearance = matches(
    t("settings.appearance"),
    t("settings.theme"),
    t("settings.language"),
    t("settings.dark"),
    t("settings.light"),
    t("settings.system"),
  );
  const matchEditor = matches(
    t("settings.editor"),
    t("settings.fontSize"),
    t("settings.fontFamily"),
    t("settings.tabSize"),
    t("settings.wordWrap"),
    t("settings.lineNumbers"),
    t("settings.spellcheck"),
    t("settings.snippets"),
    t("settings.autosave"),
  );
  const matchCompile = matches(
    t("settings.compile"),
    t("settings.engine"),
    t("settings.autoCompile"),
    t("settings.autoCompileDelay"),
    t("settings.timeout"),
    t("settings.buildDir"),
  );
  const matchPdf = matches(
    t("settings.pdf"),
    t("settings.defaultZoom"),
    t("settings.rememberPosition"),
  );
  const matchHistory = matches(t("settings.history"), t("settings.historyRetention"));
  const matchShortcuts = matches(
    t("settings.shortcuts"),
    t("settings.shortcutsHint"),
    "keyboard hotkeys keybindings",
  );
  const matchTools = matches(
    t("settings.tools"),
    "tectonic latexmk pdflatex xelatex lualatex biber pandoc git synctex",
  );
  const anyMatch =
    matchAppearance ||
    matchEditor ||
    matchCompile ||
    matchPdf ||
    matchHistory ||
    matchShortcuts ||
    matchTools;

  return (
    <Modal
      size="medium"
      title={t("settings.title")}
      subtitle={t("settings.unsavedNote")}
      onClose={onClose}
      footer={
        <>
          <span className="form-hint">
            {t("settings.schema", { version: settings.schemaVersion })}
          </span>
          <div className="grow" />
          <button type="button" className="text-button primary" onClick={onClose}>
            {t("settings.save")}
          </button>
        </>
      }
    >
      <input
        className="settings-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("settings.searchPlaceholder")}
        aria-label={t("settings.searchPlaceholder")}
      />
      {!anyMatch ? <div className="form-hint">{t("settings.noMatches")}</div> : null}
      <section hidden={!matchAppearance} className="settings-section">
        <h3 className="settings-section-title">{t("settings.appearance")}</h3>
        <Row label={t("settings.theme")}>
          <div className="segmented">
            {(["dark", "light", "system"] as Theme[]).map((value) => (
              <button
                type="button"
                key={value}
                className={settings.theme === value ? "active" : ""}
                onClick={() => void updateSettings({ theme: value })}
              >
                {t(`settings.${value}`)}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("settings.language")}>
          <div className="segmented">
            <button
              type="button"
              className={settings.language === "en" ? "active" : ""}
              onClick={() => void updateSettings({ language: "en" })}
            >
              {t("settings.english")}
            </button>
            <button
              type="button"
              className={settings.language === "ru" ? "active" : ""}
              onClick={() => void updateSettings({ language: "ru" })}
            >
              {t("settings.russian")}
            </button>
          </div>
        </Row>
      </section>

      <section hidden={!matchEditor} className="settings-section">
        <h3 className="settings-section-title">{t("settings.editor")}</h3>
        <Row label={t("settings.fontSize")}>
          <input
            className="number-input"
            type="number"
            min={9}
            max={32}
            value={settings.editor.fontSize}
            onChange={(event) => editor({ fontSize: Number(event.target.value) || 13 })}
          />
        </Row>
        <Row label={t("settings.fontFamily")}>
          <select
            className="select-input"
            value={settings.editor.fontFamily}
            onChange={(event) => editor({ fontFamily: event.target.value })}
          >
            <option value="SF Mono">SF Mono</option>
            <option value="Menlo">Menlo</option>
            <option value="Monaco">Monaco</option>
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
          </select>
        </Row>
        <Row label={t("settings.tabSize")}>
          <select
            className="select-input"
            value={settings.editor.tabSize}
            onChange={(event) => editor({ tabSize: Number(event.target.value) })}
          >
            {[1, 2, 4, 8].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("settings.wordWrap")}>
          <button
            type="button"
            className={`toggle ${settings.editor.wordWrap ? "on" : ""}`}
            aria-pressed={settings.editor.wordWrap}
            onClick={() => editor({ wordWrap: !settings.editor.wordWrap })}
          />
        </Row>
        <Row label={t("settings.lineNumbers")}>
          <button
            type="button"
            className={`toggle ${settings.editor.lineNumbers ? "on" : ""}`}
            aria-pressed={settings.editor.lineNumbers}
            onClick={() => editor({ lineNumbers: !settings.editor.lineNumbers })}
          />
        </Row>
        <Row label={t("settings.spellcheck")}>
          <button
            type="button"
            className={`toggle ${settings.editor.spellcheck ? "on" : ""}`}
            aria-pressed={settings.editor.spellcheck}
            onClick={() => editor({ spellcheck: !settings.editor.spellcheck })}
          />
        </Row>
        <Row label={t("settings.snippets")}>
          <button
            type="button"
            className={`toggle ${settings.editor.snippets ? "on" : ""}`}
            aria-pressed={settings.editor.snippets}
            onClick={() => editor({ snippets: !settings.editor.snippets })}
          />
        </Row>
        <Row label={t("settings.autosave")}>
          <input
            className="number-input"
            type="number"
            min={300}
            max={10000}
            step={100}
            value={settings.editor.autosaveDelayMs}
            onChange={(event) => editor({ autosaveDelayMs: Number(event.target.value) || 900 })}
          />
          <span className="form-hint">
            {t("settings.milliseconds", { value: settings.editor.autosaveDelayMs })}
          </span>
        </Row>
      </section>

      <section hidden={!matchCompile} className="settings-section">
        <h3 className="settings-section-title">{t("settings.compile")}</h3>
        <Row label={t("settings.engine")} description={t("settings.engineHint")}>
          <select
            className="select-input"
            value={settings.compile.engine}
            onChange={(event) => compile({ engine: event.target.value })}
          >
            <option value="auto">{t("settings.engineAuto")}</option>
            <option value="latexmk">{t("settings.engineLatexmk")}</option>
            <option value="pdflatex">{t("settings.enginePdflatex")}</option>
            <option value="xelatex">{t("settings.engineXelatex")}</option>
            <option value="lualatex">{t("settings.engineLualatex")}</option>
            <option value="tectonic">{t("settings.engineTectonic")}</option>
          </select>
        </Row>
        <Row label={t("settings.autoCompile")}>
          <button
            type="button"
            className={`toggle ${settings.compile.autoCompile ? "on" : ""}`}
            aria-pressed={settings.compile.autoCompile}
            onClick={() => compile({ autoCompile: !settings.compile.autoCompile })}
          />
        </Row>
        <Row label={t("settings.autoCompileDelay")}>
          <input
            className="number-input"
            type="number"
            min={400}
            max={30000}
            step={100}
            value={settings.compile.autoCompileDelayMs}
            onChange={(event) =>
              compile({ autoCompileDelayMs: Number(event.target.value) || 1400 })
            }
          />
          <span className="form-hint">
            {t("settings.milliseconds", { value: settings.compile.autoCompileDelayMs })}
          </span>
        </Row>
        <Row label={t("settings.timeout")}>
          <input
            className="number-input"
            type="number"
            min={15}
            max={1800}
            value={settings.compile.timeoutSeconds}
            onChange={(event) => compile({ timeoutSeconds: Number(event.target.value) || 300 })}
          />
          <span className="form-hint">
            {t("settings.seconds", { value: settings.compile.timeoutSeconds })}
          </span>
        </Row>
        <Row label={t("settings.buildDir")} description={t("settings.buildDirHint")}>
          <input
            className="text-input"
            value={settings.compile.buildDir}
            placeholder=".latexstudio/build"
            onChange={(event) => compile({ buildDir: event.target.value })}
          />
        </Row>
      </section>

      <section hidden={!matchPdf} className="settings-section">
        <h3 className="settings-section-title">{t("settings.pdf")}</h3>
        <Row label={t("settings.defaultZoom")}>
          <select
            className="select-input"
            value={String(settings.pdf.defaultZoom)}
            onChange={(event) => pdf({ defaultZoom: Number(event.target.value) })}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option value={value} key={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("settings.rememberPosition")}>
          <button
            type="button"
            className={`toggle ${settings.pdf.rememberPosition ? "on" : ""}`}
            aria-pressed={settings.pdf.rememberPosition}
            onClick={() => pdf({ rememberPosition: !settings.pdf.rememberPosition })}
          />
        </Row>
      </section>

      <section hidden={!matchHistory} className="settings-section">
        <h3 className="settings-section-title">{t("settings.history")}</h3>
        <Row
          label={t("settings.historyRetention")}
          description={t("settings.historyRetentionHint")}
        >
          <input
            className="number-input"
            type="number"
            min={10}
            max={500}
            step={10}
            value={settings.history.retention}
            onChange={(event) => history({ retention: Number(event.target.value) || 80 })}
          />
        </Row>
      </section>

      <section hidden={!matchTools} className="settings-section">
        <h3 className="settings-section-title">
          <Wrench size={11} style={{ display: "inline", marginRight: 4 }} />
          {t("settings.tools")}
        </h3>
        <p className="form-hint" style={{ margin: "0 0 7px" }}>
          {t("settings.toolsHint")}
        </p>
        <div className="tool-grid">
          {toolList.map((tool) => {
            const info = tools?.[tool.key] ?? null;
            return (
              <div
                className="tool-chip"
                key={tool.key}
                title={info?.path ?? t("settings.toolMissing")}
              >
                <span className={`tool-status ${info ? "found" : ""}`} />
                <span className="tool-name">{tool.label}</span>
                <span className="tool-version">
                  {info ? info.version || t("settings.toolFound") : t("settings.toolMissing")}
                </span>
                {info ? <Check size={11} color="var(--success)" /> : null}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="text-button small"
          style={{ marginTop: 8 }}
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await refreshTools();
            setRefreshing(false);
          }}
        >
          <RefreshCw size={11} className={refreshing ? "spin" : ""} />
          {t("settings.refreshTools")}
        </button>
      </section>

      <section hidden={!matchShortcuts} className="settings-section">
        <h3 className="settings-section-title">{t("settings.shortcuts")}</h3>
        <p className="form-hint">{t("settings.shortcutsHint")}</p>
        {SHORTCUT_ACTIONS.map((action) => (
          <Row key={action} label={t(`shortcuts.actions.${action}`)}>
            <input
              className="text-input shortcut-input"
              value={shortcuts[action]}
              aria-invalid={!normalizeShortcut(shortcuts[action])}
              onChange={(event) => updateShortcut(action, event.target.value)}
              spellCheck={false}
            />
          </Row>
        ))}
        <div className="shortcut-actions">
          <button type="button" className="text-button small" onClick={resetShortcuts}>
            {t("shortcuts.reset")}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">{t("settings.advanced")}</h3>
        <div className="form-group">
          <span className="form-label">{t("settings.dataFolder")}</span>
          <div className="data-path">
            {dataDir || "~/Library/Application Support/com.latexstudio.desktop"}
          </div>
          <div>
            <button
              type="button"
              className="text-button small"
              onClick={() => void api.revealAppDataDir()}
            >
              <FolderOpen size={11} />
              {t("settings.revealData")}
            </button>
          </div>
        </div>
        <div className="tip-card" style={{ marginTop: 4 }}>
          <Settings2 size={14} className="tip-icon" />
          <div>
            <div className="tip-title">{t("settings.about")}</div>
            <div className="tip-text">{t("settings.aboutBody")}</div>
          </div>
        </div>
      </section>

      <div
        className="form-hint"
        style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 4 }}
      >
        <Info size={11} />
        {t("settings.unsavedNote")}
      </div>
    </Modal>
  );
}
