import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  ExternalLink,
  FileSearch,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Scan,
  Search,
  X,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { SyncTarget } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfPreviewProps {
  onExportPdf: () => void;
}

interface PageSize {
  width: number;
  height: number;
}

interface SavedPosition {
  page: number;
  offsetRatio: number;
}

function positionKey(root: string) {
  return `latexstudio.pdfPosition.${root}`;
}

function loadSavedPosition(root: string | null | undefined): SavedPosition | null {
  if (!root) return null;
  try {
    const raw = localStorage.getItem(positionKey(root));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPosition>;
    if (!parsed || typeof parsed.page !== "number") return null;
    return {
      page: Math.max(1, Math.round(parsed.page)),
      offsetRatio: Math.min(1, Math.max(0, parsed.offsetRatio ?? 0)),
    };
  } catch {
    return null;
  }
}

function storeSavedPosition(root: string, position: SavedPosition) {
  try {
    localStorage.setItem(positionKey(root), JSON.stringify(position));
  } catch {
    // Position persistence is a convenience and must not break rendering.
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface SearchHit {
  page: number;
  preview: string;
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  scrollRoot: RefObject<HTMLDivElement | null>;
  syncTarget: SyncTarget | null;
  onSyncClick: (page: number, x: number, y: number) => void;
}

function PdfPage({
  doc,
  pageNumber,
  width,
  height,
  scale,
  scrollRoot,
  syncTarget,
  onSyncClick,
}: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(entry.isIntersecting);
      },
      {
        root: scrollRoot.current,
        rootMargin: "800px 0px",
        threshold: 0,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let cancelled = false;
    const render = async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) return;
        taskRef.current?.cancel();
        const task = page.render({ canvas, canvasContext: context, viewport });
        taskRef.current = task;
        await task.promise;
      } catch (error) {
        if (error instanceof Error && error.name === "RenderingCancelledException") return;
      }
    };
    void render();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-wrap"
      data-page={pageNumber}
      style={{
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      }}
      onClick={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onSyncClick(
          pageNumber,
          (event.clientX - rect.left) / scale,
          (event.clientY - rect.top) / scale,
        );
      }}
    >
      <canvas ref={canvasRef} />
      {syncTarget ? (
        <span
          className="pdf-sync-marker"
          style={{
            left: syncTarget.x * scale,
            top: syncTarget.y * scale,
            width: Math.max(6, syncTarget.width * scale),
            height: Math.max(3, syncTarget.height * scale),
          }}
        />
      ) : null}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

