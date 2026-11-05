export const SHORTCUT_ACTIONS = [
  "save",
  "compile",
  "palette",
  "export",
  "sync",
  "stats",
  "focus",
  "history",
  "equation",
  "table",
  "newProject",
  "openProject",
  "settings",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type Shortcuts = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  save: "Mod+S",
  compile: "Mod+Enter",
  palette: "Mod+K",
  export: "Mod+Shift+E",
  sync: "Mod+Shift+J",
  stats: "Mod+Shift+I",
  focus: "Mod+Shift+F",
  history: "Mod+Shift+H",
  equation: "Mod+Shift+M",
  table: "Mod+Shift+T",
  newProject: "Mod+N",
  openProject: "Mod+O",
  settings: "Mod+,",
};

const STORAGE_KEY = "latexstudio.shortcuts";

export function loadShortcuts(): Shortcuts {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SHORTCUTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<Shortcuts>;
    const result = { ...DEFAULT_SHORTCUTS };
    for (const action of SHORTCUT_ACTIONS) {
      const value = parsed[action];
      if (typeof value === "string" && normalizeShortcut(value)) result[action] = value.trim();
    }
    return result;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function saveShortcuts(shortcuts: Shortcuts) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
  } catch {
    // Shortcuts are a convenience; storage failures should not break settings.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("latexstudio:shortcuts"));
  }
}

export function normalizeShortcut(value: string): string | null {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  if (!key || key.length > 12) return null;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  if (modifiers.size !== parts.length - 1) return null;
  if ([...modifiers].some((part) => !["mod", "ctrl", "alt", "shift"].includes(part))) return null;
  if (![...modifiers].includes("mod") && ![...modifiers].includes("ctrl")) return null;
  return parts
    .map((part, index) => (index === parts.length - 1 ? part : part.toLowerCase()))
    .join("+");
}

function eventKey(value: string) {
  const key = value.trim().toLowerCase();
  if (key === "space") return " ";
  if (key === "comma") return ",";
  return key;
}

export function shortcutMatches(event: KeyboardEvent, shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = eventKey(parts[parts.length - 1] ?? "");
  if (!key || eventKey(event.key) !== key) return false;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const wantsMeta = modifiers.has("mod") && isMac;
  const wantsCtrl = modifiers.has("ctrl") || (modifiers.has("mod") && !isMac);
  return (
    event.metaKey === wantsMeta &&
    event.ctrlKey === wantsCtrl &&
    event.altKey === modifiers.has("alt") &&
    event.shiftKey === modifiers.has("shift")
  );
}

export function actionForEvent(event: KeyboardEvent, shortcuts: Shortcuts): ShortcutAction | null {
  for (const action of SHORTCUT_ACTIONS) {
    if (shortcutMatches(event, shortcuts[action])) return action;
  }
  return null;
}

export function shortcutLabel(value: string) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return value
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "mod") return isMac ? "⌘" : "Ctrl";
      if (lower === "ctrl") return isMac ? "⌃" : "Ctrl";
      if (lower === "alt") return isMac ? "⌥" : "Alt";
      if (lower === "shift") return isMac ? "⇧" : "Shift";
      if (lower === "enter") return "↵";
      if (lower === "comma" || lower === ",") return ",";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("");
}
