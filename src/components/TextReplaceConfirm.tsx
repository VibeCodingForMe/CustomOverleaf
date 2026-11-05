import { useTranslation } from "react-i18next";

interface TextReplaceConfirmProps {
  before: string;
  after: string;
}

/**
 * Side-by-side line preview shown before a builder replaces existing source.
 * This is deliberately a diff-style read-only view: nothing is written until
 * the caller's explicit confirm action runs.
 */
export function TextReplaceConfirm({ before, after }: TextReplaceConfirmProps) {
  const { t } = useTranslation();
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return (
    <div className="text-replace-confirm">
      <div className="text-replace-confirm-title">{t("common.replacePreview")}</div>
      <div className="text-replace-confirm-grid">
        <section>
          <h4>{t("common.currentText")}</h4>
          <pre>
            {beforeLines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff rows identify line positions
              <span className="diff-remove-text" key={index}>
                - {line}
                {"\n"}
              </span>
            ))}
          </pre>
        </section>
        <section>
          <h4>{t("common.newText")}</h4>
          <pre>
            {afterLines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff rows identify line positions
              <span className="diff-add-text" key={index}>
                + {line}
                {"\n"}
              </span>
            ))}
          </pre>
        </section>
      </div>
    </div>
  );
}
