import {
  ChevronRight,
  Copy,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { pickImportPaths } from "../lib/dialogs";
import { localizedError } from "../lib/errors";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { FileNode } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";

interface PromptState {
  mode: "file" | "folder" | "rename";
  parent: string;
  node?: FileNode;
  value: string;
}

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function fileIcon(node: FileNode) {
  if (node.isDir) return Folder;
  const lower = node.name.toLowerCase();
  if (lower.endsWith(".tex")) return FileCode2;
  if (lower.endsWith(".bib")) return FileText;
  if (/\.(png|jpe?g|gif|svg|pdf|eps)$/.test(lower)) return Image;
  return File;
}

function isTex(node: FileNode) {
  return !node.isDir && node.name.toLowerCase().endsWith(".tex");
}

export function FileTree() {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const tabs = useAppStore((state) => state.tabs);
  const activeRel = useAppStore((state) => state.activeRel);
  const openFile = useAppStore((state) => state.openFile);
  const refreshProject = useAppStore((state) => state.refreshProject);
  const setMainFile = useAppStore((state) => state.setMainFile);
  const toast = useAppStore((state) => state.toast);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const discardTabsUnder = useAppStore((state) => state.discardTabsUnder);
  const remapTabsUnder = useAppStore((state) => state.remapTabsUnder);
  const checkpointPreview = useAppStore((state) => state.checkpointPreview);
  const openCheckpointDiff = useAppStore((state) => state.openCheckpointDiff);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirtyPaths = useMemo(
    () => new Set(tabs.filter((tab) => tab.dirty).map((tab) => tab.rel)),
    [tabs],
  );

  const historyChanges = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of checkpointPreview?.files ?? []) {
      map.set(file.path, file.status);
      if (file.oldPath) map.set(file.oldPath, file.status);
    }
    return map;
  }, [checkpointPreview]);

  const historyFolders = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of checkpointPreview?.files ?? []) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        const dir = parts.slice(0, i).join("/");
        map.set(dir, (map.get(dir) ?? 0) + 1);
      }
    }
    return map;
  }, [checkpointPreview]);

  useEffect(() => {
    if (!checkpointPreview) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const file of checkpointPreview.files) {
        const parts = file.path.split("/");
        for (let i = 1; i < parts.length; i += 1) {
          next.add(parts.slice(0, i).join("/"));
        }
      }
      return next;
    });
  }, [checkpointPreview]);

  useEffect(() => {
    if (!project) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const node of project.files) {
        if (node.isDir) next.add(node.path);
      }
      if (project.mainFile) {
        const parts = project.mainFile.split("/");
        for (let i = 1; i < parts.length; i += 1) {
          next.add(parts.slice(0, i).join("/"));
        }
      }
      return next;
    });
  }, [project]);

  if (!project) {
    return (
      <aside className="file-panel">
        <div className="file-panel-header">
          <span className="file-panel-title">{t("tree.files")}</span>
        </div>
        <div className="tree-empty">{t("tree.noProject")}</div>
      </aside>
    );
  }

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const startPrompt = (mode: PromptState["mode"], parent: string, node?: FileNode) => {
    setPromptError(null);
    setPrompt({
      mode,
      parent,
      node,
      value:
        mode === "rename" ? (node?.name ?? "") : mode === "file" ? t("menu.newFileDefault") : "",
    });
  };

  const parentFor = (node: FileNode | null) => {
    if (!node) return "";
    if (node.isDir) return node.path;
    const parts = node.path.split("/");
    parts.pop();
    return parts.join("/");
  };

  const submitPrompt = async () => {
    if (!prompt) return;
    const name = prompt.value.trim();
    if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
      setPromptError(t("menu.invalidName"));
      return;
    }
    setBusy(true);
    setPromptError(null);
    try {
      if (prompt.mode === "file") {
        const rel = joinRel(prompt.parent, name);
        await api.createProjectFile(project.root, rel);
        await refreshProject();
        toast(t("toast.fileCreated", { name }), "success");
        if (name.toLowerCase().endsWith(".tex")) await openFile(rel);
      } else if (prompt.mode === "folder") {
        const rel = joinRel(prompt.parent, name);
        await api.createProjectFolder(project.root, rel);
        setExpanded((current) => new Set(current).add(rel));
        await refreshProject();
        toast(t("toast.folderCreated", { name }), "success");
      } else if (prompt.node) {
        const node = prompt.node;
        const newRel = joinRel(prompt.parent, name);
        if (newRel === node.path) {
          setPrompt(null);
          setBusy(false);
          return;
        }
        await api.renameProjectPath(project.root, node.path, newRel);
        remapTabsUnder(node.path, newRel);
        if (node.isDir) {
          setExpanded((current) => {
            const next = new Set<string>();
            for (const path of current) {
              if (path === node.path) next.add(newRel);
              else if (path.startsWith(`${node.path}/`)) {
                next.add(`${newRel}${path.slice(node.path.length)}`);
              } else next.add(path);
            }
            return next;
          });
        }
        await refreshProject();
        toast(t("toast.fileRenamed", { name }), "success");
      }
      setPrompt(null);
    } catch (error) {
      setPromptError(localizedError(t, error));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (node: FileNode) => {
    const ok = await askConfirm({
      title: t("menu.deleteConfirm", { name: node.name }),
      body: t("menu.deleteBody"),
      confirmLabel: t("menu.moveToTrash"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProjectPath(project.root, node.path);
      discardTabsUnder(node.path);
      await refreshProject();
      toast(t("toast.fileDeleted", { name: node.name }), "info");
    } catch (error) {
      toast(localizedError(t, error), "error");
    }
  };

  const doDuplicate = async (node: FileNode) => {
    try {
      const rel = await api.duplicateProjectPath(project.root, node.path);
      await refreshProject();
      toast(t("toast.duplicated", { name: rel.split("/").pop() }), "success");
    } catch (error) {
      toast(localizedError(t, error), "error");
    }
  };

  const doImport = async (destRel: string) => {
    const sources = await pickImportPaths(t("tree.import"));
    if (sources.length === 0) return;
    try {
      const imported = await api.importProjectPaths(project.root, sources, destRel);
      await refreshProject();
      toast(t("toast.imported", { count: imported.length }), "success");
    } catch (error) {
      toast(localizedError(t, error), "error");
    }
  };

  const menuItems = (node: FileNode | null): ContextMenuItem[] => {
    const parent = parentFor(node);
    const items: ContextMenuItem[] = [];
    if (node && !node.isDir) {
      items.push({
        label: t("menu.open"),
        icon: FileCode2,
        onSelect: () => void openFile(node.path),
      });
    }
    items.push(
      {
        label: t("menu.newFile"),
        icon: FilePlus2,
        onSelect: () => startPrompt("file", parent),
      },
      {
        label: t("menu.newFolder"),
        icon: FolderPlus,
        onSelect: () => startPrompt("folder", parent),
      },
      {
        label: t("tree.import"),
        icon: Upload,
        onSelect: () => void doImport(parent),
      },
    );
    if (node) {
      items.push({ separator: true });
      if (isTex(node)) {
        items.push({
          label: t("tree.setMain"),
          icon: FileText,
          disabled: project.mainFile === node.path,
          onSelect: () => void setMainFile(node.path),
        });
      }
      items.push(
        {
          label: t("menu.rename"),
          icon: MoreHorizontal,
          shortcut: "↵",
          onSelect: () => startPrompt("rename", parent, node),
        },
        {
          label: t("menu.duplicate"),
          icon: Copy,
          onSelect: () => void doDuplicate(node),
        },
        {
          label: t("tree.reveal"),
          icon: FolderOpen,
          onSelect: () => {
            void api.revealProjectPath(project.root, node.path).catch((error) => {
              toast(localizedError(t, error), "error");
            });
          },
        },
        {
          label: t("menu.copyPath"),
          icon: Copy,
          onSelect: () => {
            void navigator.clipboard.writeText(node.path);
            toast(t("toast.copiedPath"), "success");
          },
        },
        { separator: true },
        {
          label: t("menu.delete"),
          icon: Trash2,
          danger: true,
          onSelect: () => void doDelete(node),
        },
      );
    }
    return items;
  };

  const renderNode = (node: FileNode, depth: number) => {
    const isOpen = expanded.has(node.path);
    const Icon = fileIcon(node);
    const isMain = project.mainFile === node.path;
    const active = activeRel === node.path;
    const historyStatus = !node.isDir ? historyChanges.get(node.path) : undefined;
    const historyFolder = node.isDir ? historyFolders.get(node.path) : undefined;
    return (
      <div key={node.path}>
        <button
          type="button"
          className={`tree-row ${active ? "active" : ""} ${isMain ? "main-file" : ""} ${
            historyStatus ? `history-${historyStatus.toLowerCase()}` : ""
          } ${historyFolder ? "history-folder" : ""}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          title={
            historyStatus
              ? `${node.path} · ${historyStatus}`
              : historyFolder
                ? `${node.path} · ${t("history.affected", { count: historyFolder })}`
                : node.path
          }
          onClick={() => {
            if (historyStatus) void openCheckpointDiff(node.path);
            else if (node.isDir) toggle(node.path);
            else void openFile(node.path);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY, node });
          }}
        >
          {node.isDir ? (
            <span className={`tree-chevron ${isOpen ? "open" : ""}`}>
              <ChevronRight size={12} />
            </span>
          ) : (
            <span className="tree-chevron" />
          )}
          <span className={`tree-icon ${node.isDir ? "folder" : isTex(node) ? "tex" : ""}`}>
            <Icon size={node.isDir ? 14 : 13} />
          </span>
          <span className="tree-label">{node.name}</span>
          {isMain ? <span className="tree-badge">{t("tree.main")}</span> : null}
          {historyFolder ? (
            <span className="tree-change tree-change-count">{historyFolder}</span>
          ) : null}
          {historyStatus ? (
            <span className={`tree-change change-badge change-${historyStatus.toLowerCase()}`}>
              {historyStatus}
            </span>
          ) : null}
          {dirtyPaths.has(node.path) ? <span className="tree-dirty" /> : null}
        </button>
        {node.isDir && isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <aside className="file-panel">
      <div className="file-panel-header">
        <span className="file-panel-title">
          {t("tree.files")}
          <span className="dim" style={{ fontWeight: 400, letterSpacing: 0 }}>
            {project.files.length}
          </span>
        </span>
        <div className="file-panel-actions">
          <button
            type="button"
            className="icon-button"
            title={t("tree.newFile")}
            onClick={() => startPrompt("file", "")}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t("tree.newFolder")}
            onClick={() => startPrompt("folder", "")}
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t("tree.refresh")}
            onClick={() => void refreshProject()}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div
        className="tree"
        onClick={(event) => {
          if (event.target === event.currentTarget) setMenu(null);
        }}
      >
        {project.files.length === 0 ? (
          <div className="tree-empty">{t("tree.empty")}</div>
        ) : (
          project.files.map((node) => renderNode(node, 0))
        )}
      </div>

      <div className="file-panel-footer">
        <button type="button" className="tool-btn" onClick={() => startPrompt("file", "")}>
          <FilePlus2 size={13} />
          {t("tree.newFile")}
        </button>
        <button
          type="button"
          className="icon-button"
          title={t("tree.importHint")}
          onClick={() => void doImport("")}
        >
          <Upload size={13} />
        </button>
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {prompt ? (
        <Modal
          size="narrow"
          title={
            prompt.mode === "rename"
              ? t("menu.renamePrompt", { name: prompt.node?.name ?? "" })
              : prompt.mode === "file"
                ? t("menu.newFilePrompt")
                : t("menu.newFolderPrompt")
          }
          onClose={() => setPrompt(null)}
          closeDisabled={busy}
          footer={
            <>
              <div className="grow" />
              <button
                type="button"
                className="text-button"
                onClick={() => setPrompt(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="text-button primary"
                onClick={() => void submitPrompt()}
                disabled={busy || !prompt.value.trim()}
              >
                {busy ? <span className="spinner" /> : null}
                {prompt.mode === "rename" ? t("common.rename") : t("common.create")}
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label" htmlFor="tree-name-input">
              {prompt.mode === "file"
                ? t("menu.newFilePrompt")
                : prompt.mode === "folder"
                  ? t("menu.newFolderPrompt")
                  : t("common.rename")}
            </label>
            <input
              id="tree-name-input"
              className="text-input"
              value={prompt.value}
              autoFocus
              onChange={(event) => {
                setPrompt({ ...prompt, value: event.target.value });
                setPromptError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitPrompt();
              }}
              onFocus={(event) => {
                const dot = event.target.value.lastIndexOf(".");
                if (prompt.mode === "file" && dot > 0) {
                  event.target.setSelectionRange(0, dot);
                } else {
                  event.target.select();
                }
              }}
            />
            {prompt.parent ? (
              <div className="form-hint">
                {t("newProject.location")}: {prompt.parent}/
              </div>
            ) : null}
          </div>
          {promptError ? <div className="fix-error">{promptError}</div> : null}
        </Modal>
      ) : null}
    </aside>
  );
}
