import { create } from "zustand";
import i18n from "../i18n";
import { localizedError } from "../lib/errors";
import { api, errorCode, errorMessage } from "../lib/ipc";
import type {
  AppTab,
  BuildResult,
  CheckpointFileDiff,
  CheckpointPreview,
  ConfirmOptions,
  ConfirmState,
  Diagnostic,
  DoctorReport,
  FixState,
  LastPdf,
  PanelTab,
  ProjectIndex,
  ProjectSnapshot,
  ReplacePreview,
  SearchMatch,
  Settings,
  SidebarView,
  SyncStatus,
  SyncTarget,
  Theme,
  ToastMessage,
  ToolsInfo,
} from "../types";

const MAX_TABS = 24;
const CRASH_KEY_PREFIX = "latexstudio.crashDrafts:";
const CRASH_MAX_CHARS = 3_500_000;
let toastId = 0;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let autoCompileTimer: ReturnType<typeof setTimeout> | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;
let crashTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestId = 0;

interface CrashDraft {
  rel: string;
  content: string;
  eol: string;
  bom: boolean;
}

interface CrashRecord {
  savedAtMs: number;
  drafts: CrashDraft[];
}

function clearAutosave(rel: string) {
  const timer = saveTimers.get(rel);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(rel);
  }
}

function crashKey(root: string) {
  return `${CRASH_KEY_PREFIX}${root}`;
}

function readCrashDrafts(root: string): CrashDraft[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(crashKey(root));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CrashRecord>;
    if (!Array.isArray(parsed.drafts)) return [];
    const seen = new Set<string>();
    return parsed.drafts.filter((draft): draft is CrashDraft => {
      if (
        !draft ||
        typeof draft.rel !== "string" ||
        typeof draft.content !== "string" ||
        typeof draft.eol !== "string" ||
        typeof draft.bom !== "boolean" ||
        draft.rel.startsWith("/") ||
        draft.rel.includes("..") ||
        seen.has(draft.rel)
      ) {
        return false;
      }
      seen.add(draft.rel);
      return true;
    });
  } catch {
    return [];
  }
}

function writeCrashDrafts(root: string, drafts: CrashDraft[]) {
  if (typeof localStorage === "undefined") return;
  try {
    if (drafts.length === 0) {
      localStorage.removeItem(crashKey(root));
      return;
    }
    const record: CrashRecord = { savedAtMs: Date.now(), drafts };
    localStorage.setItem(crashKey(root), JSON.stringify(record));
  } catch {
    // Recovery is best-effort; quota or privacy-mode failures must not break editing.
  }
}

function clearCrashDrafts(root: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(crashKey(root));
  } catch {
    // Ignore storage failures.
  }
}

function persistCurrentDrafts() {
  const state = useAppStore.getState();
  if (!state.project) return;
  const drafts: CrashDraft[] = [];
  let budget = CRASH_MAX_CHARS;
  for (const tab of state.tabs) {
    if (!tab.dirty || tab.loading || !tab.content || tab.content.length > budget) continue;
    budget -= tab.content.length;
    drafts.push({ rel: tab.rel, content: tab.content, eol: tab.eol, bom: tab.bom });
  }
  writeCrashDrafts(state.project.root, drafts);
}

function scheduleCrashPersist() {
  if (crashTimer) clearTimeout(crashTimer);
  crashTimer = setTimeout(persistCurrentDrafts, 500);
}

async function restoreCrashDrafts(root: string, drafts: CrashDraft[]) {
  const current = useAppStore.getState();
  let tabs = [...current.tabs];
  let restored = 0;
  for (const draft of drafts) {
    if (tabs.length >= MAX_TABS) break;
    try {
      const read = await api.readProjectFile(root, draft.rel);
      const tab = {
        ...tabFromRead(draft.rel, read),
        content: draft.content,
        dirty: true,
      };
      const existing = tabs.findIndex((item) => item.rel === draft.rel);
      if (existing >= 0) tabs[existing] = tab;
      else tabs = [...tabs, tab];
      restored += 1;
    } catch {
      // A draft whose file was deleted or moved cannot be reopened safely.
    }
  }
  if (restored > 0) {
    const first = drafts.find((draft) => tabs.some((tab) => tab.rel === draft.rel));
    useAppStore.setState({
      tabs,
      activeRel: first?.rel ?? useAppStore.getState().activeRel,
      activeLine: null,
      activeColumn: null,
    });
    persistCurrentDrafts();
  }
  return restored;
}

async function offerCrashRecovery(
  root: string,
  askConfirm: (options: ConfirmOptions) => Promise<boolean>,
) {
  const drafts = readCrashDrafts(root);
  if (drafts.length === 0) return;
  const state = useAppStore.getState();
  const restore = await askConfirm({
    title: i18n.t("crash.title"),
    body: i18n.t("crash.body", { count: drafts.length }),
    confirmLabel: i18n.t("crash.restore"),
    cancelLabel: i18n.t("crash.discard"),
  });
  if (!restore) {
    clearCrashDrafts(root);
    return;
  }
  const restored = await restoreCrashDrafts(root, drafts);
  if (restored > 0) {
    state.toast(i18n.t("crash.restored", { count: restored }), "success");
  } else {
    clearCrashDrafts(root);
    state.toast(i18n.t("crash.restoreFailed"), "error");
  }
}

