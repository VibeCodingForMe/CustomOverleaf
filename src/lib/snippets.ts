import {
  type CompletionContext,
  type CompletionResult,
  snippet,
  snippetCompletion,
} from "@codemirror/autocomplete";

export interface LatexSnippet {
  id: string;
  label: string;
  detail: string;
  description: string;
  template: string;
  plain: string;
}

export const latexSnippets: LatexSnippet[] = [
  {
    id: "section",
    label: "section",
    detail: "Section",
    description: "Section with a short title",
    template: "\\section{${title}}\n${#0}",
    plain: "\\section{Section title}\n",
  },
  {
    id: "subsection",
    label: "subsection",
    detail: "Subsection",
    description: "Subsection with a short title",
    template: "\\subsection{${title}}\n${#0}",
    plain: "\\subsection{Subsection title}\n",
  },
  {
    id: "figure",
    label: "figure",
    detail: "Figure",
    description: "Centered figure with caption and label",
    template:
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${file}}\n  \\caption{${caption}}\n  \\label{fig:${label}}\n\\end{figure}\n${#0}",
    plain:
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{image.png}\n  \\caption{Caption}\n  \\label{fig:label}\n\\end{figure}\n",
  },
  {
    id: "table",
    label: "table",
    detail: "Table",
    description: "Booktabs table with caption and label",
    template:
      "\\begin{table}[htbp]\n  \\centering\n  \\caption{${caption}}\n  \\label{tab:${label}}\n  \\begin{tabular}{${columns}}\n    \\toprule\n    ${header} \\\\\n    \\midrule\n    ${row} \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n${#0}",
    plain:
      "\\begin{table}[htbp]\n  \\centering\n  \\caption{Caption}\n  \\label{tab:label}\n  \\begin{tabular}{ll}\n    \\toprule\n    Header 1 & Header 2 \\\\\n    \\midrule\n    Cell 1 & Cell 2 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n",
  },
  {
    id: "equation",
    label: "equation",
    detail: "Equation",
    description: "Numbered display equation",
    template: "\\begin{equation}\n  ${formula}\n  \\label{eq:${label}}\n\\end{equation}\n${#0}",
    plain: "\\begin{equation}\n  E = mc^2\n  \\label{eq:label}\n\\end{equation}\n",
  },
  {
    id: "align",
    label: "align",
    detail: "Aligned equations",
    description: "Aligned display equations",
    template:
      "\\begin{align}\n  ${left} &= ${right} \\\\\n  ${left2} &= ${right2}\n\\end{align}\n${#0}",
    plain: "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\n",
  },
  {
    id: "matrix",
    label: "matrix",
    detail: "Matrix",
    description: "Parenthesized matrix",
    template: "\\begin{pmatrix}\n  ${a} & ${b} \\\\\n  ${c} & ${d}\n\\end{pmatrix}${#0}",
    plain: "\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}",
  },
  {
    id: "itemize",
    label: "itemize",
    detail: "Bullet list",
    description: "Bullet list with two items",
    template: "\\begin{itemize}\n  \\item ${first}\n  \\item ${second}\n\\end{itemize}\n${#0}",
    plain: "\\begin{itemize}\n  \\item First item\n  \\item Second item\n\\end{itemize}\n",
  },
  {
    id: "enumerate",
    label: "enumerate",
    detail: "Numbered list",
    description: "Numbered list with two items",
    template: "\\begin{enumerate}\n  \\item ${first}\n  \\item ${second}\n\\end{enumerate}\n${#0}",
    plain: "\\begin{enumerate}\n  \\item First item\n  \\item Second item\n\\end{enumerate}\n",
  },
  {
    id: "ref",
    label: "ref",
    detail: "Reference",
    description: "Reference a label",
    template: "\\ref{${label}}${#0}",
    plain: "\\ref{label}",
  },
  {
    id: "cite",
    label: "cite",
    detail: "Citation",
    description: "Cite a bibliography entry",
    template: "\\cite{${key}}${#0}",
    plain: "\\cite{key}",
  },
  {
    id: "bibliography",
    label: "bibliography",
    detail: "Bibliography",
    description: "BibTeX bibliography block",
    template: "\\bibliographystyle{plain}\n\\bibliography{${file}}\n${#0}",
    plain: "\\bibliographystyle{plain}\n\\bibliography{references}\n",
  },
  {
    id: "biblatex",
    label: "printbibliography",
    detail: "BibLaTeX",
    description: "BibLaTeX resource and print block",
    template: "\\addbibresource{${file}.bib}\n\\printbibliography\n${#0}",
    plain: "\\addbibresource{references.bib}\n\\printbibliography\n",
  },
  {
    id: "theorem",
    label: "theorem",
    detail: "Theorem",
    description: "Theorem environment",
    template: "\\begin{theorem}\n  ${statement}\n\\end{theorem}\n${#0}",
    plain: "\\begin{theorem}\n  Statement.\n\\end{theorem}\n",
  },
];

export function snippetCompletionSource(
  getEnabled: () => boolean,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    if (!getEnabled()) return null;
    const word = context.matchBefore(/\\?[a-zA-Z@]*$/);
    if (!word || (word.text === "" && !context.explicit)) return null;
    const typed = word.text.replace(/^\\/, "").toLowerCase();
    if (!typed) return null;
    const options = latexSnippets
      .filter(
        (item) =>
          item.label.toLowerCase().startsWith(typed) || item.label.toLowerCase().includes(typed),
      )
      .map((item) =>
        snippetCompletion(item.template, {
          label: `\\${item.label}`,
          detail: item.detail,
          info: item.description,
          type: "snippet",
          boost: 4,
        }),
      );
    if (!options.length) return null;
    return { from: word.from, options, validFor: /^\\?[a-zA-Z@]*$/ };
  };
}

export function plainSnippet(id: string): string {
  return latexSnippets.find((item) => item.id === id)?.plain ?? "";
}

export function snippetById(id: string): LatexSnippet | undefined {
  return latexSnippets.find((item) => item.id === id);
}

/** Converts a snippet template to a plain insertion with sensible defaults. */
export function expandSnippet(template: string): string {
  return template
    .replace(/\$\{#[^}]*\}/g, "")
    .replace(/\$\{([^}]*)\}/g, (_match, name: string) => name)
    .replace(/\\\$/g, "$");
}

export { snippet };
