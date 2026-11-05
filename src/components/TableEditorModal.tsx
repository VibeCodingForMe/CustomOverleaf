import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowRightToLine,
  Check,
  Columns3,
  FileUp,
  Grid3X3,
  Merge,
  Rows3,
  Split,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getEditorSelection, insertEditorText, replaceEditorSelection } from "../lib/editorBus";
import { Modal } from "./Modal";
import { TextReplaceConfirm } from "./TextReplaceConfirm";

type Align = "l" | "c" | "r";
type Rules = "booktabs" | "hline" | "none";

interface Cell {
  text: string;
  span: number;
}

export interface TableState {
  rows: Cell[][];
  cols: number;
  aligns: Align[];
  rules: Rules;
  environment: "tabular" | "longtable";
  caption: string;
  label: string;
  matched: boolean;
  replaceable: boolean;
  warning: string | null;
}

function emptyCell(): Cell {
  return { text: "", span: 1 };
}

function makeTable(rows = 3, cols = 3): Cell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, emptyCell));
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "&" && depth === 0) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseTable(source: string): { rows: string[][]; spec: string } | null {
  const match = source.match(
    /\\begin\{(tabular|longtable)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?\{([^}]*)\}([\s\S]*?)\\end\{\1\}/,
  );
  if (!match) return null;
  const spec = match[2] ?? "";
  const body = match[3] ?? "";
  const rows: string[][] = [];
  const lines = body.split(/\\\\/);
  for (const rawLine of lines) {
    const line = rawLine
      .replace(/\\toprule|\\midrule|\\bottomrule|\\hline|\\cline\{[^}]*\}/g, "")
      .replace(/\n+/g, " ")
      .trim();
    if (!line) continue;
    rows.push(splitRow(line));
  }
  if (!rows.length) return null;
  return { rows, spec };
}

export function detect(source: string): TableState {
  const trimmed = source.trim();
  const parsed = trimmed ? parseTable(trimmed) : null;
  if (parsed) {
    const cols = Math.max(1, ...parsed.rows.map((row) => row.length));
    const rows = parsed.rows.map((row) =>
      Array.from({ length: cols }, (_unused, index) => ({
        text: (row[index] ?? "").replace(/^\\multicolumn\{\d+\}\{[^}]*\}\{(.*)\}$/, "$1"),
        span: 1,
      })),
    );
    const aligns = Array.from({ length: cols }, (_unused, index) => {
      const char = parsed.spec.replace(/[^lcr]/g, "")[index];
      return (char as Align) || "l";
    });
    return {
      rows,
      cols,
      aligns,
      rules: trimmed.includes("\\toprule")
        ? "booktabs"
        : trimmed.includes("\\hline")
          ? "hline"
          : "none",
      environment: trimmed.includes("\\begin{longtable}") ? "longtable" : "tabular",
      caption: trimmed.match(/\\caption\{([^}]*)\}/)?.[1] ?? "",
      label: trimmed.match(/\\label\{([^}]*)\}/)?.[1] ?? "",
      matched: true,
      replaceable: true,
      warning: null,
    };
  }
  if (/\\begin\{/.test(trimmed)) {
    return {
      rows: makeTable(),
      cols: 3,
      aligns: ["l", "c", "r"],
      rules: "booktabs",
      environment: "tabular",
      caption: "",
      label: "",
      matched: false,
      replaceable: false,
      warning: "selectionNotTable",
    };
  }
  return {
    rows: makeTable(),
    cols: 3,
    aligns: ["l", "c", "r"],
    rules: "booktabs",
    environment: "tabular",
    caption: "",
    label: "",
    matched: false,
    replaceable: true,
    warning: null,
  };
}

function escapeCell(value: string, escapeCells: boolean) {
  if (!escapeCells) return value;
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\n/g, " \\newline ");
}

function tableRows(state: TableState, escapeCells: boolean, indent: string): string[] {
  const lines: string[] = [];
  const rules = state.rules;
  state.rows.forEach((row, rowIndex) => {
    const cells: string[] = [];
    for (let col = 0; col < state.cols; col += 1) {
      const cell = row[col];
      if (!cell || cell.span === 0) continue;
      const value = escapeCell(cell.text, escapeCells);
      if (cell.span > 1) {
        const span = Math.min(cell.span, state.cols - col);
        cells.push(`\\multicolumn{${span}}{${state.aligns[col]}}{${value}}`);
      } else {
        cells.push(value);
      }
    }
    if (!cells.length) return;
    lines.push(`${indent}${cells.join(" & ")} \\\\`);
    if (rowIndex === 0 && state.rows.length > 1) {
      if (rules === "booktabs") lines.push(`${indent}\\midrule`);
      else if (rules === "hline") lines.push(`${indent}\\hline`);
    }
  });
  return lines;
}

