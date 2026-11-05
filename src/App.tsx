import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BibHelpModal } from "./components/BibHelpModal";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EquationBuilderModal } from "./components/EquationBuilderModal";
import { ExportModal } from "./components/ExportModal";
import { FixModal } from "./components/FixModal";
import { GitModal } from "./components/GitModal";
import { NewProjectModal } from "./components/NewProjectModal";
import { ReplaceModal } from "./components/ReplaceModal";
import { SettingsModal } from "./components/SettingsModal";
import { StatsModal } from "./components/StatsModal";
import { StatusBar } from "./components/StatusBar";
import { TableEditorModal } from "./components/TableEditorModal";
import { TitleBar } from "./components/TitleBar";
import { ToastHost } from "./components/ToastHost";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Workspace } from "./components/Workspace";
import type { TemplateId } from "./i18n";
import { pickProjectFolder } from "./lib/dialogs";
import { insertEditorText } from "./lib/editorBus";
import { localizedError } from "./lib/errors";
import { api } from "./lib/ipc";
import { actionForEvent, loadShortcuts, type Shortcuts, shortcutLabel } from "./lib/shortcuts";
import { expandSnippet, latexSnippets } from "./lib/snippets";
import { useAppStore } from "./store/useAppStore";
import type { ExportFormat, FileNode } from "./types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "eps"]);

function isImagePath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

function findImageFolder(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.isDir && ["images", "image", "figures", "assets"].includes(node.name.toLowerCase())) {
      return node.path;
    }
  }
  for (const node of nodes) {
    if (!node.isDir) continue;
    const found = findImageFolder(node.children);
    if (found) return found;
  }
  return null;
}

