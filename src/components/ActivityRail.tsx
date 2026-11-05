import { FolderTree, ListTree, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import type { SidebarView } from "../types";

const views: Array<{ id: SidebarView; icon: typeof FolderTree; label: string }> = [
  { id: "project", icon: FolderTree, label: "sidebar.project" },
  { id: "search", icon: Search, label: "sidebar.search" },
  { id: "outline", icon: ListTree, label: "sidebar.outline" },
];

export function ActivityRail() {
  const { t } = useTranslation();
  const sidebarView = useAppStore((state) => state.sidebarView);
  const setSidebarView = useAppStore((state) => state.setSidebarView);

  return (
    <nav className="activity-rail" aria-label={t("sidebar.navigation")}>
      {views.map((view) => {
        const Icon = view.icon;
        return (
          <button
            key={view.id}
            type="button"
            className={`rail-button ${sidebarView === view.id ? "active" : ""}`}
            title={t(view.label)}
            aria-label={t(view.label)}
            aria-pressed={sidebarView === view.id}
            onClick={() => setSidebarView(view.id)}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </nav>
  );
}
