import type { EditorView } from "@codemirror/view";

let activeView: EditorView | null = null;

export interface EditorSelection {
  from: number;
  to: number;
  text: string;
}

export function setActiveEditor(view: EditorView | null) {
  activeView = view;
}

export function getActiveEditor(): EditorView | null {
  return activeView;
}

export function getEditorSelection(): EditorSelection | null {
  const view = activeView;
  if (!view) return null;
  const range = view.state.selection.main;
  return {
    from: range.from,
    to: range.to,
    text: view.state.sliceDoc(range.from, range.to),
  };
}

export function replaceEditorSelection(text: string) {
  const view = activeView;
  if (!view) return false;
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function insertEditorText(text: string) {
  const view = activeView;
  if (!view) return false;
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Returns the selected text plus a little surrounding context for parsers. */
export function getSelectionWithContext(radius = 400): EditorSelection | null {
  const view = activeView;
  if (!view) return null;
  const range = view.state.selection.main;
  const from = Math.max(0, range.from - radius);
  const to = Math.min(view.state.doc.length, range.to + radius);
  return {
    from,
    to,
    text: view.state.sliceDoc(from, to),
  };
}