export default function App() {
  const { t } = useTranslation();
  const initialized = useAppStore((state) => state.initialized);
  const initializing = useAppStore((state) => state.initializing);
  const project = useAppStore((state) => state.project);
  const projectRoot = project?.root ?? null;
  const initialize = useAppStore((state) => state.initialize);
  const openProject = useAppStore((state) => state.openProject);
  const saveActive = useAppStore((state) => state.saveTab);
  const activeRel = useAppStore((state) => state.activeRel);
  const activeLine = useAppStore((state) => state.activeLine);
  const compile = useAppStore((state) => state.compile);
  const forwardSync = useAppStore((state) => state.forwardSync);
  const saveAll = useAppStore((state) => state.saveAll);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const checkExternalChanges = useAppStore((state) => state.checkExternalChanges);
  const projectIndex = useAppStore((state) => state.projectIndex);
  const setSidebarView = useAppStore((state) => state.setSidebarView);
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const setPanelTab = useAppStore((state) => state.setPanelTab);
  const runDoctor = useAppStore((state) => state.runDoctor);
  const refreshProject = useAppStore((state) => state.refreshProject);
  const toast = useAppStore((state) => state.toast);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const openFile = useAppStore((state) => state.openFile);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectTemplate, setNewProjectTemplate] = useState<TemplateId>("article");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPreset, setExportPreset] = useState<ExportFormat | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [equationOpen, setEquationOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [bibHelpOpen, setBibHelpOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcuts>(() => loadShortcuts());
  const projectRevision = useRef<string | null>(null);

  useEffect(() => {
    const refreshShortcuts = () => setShortcuts(loadShortcuts());
    window.addEventListener("latexstudio:shortcuts", refreshShortcuts);
    return () => window.removeEventListener("latexstudio:shortcuts", refreshShortcuts);
  }, []);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!project) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void checkExternalChanges();
    }, 3000);
    const onFocus = () => void checkExternalChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [project, checkExternalChanges]);

  useEffect(() => {
    if (!project || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const images = event.payload.paths.filter(isImagePath);
        if (images.length === 0) {
          toast(t("toast.noImages"), "info");
          return;
        }
        const destination = findImageFolder(project.files) ?? "";
        void api
          .importProjectPaths(project.root, images, destination)
          .then(async (imported) => {
            await refreshProject();
            const first = imported.find(isImagePath);
            if (first) {
              insertEditorText(`\\includegraphics[width=0.8\\linewidth]{${first}}\n`);
            }
            toast(t("toast.imagesImported", { count: imported.length }), "success");
          })
          .catch((error) => toast(localizedError(t, error), "error"));
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Drag and drop is optional when the window API is unavailable.
      });
    return () => unlisten?.();
  }, [project, refreshProject, t, toast]);

  useEffect(() => {
    projectRevision.current = null;
    if (!projectRoot || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const revision = await api.getProjectRevision(projectRoot);
        if (cancelled) return;
        if (projectRevision.current === null) projectRevision.current = revision;
        else if (projectRevision.current !== revision) {
          projectRevision.current = revision;
          await refreshProject();
        }
      } catch {
        // A transient scan failure should not interrupt editing.
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectRoot, refreshProject]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = actionForEvent(event, shortcuts);
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case "palette":
          setPaletteOpen((open) => !open);
          break;
        case "save":
          if (activeRel) void saveActive(activeRel, true);
          break;
        case "compile":
          void compile();
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "openProject":
          void pickProjectFolder(t("welcome.openProject")).then((path) => {
            if (path) void openProject(path);
          });
          break;
        case "newProject":
          setNewProjectTemplate("article");
          setNewProjectOpen(true);
          break;
        case "sync":
          if (activeRel && activeLine) void forwardSync(activeRel, activeLine);
          break;
        case "export":
          setExportPreset(null);
          setExportOpen(true);
          break;
        case "stats":
          setStatsOpen(true);
          break;
        case "focus":
          setFocusMode((value) => !value);
          break;
        case "history":
          setHistoryOpen(true);
          break;
        case "equation":
          setEquationOpen(true);
          break;
        case "table":
          setTableOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeRel,
    activeLine,
    compile,
    forwardSync,
    openProject,
    saveActive,
    setHistoryOpen,
    shortcuts,
    t,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<string>("menu-action", (event) => {
      const action = event.payload;
      if (action !== "undo" && action !== "redo") return;
      const active = document.activeElement as HTMLElement | null;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        document.execCommand(action);
      } else if (active?.closest(".cm-editor")) {
        window.dispatchEvent(new CustomEvent("latexstudio:edit", { detail: action }));
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Native menu history actions are optional outside Tauri.
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useAppStore.getState().tabs.some((tab) => tab.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const dirty = useAppStore.getState().tabs.filter((tab) => tab.dirty);
        if (dirty.length === 0) return;
        event.preventDefault();
        const ok = await askConfirm({
          title: t("toast.closeConfirm"),
          body: t("toast.closeConfirmBody", { count: dirty.length }),
          confirmLabel: t("toast.saveAndClose"),
          cancelLabel: t("toast.stay"),
        });
        if (!ok) return;
        const saved = await saveAll();
        if (!saved) return;
        try {
          await getCurrentWindow().destroy();
        } catch {
          // The window may already be closing.
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Close interception is a convenience; editing still works without it.
      });
    return () => unlisten?.();
  }, [askConfirm, saveAll, t]);

  const openNewProject = useCallback((template?: TemplateId) => {
    setNewProjectTemplate(template ?? "article");
    setNewProjectOpen(true);
  }, []);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: "project.open",
        title: t("welcome.openProject"),
        group: t("palette.groups.project"),
        shortcut: shortcutLabel(shortcuts.openProject),
        run: () => {
          void pickProjectFolder(t("welcome.openProject")).then((path) => {
            if (path) void openProject(path);
          });
        },
      },
      {
        id: "project.new",
        title: t("welcome.newProject"),
        group: t("palette.groups.project"),
        shortcut: shortcutLabel(shortcuts.newProject),
        run: () => openNewProject(),
      },
      {
        id: "app.settings",
        title: t("titlebar.settings"),
        group: t("palette.groups.project"),
        shortcut: shortcutLabel(shortcuts.settings),
        run: () => setSettingsOpen(true),
      },
      {
        id: "view.search",
        title: t("search.title"),
        group: t("palette.groups.navigation"),
        run: () => setSidebarView("search"),
      },
      {
        id: "view.outline",
        title: t("outline.title"),
        group: t("palette.groups.navigation"),
        run: () => setSidebarView("outline"),
      },
      {
        id: "view.projects",
        title: t("sidebar.project"),
        group: t("palette.groups.navigation"),
        run: () => setSidebarView("project"),
      },
      {
        id: "view.panel",
        title: t("palette.togglePanel"),
        group: t("palette.groups.view"),
        run: () => setPanelOpen(!panelOpen),
      },
      {
        id: "view.history",
        title: t("palette.toggleHistory"),
        group: t("palette.groups.view"),
        run: () => setHistoryOpen(true),
      },
      {
        id: "view.focus",
        title: focusMode ? t("palette.focusOff") : t("palette.focusOn"),
        group: t("palette.groups.view"),
        keywords: "zen distraction free",
        run: () => setFocusMode((value) => !value),
      },
      {
        id: "view.stats",
        title: t("stats.title"),
        group: t("palette.groups.view"),
        keywords: "word count characters lines reading",
        run: () => setStatsOpen(true),
      },
      {
        id: "theme.dark",
        title: t("palette.themeDark"),
        group: t("palette.groups.appearance"),
        run: () => void updateSettings({ theme: "dark" }),
      },
      {
        id: "theme.light",
        title: t("palette.themeLight"),
        group: t("palette.groups.appearance"),
        run: () => void updateSettings({ theme: "light" }),
      },
      {
        id: "lang.ru",
        title: t("palette.languageRussian"),
        group: t("palette.groups.appearance"),
        run: () => void updateSettings({ language: "ru" }),
      },
      {
        id: "lang.en",
        title: t("palette.languageEnglish"),
        group: t("palette.groups.appearance"),
        run: () => void updateSettings({ language: "en" }),
      },
    ];

    if (project) {
      for (const snippet of latexSnippets) {
        list.push({
          id: `snippet.${snippet.id}`,
          title: t("palette.insertSnippet", { name: snippet.label }),
          group: t("palette.groups.insert"),
          keywords: `snippet ${snippet.id} ${snippet.detail}`,
          run: () => insertEditorText(expandSnippet(snippet.template)),
        });
      }
      list.splice(
        2,
        0,
        {
          id: "file.save",
          title: t("common.save"),
          group: t("palette.groups.project"),
          shortcut: shortcutLabel(shortcuts.save),
          run: () => {
            if (activeRel) void saveActive(activeRel, true);
          },
        },
        {
          id: "build.compile",
          title: t("titlebar.recompile"),
          group: t("palette.groups.project"),
          shortcut: shortcutLabel(shortcuts.compile),
          run: () => void compile(),
        },
        {
          id: "file.export",
          title: t("titlebar.export"),
          group: t("palette.groups.project"),
          shortcut: shortcutLabel(shortcuts.export),
          run: () => {
            setExportPreset(null);
            setExportOpen(true);
          },
        },
        {
          id: "history.full",
          title: t("history.title"),
          group: t("palette.groups.project"),
          run: () => setHistoryOpen(true),
        },
        {
          id: "insert.equation",
          title: t("equation.title"),
          group: t("palette.groups.insert"),
          keywords: "formula math fraction matrix equation",
          run: () => setEquationOpen(true),
        },
        {
          id: "insert.table",
          title: t("tableEditor.title"),
          group: t("palette.groups.insert"),
          keywords: "grid csv tabular longtable table",
          run: () => setTableOpen(true),
        },
        {
          id: "build.doctor",
          title: t("doctor.title"),
          group: t("palette.groups.project"),
          run: () => {
            setPanelTab("doctor");
            void runDoctor();
          },
        },
        {
          id: "help.bibliography",
          title: t("bibHelp.title"),
          group: t("palette.groups.project"),
          keywords: "bibtex biber bibliography citations references",
          run: () => setBibHelpOpen(true),
        },
      );
    }

    if (projectIndex) {
      for (const heading of projectIndex.headings.slice(0, 80)) {
        list.push({
          id: `heading:${heading.file}:${heading.line}`,
          title: t("palette.goToSection", { title: heading.title || t("outline.untitled") }),
          group: t("palette.groups.navigation"),
          keywords: `${heading.file} ${heading.title}`,
          run: () => void openFile(heading.file, heading.line),
        });
      }
      for (const label of projectIndex.labels.slice(0, 80)) {
        list.push({
          id: `label:${label.file}:${label.line}:${label.key}`,
          title: t("palette.goToLabel", { key: label.key }),
          group: t("palette.groups.navigation"),
          keywords: `${label.key} ${label.file}`,
          run: () => void openFile(label.file, label.line),
        });
      }
    }

    return list;
  }, [
    activeRel,
    compile,
    focusMode,
    openFile,
    openNewProject,
    panelOpen,
    project,
    projectIndex,
    saveActive,
    openProject,
    runDoctor,
    setHistoryOpen,
    setPanelOpen,
    setPanelTab,
    setSidebarView,
    shortcuts,
    t,
    updateSettings,
  ]);

  return (
    <div className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
      <TitleBar
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenGit={() => setGitOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenExport={() => {
          setExportPreset(null);
          setExportOpen(true);
        }}
        onOpenNewProject={() => openNewProject()}
      />
      <main className="main-region">
        {initializing && !initialized ? (
          <div className="app-loading">
            <span className="spinner large" />
            {t("common.loading")}
          </div>
        ) : project ? (
          <Workspace
            onExportPdf={() => {
              setExportPreset("pdf");
              setExportOpen(true);
            }}
          />
        ) : (
          <WelcomeScreen onNewProject={openNewProject} />
        )}
      </main>
      <StatusBar />

      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
      {newProjectOpen ? (
        <NewProjectModal
          initialTemplate={newProjectTemplate}
          onClose={() => setNewProjectOpen(false)}
        />
      ) : null}
      {exportOpen ? (
        <ExportModal
          preset={exportPreset}
          onClose={() => {
            setExportOpen(false);
            setExportPreset(null);
          }}
        />
      ) : null}
      {gitOpen ? <GitModal onClose={() => setGitOpen(false)} /> : null}
      {equationOpen ? <EquationBuilderModal onClose={() => setEquationOpen(false)} /> : null}
      {tableOpen ? <TableEditorModal onClose={() => setTableOpen(false)} /> : null}
      {statsOpen ? <StatsModal onClose={() => setStatsOpen(false)} /> : null}
      {bibHelpOpen ? <BibHelpModal onClose={() => setBibHelpOpen(false)} /> : null}
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      <FixModal />
      <ReplaceModal />
      <ConfirmDialog />
      <ToastHost />
    </div>
  );
}
