import { open, save } from "@tauri-apps/plugin-dialog";
import type { ExportFormat } from "../types";

const projectFilters = [{ name: "LaTeX project", extensions: ["tex", "bib", "sty", "cls"] }];

export async function pickProjectFolder(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

export async function pickProjectFile(title: string): Promise<string | null> {
  const result = await open({ directory: false, multiple: false, title, filters: projectFilters });
  return typeof result === "string" ? result : null;
}

export async function pickImportPaths(title: string): Promise<string[]> {
  const result = await open({ directory: false, multiple: true, title });
  if (Array.isArray(result)) return result;
  return typeof result === "string" ? [result] : [];
}

const exportFilters: Record<ExportFormat, { name: string; extensions: string[] }> = {
  pdf: { name: "PDF", extensions: ["pdf"] },
  tex: { name: "LaTeX source", extensions: ["tex"] },
  zip: { name: "ZIP archive", extensions: ["zip"] },
  docx: { name: "Word document", extensions: ["docx"] },
  html: { name: "HTML document", extensions: ["html"] },
  odt: { name: "OpenDocument text", extensions: ["odt"] },
  epub: { name: "EPUB book", extensions: ["epub"] },
  markdown: { name: "Markdown", extensions: ["md", "markdown"] },
};

export async function pickExportDestination(
  format: ExportFormat,
  defaultName: string,
  title: string,
): Promise<string | null> {
  const filter = exportFilters[format];
  const result = await save({ defaultPath: defaultName, title, filters: [filter] });
  return typeof result === "string" ? result : null;
}