function applyLanguage(language: string) {
  if (language === "en" || language === "ru") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function fileName(rel: string) {
  const parts = rel.split("/");
  return parts[parts.length - 1] ?? rel;
}

function tabFromRead(rel: string, read: Awaited<ReturnType<typeof api.readProjectFile>>): AppTab {
  return {
    rel,
    name: fileName(rel),
    content: read.content,
    hash: read.hash,
    eol: read.eol,
    bom: read.bom,
    dirty: false,
    loading: false,
    error: null,
    modifiedMs: read.modifiedMs,
    size: read.size,
    externalChange: false,
  };
}

interface AppStore {
  initialized: boolean;
  backendMissing: boolean;
  settings: Settings | null;
  tools: ToolsInfo | null;
  project: ProjectSnapshot | null;
  tabs: AppTab[];
  activeRel: string | null;
  activeLine: number | null;
  activeColumn: number | null;
  gotoLine: number | null;
  gotoToken: number;
  build: BuildResult | null;
  compiling: boolean;
  pdf: LastPdf | null;
  pdfVersion: number;
  pdfError: string | null;
  syncStatus: SyncStatus | null;
  syncTarget: SyncTarget | null;
  syncTargetToken: number;
  syncLoading: boolean;
  panelTab: PanelTab;
  panelOpen: boolean;
  panelHeight: number;
  sidebarView: SidebarView;
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  searchQuery: string;
  searchCaseSensitive: boolean;
  searchRegex: boolean;
  searchResults: SearchMatch[];
  searchLoading: boolean;
  searchError: string | null;
  replacePreview: ReplacePreview | null;
  replaceText: string;
  replaceLoading: boolean;
  replaceError: string | null;
  historyOpen: boolean;
  checkpointPreview: CheckpointPreview | null;
  checkpointDiff: CheckpointFileDiff | null;
  checkpointDiffPath: string | null;
  checkpointLoading: boolean;
  doctorReport: DoctorReport | null;
  doctorLoading: boolean;
  doctorError: string | null;
  doctorStale: boolean;
  toasts: ToastMessage[];
  confirmState: ConfirmState | null;
  fixState: FixState | null;
  initializing: boolean;

  initialize: () => Promise<void>;
  openProject: (path: string) => Promise<boolean>;
  createProject: (parent: string, name: string, template: string) => Promise<boolean>;
  closeProject: () => void;
  removeRecent: (path: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setMainFile: (rel: string) => Promise<void>;
  openFile: (rel: string, line?: number, column?: number) => Promise<void>;
  setTabContent: (rel: string, content: string) => void;
  saveTab: (rel: string, announce?: boolean) => Promise<boolean>;
  saveAll: (announce?: boolean) => Promise<boolean>;
  closeTab: (rel: string) => Promise<void>;
  discardTabsUnder: (prefix: string) => void;
  remapTabsUnder: (oldRel: string, newRel: string) => void;
  reloadTab: (rel: string) => Promise<void>;
  keepExternal: (rel: string) => Promise<void>;
  checkExternalChanges: () => Promise<void>;
  compile: (silent?: boolean) => Promise<void>;
  cancelBuild: () => Promise<void>;
  loadPdf: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
  forwardSync: (file: string, line: number) => Promise<void>;
  reverseSync: (page: number, x: number, y: number) => Promise<void>;
  clearSyncTarget: () => void;
  cleanBuild: () => Promise<void>;
  cleanAux: () => Promise<void>;
  refreshIndex: () => Promise<void>;
  runDoctor: () => Promise<void>;
  setSidebarView: (view: SidebarView) => void;
  search: (query: string) => Promise<void>;
  setSearchCaseSensitive: (value: boolean) => Promise<void>;
  setSearchRegex: (value: boolean) => Promise<void>;
  previewReplace: (replacement: string) => Promise<void>;
  applyReplace: () => Promise<boolean>;
  clearReplacePreview: () => void;
  setHistoryOpen: (open: boolean) => void;
  previewCheckpoint: (id: string) => Promise<void>;
  openCheckpointDiff: (path: string) => Promise<void>;
  clearCheckpointPreview: () => void;
  restoreCheckpoint: (id: string, token: string, paths?: string[]) => Promise<boolean>;
  setPanelTab: (tab: PanelTab) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelHeight: (height: number) => void;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  refreshTools: () => Promise<void>;
  openFix: (diagnostic: Diagnostic) => Promise<void>;
  closeFix: () => void;
  applyFix: () => Promise<void>;
  toast: (
    message: string,
    kind?: ToastMessage["kind"],
    action?: { label: string; run: () => void },
  ) => void;
  dismissToast: (id: number) => void;
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (value: boolean) => void;
  setCursor: (line: number, column: number) => void;
}

function scheduleAutoCompile() {
  const state = useAppStore.getState();
  const settings = state.settings;
  if (!settings?.compile.autoCompile) return;
  if (autoCompileTimer) clearTimeout(autoCompileTimer);
  autoCompileTimer = setTimeout(() => {
    const latest = useAppStore.getState();
    if (!latest.compiling && latest.project) void latest.compile(true);
  }, settings.compile.autoCompileDelayMs);
}

function scheduleIndexRefresh() {
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    void useAppStore.getState().refreshIndex();
  }, 500);
}

