import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { type Diagnostic as LintDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { setActiveEditor } from "../lib/editorBus";
import { snippetCompletionSource } from "../lib/snippets";
import type { Diagnostic, EditorSettings, ProjectIndex, Theme } from "../types";

const latexCommands = [
  "\\documentclass",
  "\\usepackage",
  "\\begin",
  "\\end",
  "\\section",
  "\\subsection",
  "\\subsubsection",
  "\\paragraph",
  "\\chapter",
  "\\part",
  "\\title",
  "\\author",
  "\\date",
  "\\maketitle",
  "\\tableofcontents",
  "\\listoffigures",
  "\\listoftables",
  "\\label",
  "\\ref",
  "\\eqref",
  "\\pageref",
  "\\cite",
  "\\citep",
  "\\citet",
  "\\bibliography",
  "\\bibliographystyle",
  "\\addbibresource",
  "\\printbibliography",
  "\\include",
  "\\input",
  "\\includegraphics",
  "\\caption",
  "\\centering",
  "\\textbf",
  "\\textit",
  "\\underline",
  "\\emph",
  "\\texttt",
  "\\footnote",
  "\\item",
  "\\itemize",
  "\\enumerate",
  "\\description",
  "\\frac",
  "\\sqrt",
  "\\sum",
  "\\int",
  "\\prod",
  "\\left",
  "\\right",
  "\\cdot",
  "\\times",
  "\\alpha",
  "\\beta",
  "\\gamma",
  "\\delta",
  "\\epsilon",
  "\\lambda",
  "\\mu",
  "\\pi",
  "\\sigma",
  "\\omega",
  "\\infty",
  "\\partial",
  "\\nabla",
  "\\mathcal",
  "\\mathbb",
  "\\mathrm",
  "\\text",
  "\\newpage",
  "\\clearpage",
  "\\hline",
  "\\toprule",
  "\\midrule",
  "\\bottomrule",
  "\\multicolumn",
  "\\multirow",
  "\\todo",
  "\\today",
  "\\LaTeX",
  "\\TeX",
];

const environments = [
  "document",
  "abstract",
  "figure",
  "table",
  "tabular",
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "itemize",
  "enumerate",
  "description",
  "quote",
  "verbatim",
  "center",
  "flushleft",
  "flushright",
  "minipage",
  "theorem",
  "proof",
  "frame",
  "columns",
  "column",
];

const commonPackages = [
  "amsmath",
  "amssymb",
  "amsthm",
  "graphicx",
  "booktabs",
  "longtable",
  "multirow",
  "array",
  "geometry",
  "hyperref",
  "cleveref",
  "babel",
  "fontspec",
  "unicode-math",
  "biblatex",
  "natbib",
  "xcolor",
  "tikz",
  "pgfplots",
  "listings",
  "microtype",
  "setspace",
  "titlesec",
  "fancyhdr",
  "enumitem",
  "caption",
  "subcaption",
  "float",
  "siunitx",
  "csquotes",
];

function completionFrom(
  match: { from: number; text: string } | null,
  options: Completion[],
): CompletionResult | null {
  if (!match) return null;
  const brace = match.text.lastIndexOf("{");
  const from = brace >= 0 ? match.from + brace + 1 : match.from;
  return { from, options: options.slice(0, 120) };
}

function latexSource(getIndex: () => ProjectIndex | null, currentRel: string) {
  return (context: CompletionContext): CompletionResult | null => {
    const index = getIndex();
    const refMatch = context.matchBefore(/\\[a-zA-Z]*(?:ref|Ref)\*?\{[^}]*$/);
    if (refMatch && index) {
      return completionFrom(
        refMatch,
        index.labels.map((label) => ({
          label: label.key,
          type: "variable",
          detail: `${label.file}:${label.line}`,
          boost: 3,
        })),
      );
    }

    const citeMatch = context.matchBefore(
      /\\[a-zA-Z]*(?:cite|Cite|parencite|textcite|autocite)\*?(?:\[[^\]]*\])*\{[^}]*$/,
    );
    if (citeMatch && index) {
      return completionFrom(
        citeMatch,
        index.citations.map((citation) => ({
          label: citation.key,
          type: "constant",
          detail: [citation.author, citation.year, citation.title].filter(Boolean).join(" · "),
          boost: 3,
        })),
      );
    }

    const inputMatch = context.matchBefore(/\\[a-zA-Z]*(?:input|include|subfile)\{[^}]*$/);
    if (inputMatch && index) {
      return completionFrom(
        inputMatch,
        index.files
          .filter(
            (file) =>
              file.toLowerCase().endsWith(".tex") &&
              file !== currentRel &&
              !file.split("/").some((part) => part.startsWith(".")),
          )
          .map((file) => ({
            label: file.replace(/\.tex$/i, ""),
            type: "text",
            detail: file,
            boost: 2,
          })),
      );
    }

    const graphicsMatch = context.matchBefore(/\\includegraphics\*?(?:\[[^\]]*\])?\{[^}]*$/);
    if (graphicsMatch && index) {
      return completionFrom(
        graphicsMatch,
        index.images.map((image) => ({
          label: image,
          type: "text",
          detail: "image",
          boost: 2,
        })),
      );
    }

    const packageMatch = context.matchBefore(/\\usepackage(?:\[[^\]]*\])?\{[^}]*$/);
    if (packageMatch) {
      const used = index?.packages ?? [];
      const names = [...new Set([...used, ...commonPackages])];
      return completionFrom(
        packageMatch,
        names.map((name) => ({
          label: name,
          type: "constant",
          detail: used.includes(name) ? "used in project" : "package",
        })),
      );
    }

    const beginMatch = context.matchBefore(/\\(?:begin|end)\{[^}]*$/);
    if (beginMatch) {
      return completionFrom(
        beginMatch,
        environments.map((environment) => ({
          label: environment,
          type: "class",
          detail: "environment",
          boost: 2,
        })),
      );
    }

    const word = context.matchBefore(/\\[a-zA-Z@]*$/);
    if (!word) return null;
    if (word.text === "\\" && !context.explicit) return null;
    const typed = word.text.slice(1).toLowerCase();
    const commands = latexCommands
      .filter((command) => command.slice(1).toLowerCase().includes(typed))
      .map((command) => ({ label: command, type: "keyword", boost: 2 }));
    const envs = environments
      .filter((environment) => environment.toLowerCase().includes(typed))
      .map((environment) => ({
        label: `\\begin{${environment}}`,
        type: "class",
        detail: "environment",
        apply: `\\begin{${environment}}\n\t\n\\end{${environment}}`,
      }));
    return { from: word.from, options: [...commands, ...envs].slice(0, 40) };
  };
}

const latexHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.tagName, tags.processingInstruction], color: "var(--syntax-command)" },
  { tag: tags.keyword, color: "var(--syntax-section)" },
  { tag: [tags.atom, tags.variableName], color: "var(--syntax-math)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: tags.bracket, color: "var(--syntax-bracket)" },
  { tag: tags.number, color: "var(--syntax-string)" },
  { tag: tags.invalid, color: "var(--danger)", textDecoration: "underline wavy" },
]);

function editorTheme(settings: EditorSettings, dark: boolean): Extension {
  const family = settings.fontFamily.includes(",")
    ? settings.fontFamily
    : `"${settings.fontFamily}", "SF Mono", ui-monospace, Menlo, monospace`;
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--editor-bg)",
        color: "var(--text)",
        height: "100%",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: family,
        fontSize: `${settings.fontSize}px`,
        lineHeight: "1.65",
      },
      ".cm-content": {
        padding: "10px 0 40vh",
        caretColor: "var(--accent)",
      },
      ".cm-line": { padding: "0 14px 0 6px" },
      ".cm-gutters": {
        backgroundColor: "var(--editor-gutter)",
        color: "var(--text-dim)",
        borderRight: "1px solid var(--border-subtle)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--bg-hover)",
        color: "var(--text)",
      },
      ".cm-activeLine": {
        backgroundColor: dark ? "rgba(255,255,255,0.028)" : "rgba(20,40,80,0.035)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--accent-soft) !important",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent)",
        borderLeftWidth: "2px",
      },
      ".cm-panels": {
        backgroundColor: "var(--bg-panel)",
        color: "var(--text)",
      },
      ".cm-searchMatch": {
        backgroundColor: "rgba(231,162,59,0.3)",
        outline: "1px solid rgba(231,162,59,0.55)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "rgba(52,120,246,0.4)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "var(--shadow-md)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "white",
      },
      ".cm-matchingBracket": {
        backgroundColor: "var(--accent-soft)",
        outline: "1px solid var(--accent)",
      },
    },
    { dark },
  );
}

