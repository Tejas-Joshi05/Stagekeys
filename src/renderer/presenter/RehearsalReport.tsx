import { formatDuration } from '../shared/util';
import { dismissReport, usePresenterStore } from './control';

/** Shown after a rehearsal: how long each slide took, longest highlighted. */
export function RehearsalReport() {
  const report = usePresenterStore((s) => s.report);
  if (!report) return null;
  const longest = Math.max(1, ...report.slides.map((s) => s.ms));
  return (
    <div className="modal-backdrop">
      <div className="modal" data-testid="rehearsal-report">
        <h2>Rehearsal: {formatDuration(report.totalMs)}</h2>
        <p className="hint">Time on each slide. The bar shows where you spent the longest.</p>
        <div className="report-rows">
          {report.slides.map((s) => (
            <div className="report-row" key={s.index}>
              <span className="report-name">
                {s.index + 1}. {s.name}
              </span>
              <span className="report-bar">
                <span
                  style={{ width: `${(s.ms / longest) * 100}%` }}
                  className={s.ms === longest ? 'longest' : ''}
                />
              </span>
              <span className="report-time">
                {formatDuration(s.ms)}
                {s.visits > 1 && ` (${s.visits} visits)`}
              </span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={dismissReport}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
