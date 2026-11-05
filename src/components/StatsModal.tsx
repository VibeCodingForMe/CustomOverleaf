import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

function wordCount(text: string) {
  const plain = text
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, " ")
    .replace(/[{}$&#_^~%]/g, " ");
  return plain.split(/\s+/).filter((word) => word.trim().length > 0).length;
}

export function StatsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tabs = useAppStore((state) => state.tabs);
  const activeRel = useAppStore((state) => state.activeRel);
  const active = tabs.find((tab) => tab.rel === activeRel) ?? null;
  const content = active?.content ?? "";
  const words = wordCount(content);
  const characters = [...content].length;
  const lines = content ? content.split("\n").length : 0;
  const readingMinutes = Math.max(1, Math.round(words / 220));
  const rows = [
    [t("stats.words"), words.toLocaleString()],
    [t("stats.characters"), characters.toLocaleString()],
    [t("stats.charactersNoSpaces"), characters - (content.match(/\s/g)?.length ?? 0)],
    [t("stats.lines"), lines.toLocaleString()],
    [t("stats.readingTime"), t("stats.minutes", { count: readingMinutes })],
  ] as const;

  return (
    <Modal
      title={t("stats.title")}
      subtitle={active?.rel ?? t("stats.noFile")}
      onClose={onClose}
      size="narrow"
      footer={
        <button type="button" className="text-button primary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <div className="stats-grid">
        {rows.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>
      <p className="form-hint stats-note">
        <BarChart3 size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {t("stats.note")}
      </p>
    </Modal>
  );
}
