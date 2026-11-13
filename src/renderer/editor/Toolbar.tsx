import { useEffect, useState } from 'react';
import type { DisplayInfo } from '../../ipc/contract';
import { dispatch, type Action } from '../actions';
import { listAnimations } from '../animations';
import { setTitle, useDeckStore } from '../deck';
import { MidiStatusBadge, useMidiStore } from '../midi';
import { setShowDisplay, usePresenterStore } from '../presenter';
import { api } from '../shared/api';

function SaveStatus() {
  const dirty = useDeckStore((s) => s.revision !== s.savedRevision);
  const error = useDeckStore((s) => s.saveError);
  const isDraft = useDeckStore((s) => s.isDraft);
  if (error) {
    return (
      <span className="save-status error" title={error} data-testid="save-status">
        Not saved: {error}
      </span>
    );
  }
  return (
    <span className="save-status" data-testid="save-status">
      {dirty ? 'Saving…' : isDraft ? 'Draft saved (use Save to choose a location)' : 'Saved'}
    </span>
  );
}

function DisplayPicker() {
  const displayId = usePresenterStore((s) => s.displayId);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    const refresh = () => void api().listDisplays().then(setDisplays);
    refresh();
    // Displays come and go (projector plugged in); re-read when the window regains focus.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const fallback = (displays.find((d) => !d.primary) ?? displays[0])?.id;
  const value = displays.some((d) => d.id === displayId) ? displayId : fallback;
  return (
    <select
      className="display-picker"
      title="Display to present on"
      value={value ?? ''}
      onChange={(e) => setShowDisplay(Number(e.target.value))}
    >
      {displays.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label} ({d.width}×{d.height}){d.primary ? ' · this screen' : ''}
        </option>
      ))}
    </select>
  );
}

export function Toolbar() {
  const title = useDeckStore((s) => s.deck?.meta.title ?? '');
  const canUndo = useDeckStore((s) => s.canUndo);
  const canRedo = useDeckStore((s) => s.canRedo);
  const undoLabel = useDeckStore((s) => s.undoLabel);
  const redoLabel = useDeckStore((s) => s.redoLabel);
  const midiStatus = useMidiStore((s) => s.status);
  const midiDetail = useMidiStore((s) => s.detail);
  const act = (action: Action) => () => dispatch(action, 'ui');

  return (
    <div className="toolbar" data-testid="toolbar">
      <input
        className="deck-title"
        value={title}
        placeholder="Deck title"
        onChange={(e) => setTitle(e.target.value)}
        data-testid="deck-title"
      />
      <div className="tool-group">
        <button onClick={act({ type: 'file.new' })}>New</button>
        <button onClick={act({ type: 'file.open' })}>Open</button>
        <button onClick={act({ type: 'file.save' })} data-testid="save">
          Save
        </button>
      </div>
      <div className="tool-group">
        <button
          onClick={act({ type: 'edit.undo' })}
          disabled={!canUndo}
          title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
          data-testid="undo"
        >
          Undo
        </button>
        <button
          onClick={act({ type: 'edit.redo' })}
          disabled={!canRedo}
          title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
          data-testid="redo"
        >
          Redo
        </button>
      </div>
      <div className="tool-group">
        <button onClick={act({ type: 'element.add', kind: 'text' })} data-testid="add-text">
          Text
        </button>
        <button onClick={act({ type: 'element.add', kind: 'rect' })} data-testid="add-rect">
          Rectangle
        </button>
        <button onClick={act({ type: 'element.add', kind: 'ellipse' })}>Ellipse</button>
        <button onClick={act({ type: 'element.add', kind: 'line' })}>Line</button>
        <button onClick={act({ type: 'element.add', kind: 'image' })}>Image</button>
        <select
          className="add-animation"
          data-testid="add-animation"
          value=""
          onChange={(e) => {
            if (e.target.value)
              dispatch(
                { type: 'element.add', kind: 'animation', animationId: e.target.value },
                'ui',
              );
          }}
        >
          <option value="">Animation…</option>
          {listAnimations().map((a) => (
            <option key={a.id} value={a.id} title={a.description}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <span className="spacer" />
      <SaveStatus />
      <MidiStatusBadge status={midiStatus} detail={midiDetail} />
      <div className="tool-group">
        <DisplayPicker />
        <button onClick={act({ type: 'show.start', rehearsal: true })} data-testid="rehearse">
          Rehearse
        </button>
        <button
          className="primary"
          onClick={act({ type: 'show.start', rehearsal: false })}
          data-testid="present"
        >
          Present
        </button>
      </div>
    </div>
  );
}
