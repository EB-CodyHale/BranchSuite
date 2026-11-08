import { useRef, type ReactNode } from 'react';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Shows a busy confirm button and blocks closing while the action runs. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for consequential actions. Focus starts on Cancel so Enter never confirms by accident. */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancel', tone = 'default', loading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    if (!loading) onCancel();
  };
  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={title}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={cancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <div className="text-sm text-muted">{description}</div> : null}
    </Dialog>
  );
}
