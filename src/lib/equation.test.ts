import { describe, expect, it } from "vitest";
import { detectEquation, wrapEquation } from "./equation";

describe("equation builder", () => {
  it("detects supported math delimiters", () => {
    expect(detectEquation("$x^2$")).toMatchObject({
      body: "x^2",
      mode: "inline",
      math: true,
      replaceable: true,
    });
    expect(detectEquation("\\[\\frac{1}{2}\\]")).toMatchObject({
      body: "\\frac{1}{2}",
      mode: "display",
      math: true,
    });
    expect(detectEquation("\\begin{align}a&=b\\end{align}")).toMatchObject({
      body: "a&=b",
      mode: "align",
      math: true,
    });
  });

  it("wraps formulas in the requested environment", () => {
    expect(wrapEquation("a+b", "inline")).toBe("$a+b$");
    expect(wrapEquation("a+b", "display")).toBe("\\[\n  a+b\n\\]");
    expect(wrapEquation("a+b", "equation")).toBe("\\begin{equation}\n  a+b\n\\end{equation}");
    expect(wrapEquation("a+b", "align")).toBe("\\begin{align}\n  a+b\n\\end{align}");
  });

  it("refuses unsupported math environments instead of silently replacing them", () => {
    const result = detectEquation("\\begin{gather}a=b\\end{gather}");
    expect(result.replaceable).toBe(false);
    expect(result.math).toBe(false);
    expect(result.warning).toBe("selectionNotMath");
  });

  it("does not import arbitrary prose as formula text", () => {
    expect(detectEquation("Just some prose.")).toMatchObject({
      body: "",
      math: false,
      replaceable: true,
    });
  });
});
