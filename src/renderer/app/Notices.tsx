import { dismissNotice, useNotices } from '../shared/notify';

/** Small messages in the corner. They never block, never take focus and never open a dialog. */
export function Notices() {
  const notices = useNotices((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.level}`} data-testid="notice">
          <span>{n.message}</span>
          <button
            className="icon"
            tabIndex={-1}
            onClick={() => dismissNotice(n.id)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
