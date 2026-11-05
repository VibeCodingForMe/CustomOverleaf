import { ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

export function FixModal() {
  const { t } = useTranslation();
  const fix = useAppStore((state) => state.fixState);
  const tabs = useAppStore((state) => state.tabs);
  const closeFix = useAppStore((state) => state.closeFix);
  const applyFix = useAppStore((state) => state.applyFix);
  const [applying, setApplying] = useState(false);

  if (!fix) return null;
  const { diagnostic, suggestion, loading, error } = fix;
  const params = diagnostic.params;
  const title = t(`diagnostics.codes.${diagnostic.code}.title`, {
    defaultValue: diagnostic.message,
    ...params,
  });
  const body = t(`diagnostics.codes.${diagnostic.code}.body`, {
    defaultValue: "",
    ...params,
  });
  const tab = suggestion ? tabs.find((item) => item.rel === suggestion.file) : null;
  const lines = tab?.content.split("\n") ?? [];

  const apply = async () => {
    setApplying(true);
    await applyFix();
    setApplying(false);
  };

  return (
    <Modal
      size="medium"
      title={t("fix.title")}
      subtitle={t("fix.subtitle")}
      onClose={closeFix}
      closeDisabled={applying}
      footer={
        <>
          <div className="grow" />
          <button type="button" className="text-button" onClick={closeFix} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="text-button primary"
            disabled={!suggestion || applying || Boolean(error) || loading}
            onClick={() => void apply()}
          >
            {applying ? <span className="spinner" /> : <Sparkles size={12} />}
            {t("common.applyFix")}
          </button>
        </>
      }
    >
      <div className="diag-card" style={{ marginBottom: 12 }}>
        <div className="diag-head">
          <TriangleAlert size={13} color="var(--danger)" />
          <span className="diag-title">{title}</span>
          {suggestion ? (
            <span
              className={`fix-confidence ${suggestion.confidence}`}
              style={{ marginLeft: "auto" }}
            >
              {t("fix.confidence")}: {t(`fix.${suggestion.confidence}`)}
            </span>
          ) : null}
        </div>
        <div className="diag-message">{diagnostic.message}</div>
        {body ? <div className="diag-explanation">{body}</div> : null}
        {diagnostic.file ? (
          <div className="form-hint mono" style={{ marginTop: 5 }}>
            {diagnostic.file}
            {diagnostic.line ? `:${diagnostic.line}` : ""}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="empty-panel" style={{ minHeight: 120 }}>
          <span className="spinner large" />
          <p>{t("fix.loading")}</p>
        </div>
      ) : error ? (
        <div className="fix-error">{error}</div>
      ) : suggestion ? (
        <>
          <div className="section-title" style={{ marginBottom: 6 }}>
            {t("fix.preview")}
          </div>
          <div className="fix-diff">
            {suggestion.edits.map((edit, index) => {
              const line = lines[edit.line - 1] ?? "";
              return (
                <div key={`${edit.line}-${index}`}>
                  <div className="fix-diff-header">
                    {edit.kind === "replace_line"
                      ? t("fix.replace", { line: edit.line })
                      : t("fix.insert", { line: edit.line })}
                  </div>
                  {edit.kind === "replace_line" ? (
                    <div className="diff-line removed">
                      <span className="sign">−</span>
                      <span>{edit.expected ?? line}</span>
                    </div>
                  ) : edit.expected ? (
                    <div className="diff-line context">
                      <span className="sign"> </span>
                      <span>{edit.expected}</span>
                    </div>
                  ) : null}
                  <div className="diff-line added">
                    <span className="sign">+</span>
                    <span>{edit.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="fix-note">
            <ShieldCheck size={13} style={{ flex: "none", marginTop: 1 }} />
            {t("fix.backup")}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
