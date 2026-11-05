export type WrapMode = "inline" | "display" | "equation" | "align";

export interface EquationInfo {
  body: string;
  mode: WrapMode;
  replaceable: boolean;
  math: boolean;
  warning: string | null;
}

export function detectEquation(text: string): EquationInfo {
  const trimmed = text.trim();
  if (!trimmed) {
    return { body: "", mode: "display", replaceable: true, math: false, warning: null };
  }
  const env = trimmed.match(/^\\begin\{(equation|align)\}([\s\S]*?)\\end\{\1\}$/);
  if (env) {
    const mode: WrapMode = env[1] === "align" ? "align" : "equation";
    return { body: env[2].trim(), mode, replaceable: true, math: true, warning: null };
  }
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
    return {
      body: trimmed.slice(2, -2).trim(),
      mode: "display",
      replaceable: true,
      math: true,
      warning: null,
    };
  }
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) {
    return {
      body: trimmed.slice(2, -2).trim(),
      mode: "display",
      replaceable: true,
      math: true,
      warning: null,
    };
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2) {
    return {
      body: trimmed.slice(1, -1).trim(),
      mode: "inline",
      replaceable: true,
      math: true,
      warning: null,
    };
  }
  if (/\\begin\{/.test(trimmed)) {
    return {
      body: "",
      mode: "display",
      replaceable: false,
      math: false,
      warning: "selectionNotMath",
    };
  }
  // A non-math selection is not imported into the builder: replacing it by default
  // would silently destroy prose. The user can still opt in via the checkbox.
  return { body: "", mode: "display", replaceable: true, math: false, warning: null };
}

export function wrapEquation(body: string, mode: WrapMode) {
  const value = body.trim();
  if (mode === "inline") return `$${value}$`;
  if (mode === "display") return `\\[\n  ${value}\n\\]`;
  if (mode === "align") return `\\begin{align}\n  ${value}\n\\end{align}`;
  return `\\begin{equation}\n  ${value}\n\\end{equation}`;
}
