import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.title} ${command.group} ${command.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <Modal title={t("palette.title")} onClose={onClose} size="medium">
      <div className="palette-search">
        <Search size={15} />
        <input
          ref={input}
          value={query}
          placeholder={t("palette.placeholder")}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(filtered.length - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(filtered[selected]);
            }
          }}
        />
      </div>
      <div className="palette-list">
        {filtered.length === 0 ? <div className="tree-empty">{t("palette.noResults")}</div> : null}
        {filtered.map((command, index) => (
          <button
            type="button"
            key={command.id}
            className={`palette-item ${index === selected ? "active" : ""}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => run(command)}
          >
            <span className="palette-text">
              <span className="palette-title">{command.title}</span>
              <span className="palette-group">{command.group}</span>
            </span>
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            {index === selected ? <CornerDownLeft size={12} /> : null}
          </button>
        ))}
      </div>
    </Modal>
  );
}
