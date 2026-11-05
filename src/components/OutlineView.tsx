import { ChevronRight, Image, ListTree, RefreshCw, Sigma, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import type { IndexFloat, IndexHeading } from "../types";

function headingId(heading: IndexHeading, index: number) {
  return `${heading.file}:${heading.line}:${index}`;
}

export function OutlineView() {
  const { t } = useTranslation();
  const projectIndex = useAppStore((state) => state.projectIndex);
  const indexLoading = useAppStore((state) => state.indexLoading);
  const refreshIndex = useAppStore((state) => state.refreshIndex);
  const openFile = useAppStore((state) => state.openFile);
  const activeRel = useAppStore((state) => state.activeRel);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [floatsOpen, setFloatsOpen] = useState(true);
  const floats = projectIndex?.floats ?? [];

  const rows = useMemo(() => {
    const headings = projectIndex?.headings ?? [];
    const entries = headings.map((heading, index) => ({
      heading,
      id: headingId(heading, index),
      index,
    }));
    const visible: typeof entries = [];
    let hiddenBelow = 0;
    for (const entry of entries) {
      if (hiddenBelow && entry.heading.level > hiddenBelow) continue;
      hiddenBelow = 0;
      visible.push(entry);
      if (collapsed.has(entry.id)) hiddenBelow = entry.heading.level;
    }
    const hasChildren = new Set<string>();
    for (const entry of visible) {
      for (let cursor = entry.index + 1; cursor < headings.length; cursor += 1) {
        const next = headings[cursor];
        if (next.level <= entry.heading.level) break;
        hasChildren.add(entry.id);
      }
    }
    return { visible, hasChildren };
  }, [projectIndex, collapsed]);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const minLevel = useMemo(() => {
    const levels = projectIndex?.headings.map((heading) => heading.level) ?? [1];
    return Math.min(...levels);
  }, [projectIndex]);

  return (
    <aside className="file-panel outline-view">
      <div className="file-panel-header">
        <span className="file-panel-title">
          <ListTree size={13} />
          {t("outline.title")}
        </span>
        {projectIndex?.headings.length || floats.length ? (
          <span className="sidebar-count">
            {(projectIndex?.headings.length ?? 0) + floats.length}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-button"
          title={t("outline.refresh")}
          onClick={() => void refreshIndex()}
          disabled={indexLoading}
        >
          <RefreshCw size={13} className={indexLoading ? "spin" : ""} />
        </button>
      </div>

      <div className="outline-list">
        {indexLoading && !projectIndex ? (
          <div className="tree-empty">
            <span className="spinner" /> {t("outline.loading")}
          </div>
        ) : null}
        {!indexLoading && rows.visible.length === 0 ? (
          <div className="tree-empty">{t("outline.empty")}</div>
        ) : null}
        {rows.visible.map(({ heading, id }) => {
          const hasChildren = rows.hasChildren.has(id);
          const isCollapsed = collapsed.has(id);
          return (
            <div
              key={id}
              className={`outline-row ${activeRel === heading.file ? "current-file" : ""}`}
              style={{ paddingLeft: `${8 + (heading.level - minLevel) * 14}px` }}
            >
              <button
                type="button"
                className={`outline-toggle ${isCollapsed ? "collapsed" : ""} ${hasChildren ? "" : "invisible"}`}
                aria-label={isCollapsed ? t("outline.expand") : t("outline.collapse")}
                onClick={() => toggle(id)}
              >
                <ChevronRight size={12} />
              </button>
              <button
                type="button"
                className={`outline-item level-${heading.level}`}
                title={`${heading.file}:${heading.line}`}
                onClick={() => void openFile(heading.file, heading.line)}
              >
                <span className="outline-text">{heading.title || t("outline.untitled")}</span>
                <span className="outline-file">
                  {heading.file.split("/").pop()}
                  {heading.starred ? " *" : ""}
                </span>
              </button>
            </div>
          );
        })}
        {floats.length ? (
          <>
            <button
              type="button"
              className="outline-group-head"
              onClick={() => setFloatsOpen((value) => !value)}
            >
              <ChevronRight size={12} className={floatsOpen ? "expanded" : ""} />
              {t("outline.floats", { count: floats.length })}
            </button>
            {floatsOpen
              ? floats.map((item: IndexFloat) => {
                  const Icon =
                    item.kind === "table" ? Table2 : item.kind === "figure" ? Image : Sigma;
                  const name = item.caption || item.label || t(`outline.floatKind.${item.kind}`);
                  return (
                    <div
                      key={`${item.file}:${item.line}:${item.kind}`}
                      className="outline-row float-row"
                    >
                      <span className="outline-float-icon">
                        <Icon size={11} />
                      </span>
                      <button
                        type="button"
                        className="outline-item"
                        title={`${item.file}:${item.line}`}
                        onClick={() => void openFile(item.file, item.line)}
                      >
                        <span className="outline-text">{name}</span>
                        <span className="outline-file">{item.file.split("/").pop()}</span>
                      </button>
                    </div>
                  );
                })
              : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
