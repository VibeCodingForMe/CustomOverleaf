import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, loadShortcuts, normalizeShortcut, shortcutLabel } from "./shortcuts";

describe("shortcuts", () => {
  it("normalizes modifiers and keys", () => {
    expect(normalizeShortcut("Mod+Shift+E")).toBe("mod+shift+E");
    expect(normalizeShortcut(" ctrl + alt + delete ")).toBe("ctrl+alt+delete");
    expect(normalizeShortcut("Mod+,")).toBe("mod+,");
  });

  it("rejects shortcuts without a primary modifier or with duplicates", () => {
    expect(normalizeShortcut("S")).toBeNull();
    expect(normalizeShortcut("Shift+S")).toBeNull();
    expect(normalizeShortcut("Mod+Mod+S")).toBeNull();
    expect(normalizeShortcut("Mod+Hyper+S")).toBeNull();
    expect(normalizeShortcut("Mod+")).toBeNull();
  });

  it("returns defaults when storage is unavailable", () => {
    expect(loadShortcuts()).toEqual(DEFAULT_SHORTCUTS);
  });

  it("renders readable labels", () => {
    expect(shortcutLabel("Mod+Shift+J")).toMatch(/J$/);
    expect(shortcutLabel("Mod+Enter")).toMatch(/↵$/);
  });
});
