import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <span className="toast-icon">
            {toast.kind === "success" ? (
              <CheckCircle2 size={15} />
            ) : toast.kind === "error" ? (
              <AlertCircle size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span className="toast-message">{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                dismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