export function generate(state: TableState, escapeCells: boolean) {
  const spec = state.aligns.join("");
  const rules = state.rules;
  const caption = state.caption.trim();
  const label = state.label.trim();
  const lines: string[] = [];

  if (state.environment === "longtable") {
    lines.push(`\\begin{longtable}{${spec}}`);
    if (caption || label) {
      lines.push(`  \\caption{${caption}}\\label{${label}}\\\\`);
    }
    if (rules === "booktabs") lines.push("  \\toprule");
    else if (rules === "hline") lines.push("  \\hline");
    lines.push(...tableRows(state, escapeCells, "  "));
    if (rules === "booktabs") lines.push("  \\bottomrule");
    else if (rules === "hline") lines.push("  \\hline");
    lines.push("\\end{longtable}");
    return lines.join("\n");
  }

  // A tabular is not a float: wrap it so \caption and \label are valid.
  lines.push("\\begin{table}[htbp]");
  lines.push("  \\centering");
  if (caption) lines.push(`  \\caption{${caption}}`);
  if (label) lines.push(`  \\label{${label}}`);
  lines.push(`  \\begin{tabular}{${spec}}`);
  if (rules === "booktabs") lines.push("    \\toprule");
  else if (rules === "hline") lines.push("    \\hline");
  lines.push(...tableRows(state, escapeCells, "    "));
  if (rules === "booktabs") lines.push("    \\bottomrule");
  else if (rules === "hline") lines.push("    \\hline");
  lines.push("  \\end{tabular}");
  lines.push("\\end{table}");
  return lines.join("\n");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length));
}

