import katex from "katex";
import "katex/dist/katex.min.css";
import { Check, Copy, FunctionSquare, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getEditorSelection, insertEditorText, replaceEditorSelection } from "../lib/editorBus";
import { detectEquation, type WrapMode, wrapEquation } from "../lib/equation";
import { Modal } from "./Modal";
import { TextReplaceConfirm } from "./TextReplaceConfirm";

const groups: Array<{
  title: string;
  items: Array<{ label: string; insert: string; caret?: number }>;
}> = [
  {
    title: "Structure",
    items: [
      { label: "a/b", insert: "\\frac{}{}", caret: 6 },
      { label: "x²", insert: "^{}", caret: 2 },
      { label: "x₂", insert: "_{}", caret: 2 },
      { label: "√", insert: "\\sqrt{}", caret: 6 },
      { label: "n√", insert: "\\sqrt[n]{}", caret: 9 },
      { label: "( )", insert: "\\left( \\right)", caret: 7 },
      { label: "[ ]", insert: "\\left[ \\right]", caret: 7 },
      { label: "{ }", insert: "\\left\\{ \\right\\}", caret: 9 },
    ],
  },
  {
    title: "Calculus",
    items: [
      { label: "∫", insert: "\\int_{}^{} ", caret: 6 },
      { label: "∬", insert: "\\iint_{}^{} ", caret: 7 },
      { label: "∑", insert: "\\sum_{}^{} ", caret: 6 },
      { label: "∏", insert: "\\prod_{}^{} ", caret: 7 },
      { label: "lim", insert: "\\lim_{x \\to 0} ", caret: 11 },
      { label: "∂", insert: "\\partial ", caret: 9 },
      { label: "∇", insert: "\\nabla ", caret: 7 },
      { label: "∞", insert: "\\infty ", caret: 7 },
    ],
  },
  {
    title: "Relations",
    items: [
      { label: "≤", insert: "\\leq " },
      { label: "≥", insert: "\\geq " },
      { label: "≠", insert: "\\neq " },
      { label: "≈", insert: "\\approx " },
      { label: "∈", insert: "\\in " },
      { label: "→", insert: "\\to " },
      { label: "⇒", insert: "\\Rightarrow " },
      { label: "⇔", insert: "\\Leftrightarrow " },
    ],
  },
  {
    title: "Greek",
    items: [
      { label: "α", insert: "\\alpha " },
      { label: "β", insert: "\\beta " },
      { label: "γ", insert: "\\gamma " },
      { label: "δ", insert: "\\delta " },
      { label: "ε", insert: "\\epsilon " },
      { label: "θ", insert: "\\theta " },
      { label: "λ", insert: "\\lambda " },
      { label: "μ", insert: "\\mu " },
      { label: "π", insert: "\\pi " },
      { label: "σ", insert: "\\sigma " },
      { label: "φ", insert: "\\phi " },
      { label: "ω", insert: "\\omega " },
    ],
  },
  {
    title: "Layout",
    items: [
      {
        label: "matrix",
        insert: "\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}",
      },
      {
        label: "cases",
        insert: "\\begin{cases}\n  x & x > 0 \\\\\n  -x & x \\leq 0\n\\end{cases}",
      },
      {
        label: "aligned",
        insert: "\\begin{aligned}\n  a &= b \\\\\n  c &= d\n\\end{aligned}",
      },
      {
        label: "system",
        insert: "\\begin{cases}\n  a_1 x + b_1 y = c_1 \\\\\n  a_2 x + b_2 y = c_2\n\\end{cases}",
      },
    ],
  },
];