export function PdfPreview({ onExportPdf }: PdfPreviewProps) {
  const { t } = useTranslation();
  const project = useAppStore((state) => state.project);
  const pdf = useAppStore((state) => state.pdf);
  const pdfVersion = useAppStore((state) => state.pdfVersion);
  const pdfError = useAppStore((state) => state.pdfError);
  const compiling = useAppStore((state) => state.compiling);
  const build = useAppStore((state) => state.build);
  const loadPdf = useAppStore((state) => state.loadPdf);
  const toast = useAppStore((state) => state.toast);
  const settings = useAppStore((state) => state.settings);
  const activeRel = useAppStore((state) => state.activeRel);
  const activeLine = useAppStore((state) => state.activeLine);
  const syncStatus = useAppStore((state) => state.syncStatus);
  const syncTarget = useAppStore((state) => state.syncTarget);
  const syncTargetToken = useAppStore((state) => state.syncTargetToken);
  const syncLoading = useAppStore((state) => state.syncLoading);
  const forwardSync = useAppStore((state) => state.forwardSync);
  const reverseSync = useAppStore((state) => state.reverseSync);
  const clearSyncTarget = useAppStore((state) => state.clearSyncTarget);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [zoom, setZoom] = useState(settings?.pdf.defaultZoom ?? 1);
  const [fitWidth, setFitWidth] = useState(true);
  const [fitPage, setFitPage] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pageNumberRef = useRef(1);
  const restoreTargetRef = useRef<{ page: number; offsetRatio: number } | null>(null);
  const projectRootRef = useRef(project?.root ?? null);
  const lastPositionSaveRef = useRef(0);

  const data = useMemo(() => (pdf ? decodeBase64(pdf.data) : null), [pdf]);

  useEffect(() => {
    pdfDocRef.current = pdfDoc;
  }, [pdfDoc]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  // A different project starts at the saved page (when enabled); a recompile keeps the reading position.
  useEffect(() => {
    const root = project?.root ?? null;
    if (projectRootRef.current === root) return;
    const previousRoot = projectRootRef.current;
    const stage = stageRef.current;
    if (previousRoot && stage && settings?.pdf.rememberPosition) {
      const page = stage.querySelector<HTMLElement>(
        `.pdf-page-wrap[data-page="${pageNumberRef.current}"]`,
      );
      if (page) {
        const stageRect = stage.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const hiddenAbove = Math.min(pageRect.height, Math.max(0, stageRect.top - pageRect.top));
        storeSavedPosition(previousRoot, {
          page: pageNumberRef.current,
          offsetRatio: pageRect.height > 0 ? hiddenAbove / pageRect.height : 0,
        });
      }
    }
    projectRootRef.current = root;
    const saved = root && settings?.pdf.rememberPosition ? loadSavedPosition(root) : null;
    restoreTargetRef.current = saved;
    setPageNumber(saved?.page ?? 1);
    setPageInput(String(saved?.page ?? 1));
  }, [project?.root, settings?.pdf.rememberPosition]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // clientWidth is stable because the stage always reserves its scrollbar gutter.
      const next = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      setContainerWidth((current) => (Math.abs(current - next) >= 2 ? next : current));
      setContainerHeight((current) => (Math.abs(current - height) >= 2 ? height : current));
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pdfVersion forces a reload of identical data
  useEffect(() => {
    if (!data) {
      restoreTargetRef.current = null;
      setPdfDoc(null);
      setPageSize(null);
      return;
    }
    const stage = stageRef.current;
    const previousDoc = pdfDocRef.current;
    if (previousDoc && stage) {
      const page = stage.querySelector<HTMLElement>(
        `.pdf-page-wrap[data-page="${pageNumberRef.current}"]`,
      );
      let offsetRatio = 0;
      if (page) {
        const stageRect = stage.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const hiddenAbove = Math.min(pageRect.height, Math.max(0, stageRect.top - pageRect.top));
        offsetRatio = pageRect.height > 0 ? hiddenAbove / pageRect.height : 0;
      }
      restoreTargetRef.current = { page: pageNumberRef.current, offsetRatio };
    } else {
      const saved =
        projectRootRef.current && settings?.pdf.rememberPosition
          ? loadSavedPosition(projectRootRef.current)
          : null;
      restoreTargetRef.current = saved;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPageSize(null);
    setPdfDoc(null);
    const task = pdfjs.getDocument({ data: data.slice(), useSystemFonts: true });
    task.promise
      .then(async (doc) => {
        if (cancelled) {
          void task.destroy();
          return;
        }
        const firstPage = await doc.getPage(1);
        if (cancelled) {
          void task.destroy();
          return;
        }
        const viewport = firstPage.getViewport({ scale: 1 });
        const target = restoreTargetRef.current;
        const nextPage = Math.min(Math.max(1, target?.page ?? 1), doc.numPages);
        if (target) restoreTargetRef.current = { ...target, page: nextPage };
        setPdfDoc(doc);
        setPageSize({ width: viewport.width, height: viewport.height });
        setPageNumber(nextPage);
        setPageInput(String(nextPage));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      void task.destroy();
      setPdfDoc(null);
    };
    // pdfVersion forces a reload even when the base64 payload is identical.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pdfVersion]);

  const totalPages = pdfDoc?.numPages ?? 0;

  const availableWidth = Math.max(260, (containerWidth || 600) - 40);
  const availableHeight = Math.max(260, (containerHeight || 700) - 40);
  const fitZoom = pageSize ? Math.max(0.2, availableWidth / pageSize.width) : 1;
  const fitPageZoom = pageSize
    ? Math.max(0.2, Math.min(fitZoom, availableHeight / pageSize.height))
    : 1;
  const effectiveZoom = fitPage ? fitPageZoom : fitWidth ? fitZoom : zoom;
  const displayZoom = effectiveZoom;

  useEffect(() => {
    if (!pdfDoc) return;
    if (pageNumber > pdfDoc.numPages) {
      setPageNumber(pdfDoc.numPages || 1);
      setPageInput(String(pdfDoc.numPages || 1));
    }
  }, [pdfDoc, pageNumber]);

  // Track which page is currently in view while the user scrolls continuously.
  useEffect(() => {
    if (!pdfDoc || !pageSize) return;
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // The scroll container is temporarily reset while a recompiled PDF loads.
      // Do not overwrite the page we are about to restore.
      if (restoreTargetRef.current) return;
      const pages = stage.querySelectorAll<HTMLElement>(".pdf-page-wrap[data-page]");
      if (!pages.length) return;
      const stageRect = stage.getBoundingClientRect();
      const anchor = stageRect.top + Math.min(stageRect.height * 0.35, 190);
      let containing: number | null = null;
      let nearest = 1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const page of pages) {
        const rect = page.getBoundingClientRect();
        const value = Number.parseInt(page.dataset.page ?? "1", 10);
        if (rect.top <= anchor && rect.bottom >= anchor) containing = value;
        const distance = Math.abs(rect.top + rect.height / 2 - anchor);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = value;
        }
      }
      const next = containing ?? nearest;
      setPageNumber((current) => (current === next ? current : next));
      if (settings?.pdf.rememberPosition && projectRootRef.current) {
        const now = Date.now();
        if (now - lastPositionSaveRef.current >= 500) {
          lastPositionSaveRef.current = now;
          const currentPage = stage.querySelector<HTMLElement>(
            `.pdf-page-wrap[data-page="${next}"]`,
          );
          let offsetRatio = 0;
          if (currentPage) {
            const pageRect = currentPage.getBoundingClientRect();
            const hiddenAbove = Math.min(
              pageRect.height,
              Math.max(0, stageRect.top - pageRect.top),
            );
            offsetRatio = pageRect.height > 0 ? hiddenAbove / pageRect.height : 0;
          }
          storeSavedPosition(projectRootRef.current, { page: next, offsetRatio });
        }
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      stage.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pdfDoc, pageSize, settings?.pdf.rememberPosition]);

  // Recompiles replace the PDF document. Restore both the page and the
  // position inside that page once the new page wrappers are mounted.
  useEffect(() => {
    if (!pdfDoc || !pageSize) return;
    const target = restoreTargetRef.current;
    if (!target) return;
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      const stage = stageRef.current;
      const page = stage?.querySelector<HTMLElement>(`.pdf-page-wrap[data-page="${target.page}"]`);
      if (!stage || !page) {
        attempts += 1;
        if (attempts <= 12) {
          frame = requestAnimationFrame(restore);
        } else {
          restoreTargetRef.current = null;
        }
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const pageTop = stage.scrollTop + (pageRect.top - stageRect.top);
      const offset = pageRect.height * target.offsetRatio;
      stage.scrollTo({ top: Math.max(0, pageTop + offset), behavior: "auto" });
      setPageNumber(target.page);
      setPageInput(String(target.page));
      restoreTargetRef.current = null;
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [pdfDoc, pageSize]);

  useEffect(() => {
    if (window.document.activeElement !== pageInputRef.current) {
      setPageInput(String(pageNumber));
    }
  }, [pageNumber]);

  // SyncTeX forward: scroll the exact box reported by the compiler into view
  // and keep a short-lived marker on it so the target is visible.
  useEffect(() => {
    if (!syncTarget || !syncTargetToken || !pdfDoc || !pageSize) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      const stage = stageRef.current;
      const page = stage?.querySelector<HTMLElement>(
        `.pdf-page-wrap[data-page="${syncTarget.page}"]`,
      );
      if (!stage || !page) {
        attempts += 1;
        if (attempts <= 12) frame = requestAnimationFrame(reveal);
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const pageTop = stage.scrollTop + (pageRect.top - stageRect.top);
      stage.scrollTo({
        top: Math.max(0, pageTop + syncTarget.y * effectiveZoom - 100),
        behavior: "auto",
      });
      setPageNumber(syncTarget.page);
      setPageInput(String(syncTarget.page));
    };
    frame = requestAnimationFrame(reveal);
    const timer = window.setTimeout(() => clearSyncTarget(), 5000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [syncTarget, syncTargetToken, pdfDoc, pageSize, effectiveZoom, clearSyncTarget]);

  const goToPage = useCallback(
    (next: number) => {
      if (!pdfDoc) return;
      const value = Math.min(Math.max(1, Math.round(next)), pdfDoc.numPages);
      setPageNumber(value);
      const stage = stageRef.current;
      const page = stage?.querySelector<HTMLElement>(`.pdf-page-wrap[data-page="${value}"]`);
      if (stage && page) {
        const stageRect = stage.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const top = stage.scrollTop + (pageRect.top - stageRect.top) - 14;
        stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      }
    },
    [pdfDoc],
  );

  const runSearch = useCallback(
    async (term: string) => {
      if (!pdfDoc || term.trim().length < 2) {
        setHits([]);
        return;
      }
      setSearching(true);
      const found: SearchHit[] = [];
      const needle = term.toLowerCase();
      try {
        for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex += 1) {
          const page = await pdfDoc.getPage(pageIndex);
          const text = await page.getTextContent();
          const content = text.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ");
          const index = content.toLowerCase().indexOf(needle);
          if (index >= 0) {
            found.push({
              page: pageIndex,
              preview: content.slice(Math.max(0, index - 40), index + term.length + 60),
            });
          }
          if (found.length >= 300) break;
        }
      } finally {
        setHits(found);
        setSearching(false);
      }
    },
    [pdfDoc],
  );

  useEffect(() => {
    if (!searchOpen) return;
    const timer = setTimeout(() => void runSearch(query), 240);
    return () => clearTimeout(timer);
  }, [query, searchOpen, runSearch]);

  const zoomBy = (delta: number) => {
    setFitWidth(false);
    setFitPage(false);
    setZoom(Math.min(4, Math.max(0.25, Math.round((displayZoom + delta) * 100) / 100)));
  };

  const toggleFitWidth = () => {
    if (fitWidth) {
      setZoom(effectiveZoom);
      setFitWidth(false);
    } else {
      setFitPage(false);
      setFitWidth(true);
    }
  };

  const toggleFitPage = () => {
    if (fitPage) {
      setZoom(effectiveZoom);
      setFitPage(false);
    } else {
      setFitWidth(false);
      setFitPage(true);
    }
  };

  const revealPdf = () => {
    if (!project) return;
    void api.revealProject(project.root).catch(() => {
      toast(t("errors.generic"), "error");
    });
  };

  const pages = useMemo(() => {
    if (!pdfDoc || !pageSize) return [];
    return Array.from({ length: pdfDoc.numPages }, (_, index) => index + 1);
  }, [pdfDoc, pageSize]);

  return (
    <section className="pdf-panel">
      <div className="pdf-toolbar">
        <span className="pdf-title">
          <FileSearch size={13} />
          {t("pdf.title")}
        </span>
        <div className="toolbar-sep" />
        <button
          type="button"
          className="icon-button"
          disabled={!pdfDoc || pageNumber <= 1}
          onClick={() => goToPage(pageNumber - 1)}
          title={t("pdf.previousPage")}
        >
          <ChevronLeft size={14} />
        </button>
        <input
          ref={pageInputRef}
          className="pdf-page-input"
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const value = Number.parseInt(pageInput, 10);
              if (Number.isFinite(value)) goToPage(value);
              else setPageInput(String(pageNumber));
            }
          }}
          disabled={!pdfDoc}
          aria-label={t("pdf.page")}
        />
        <span className="pdf-page-total">/ {totalPages || "—"}</span>
        <button
          type="button"
          className="icon-button"
          disabled={!pdfDoc || pageNumber >= totalPages}
          onClick={() => goToPage(pageNumber + 1)}
          title={t("pdf.nextPage")}
        >
          <ChevronRight size={14} />
        </button>

        <div className="toolbar-sep" />

        <button
          type="button"
          className="icon-button"
          onClick={() => zoomBy(-0.1)}
          disabled={!pdfDoc}
          title={t("pdf.zoomOut")}
        >
          <Minus size={13} />
        </button>
        <span className="pdf-zoom-label">{Math.round(displayZoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => zoomBy(0.1)}
          disabled={!pdfDoc}
          title={t("pdf.zoomIn")}
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className={`icon-button ${fitWidth ? "active" : ""}`}
          onClick={toggleFitWidth}
          disabled={!pdfDoc}
          title={t("pdf.fitWidth")}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className={`icon-button ${fitPage ? "active" : ""}`}
          onClick={toggleFitPage}
          disabled={!pdfDoc}
          title={t("pdf.fitPage")}
        >
          <Scan size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setFitWidth(false);
            setFitPage(false);
            setZoom(1);
          }}
          disabled={!pdfDoc}
          title={t("pdf.actualSize")}
          style={{ width: 30, fontSize: 9.5, fontWeight: 700 }}
        >
          1:1
        </button>

        <div className="pdf-toolbar-spacer" />

        <div className="pdf-search-wrap">
          <button
            type="button"
            className={`icon-button ${searchOpen ? "active" : ""}`}
            title={t("pdf.search")}
            onClick={() => setSearchOpen((current) => !current)}
            disabled={!pdfDoc}
          >
            <Search size={13} />
          </button>
          {searchOpen ? (
            <div className="pdf-search-pop">
              <div className="search-box">
                <Search size={12} />
                <input
                  autoFocus
                  value={query}
                  placeholder={t("pdf.searchPlaceholder")}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearchOpen(false);
                    if (event.key === "Enter") void runSearch(query);
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  style={{ width: 18, height: 18 }}
                  onClick={() => setSearchOpen(false)}
                >
                  <X size={11} />
                </button>
              </div>
              <div className="pdf-search-count">
                {searching
                  ? t("pdf.rendering")
                  : query.trim().length < 2
                    ? t("pdf.search")
                    : hits.length === 0
                      ? t("pdf.searchNoResults")
                      : t("pdf.searchResults", { count: hits.length })}
              </div>
              <div style={{ maxHeight: 180, overflow: "auto", marginTop: 4 }}>
                {hits.slice(0, 40).map((hit, index) => (
                  <button
                    type="button"
                    key={`${hit.page}-${index}`}
                    className="search-result"
                    onClick={() => {
                      goToPage(hit.page);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="line" style={{ minWidth: 22 }}>
                      {hit.page}
                    </span>
                    <span className="preview">{hit.preview}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={`icon-button ${syncStatus?.available ? "active" : ""}`}
          onClick={() => {
            if (activeRel && activeLine) {
              void forwardSync(activeRel, activeLine);
            } else {
              toast(t("sync.noCursor"), "info");
            }
          }}
          disabled={!project || syncLoading}
          title={t("sync.forwardHint")}
        >
          <Crosshair size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void loadPdf()}
          disabled={!project}
          title={t("pdf.refresh")}
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={revealPdf}
          disabled={!project}
          title={t("pdf.share")}
        >
          <ExternalLink size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onExportPdf}
          disabled={!pdf}
          title={t("pdf.download")}
        >
          <Download size={13} />
        </button>
      </div>

      {build && !build.success && pdf ? (
        <div className="stale-banner" title={t("pdf.staleHint")}>
          <span className="status-dot" style={{ background: "var(--warning)" }} />
          {t("pdf.stale")}
        </div>
      ) : null}

      <div className="pdf-stage" ref={stageRef}>
        {pdf ? (
          <>
            {loading ? (
              <div className="pdf-status">
                <span className="spinner" />
                <span>{t("pdf.rendering")}</span>
              </div>
            ) : null}
            {loadError ? (
              <div className="pdf-status error">
                <span>{t("pdf.loadFailed")}</span>
                <span className="dim mono" style={{ fontSize: 10 }}>
                  {loadError}
                </span>
              </div>
            ) : null}
            {pages.length > 0 && pageSize ? (
              <div className="pdf-pages">
                {pages.map((number) => (
                  <PdfPage
                    key={number}
                    doc={pdfDoc as PDFDocumentProxy}
                    pageNumber={number}
                    width={pageSize.width}
                    height={pageSize.height}
                    scale={effectiveZoom}
                    scrollRoot={stageRef}
                    syncTarget={syncTarget && syncTarget.page === number ? syncTarget : null}
                    onSyncClick={(page, x, y) => {
                      void reverseSync(page, x, y);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="pdf-overlay" style={{ position: "static", minHeight: 260 }}>
            {compiling ? (
              <>
                <span className="spinner large" />
                <span>{t("pdf.compiling")}</span>
              </>
            ) : pdfError ? (
              <span>{pdfError}</span>
            ) : (
              <>
                <FileSearch size={26} />
                <strong style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {t("pdf.empty")}
                </strong>
                <span style={{ maxWidth: 220, fontSize: 11 }}>{t("pdf.emptyHint")}</span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
