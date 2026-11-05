import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";

export function HistoryRail() {
  const { t } = useTranslation();
  const historyOpen = useAppStore((state) => state.historyOpen);
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen);

  return (
    <nav className="history-rail" aria-label={t("history.title")}>
      <button
        type="button"
        className={`rail-button ${historyOpen ? "active" : ""}`}
        title={t("history.title")}
        aria-label={t("history.title")}
        aria-pressed={historyOpen}
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        <History size={18} />
      </button>
    </nav>
  );
}
