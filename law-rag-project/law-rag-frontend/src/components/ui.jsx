import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export function IconButton({ label, children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

// The server's raw error, tucked away for people who want to report it.
export function TechnicalDetail({ text }) {
  if (!text) {
    return null;
  }
  return (
    <details className="tech-detail">
      <summary>자세히</summary>
      <code>{text}</code>
    </details>
  );
}

export function Toasts({ toasts, onDismiss }) {
  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
  };

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icons[toast.type] ?? Info;
        return (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <Icon size={16} aria-hidden="true" />
            <span>{toast.message}</span>
            <IconButton label="알림 닫기" onClick={() => onDismiss(toast.id)}>
              <X size={14} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "확인",
  tone = "danger",
  busy = false,
  children,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="scrim" onMouseDown={busy ? undefined : onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-desc">{description}</p>
        {children}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