interface LatexEditorProps {
  rel: string;
  content: string;
  settings: EditorSettings;
  theme: Theme;
  index: ProjectIndex | null;
  diagnostics: Diagnostic[];
  gotoLine: number | null;
  gotoToken: number;
  onChange: (value: string) => void;
  onCursor: (line: number, column: number) => void;
  onSave: () => void;
  onCompile: () => void;
}

export function LatexEditor({
  rel,
  content,
  settings,
  theme,
  index,
  diagnostics,
  gotoLine,
  gotoToken,
  onChange,
  onCursor,
  onSave,
  onCompile,
}: LatexEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const applying = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;
  const callbacks = useRef({ onChange, onCursor, onSave, onCompile });
  callbacks.current = { onChange, onCursor, onSave, onCompile };
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const dark = theme === "dark" || (theme === "system" && systemDark);

  // biome-ignore lint/correctness/useExhaustiveDependencies: content updates are applied by the effect below
  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [
          latexSource(() => indexRef.current, rel),
          snippetCompletionSource(() => settings.snippets),
        ],
        maxRenderedOptions: 20,
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      lintGutter(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            callbacks.current.onSave();
            return true;
          },
        },
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            callbacks.current.onCompile();
            return true;
          },
        },
      ]),
      EditorState.tabSize.of(settings.tabSize),
      EditorView.contentAttributes.of({
        spellcheck: settings.spellcheck ? "true" : "false",
        autocapitalize: "off",
        autocorrect: "off",
      }),
      syntaxHighlighting(latexHighlight),
      editorTheme(settings, dark),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applying.current) {
          callbacks.current.onChange(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          callbacks.current.onCursor(line.number, head - line.from + 1);
        }
      }),
    ];
    if (settings.lineNumbers) extensions.push(lineNumbers());
    if (settings.wordWrap) extensions.push(EditorView.lineWrapping);
    if (rel.toLowerCase().endsWith(".tex")) {
      extensions.push(StreamLanguage.define(stex));
    }
    const state = EditorState.create({ doc: content, extensions });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    setActiveEditor(instance);
    instance.focus();
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    callbacks.current.onCursor(line.number, 1);
    return () => {
      if (view.current === instance) {
        setActiveEditor(null);
        view.current = null;
      }
      instance.destroy();
    };
    // Recreate only when the document identity or editor configuration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel, settings, dark]);

  useEffect(() => {
    const onHistory = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      const instance = view.current;
      if (!instance) return;
      if (action === "undo") undo(instance);
      else if (action === "redo") redo(instance);
      instance.focus();
    };
    window.addEventListener("latexstudio:edit", onHistory);
    return () => window.removeEventListener("latexstudio:edit", onHistory);
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === content) return;
    applying.current = true;
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: content },
    });
    applying.current = false;
  }, [content]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const doc = instance.state.doc;
    const lint: LintDiagnostic[] = diagnostics
      .filter((diagnostic) => diagnostic.file === rel && diagnostic.line)
      .slice(0, 200)
      .map((diagnostic) => {
        const lineNumber = Math.min(Math.max(1, diagnostic.line ?? 1), doc.lines);
        const line = doc.line(lineNumber);
        const from = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1));
        return {
          from,
          to: Math.max(from, line.to),
          severity:
            diagnostic.severity === "error"
              ? "error"
              : diagnostic.severity === "warning"
                ? "warning"
                : "info",
          message: diagnostic.message,
          source: diagnostic.code,
        };
      });
    instance.dispatch(setDiagnostics(instance.state, lint));
  }, [diagnostics, rel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the token intentionally triggers a jump
  useEffect(() => {
    const instance = view.current;
    if (!instance || !gotoLine) return;
    const lineNumber = Math.min(Math.max(1, gotoLine), instance.state.doc.lines);
    const line = instance.state.doc.line(lineNumber);
    instance.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    instance.focus();
  }, [gotoLine, gotoToken]);

  return <div className="editor-host" ref={host} />;
}
