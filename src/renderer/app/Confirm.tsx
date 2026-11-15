import { useEffect } from 'react';
import { useAppStore, type ConfirmRequest } from './appStore';

/** Asks before something that cannot be undone. Never used during a show. */
export function askToConfirm(request: ConfirmRequest): void {
  useAppStore.setState({ confirm: request });
}

export function ConfirmModal() {
  const request = useAppStore((s) => s.confirm);
  const close = (): void => useAppStore.setState({ confirm: null });

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request]);

  if (!request) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="alertdialog"
        aria-label={request.title}
        data-testid="confirm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{request.title}</h2>
        <p>{request.detail}</p>
        <div className="modal-actions confirm-actions">
          {/* Cancel has the focus, so Enter never deletes by accident. */}
          <button autoFocus onClick={close} data-testid="confirm-cancel">
            Cancel
          </button>
          <button
            className="danger"
            data-testid="confirm-ok"
            onClick={() => {
              close();
              request.onConfirm();
            }}
          >
            {request.action}
          </button>
        </div>
      </div>
    </div>
  );
}