export function EquationBuilderModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const selection = getEditorSelection();
  const initial = detectEquation(selection?.text ?? "");
  const [body, setBody] = useState(initial.body);
  const [mode, setMode] = useState<WrapMode>(initial.mode);
  const [replace, setReplace] = useState(Boolean(selection?.text.trim()) && initial.math);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const output = useMemo(() => wrapEquation(body, mode), [body, mode]);

  useEffect(() => {
    const element = preview.current;
    if (!element) return;
    element.replaceChildren();
    setPreviewError(null);
    if (!body.trim()) return;
    try {
      katex.render(body, element, {
        displayMode: mode !== "inline",
        throwOnError: true,
        strict: "ignore",
        trust: false,
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }, [body, mode]);

  const insert = (value: string, caret?: number) => {
    const element = textarea.current;
    if (!element) {
      setBody((current) => current + value);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = body.slice(0, start) + value + body.slice(end);
    setBody(next);
    const position = start + (caret ?? value.length);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  const commit = () => {
    const text = replace ? output : `\n${output}\n`;
    if (replace) replaceEditorSelection(text);
    else insertEditorText(text);
    onClose();
  };

  const apply = () => {
    if (!body.trim()) return;
    if (replace) setConfirming(true);
    else commit();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      title={t("equation.title")}
      subtitle={t("equation.subtitle")}
      onClose={onClose}
      size="wide"
      footer={
        <>
          {!initial.replaceable && initial.warning ? (
            <span className="form-hint" style={{ color: "var(--warning)" }}>
              {t("equation.unsupported")}
            </span>
          ) : null}
          <div className="grow" />
          {confirming ? (
            <>
              <button type="button" className="text-button" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="text-button primary" onClick={commit}>
                <Check size={13} />
                {t("equation.confirmReplace")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="text-button" onClick={() => void copy()}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? t("common.copied") : t("equation.copy")}
              </button>
              <button type="button" className="text-button" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="text-button primary"
                disabled={!body.trim()}
                onClick={apply}
              >
                <FunctionSquare size={13} />
                {replace ? t("equation.replace") : t("equation.insert")}
              </button>
            </>
          )}
        </>
      }
    >
      {confirming ? (
        <TextReplaceConfirm before={selection?.text ?? ""} after={output} />
      ) : (
        <div className="equation-builder">
          <div className="equation-palette">
            {groups.map((group) => (
              <section key={group.title}>
                <h4>{t(`equation.groups.${group.title.toLowerCase()}`)}</h4>
                <div className="equation-palette-grid">
                  {group.items.map((item) => (
                    <button
                      type="button"
                      key={item.label}
                      className="equation-key"
                      title={item.insert}
                      onClick={() => insert(item.insert, item.caret)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <section>
              <h4>{t("equation.wrapper")}</h4>
              <div className="segmented equation-mode">
                {(["inline", "display", "equation", "align"] as WrapMode[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={mode === value ? "active" : ""}
                    onClick={() => setMode(value)}
                  >
                    {t(`equation.modes.${value}`)}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="equation-work">
            <div className="equation-preview" aria-live="polite">
              <div ref={preview} />
              {previewError ? <div className="equation-error">{previewError}</div> : null}
              {!body.trim() ? <div className="form-hint">{t("equation.previewEmpty")}</div> : null}
            </div>
            <label className="form-label" htmlFor="equation-source">
              {t("equation.source")}
            </label>
            <textarea
              ref={textarea}
              id="equation-source"
              className="equation-source"
              value={body}
              spellCheck={false}
              placeholder="E = mc^2"
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="equation-output-head">
              <span className="form-label">{t("equation.output")}</span>
              <button
                type="button"
                className="text-button small"
                onClick={() => {
                  setBody("");
                  textarea.current?.focus();
                }}
              >
                <Trash2 size={11} />
                {t("common.clear")}
              </button>
            </div>
            <pre className="equation-output">{output}</pre>
            {selection?.text.trim() ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={replace}
                  disabled={!initial.replaceable}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                <span>{t("equation.replaceSelection")}</span>
              </label>
            ) : (
              <div className="form-hint">
                <Plus size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                {t("equation.insertHint")}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
