import { useEffect, useState } from 'react';
import type { DraftInfo } from '../../ipc/contract';
import { dispatch } from '../actions';
import { openDeckAt, restoreBackup } from '../deck';
import { api } from '../shared/api';
import { notify } from '../shared/notify';
import { useAppStore } from './appStore';
import { reportOpenResult } from './controlActions';

const when = (ms: number): string =>
  new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Shown when a deck could not be opened. Offers its backups instead of leaving the user stuck. */
export function OpenErrorModal() {
  const openError = useAppStore((s) => s.openError);
  if (!openError) return null;
  const { error, path, backups } = openError;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" data-testid="open-error">
        <h2>This deck could not be opened</h2>
        <p>{error}</p>
        {path && backups.length > 0 && (
          <>
            <p className="hint">
              Stagekeys keeps timestamped backups inside every deck. You can restore one of these:
            </p>
            <div className="backup-list">
              {backups.slice(0, 8).map((b) => (
                <button
                  key={b.name}
                  onClick={() => void restoreBackup(path, b.name).then(reportOpenResult)}
                >
                  Restore backup from {when(b.modified)}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={() => useAppStore.setState({ openError: null })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function Welcome() {
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const version = useAppStore((s) => s.info?.version);
  const refresh = () => void api().listDrafts().then(setDrafts);
  useEffect(refresh, []);

  const remove = async (draft: DraftInfo) => {
    const result = await api().deleteDraft(draft.path);
    if (!result.ok) notify('error', `Could not delete the draft: ${result.error}`);
    refresh();
  };

  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome-card">
        <h1>Stagekeys</h1>
        <p className="tagline">Slides you play from a MIDI keyboard.</p>
        <div className="welcome-actions">
          <button
            className="primary big"
            onClick={() => dispatch({ type: 'file.new' }, 'ui')}
            data-testid="new-deck"
          >
            New deck
          </button>
          <button
            className="big"
            onClick={() => dispatch({ type: 'file.open' }, 'ui')}
            data-testid="open-deck"
          >
            Open deck…
          </button>
        </div>
        {drafts.length > 0 && (
          <div className="drafts" data-testid="drafts">
            <h2>Unsaved drafts</h2>
            <p className="hint">
              Decks you edited but never saved to a location. They are kept here until you delete
              them.
            </p>
            {drafts.map((d) => (
              <div className="draft" key={d.path}>
                <span className="draft-title">{d.title}</span>
                <span className="draft-date">{when(d.modified)}</span>
                <button onClick={() => void openDeckAt(d.path).then(reportOpenResult)}>Open</button>
                <button className="link danger" onClick={() => void remove(d)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        {version && <p className="version">Version {version}</p>}
      </div>
    </div>
  );
}
