import { AlertTriangle } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

export function ConfirmDialog() {
  const state = useAppStore((store) => store.confirmState);
  const resolve = useAppStore((store) => store.resolveConfirm);
  if (!state) return null;
  return (
    <Modal
      size="narrow"
      title={state.title}
      onClose={() => resolve(false)}
      footer={
        <>
          <div className="grow" />
          <button type="button" className="text-button" onClick={() => resolve(false)}>
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`text-button ${state.danger ? "danger" : "primary"}`}
            onClick={() => resolve(true)}
            autoFocus
          >
            {state.confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {state.danger ? (
          <AlertTriangle size={18} color="var(--danger)" style={{ flex: "none", marginTop: 1 }} />
        ) : null}
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
          {state.body}
        </p>
      </div>
    </Modal>
  );
}
