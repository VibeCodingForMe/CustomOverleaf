import { GitBranch, GitCommitHorizontal, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizedError } from "../lib/errors";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { GitChange, GitStatus } from "../types";
import { Modal } from "./Modal";

interface GitModalProps {
  onClose: () => void;
}

function statusLabel(change: GitChange, t: ReturnType<typeof useTranslation>["t"]) {
  if (change.status === "??") return t("git.untracked");
  if (change.status.includes("A")) return t("git.added");
  if (change.status.includes("D")) return t("git.deleted");
  return t("git.modified");
}

export function GitModal({ onClose }: GitModalProps) {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const tools = useAppStore((state) => state.tools);
  const toast = useAppStore((state) => state.toast);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selected, setSelected] = useState<GitChange | null>(null);
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (keepSelection = false) => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getGitStatus(project.root);
      setStatus(next);
      const current =
        (keepSelection && selected
          ? next.changes.find((change) => change.path === selected.path)
          : null) ??
        next.changes[0] ??
        null;
      setSelected(current);
      if (current) {
        setDiff(await api.getGitDiff(project.root, current.path));
      } else {
        setDiff("");
      }
    } catch (err) {
      setError(localizedError(t, err));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the project changes
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root]);

  const select = async (change: GitChange) => {
    if (!project) return;
    setSelected(change);
    try {
      setDiff(await api.getGitDiff(project.root, change.path));
    } catch (err) {
      toast(localizedError(t, err), "error");
    }
  };

  const stage = async (paths: string[]) => {
    if (!project || paths.length === 0) return;
    setWorking(true);
    try {
      await api.stageGitPaths(project.root, paths);
      await load(true);
    } catch (err) {
      toast(localizedError(t, err), "error");
    } finally {
      setWorking(false);
    }
  };

  const commit = async () => {
    if (!project || !message.trim()) return;
    setWorking(true);
    try {
      await api.commitGit(project.root, message.trim());
      setMessage("");
      toast(t("git.commitSuccess"), "success");
      await load();
    } catch (err) {
      toast(localizedError(t, err), "error");
    } finally {
      setWorking(false);
    }
  };

  if (!project) return null;

  const staged = status?.changes.filter((change) => change.staged) ?? [];
  const commitDisabled = working || staged.length === 0 || !message.trim();

  return (
    <Modal
      size="wide"
      title={t("git.title")}
      subtitle={project.name}
      onClose={onClose}
      closeDisabled={working}
      footer={
        status?.isRepo ? (
          <>
            <div className="row-input" style={{ flex: 1 }}>
              <input
                className="text-input"
                value={message}
                placeholder={t("git.commitPlaceholder")}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !commitDisabled) void commit();
                }}
              />
            </div>
            <button
              type="button"
              className="text-button primary"
              disabled={commitDisabled}
              onClick={() => void commit()}
            >
              {working ? <span className="spinner" /> : <GitCommitHorizontal size={13} />}
              {t("git.commit")}
            </button>
          </>
        ) : (
          <>
            <div className="grow" />
            <button type="button" className="text-button" onClick={onClose}>
              {t("common.close")}
            </button>
          </>
        )
      }
    >
      {!tools?.git ? (
        <div className="empty-panel">
          <ShieldAlert size={22} />
          <p>{t("git.notInstalled")}</p>
        </div>
      ) : loading && !status ? (
        <div className="empty-panel">
          <span className="spinner large" />
          <p>{t("git.loading")}</p>
        </div>
      ) : error ? (
        <div className="fix-error">{error}</div>
      ) : !status?.isRepo ? (
        <div className="empty-panel">
          <GitBranch size={24} />
          <h3>{t("git.notRepo")}</h3>
          <p>{t("git.notRepoHint")}</p>
          <code className="data-path" style={{ marginTop: 6 }}>
            cd {project.root} && git init
          </code>
        </div>
      ) : (
        <>
          <div className="git-status-header">
            <span className="branch-pill">
              <GitBranch size={11} />
              {status.branch ?? "—"}
            </span>
            <span className="form-hint">{status.clean ? t("git.clean") : t("git.changes")}</span>
            <div className="grow" />
            <button
              type="button"
              className="text-button small"
              disabled={working || status.changes.length === 0}
              onClick={() => void stage(status.changes.map((change) => change.path))}
            >
              {t("git.stageAll")}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void load(true)}
              disabled={loading || working}
              title={t("git.refresh")}
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} />
            </button>
          </div>
          {status.changes.length === 0 ? (
            <div className="empty-panel">
              <GitBranch size={22} />
              <p>{t("git.clean")}</p>
            </div>
          ) : (
            <div className="git-body">
              <div className="git-changes">
                {status.changes.map((change) => (
                  <button
                    type="button"
                    key={change.path}
                    className={`git-change ${selected?.path === change.path ? "active" : ""}`}
                    onClick={() => void select(change)}
                  >
                    <span className={`git-status-code ${change.staged ? "staged" : ""}`}>
                      {change.status}
                    </span>
                    <span className="git-path" title={change.path}>
                      {change.path}
                    </span>
                    <span className="form-hint" style={{ flex: "none" }}>
                      {statusLabel(change, t)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="git-diff">
                {selected ? (
                  <>
                    <div className="fix-diff-header" style={{ marginBottom: 6 }}>
                      {selected.path}
                      {selected.staged ? ` · ${t("git.staged")}` : ` · ${t("git.unstaged")}`}
                    </div>
                    {diff ? (
                      <div className="git-diff-lines">
                        {diff.split("\n").map((line, index) => (
                          <div
                            key={`${index}-${line.slice(0, 8)}`}
                            className={
                              line.startsWith("+") && !line.startsWith("+++")
                                ? "git-diff-add"
                                : line.startsWith("-") && !line.startsWith("---")
                                  ? "git-diff-del"
                                  : line.startsWith("@@")
                                    ? "git-diff-hunk"
                                    : ""
                            }
                          >
                            {line || " "}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-panel">
                        <p>{t("git.noDiff")}</p>
                      </div>
                    )}
                    {!selected.staged ? (
                      <button
                        type="button"
                        className="text-button small"
                        style={{ marginTop: 6 }}
                        disabled={working}
                        onClick={() => void stage([selected.path])}
                      >
                        {t("git.stage")}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-panel">
                    <p>{t("git.noDiff")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