export function TableEditorModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const selection = getEditorSelection();
  const initial = useMemo(() => detect(selection?.text ?? ""), [selection?.text]);
  const [table, setTable] = useState(initial);
  const [replace, setReplace] = useState(Boolean(selection?.text.trim()) && initial.matched);
  const [escapeCells, setEscapeCells] = useState(true);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [active, setActive] = useState({ row: 0, col: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  const output = useMemo(() => generate(table, escapeCells), [table, escapeCells]);

  const updateCell = (row: number, col: number, text: string) => {
    setTable((current) => ({
      ...current,
      rows: current.rows.map((entry, rowIndex) =>
        rowIndex === row
          ? entry.map((cell, colIndex) => (colIndex === col ? { ...cell, text } : cell))
          : entry,
      ),
    }));
  };

  const addRow = () => {
    setTable((current) => ({
      ...current,
      rows: [...current.rows, Array.from({ length: current.cols }, emptyCell)],
    }));
  };

  const removeRow = (row: number) => {
    setTable((current) => {
      if (current.rows.length <= 1) return current;
      return { ...current, rows: current.rows.filter((_entry, index) => index !== row) };
    });
  };

  const addColumn = () => {
    setTable((current) => ({
      ...current,
      cols: current.cols + 1,
      aligns: [...current.aligns, "l"],
      rows: current.rows.map((row) => [...row, emptyCell()]),
    }));
  };

  const removeColumn = (col: number) => {
    setTable((current) => {
      if (current.cols <= 1) return current;
      return {
        ...current,
        cols: current.cols - 1,
        aligns: current.aligns.filter((_align, index) => index !== col),
        rows: current.rows.map((row) => row.filter((_cell, index) => index !== col)),
      };
    });
  };

  const mergeRight = () => {
    const row = table.rows[active.row];
    const cell = row?.[active.col];
    const next = row?.[active.col + 1];
    if (!cell || !next || cell.span === 0 || next.span === 0) return;
    setTable((current) => ({
      ...current,
      rows: current.rows.map((entry, rowIndex) =>
        rowIndex === active.row
          ? entry.map((value, colIndex) => {
              if (colIndex === active.col) {
                return {
                  ...value,
                  span: value.span + next.span,
                  text: [value.text.trim(), next.text.trim()].filter(Boolean).join(" "),
                };
              }
              if (colIndex === active.col + 1) return { ...value, span: 0 };
              return value;
            })
          : entry,
      ),
    }));
  };

  const unmerge = () => {
    const row = table.rows[active.row];
    const cell = row?.[active.col];
    if (!cell || cell.span <= 1) return;
    setTable((current) => ({
      ...current,
      rows: current.rows.map((entry, rowIndex) =>
        rowIndex === active.row
          ? entry.map((value, colIndex) => {
              if (colIndex === active.col) return { ...value, span: 1 };
              if (colIndex === active.col + 1)
                return { ...value, span: value.span + cell.span - 1 };
              return value;
            })
          : entry,
      ),
    }));
  };

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text()).slice(0, 200);
    if (!rows.length) return;
    const cols = Math.max(...rows.map((row) => row.length));
    setTable((current) => ({
      ...current,
      cols,
      aligns: Array.from({ length: cols }, (_unused, index) => current.aligns[index] ?? "l"),
      rows: rows.map((row) =>
        Array.from({ length: cols }, (_unused, index) => ({ text: row[index] ?? "", span: 1 })),
      ),
    }));
  };

  const commit = () => {
    const text = replace ? output : `\n${output}\n`;
    if (replace) replaceEditorSelection(text);
    else insertEditorText(text);
    onClose();
  };

  const apply = () => {
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
      title={t("tableEditor.title")}
      subtitle={t("tableEditor.subtitle")}
      onClose={onClose}
      size="wide"
      footer={
        <>
          {!initial.replaceable && initial.warning ? (
            <span className="form-hint" style={{ color: "var(--warning)" }}>
              {t("tableEditor.unsupported")}
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
                {t("tableEditor.confirmReplace")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="text-button" onClick={() => void copy()}>
                {copied ? <Check size={13} /> : <Grid3X3 size={13} />}
                {copied ? t("common.copied") : t("tableEditor.copy")}
              </button>
              <button type="button" className="text-button" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="text-button primary"
                disabled={!table.rows.length}
                onClick={apply}
              >
                {replace ? t("tableEditor.replace") : t("tableEditor.insert")}
              </button>
            </>
          )}
        </>
      }
    >
      {confirming ? (
        <TextReplaceConfirm before={selection?.text ?? ""} after={output} />
      ) : (
        <div className="table-editor">
          <div className="table-toolbar">
            <div className="segmented">
              {(["tabular", "longtable"] as const).map((environment) => (
                <button
                  type="button"
                  key={environment}
                  className={table.environment === environment ? "active" : ""}
                  onClick={() => setTable((current) => ({ ...current, environment }))}
                >
                  {environment}
                </button>
              ))}
            </div>
            <div className="segmented">
              {(["booktabs", "hline", "none"] as Rules[]).map((rules) => (
                <button
                  type="button"
                  key={rules}
                  className={table.rules === rules ? "active" : ""}
                  onClick={() => setTable((current) => ({ ...current, rules }))}
                >
                  {t(`tableEditor.rules.${rules}`)}
                </button>
              ))}
            </div>
            <div className="grow" />
            <button type="button" className="text-button small" onClick={addRow}>
              <Rows3 size={12} /> {t("tableEditor.addRow")}
            </button>
            <button type="button" className="text-button small" onClick={addColumn}>
              <Columns3 size={12} /> {t("tableEditor.addColumn")}
            </button>
            <button
              type="button"
              className="text-button small"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp size={12} /> {t("tableEditor.importCsv")}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsv(file);
                event.currentTarget.value = "";
              }}
            />
          </div>

          <div className="table-editor-body">
            <div className="table-grid-wrap">
              <table className="table-grid">
                <thead>
                  <tr>
                    <th className="table-grid-corner" />
                    {Array.from({ length: table.cols }, (_unused, col) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are grid positions
                      <th key={col}>
                        <div className="table-col-head">
                          <div className="segmented tiny">
                            {(["l", "c", "r"] as Align[]).map((align) => (
                              <button
                                type="button"
                                key={align}
                                className={table.aligns[col] === align ? "active" : ""}
                                title={t(
                                  `tableEditor.align.${align === "l" ? "left" : align === "c" ? "center" : "right"}`,
                                )}
                                onClick={() =>
                                  setTable((current) => ({
                                    ...current,
                                    aligns: current.aligns.map((value, index) =>
                                      index === col ? align : value,
                                    ),
                                  }))
                                }
                              >
                                {align === "l" && <AlignLeft size={11} />}
                                {align === "c" && <AlignCenter size={11} />}
                                {align === "r" && <AlignRight size={11} />}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="table-remove"
                            title={t("tableEditor.removeColumn")}
                            onClick={() => removeColumn(col)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are grid positions
                    <tr key={rowIndex}>
                      <th className="table-row-head">
                        <span>{rowIndex + 1}</span>
                        <button
                          type="button"
                          className="table-remove"
                          title={t("tableEditor.removeRow")}
                          onClick={() => removeRow(rowIndex)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </th>
                      {row.map((cell, colIndex) => {
                        if (cell.span === 0) return null;
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: columns are grid positions
                          <td key={colIndex} colSpan={cell.span}>
                            <textarea
                              value={cell.text}
                              rows={1}
                              className={
                                active.row === rowIndex && active.col === colIndex ? "active" : ""
                              }
                              onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                              onChange={(event) =>
                                updateCell(rowIndex, colIndex, event.target.value)
                              }
                              placeholder={rowIndex === 0 ? t("tableEditor.headerCell") : ""}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-editor-side">
              <div className="table-actions">
                <button type="button" className="text-button small" onClick={mergeRight}>
                  <Merge size={12} /> {t("tableEditor.mergeRight")}
                </button>
                <button type="button" className="text-button small" onClick={unmerge}>
                  <Split size={12} /> {t("tableEditor.unmerge")}
                </button>
                <button
                  type="button"
                  className="text-button small"
                  onClick={() =>
                    setTable((current) => ({
                      ...current,
                      rows: [...current.rows, Array.from({ length: current.cols }, emptyCell)],
                    }))
                  }
                >
                  <ArrowDownToLine size={12} /> {t("tableEditor.addRow")}
                </button>
                <button
                  type="button"
                  className="text-button small"
                  onClick={() =>
                    setTable((current) => ({
                      ...current,
                      cols: current.cols + 1,
                      aligns: [...current.aligns, "l"],
                      rows: current.rows.map((row) => [...row, emptyCell()]),
                    }))
                  }
                >
                  <ArrowRightToLine size={12} /> {t("tableEditor.addColumn")}
                </button>
              </div>

              <div className="table-meta">
                <label className="form-label" htmlFor="table-caption">
                  {t("tableEditor.caption")}
                </label>
                <input
                  id="table-caption"
                  value={table.caption}
                  onChange={(event) =>
                    setTable((current) => ({ ...current, caption: event.target.value }))
                  }
                />
                <label className="form-label" htmlFor="table-label">
                  {t("tableEditor.label")}
                </label>
                <input
                  id="table-label"
                  value={table.label}
                  onChange={(event) =>
                    setTable((current) => ({ ...current, label: event.target.value }))
                  }
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={escapeCells}
                    onChange={(event) => setEscapeCells(event.target.checked)}
                  />
                  <span>{t("tableEditor.escape")}</span>
                </label>
              </div>

              <div className="equation-output-head">
                <span className="form-label">{t("tableEditor.preview")}</span>
              </div>
              <div className="table-render-preview">
                <table>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are grid positions
                      <tr key={rowIndex}>
                        {row.map((cell, colIndex) => {
                          if (cell.span === 0) return null;
                          return (
                            <td
                              // biome-ignore lint/suspicious/noArrayIndexKey: columns are grid positions
                              key={colIndex}
                              colSpan={cell.span}
                              style={{
                                textAlign:
                                  table.aligns[colIndex] === "l"
                                    ? "left"
                                    : table.aligns[colIndex] === "r"
                                      ? "right"
                                      : "center",
                              }}
                            >
                              {cell.text || "\u00a0"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="equation-output-head">
                <span className="form-label">{t("tableEditor.output")}</span>
                <button
                  type="button"
                  className="text-button small"
                  onClick={() => setTable(initial)}
                >
                  <Trash2 size={11} />
                  {t("common.reset")}
                </button>
              </div>
              <pre className="equation-output table-output">{output}</pre>

              {selection?.text.trim() ? (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={replace}
                    disabled={!initial.replaceable}
                    onChange={(event) => setReplace(event.target.checked)}
                  />
                  <span>{t("tableEditor.replaceSelection")}</span>
                </label>
              ) : (
                <div className="form-hint">{t("tableEditor.insertHint")}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
