import { AlertCircle, BookOpen, Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

const biblatex = `\\usepackage[backend=biber,style=numeric]{biblatex}
\\addbibresource{references.bib}
% ...
\\printbibliography`;

const classic = `\\bibliographystyle{plain}
\\bibliography{references}`;

export function BibHelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const rows = [
    { id: "biblatex", code: biblatex },
    { id: "classic", code: classic },
  ];

  return (
    <Modal
      title={t("bibHelp.title")}
      subtitle={t("bibHelp.subtitle")}
      onClose={onClose}
      size="wide"
      footer={
        <button type="button" className="button primary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <div className="bib-help">
        <section className="bib-help-card">
          <h3>
            <BookOpen size={15} /> {t("bibHelp.setupTitle")}
          </h3>
          <p>{t("bibHelp.setupBody")}</p>
          {rows.map((row) => (
            <div className="bib-help-code" key={row.id}>
              <pre>{row.code}</pre>
              <button
                type="button"
                className="icon-button"
                title={t("bibHelp.copy")}
                onClick={() => void copy(row.id, row.code)}
              >
                {copied === row.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ))}
        </section>

        <section className="bib-help-card">
          <h3>
            <Terminal size={15} /> {t("bibHelp.buildTitle")}
          </h3>
          <p>{t("bibHelp.buildBody")}</p>
          <ol className="bib-help-steps">
            <li>{t("bibHelp.stepOne")}</li>
            <li>{t("bibHelp.stepTwo")}</li>
            <li>{t("bibHelp.stepThree")}</li>
          </ol>
        </section>

        <section className="bib-help-card">
          <h3>
            <AlertCircle size={15} /> {t("bibHelp.problemsTitle")}
          </h3>
          <dl className="bib-help-problems">
            <dt>{t("bibHelp.problemBiber")}</dt>
            <dd>{t("bibHelp.problemBiberBody")}</dd>
            <dt>{t("bibHelp.problemMissing")}</dt>
            <dd>{t("bibHelp.problemMissingBody")}</dd>
            <dt>{t("bibHelp.problemUndefined")}</dt>
            <dd>{t("bibHelp.problemUndefinedBody")}</dd>
          </dl>
        </section>
      </div>
    </Modal>
  );
}
