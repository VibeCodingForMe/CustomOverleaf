import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label?: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: position.x, top: position.y }} ref={ref}>
      {items.map((item, index) =>
        item.separator ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no stable label
          <div className="context-sep" key={`sep-${index}`} />
        ) : (
          <button
            type="button"
            key={item.label}
            className={`context-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            {item.icon ? <item.icon size={13} /> : <span style={{ width: 13 }} />}
            <span>{item.label}</span>
            {item.shortcut ? <span className="context-shortcut">{item.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