async function ensureHistoryBaseline(root: string) {
  try {
    const existing = await api.listCheckpoints(root);
    if (existing.length === 0) {
      await api.createCheckpoint(root, null, null, "auto");
    }
  } catch {
    // History is helpful, but a missing baseline must not block opening a project.
  }
}

function savedSidebarView(): SidebarView {
  if (typeof localStorage === "undefined") return "project";
  const value = localStorage.getItem("latexstudio.sidebarView");
  return value === "search" || value === "outline" ? value : "project";
}

function savedHistoryOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("latexstudio.historyOpen") === "true";
}

function savedPanelOpen(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem("latexstudio.panelOpen") !== "false";
}

function savedPanelHeight(): number {
  if (typeof localStorage === "undefined") return 220;
  const height = Number(localStorage.getItem("latexstudio.panelHeight"));
  return Number.isFinite(height) && height > 0 ? Math.max(120, Math.min(height, 600)) : 220;
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  backendMissing: false,
  settings: null,
  tools: null,
  project: null,
  tabs: [],
  activeRel: null,
  activeLine: null,
  activeColumn: null,
  gotoLine: null,
  gotoToken: 0,
  build: null,
  compiling: false,
  pdf: null,
  pdfVersion: 0,
  pdfError: null,
  syncStatus: null,
  syncTarget: null,
  syncTargetToken: 0,
  syncLoading: false,
  panelTab: "errors",
  panelOpen: savedPanelOpen(),
  panelHeight: savedPanelHeight(),
  sidebarView: savedSidebarView(),
  projectIndex: null,
  indexLoading: false,
  searchQuery: "",
  searchCaseSensitive: false,
  searchRegex: false,
  searchResults: [],
  searchLoading: false,
  searchError: null,
  replacePreview: null,
  replaceText: "",
  replaceLoading: false,
  replaceError: null,
  historyOpen: savedHistoryOpen(),
  checkpointPreview: null,
  checkpointDiff: null,
  checkpointDiffPath: null,
  checkpointLoading: false,
  doctorReport: null,
  doctorLoading: false,
  doctorError: null,
  doctorStale: false,
  toasts: [],
  confirmState: null,
  fixState: null,
  initializing: false,

  initialize: async () => {
    if (get().initialized || get().initializing) return;
    set({ initializing: true });
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      set({ initialized: true, initializing: false, backendMissing: true });
      return;
    }
    try {
      const [settings, tools] = await Promise.all([api.getSettings(), api.getTools()]);
      applyLanguage(settings.language);
      applyTheme(settings.theme);
      set({ settings, tools });
      if (settings.lastProject) {
        try {
          const project = await api.openProject(settings.lastProject);
          set({ project, syncStatus: null, syncTarget: null });
          await Promise.all([get().loadPdf(), get().refreshIndex()]);
          await ensureHistoryBaseline(project.root);
          if (project.mainFile) {
            await get().openFile(project.mainFile);
          }
          await offerCrashRecovery(project.root, get().askConfirm);
        } catch {
          // The last project may have been moved or deleted.
        }
      }
      const fresh = await api.getSettings();
      set({ settings: fresh });
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      set({ backendMissing: true });
    } finally {
      set({ initialized: true, initializing: false });
    }
  },

  openProject: async (path) => {
    try {
      const project = await api.openProject(path);
      set({
        project,
        tabs: [],
        activeRel: null,
        activeLine: null,
        build: null,
        pdf: null,
        pdfVersion: 0,
        pdfError: null,
        syncStatus: null,
        syncTarget: null,
        searchQuery: "",
        searchResults: [],
        replacePreview: null,
        replaceText: "",
        replaceError: null,
        doctorReport: null,
        doctorLoading: false,
        doctorError: null,
        doctorStale: false,
      });
      await get().loadPdf();
      await get().refreshIndex();
      await ensureHistoryBaseline(project.root);
      if (project.mainFile) await get().openFile(project.mainFile);
      await offerCrashRecovery(project.root, get().askConfirm);
      const settings = await api.getSettings();
      set({ settings });
      get().toast(i18n.t("toast.projectOpened", { name: project.name }), "success");
      return true;
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      return false;
    }
  },

  createProject: async (parent, name, template) => {
    try {
      const project = await api.createProject(parent, name, template);
      clearCrashDrafts(project.root);
      set({
        project,
        tabs: [],
        activeRel: null,
        activeLine: null,
        build: null,
        pdf: null,
        pdfVersion: 0,
        pdfError: null,
        syncStatus: null,
        syncTarget: null,
        doctorReport: null,
        doctorLoading: false,
        doctorError: null,
        doctorStale: false,
      });
      await get().loadPdf();
      await get().refreshIndex();
      await ensureHistoryBaseline(project.root);
      if (project.mainFile) await get().openFile(project.mainFile);
      const settings = await api.getSettings();
      set({ settings });
      get().toast(i18n.t("toast.projectCreated", { name: project.name }), "success");
      return true;
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      return false;
    }
  },

  closeProject: () => {
    persistCurrentDrafts();
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    if (autoCompileTimer) clearTimeout(autoCompileTimer);
    set({
      project: null,
      tabs: [],
      activeRel: null,
      activeLine: null,
      build: null,
      pdf: null,
      pdfVersion: 0,
      pdfError: null,
      syncStatus: null,
      syncTarget: null,
      syncLoading: false,
      searchResults: [],
      searchQuery: "",
      searchError: null,
      replacePreview: null,
      replaceText: "",
      replaceError: null,
      projectIndex: null,
      indexLoading: false,
      doctorReport: null,
      doctorLoading: false,
      doctorError: null,
      doctorStale: false,
    });
  },

  removeRecent: async (path) => {
    try {
      await api.removeRecent(path);
      const settings = await api.getSettings();
      set({ settings });
      get().toast(i18n.t("toast.recentRemoved"), "info");
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  refreshProject: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const fresh = await api.refreshProject(project.root);
      set({ project: fresh });
      scheduleIndexRefresh();
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  setMainFile: async (rel) => {
    const project = get().project;
    if (!project) return;
    try {
      const fresh = await api.setMainFile(project.root, rel);
      set({ project: fresh });
      scheduleIndexRefresh();
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  openFile: async (rel, line, column) => {
    const project = get().project;
    if (!project) return;
    const existing = get().tabs.find((tab) => tab.rel === rel);
    if (existing) {
      set({
        activeRel: rel,
        activeLine: line ?? null,
        activeColumn: column ?? null,
        gotoLine: line ?? null,
        gotoToken: get().gotoToken + 1,
      });
      return;
    }
    if (get().tabs.length >= MAX_TABS) {
      get().toast(i18n.t("editor.tabLimit"), "info");
      return;
    }
    const placeholder: AppTab = {
      rel,
      name: fileName(rel),
      content: "",
      hash: "",
      eol: "\n",
      bom: false,
      dirty: false,
      loading: true,
      error: null,
      modifiedMs: 0,
      size: 0,
      externalChange: false,
    };
    set({
      tabs: [...get().tabs, placeholder],
      activeRel: rel,
      activeLine: line ?? null,
      activeColumn: column ?? null,
      gotoLine: line ?? null,
      gotoToken: get().gotoToken + 1,
    });
    try {
      const read = await api.readProjectFile(project.root, rel);
      const tab = tabFromRead(rel, read);
      set({ tabs: get().tabs.map((item) => (item.rel === rel ? tab : item)) });
      if (get().project?.mainFile === rel) {
        // Keep the sidebar marker in sync without an extra tree refresh.
      }
    } catch (error) {
      set({
        tabs: get().tabs.map((item) =>
          item.rel === rel
            ? { ...item, loading: false, error: localizedError(i18n.t.bind(i18n), error) }
            : item,
        ),
      });
    }
  },

  setTabContent: (rel, content) => {
    set({
      tabs: get().tabs.map((tab) => (tab.rel === rel ? { ...tab, content, dirty: true } : tab)),
    });
    scheduleCrashPersist();
    clearAutosave(rel);
    const delay = get().settings?.editor.autosaveDelayMs ?? 900;
    const timer = setTimeout(() => {
      void get().saveTab(rel);
    }, delay);
    saveTimers.set(rel, timer);
  },

  saveTab: async (rel, announce = false) => {
    const project = get().project;
    const tab = get().tabs.find((item) => item.rel === rel);
    if (!project || !tab || !tab.dirty) return true;
    clearAutosave(rel);
    try {
      const result = await api.writeProjectFile(
        project.root,
        rel,
        tab.content,
        tab.eol,
        tab.bom,
        tab.hash || null,
      );
      set({
        tabs: get().tabs.map((item) =>
          item.rel === rel
            ? {
                ...item,
                hash: result.hash,
                modifiedMs: result.modifiedMs,
                size: result.size,
                dirty: false,
                externalChange: false,
              }
            : item,
        ),
      });
      if (announce) get().toast(i18n.t("toast.saved", { file: tab.name }), "success");
      persistCurrentDrafts();
      set({ doctorStale: true });
      scheduleIndexRefresh();
      scheduleAutoCompile();
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (code === "hash_mismatch" || code === "conflict") {
        set({
          tabs: get().tabs.map((item) =>
            item.rel === rel ? { ...item, externalChange: true } : item,
          ),
        });
        get().toast(i18n.t("editor.saveConflict"), "error", {
          label: i18n.t("editor.externalReload"),
          run: () => void get().reloadTab(rel),
        });
      } else {
        get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      }
      return false;
    }
  },

  saveAll: async (announce = false) => {
    const dirty = get().tabs.filter((tab) => tab.dirty);
    let ok = true;
    for (const tab of dirty) {
      const saved = await get().saveTab(tab.rel, announce);
      if (!saved) ok = false;
    }
    return ok;
  },

  closeTab: async (rel) => {
    const tab = get().tabs.find((item) => item.rel === rel);
    if (tab?.dirty) {
      const ok = await get().askConfirm({
        title: i18n.t("common.saveChanges"),
        body: i18n.t("editor.closeDirty", { file: tab.name }),
        confirmLabel: i18n.t("common.save"),
        cancelLabel: i18n.t("common.discard"),
      });
      if (ok) {
        const saved = await get().saveTab(rel);
        if (!saved) return;
      }
    }
    clearAutosave(rel);
    const tabs = get().tabs;
    const index = tabs.findIndex((item) => item.rel === rel);
    const nextTabs = tabs.filter((item) => item.rel !== rel);
    let activeRel = get().activeRel;
    if (activeRel === rel) {
      activeRel = nextTabs[Math.min(index, nextTabs.length - 1)]?.rel ?? null;
    }
    set({ tabs: nextTabs, activeRel, activeLine: null, gotoLine: null });
    persistCurrentDrafts();
  },

  discardTabsUnder: (prefix) => {
    const matches = (rel: string) => rel === prefix || rel.startsWith(`${prefix}/`);
    const tabs = get().tabs.filter((tab) => !matches(tab.rel));
    let activeRel = get().activeRel;
    if (activeRel && matches(activeRel)) activeRel = tabs[tabs.length - 1]?.rel ?? null;
    set({ tabs, activeRel, activeLine: null });
    persistCurrentDrafts();
  },

  remapTabsUnder: (oldRel, newRel) => {
    const matches = (rel: string) => rel === oldRel || rel.startsWith(`${oldRel}/`);
    const tabs = get().tabs.map((tab) => {
      if (!matches(tab.rel)) return tab;
      const suffix = tab.rel.slice(oldRel.length);
      const rel = `${newRel}${suffix}`;
      return { ...tab, rel, name: fileName(rel) };
    });
    const activeRel = get().activeRel;
    const nextActive =
      activeRel && matches(activeRel) ? `${newRel}${activeRel.slice(oldRel.length)}` : activeRel;
    set({ tabs, activeRel: nextActive });
    persistCurrentDrafts();
  },

  reloadTab: async (rel) => {
    const project = get().project;
    if (!project) return;
    try {
      const read = await api.readProjectFile(project.root, rel);
      set({
        tabs: get().tabs.map((tab) => (tab.rel === rel ? tabFromRead(rel, read) : tab)),
      });
      persistCurrentDrafts();
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  keepExternal: async (rel) => {
    const project = get().project;
    if (!project) return;
    try {
      const read = await api.readProjectFile(project.root, rel);
      set({
        tabs: get().tabs.map((tab) =>
          tab.rel === rel
            ? {
                ...tab,
                hash: read.hash,
                modifiedMs: read.modifiedMs,
                size: read.size,
                dirty: true,
                externalChange: false,
                error: null,
              }
            : tab,
        ),
      });
      persistCurrentDrafts();
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  checkExternalChanges: async () => {
    const project = get().project;
    if (!project || get().compiling) return;
    for (const tab of get().tabs) {
      if (tab.loading || tab.error) continue;
      try {
        const stat = await api.statProjectFile(project.root, tab.rel);
        if (!stat.exists) {
          if (!tab.externalChange) {
            set({
              tabs: get().tabs.map((item) =>
                item.rel === tab.rel
                  ? { ...item, externalChange: true, error: i18n.t("errors.deleted") }
                  : item,
              ),
            });
          }
          continue;
        }
        if (stat.modifiedMs > tab.modifiedMs + 2) {
          if (tab.dirty) {
            if (!tab.externalChange) {
              set({
                tabs: get().tabs.map((item) =>
                  item.rel === tab.rel ? { ...item, externalChange: true } : item,
                ),
              });
            }
          } else {
            const read = await api.readProjectFile(project.root, tab.rel);
            set({
              tabs: get().tabs.map((item) =>
                item.rel === tab.rel ? tabFromRead(tab.rel, read) : item,
              ),
            });
          }
        }
      } catch {
        // A transient stat failure should not interrupt editing.
      }
    }
  },

  compile: async (silent = false) => {
    const project = get().project;
    if (!project || get().compiling) return;
    const saved = await get().saveAll(false);
    if (!saved) return;
    const engine = get().settings?.compile.engine ?? "auto";
    set({ compiling: true });
    if (!silent) get().toast(i18n.t("panel.started", { engine }), "info");
    try {
      const build = await api.compileProject(project.root, engine);
      set({ build, compiling: false });
      if (build.success) {
        await get().loadPdf();
        if (!silent) {
          get().toast(
            i18n.t("toast.buildSucceeded", {
              duration: `${(build.durationMs / 1000).toFixed(1)} s`,
            }),
            "success",
          );
        }
      } else {
        const errors = build.diagnostics.filter((d) => d.severity === "error");
        const warnings = build.diagnostics.filter((d) => d.severity === "warning");
        set({
          panelOpen: true,
          panelTab: errors.length > 0 ? "errors" : warnings.length > 0 ? "warnings" : "logs",
        });
        if (!silent) get().toast(i18n.t("toast.buildFailed"), "error");
      }
    } catch (error) {
      set({ compiling: false, panelOpen: true, panelTab: "logs" });
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  cancelBuild: async () => {
    try {
      await api.cancelCompilation();
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  loadPdf: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const pdf = await api.getLastPdf(project.root);
      set({ pdf, pdfVersion: get().pdfVersion + 1, pdfError: null });
      void get().refreshSyncStatus();
    } catch (error) {
      set({ pdfError: localizedError(i18n.t.bind(i18n), error) });
    }
  },

  refreshSyncStatus: async () => {
    const project = get().project;
    if (!project) {
      set({ syncStatus: null });
      return;
    }
    try {
      const status = await api.synctexStatus(project.root);
      if (get().project?.root === project.root) set({ syncStatus: status });
    } catch {
      if (get().project?.root === project.root) set({ syncStatus: null });
    }
  },

  forwardSync: async (file, line) => {
    const project = get().project;
    if (!project) return;
    set({ syncLoading: true });
    try {
      const target = await api.forwardSynctex(project.root, file, line);
      if (!target) {
        get().toast(i18n.t("sync.noTarget"), "info");
        return;
      }
      set({
        syncTarget: target,
        syncTargetToken: get().syncTargetToken + 1,
      });
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    } finally {
      set({ syncLoading: false });
    }
  },

  reverseSync: async (page, x, y) => {
    const project = get().project;
    if (!project) return;
    try {
      const source = await api.reverseSynctex(project.root, page, x, y);
      if (!source) {
        get().toast(i18n.t("sync.noSource"), "info");
        return;
      }
      await get().openFile(source.file, source.line);
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  clearSyncTarget: () => set({ syncTarget: null }),

  cleanBuild: async () => {
    const project = get().project;
    if (!project) return;
    try {
      await api.cleanProjectBuild(project.root);
      set({
        build: null,
        pdf: null,
        pdfVersion: get().pdfVersion + 1,
        syncStatus: null,
        syncTarget: null,
      });
      get().toast(i18n.t("panel.cleaned"), "success");
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  cleanAux: async () => {
    const project = get().project;
    if (!project) return;
    const confirmed = await get().askConfirm({
      title: i18n.t("panel.cleanAux"),
      body: i18n.t("panel.cleanAuxConfirm"),
      confirmLabel: i18n.t("panel.cleanAuxAction"),
      cancelLabel: i18n.t("common.cancel"),
    });
    if (!confirmed) return;
    try {
      const removed = await api.cleanProjectAux(project.root);
      get().toast(i18n.t("panel.auxCleaned", { count: removed }), "success");
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  refreshIndex: async () => {
    const project = get().project;
    if (!project) {
      set({ projectIndex: null, indexLoading: false });
      return;
    }
    set({ indexLoading: true });
    try {
      const index = await api.getProjectIndex(project.root);
      if (get().project?.root === project.root) {
        set({ projectIndex: index, indexLoading: false });
      }
    } catch {
      if (get().project?.root === project.root) set({ indexLoading: false });
    }
  },

  runDoctor: async () => {
    const project = get().project;
    if (!project) return;
    set({ doctorLoading: true, doctorError: null });
    try {
      const report = await api.runProjectDoctor(project.root);
      if (get().project?.root === project.root) {
        set({ doctorReport: report, doctorLoading: false, doctorStale: false });
      }
    } catch (error) {
      if (get().project?.root === project.root) {
        set({
          doctorLoading: false,
          doctorError: localizedError(i18n.t.bind(i18n), error),
        });
      }
    }
  },

  setSidebarView: (view) => {
    set({ sidebarView: view });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("latexstudio.sidebarView", view);
    }
  },

  search: async (query) => {
    const project = get().project;
    const request = ++searchRequestId;
    set({ searchQuery: query, searchError: null, replacePreview: null, replaceError: null });
    if (!project || query.trim().length === 0) {
      set({ searchResults: [], searchLoading: false });
      return;
    }
    set({ searchLoading: true });
    try {
      const results = await api.searchProject(
        project.root,
        query,
        get().searchCaseSensitive,
        get().searchRegex,
      );
      if (request !== searchRequestId) return;
      set({ searchResults: results, searchLoading: false });
    } catch (error) {
      if (request !== searchRequestId) return;
      set({
        searchLoading: false,
        searchResults: [],
        searchError: localizedError(i18n.t.bind(i18n), error),
      });
    }
  },

  setSearchCaseSensitive: async (value) => {
    set({ searchCaseSensitive: value });
    if (get().searchQuery.trim()) await get().search(get().searchQuery);
  },

  setSearchRegex: async (value) => {
    set({ searchRegex: value });
    if (get().searchQuery.trim()) await get().search(get().searchQuery);
  },

  previewReplace: async (replacement) => {
    const project = get().project;
    const query = get().searchQuery;
    if (!project || !query.trim()) return;
    set({ replaceText: replacement, replaceLoading: true, replaceError: null });
    try {
      const preview = await api.previewReplace(
        project.root,
        query,
        replacement,
        get().searchCaseSensitive,
        get().searchRegex,
      );
      set({ replacePreview: preview, replaceLoading: false });
    } catch (error) {
      set({
        replaceLoading: false,
        replacePreview: null,
        replaceError: localizedError(i18n.t.bind(i18n), error),
      });
    }
  },

  applyReplace: async () => {
    const project = get().project;
    const preview = get().replacePreview;
    const query = get().searchQuery;
    if (!project || !preview || !query.trim()) return false;
    const affected = new Set(preview.files.map((file) => file.path));
    const dirty = get().tabs.filter((tab) => tab.dirty && affected.has(tab.rel));
    if (dirty.length > 0) {
      const discard = await get().askConfirm({
        title: i18n.t("search.replaceDirtyTitle"),
        body: i18n.t("search.replaceDirtyBody", { count: dirty.length }),
        confirmLabel: i18n.t("common.discard"),
        danger: true,
      });
      if (!discard) return false;
    }
    set({ replaceLoading: true, replaceError: null });
    try {
      const result = await api.applyReplace(
        project.root,
        query,
        get().replaceText,
        get().searchCaseSensitive,
        get().searchRegex,
        preview.token,
      );
      set({ replacePreview: null, replaceLoading: false, doctorStale: true });
      await get().refreshProject();
      await get().refreshIndex();
      for (const rel of affected) {
        if (get().tabs.some((tab) => tab.rel === rel)) await get().reloadTab(rel);
      }
      await get().search(query);
      if (result.filesChanged === 0) {
        get().toast(i18n.t("search.replaceNoChanges"), "info");
      } else {
        get().toast(
          i18n.t("search.replaceSuccess", {
            count: result.replacements,
            files: result.filesChanged,
          }),
          "success",
        );
        scheduleAutoCompile();
      }
      return true;
    } catch (error) {
      set({ replaceLoading: false });
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      return false;
    }
  },

  clearReplacePreview: () => set({ replacePreview: null, replaceError: null }),

  setHistoryOpen: (open) => {
    set({ historyOpen: open });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("latexstudio.historyOpen", String(open));
    }
  },

  previewCheckpoint: async (id) => {
    const project = get().project;
    if (!project) return;
    set({ checkpointLoading: true, checkpointDiff: null, checkpointDiffPath: null });
    try {
      const preview = await api.previewCheckpoint(project.root, id);
      set({ checkpointPreview: preview, checkpointLoading: false });
      const first = preview.files[0];
      if (first) await get().openCheckpointDiff(first.path);
    } catch (error) {
      set({ checkpointLoading: false });
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  openCheckpointDiff: async (path) => {
    const project = get().project;
    const preview = get().checkpointPreview;
    if (!project || !preview) return;
    set({ checkpointLoading: true, checkpointDiffPath: path, checkpointDiff: null });
    try {
      const diff = await api.getCheckpointFileDiff(project.root, preview.checkpoint.id, path);
      if (get().checkpointPreview?.checkpoint.id === preview.checkpoint.id) {
        set({ checkpointDiff: diff, checkpointLoading: false });
      }
    } catch (error) {
      set({ checkpointLoading: false });
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  clearCheckpointPreview: () =>
    set({
      checkpointPreview: null,
      checkpointDiff: null,
      checkpointDiffPath: null,
      checkpointLoading: false,
    }),

  restoreCheckpoint: async (id, token, paths) => {
    const project = get().project;
    const preview = get().checkpointPreview;
    if (!project || !preview || preview.checkpoint.id !== id) return false;
    const affected = preview.files.filter((file) => !paths || paths.includes(file.path));
    const dirtyAffected = get().tabs.filter(
      (tab) =>
        tab.dirty && affected.some((file) => file.path === tab.rel || file.oldPath === tab.rel),
    );
    const ok = await get().askConfirm({
      title: i18n.t(paths ? "history.restoreFileConfirm" : "history.restoreConfirm"),
      body: i18n.t("history.restoreSummary", {
        files: affected.length,
        added: preview.added,
        modified: preview.modified,
        deleted: preview.deleted,
      }),
      confirmLabel: i18n.t("history.restore"),
      danger: true,
    });
    if (!ok) return false;
    if (dirtyAffected.length > 0) {
      const discard = await get().askConfirm({
        title: i18n.t("history.restoreDirtyTitle"),
        body: i18n.t("history.restoreDirtyBodyCount", { count: dirtyAffected.length }),
        confirmLabel: i18n.t("common.discard"),
        danger: true,
      });
      if (!discard) return false;
    }
    set({ checkpointLoading: true });
    try {
      const result = await api.restoreCheckpoint(project.root, id, token, paths ?? null);
      set({
        checkpointPreview: null,
        checkpointDiff: null,
        checkpointDiffPath: null,
        checkpointLoading: false,
        doctorStale: true,
      });
      await get().refreshProject();
      await get().refreshIndex();
      await get().loadPdf();
      for (const rel of result.restoredFiles) {
        const tab = get().tabs.find((item) => item.rel === rel);
        if (tab) await get().reloadTab(rel);
      }
      for (const rel of result.deletedFiles) {
        if (get().tabs.some((tab) => tab.rel === rel)) get().discardTabsUnder(rel);
      }
      const checks = await Promise.all([
        ...result.restoredFiles.map((rel) => api.pathExists(`${project.root}/${rel}`)),
        ...result.deletedFiles.map(
          async (rel) => !(await api.pathExists(`${project.root}/${rel}`)),
        ),
      ]);
      if (checks.some((value) => !value)) {
        get().toast(i18n.t("history.restoreVerifyFailed"), "error");
        return false;
      }
      get().toast(i18n.t("toast.historyRestored"), "success");
      scheduleAutoCompile();
      return true;
    } catch (error) {
      set({ checkpointLoading: false });
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
      return false;
    }
  },

  setPanelTab: (tab) => {
    localStorage.setItem("latexstudio.panelOpen", "true");
    set({ panelTab: tab, panelOpen: true });
  },
  setPanelOpen: (open) => {
    localStorage.setItem("latexstudio.panelOpen", String(open));
    set({ panelOpen: open });
  },
  setPanelHeight: (height) => {
    const next = Math.max(120, Math.min(height, 600));
    localStorage.setItem("latexstudio.panelHeight", String(next));
    set({ panelHeight: next });
  },

  updateSettings: async (patch) => {
    try {
      const settings = await api.updateSettings(patch);
      applyLanguage(settings.language);
      applyTheme(settings.theme);
      set({ settings });
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  refreshTools: async () => {
    try {
      const tools = await api.getTools();
      set({ tools });
      get().toast(i18n.t("toast.toolsRefreshed"), "info");
    } catch (error) {
      get().toast(localizedError(i18n.t.bind(i18n), error), "error");
    }
  },

  openFix: async (diagnostic) => {
    const project = get().project;
    if (!project) return;
    set({ fixState: { diagnostic, suggestion: null, loading: true, error: null } });
    try {
      const suggestion = await api.suggestDiagnosticFix(project.root, diagnostic);
      set({
        fixState: {
          diagnostic,
          suggestion,
          loading: false,
          error: suggestion ? null : i18n.t("fix.noSuggestion"),
        },
      });
    } catch (error) {
      set({
        fixState: {
          diagnostic,
          suggestion: null,
          loading: false,
          error: localizedError(i18n.t.bind(i18n), error),
        },
      });
    }
  },

  closeFix: () => set({ fixState: null }),

  applyFix: async () => {
    const project = get().project;
    const fix = get().fixState;
    if (!project || !fix?.suggestion) return;
    const suggestion = fix.suggestion;
    const tab = get().tabs.find((item) => item.rel === suggestion.file);
    if (!tab) {
      get().toast(i18n.t("errors.notFound"), "error");
      return;
    }
    if (tab.hash !== suggestion.fileHash) {
      set({ fixState: { ...fix, error: i18n.t("fix.fileChanged") } });
      return;
    }
    try {
      await api.createCheckpoint(project.root, null, null, "pre-fix");
      await api.backupProjectFile(project.root, suggestion.file);
      const lines = tab.content.split("\n");
      const ordered = [...suggestion.edits].sort((a, b) => b.line - a.line);
      for (const edit of ordered) {
        const index = Math.max(0, edit.line - 1);
        if (edit.kind === "replace_line") {
          if (edit.expected !== null && lines[index] !== edit.expected) {
            throw new Error(i18n.t("errors.conflict"));
          }
          lines[index] = edit.text;
        } else {
          lines.splice(index + 1, 0, edit.text);
        }
      }
      const content = lines.join("\n");
      set({
        tabs: get().tabs.map((item) =>
          item.rel === suggestion.file ? { ...item, content, dirty: true } : item,
        ),
      });
      const saved = await get().saveTab(suggestion.file);
      set({ fixState: null, doctorStale: true });
      if (saved) {
        get().toast(i18n.t("fix.applied"), "success");
        await get().compile(true);
      }
    } catch (error) {
      set({
        fixState: { ...fix, error: errorMessage(error) },
      });
    }
  },

  toast: (message, kind = "info", action) => {
    const id = ++toastId;
    const toast: ToastMessage = {
      id,
      kind,
      message,
      actionLabel: action?.label,
      onAction: action?.run,
    };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

  askConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({ confirmState: { ...options, resolve } });
    }),

  resolveConfirm: (value) => {
    const state = get().confirmState;
    if (state) {
      state.resolve(value);
      set({ confirmState: null });
    }
  },

  setCursor: (line, column) => set({ activeLine: line, activeColumn: column }),
}));
