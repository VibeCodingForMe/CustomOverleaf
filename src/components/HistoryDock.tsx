import {
  CalendarDays,
  History as HistoryIcon,
  ListFilter,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizedError } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { CheckpointSummary } from "../types";
import { Modal } from "./Modal";

type Range = "all" | "today" | "7" | "30" | "custom";
type Sort = "newest" | "oldest";
type Status = "A" | "M" | "D" | "R";

const STATUSES: Status[] = ["A", "M", "D", "R"];

function statusClass(status: string) {
  return `change-${status.toLowerCase()}`;
}

function statusLabel(t: (key: string) => string, status: string) {
  if (status === "A") return t("history.status.added");
  if (status === "M") return t("history.status.modified");
  if (status === "D") return t("history.status.deleted");
  if (status === "R") return t("history.status.renamed");
  return status;
}

export function HistoryDock() {
  const { t, i18n } = useTranslation();
  const project = useAppStore((state) => state.project);
  const preview = useAppStore((state) => state.checkpointPreview);
  const diffPath = useAppStore((state) => state.checkpointDiffPath);
  const previewCheckpoint = useAppStore((state) => state.previewCheckpoint);
  const openCheckpointDiff = useAppStore((state) => state.openCheckpointDiff);
  const clearCheckpointPreview = useAppStore((state) => state.clearCheckpointPreview);
  const restoreCheckpoint = useAppStore((state) => state.restoreCheckpoint);
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen);
  const toast = useAppStore((state) => state.toast);

  const [entries, setEntries] = useState<CheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [types, setTypes] = useState<Set<Status>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = async () => {
    if (!project) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.listCheckpoints(project.root));
    } catch (err) {
      setError(localizedError(t, err));
    } finally {
      setLoading(false);
    }
  };

  // Keep the list current while the panel is visible; checkpoints are created
  // automatically after saves, so polling is the simplest reliable signal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: project identity is the refresh key
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: polling follows the open project
  useEffect(() => {
    if (!project) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root]);

  const bounds = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (range === "today") return { from: today, to: Infinity };
    if (range === "7") return { from: today - 6 * 86_400_000, to: Infinity };
    if (range === "30") return { from: today - 29 * 86_400_000, to: Infinity };
    if (range === "custom") {
      const from = start ? new Date(start).getTime() : Number.NEGATIVE_INFINITY;
      const to = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
      return {
        from: Number.isNaN(from) ? Number.NEGATIVE_INFINITY : from,
        to: Number.isNaN(to) ? Number.POSITIVE_INFINITY : to,
      };
    }
    return { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
  }, [end, range, start]);

  const rangeInvalid = range === "custom" && bounds.from > bounds.to;

  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase(i18n.language);
    const fileText = fileFilter.trim().toLocaleLowerCase(i18n.language);
    const list = entries.filter((entry) => {
      if (rangeInvalid) return false;
      if (entry.createdAtMs < bounds.from || entry.createdAtMs > bounds.to) return false;
      if (text) {
        const haystack =
          `${entry.name ?? ""} ${entry.description ?? ""} ${entry.kind}`.toLocaleLowerCase(
            i18n.language,
          );
        if (!haystack.includes(text)) return false;
      }
      if (fileText) {
        const files = entry.files ?? [];
        if (
          !files.some(
            (file) =>
              file.path.toLocaleLowerCase(i18n.language).includes(fileText) ||
              (file.oldPath ?? "").toLocaleLowerCase(i18n.language).includes(fileText),
          )
        ) {
          return false;
        }
      }
      if (types.size > 0) {
        const files = entry.files ?? [];
        if (!files.some((file) => types.has(file.status as Status))) return false;
      }
      return true;
    });
    return list.sort((a, b) =>
      sort === "newest" ? b.createdAtMs - a.createdAtMs : a.createdAtMs - b.createdAtMs,
    );
  }, [bounds, entries, fileFilter, i18n.language, query, rangeInvalid, sort, types]);

  const toggleType = (status: Status) => {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const clearFilters = () => {
    setRange("all");
    setStart("");
    setEnd("");
    setSort("newest");
    setQuery("");
    setFileFilter("");
    setTypes(new Set());
  };

  const labelFor = (entry: CheckpointSummary) => {
    if (entry.name) return entry.name;
    if (entry.kind === "manual") return t("history.kind.manual");
    if (entry.kind === "pre-restore") return t("history.kind.preRestore");
    if (entry.kind === "pre-fix") return t("history.kind.preFix");
    if (entry.kind === "pre-delete") return t("history.kind.preDelete");
    if (entry.kind === "pre-rename") return t("history.kind.preRename");
    if (entry.kind === "pre-replace") return t("history.kind.preReplace");
    return t("history.kind.auto");
  };

  const create = async () => {
    if (!project || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createCheckpoint(project.root, name.trim(), description.trim());
      if (!created) {
        toast(t("history.noChanges"), "info");
      } else {
        toast(t("history.created", { name: labelFor(created) }), "success");
      }
      setCreateOpen(false);
      setName("");
      setDescription("");
      await load();
    } catch (err) {
      setCreateError(localizedError(t, err));
    } finally {
      setCreating(false);
    }
  };

  const select = async (entry: CheckpointSummary) => {
    await previewCheckpoint(entry.id);
  };

  const restore = async (files: string[] | undefined) => {
    if (!preview) return;
    setRestoring(true);
    try {
      await restoreCheckpoint(preview.checkpoint.id, preview.token, files);
    } finally {
      setRestoring(false);
      await load();
    }
  };

  const activeFiles = preview?.files ?? [];
  const totalAdd = activeFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDelete = activeFiles.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <section className="history-dock" aria-label={t("history.title")}>
      <div className="history-dock-head">
        <HistoryIcon size={14} />
        <span>{t("history.title")}</span>
        <span className="history-count">{entries.length}</span>
        <button
          type="button"
          className="icon-button"
          title={t("common.refresh")}
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t("history.closePanel")}
          onClick={() => setHistoryOpen(false)}
        >
          <X size={13} />
        </button>
      </div>

      {!project ? (
        <div className="tree-empty">{t("history.noProject")}</div>
      ) : (
        <>
          <div className="history-tools">
            <button
              type="button"
              className="tool-btn history-new"
              onClick={() => setCreateOpen(true)}
              title={t("history.new")}
            >
              <Plus size={12} />
              {t("history.new")}
            </button>
            <button
              type="button"
              className={`icon-button ${filtersOpen ? "active" : ""}`}
              title={t("history.filters")}
              aria-pressed={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <ListFilter size={13} />
            </button>
            <div className="history-search">
              <Search size={12} />
              <input
                className="history-search-input"
                value={query}
                placeholder={t("history.searchPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {filtersOpen ? (
            <div className="history-filters">
              <div className="history-filter-row">
                <CalendarDays size={12} />
                <select
                  className="history-select"
                  value={range}
                  aria-label={t("history.dateRange")}
                  onChange={(event) => setRange(event.target.value as Range)}
                >
                  <option value="all">{t("history.range.all")}</option>
                  <option value="today">{t("history.range.today")}</option>
                  <option value="7">{t("history.range.week")}</option>
                  <option value="30">{t("history.range.month")}</option>
                  <option value="custom">{t("history.range.custom")}</option>
                </select>
                <select
                  className="history-select history-sort"
                  value={sort}
                  aria-label={t("history.sort")}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="newest">{t("history.sortNewest")}</option>
                  <option value="oldest">{t("history.sortOldest")}</option>
                </select>
              </div>
              {range === "custom" ? (
                <div className="history-filter-row history-dates">
                  <input
                    type="datetime-local"
                    className="history-date"
                    value={start}
                    aria-label={t("history.startDate")}
                    onChange={(event) => setStart(event.target.value)}
                  />
                  <span>—</span>
                  <input
                    type="datetime-local"
                    className="history-date"
                    value={end}
                    aria-label={t("history.endDate")}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="history-filter-row">
                <input
                  className="history-file-input"
                  value={fileFilter}
                  placeholder={t("history.filePlaceholder")}
                  onChange={(event) => setFileFilter(event.target.value)}
                />
              </div>
              <div className="history-types">
                {STATUSES.map((status) => (
                  <button
                    type="button"
                    key={status}
                    className={`history-type ${statusClass(status)} ${types.has(status) ? "active" : ""}`}
                    aria-pressed={types.has(status)}
                    onClick={() => toggleType(status)}
                  >
                    {status}
                    <span>{statusLabel(t, status)}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="text-button history-clear" onClick={clearFilters}>
                {t("history.clearFilters")}
              </button>
            </div>
          ) : null}

          {rangeInvalid ? <div className="search-error">{t("history.invalidRange")}</div> : null}
          {error ? <div className="search-error">{error}</div> : null}

          {preview ? (
            <div className="history-preview-panel">
              <div className="history-preview-head">
                <span className="history-preview-title">
                  {t("history.previewOf", { name: labelFor(preview.checkpoint) })}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  title={t("history.cancelPreview")}
                  onClick={clearCheckpointPreview}
                >
                  <X size={12} />
                </button>
              </div>
              <div className="history-preview-meta">
                <span>{formatDateTime(preview.checkpoint.createdAtMs, i18n.language)}</span>
                <span className="diff-add">+{totalAdd}</span>
                <span className="diff-remove">−{totalDelete}</span>
              </div>
              <div className="history-preview-note">{t("history.previewNote")}</div>
              {activeFiles.length === 0 ? (
                <div className="tree-empty">{t("history.noChanges")}</div>
              ) : (
                <div className="history-file-list">
                  {activeFiles.map((file) => (
                    <button
                      type="button"
                      key={`${file.status}:${file.path}`}
                      className={`history-file ${diffPath === file.path ? "active" : ""}`}
                      onClick={() => void openCheckpointDiff(file.path)}
                      title={file.path}
                    >
                      <span className={`change-badge ${statusClass(file.status)}`}>
                        {file.status}
                      </span>
                      <span className="history-file-name">{file.path}</span>
                      <span className="history-file-stats">
                        {file.additions > 0 ? (
                          <span className="diff-add">+{file.additions}</span>
                        ) : null}
                        {file.deletions > 0 ? (
                          <span className="diff-remove">−{file.deletions}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="history-preview-actions">
                <button
                  type="button"
                  className="tool-btn"
                  disabled={restoring || !diffPath}
                  onClick={() => diffPath && void restore([diffPath])}
                >
                  {restoring ? <span className="spinner" /> : <RotateCcw size={12} />}
                  {t("history.restoreFile")}
                </button>
                <button
                  type="button"
                  className="tool-btn primary"
                  disabled={restoring || activeFiles.length === 0}
                  onClick={() => void restore(undefined)}
                >
                  {restoring ? <span className="spinner" /> : <RotateCcw size={12} />}
                  {t("history.restoreAll")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="history-dock-list">
            {loading && entries.length === 0 ? (
              <div className="tree-empty">
                <span className="spinner" /> {t("history.loading")}
              </div>
            ) : filtered.length === 0 ? (
              <div className="tree-empty">
                {entries.length === 0 ? t("history.empty") : t("history.noMatches")}
              </div>
            ) : (
              filtered.map((entry) => {
                const active = preview?.checkpoint.id === entry.id;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    className={`history-card ${active ? "active" : ""}`}
                    onClick={() => void select(entry)}
                  >
                    <span className="history-card-top">
                      <span className="history-card-name">{labelFor(entry)}</span>
                      <span className="history-card-time">
                        {formatDateTime(entry.createdAtMs, i18n.language)}
                      </span>
                    </span>
                    {entry.description ? (
                      <span className="history-card-description">{entry.description}</span>
                    ) : null}
                    <span className="history-card-meta">
                      <span>{t("history.affected", { count: entry.fileCount })}</span>
                      <span className="diff-add">+{entry.additions}</span>
                      <span className="diff-remove">−{entry.deletions}</span>
                    </span>
                    <span className="history-card-badges">
                      {(["A", "M", "D", "R"] as Status[]).map((status) => {
                        const count =
                          status === "A"
                            ? entry.added
                            : status === "M"
                              ? entry.modified
                              : status === "D"
                                ? entry.deleted
                                : entry.renamed;
                        return count > 0 ? (
                          <span
                            key={status}
                            className={`change-badge ${statusClass(status)}`}
                            title={statusLabel(t, status)}
                          >
                            {status} {count}
                          </span>
                        ) : null;
                      })}
                      {entry.binaryFiles > 0 ? (
                        <span className="change-badge neutral">
                          {t("history.binary", { count: entry.binaryFiles })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      {createOpen ? (
        <Modal
          size="narrow"
          title={t("history.newTitle")}
          onClose={() => setCreateOpen(false)}
          closeDisabled={creating}
          footer={
            <>
              <div className="grow" />
              <button
                type="button"
                className="text-button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="text-button primary"
                onClick={() => void create()}
                disabled={creating || !name.trim()}
              >
                {creating ? <span className="spinner" /> : <Plus size={12} />}
                {t("history.create")}
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label" htmlFor="checkpoint-name">
              {t("history.name")}
            </label>
            <input
              id="checkpoint-name"
              className="text-input"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="checkpoint-description">
              {t("history.description")}
            </label>
            <textarea
              id="checkpoint-description"
              className="text-input history-description"
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {createError ? <div className="fix-error">{createError}</div> : null}
        </Modal>
      ) : null}
    </section>
  );
}
