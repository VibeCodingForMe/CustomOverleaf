import { describe, expect, it } from "vitest";
import { detect, generate } from "./TableEditorModal";

describe("table editor generation", () => {
  it("parses an existing tabular and preserves its alignment", () => {
    const table = detect("\\begin{tabular}{lcr}\nA & B & C \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}");
    expect(table.matched).toBe(true);
    expect(table.replaceable).toBe(true);
    expect(table.cols).toBe(3);
    expect(table.aligns).toEqual(["l", "c", "r"]);
    expect(table.rows[1][2]?.text).toBe("3");
  });

  it("generates a captioned tabular float with booktabs rules", () => {
    const table = detect("");
    table.caption = "Results";
    table.label = "tab:results";
    table.rows[0][0]!.text = "Name";
    table.rows[0][1]!.text = "Value";
    table.rows[1][0]!.text = "A & B";
    table.rows[1][1]!.text = "42";
    const source = generate(table, true);
    expect(source).toContain("\\begin{table}[htbp]");
    expect(source).toContain("\\caption{Results}");
    expect(source).toContain("\\label{tab:results}");
    expect(source).toContain("\\begin{tabular}{lcr}");
    expect(source).toContain("\\toprule");
    expect(source).toContain("\\midrule");
    expect(source).toContain("A \\& B & 42 &  \\\\");
    expect(source).toContain("\\bottomrule");
  });

  it("generates longtable captions in the table body", () => {
    const table = detect("");
    table.environment = "longtable";
    table.caption = "Long";
    table.label = "tab:long";
    const source = generate(table, false);
    expect(source).toMatch(/\\begin\{longtable\}\{lcr\}/);
    expect(source).toContain("\\caption{Long}\\label{tab:long}\\\\");
    expect(source).toContain("\\end{longtable}");
  });

  it("does not mark unsupported environments as replaceable", () => {
    const table = detect("\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}");
    expect(table.matched).toBe(false);
    expect(table.replaceable).toBe(false);
    expect(table.warning).toBe("selectionNotTable");
  });
});
