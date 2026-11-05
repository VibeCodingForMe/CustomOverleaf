import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { ActivityRail } from "./ActivityRail";
import { BottomPanel } from "./BottomPanel";
import { EditorPane } from "./EditorPane";
import { FileTree } from "./FileTree";
import { HistoryDock } from "./HistoryDock";
import { HistoryRail } from "./HistoryRail";
import { OutlineView } from "./OutlineView";
import { PdfPreview } from "./PdfPreview";
import { SearchView } from "./SearchView";

interface WorkspaceProps {
  onExportPdf: () => void;
}

type DragKind = "files" | "pdf" | "panel" | "history" | null;

export function Workspace({ onExportPdf }: WorkspaceProps) {
  const panelOpen = useAppStore((state) => state.panelOpen);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const panelHeight = useAppStore((state) => state.panelHeight);
  const setPanelHeight = useAppStore((state) => state.setPanelHeight);
  const sidebarView = useAppStore((state) => state.sidebarView);
  const historyOpen = useAppStore((state) => state.historyOpen);

  const [fileWidth, setFileWidth] = useState(() => {
    const saved = Number(localStorage.getItem("latexstudio.fileWidth"));
    return Number.isFinite(saved) && saved > 0 ? saved : 250;
  });
  const [pdfWidth, setPdfWidth] = useState(() => {
    const saved = Number(localStorage.getItem("latexstudio.pdfWidth"));
    return Number.isFinite(saved) && saved > 0 ? saved : 520;
  });
  const [historyWidth, setHistoryWidth] = useState(() => {
    const saved = Number(localStorage.getItem("latexstudio.historyWidth"));
    return Number.isFinite(saved) && saved > 0 ? saved : 300;
  });
  const [dragging, setDragging] = useState<DragKind>(null);
  const drag = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem("latexstudio.fileWidth", String(fileWidth));
  }, [fileWidth]);

  useEffect(() => {
    localStorage.setItem("latexstudio.pdfWidth", String(pdfWidth));
  }, [pdfWidth]);

  useEffect(() => {
    localStorage.setItem("latexstudio.historyWidth", String(historyWidth));
  }, [historyWidth]);

  const startDrag = useCallback(
    (kind: Exclude<DragKind, null>, event: React.PointerEvent) => {
      event.preventDefault();
      drag.current = {
        kind,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: kind === "files" ? fileWidth : kind === "history" ? historyWidth : pdfWidth,
        startHeight: panelHeight,
      };
      setDragging(kind);
      document.body.style.cursor = kind === "panel" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [fileWidth, historyWidth, panelHeight, pdfWidth],
  );

  useEffect(() => {
    const fitNarrowWindow = () => {
      const width = window.innerWidth;
      if (width >= 1180) return;
      setFileWidth((value) => Math.min(value, 210));
      setHistoryWidth((value) => Math.min(value, Math.max(220, Math.round(width * 0.22))));
      setPdfWidth((value) => Math.max(260, Math.min(value, Math.round(width * 0.3))));
    };
    fitNarrowWindow();
    window.addEventListener("resize", fitNarrowWindow);
    return () => window.removeEventListener("resize", fitNarrowWindow);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      if (current.kind === "files") {
        setFileWidth(
          Math.max(180, Math.min(430, current.startWidth + event.clientX - current.startX)),
        );
      } else if (current.kind === "pdf") {
        const max = Math.max(320, window.innerWidth - fileWidth - 380);
        setPdfWidth(
          Math.max(280, Math.min(max, current.startWidth - (event.clientX - current.startX))),
        );
      } else if (current.kind === "history") {
        const max = Math.max(260, window.innerWidth - fileWidth - 380);
        setHistoryWidth(
          Math.max(240, Math.min(max, current.startWidth - (event.clientX - current.startX))),
        );
      } else if (current.kind === "panel") {
        setPanelHeight(
          Math.max(
            120,
            Math.min(
              window.innerHeight * 0.68,
              current.startHeight - (event.clientY - current.startY),
            ),
          ),
        );
      }
    };
    const onUp = () => {
      drag.current = null;
      setDragging(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, fileWidth, setPanelHeight]);

  return (
    <div className="workspace">
      <ActivityRail />
      <div
        className="sidebar-shell"
        style={{ width: fileWidth, flex: "0 0 auto", display: "flex", minWidth: 0 }}
      >
        {sidebarView === "search" ? (
          <SearchView />
        ) : sidebarView === "outline" ? (
          <OutlineView />
        ) : (
          <FileTree />
        )}
      </div>
      <div
        className={`resizer-vertical ${dragging === "files" ? "dragging" : ""}`}
        aria-hidden="true"
        onPointerDown={(event) => startDrag("files", event)}
      />
      <div className="center-wrap">
        <div className="editor-pdf-row">
          <EditorPane panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(!panelOpen)} />
          <div
            className={`resizer-vertical ${dragging === "pdf" ? "dragging" : ""}`}
            aria-hidden="true"
            onPointerDown={(event) => startDrag("pdf", event)}
          />
          <div
            style={{
              width: pdfWidth,
              flex: "0 1 auto",
              display: "flex",
              minWidth: 280,
            }}
          >
            <PdfPreview onExportPdf={onExportPdf} />
          </div>
        </div>
        {panelOpen ? (
          <>
            <div
              className={`resizer-horizontal ${dragging === "panel" ? "dragging" : ""}`}
              aria-hidden="true"
              onPointerDown={(event) => startDrag("panel", event)}
            />
            <BottomPanel />
          </>
        ) : null}
      </div>
      {historyOpen ? (
        <>
          <div
            className={`resizer-vertical ${dragging === "history" ? "dragging" : ""}`}
            aria-hidden="true"
            onPointerDown={(event) => startDrag("history", event)}
          />
          <div
            className="history-shell"
            style={{
              width: historyWidth,
              flex: "0 1 auto",
              display: "flex",
              minWidth: 240,
            }}
          >
            <HistoryDock />
          </div>
        </>
      ) : null}
      <HistoryRail />
    </div>
  );
}
