import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="icon-button modal-close" type="button" aria-label="Đóng hộp thoại" onClick={onCancel}><X size={20} /></button>
        <div className={`modal-icon ${danger ? 'danger' : ''}`}><AlertTriangle size={23} /></div>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel}>Quay lại</button>
          <button className={`button ${danger ? 'danger' : 'primary'}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
