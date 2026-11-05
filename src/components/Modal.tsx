import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "narrow" | "medium" | "wide";
  closeDisabled?: boolean;
  headerActions?: ReactNode;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  closeDisabled,
  headerActions,
}: ModalProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [closeDisabled, onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        className={`modal ${size ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-header">
          <div className="grow">
            <h2 className="modal-title">{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          {headerActions}
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={closeDisabled}
          >
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
