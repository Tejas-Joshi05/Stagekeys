import { useEffect, useState, type ReactNode } from 'react';
import type { DisplayInfo } from '../../ipc/contract';
import { dispatch, type Action } from '../actions';
import { listAnimations } from '../animations';
import { setTitle, useDeckStore } from '../deck';
import { MidiStatusBadge, useMidiStore } from '../midi';
import { setShowDisplay, usePresenterStore } from '../presenter';
import { api } from '../shared/api';
import { useSettings } from '../shared/settings';

/** Small line icons, drawn on a 16-unit grid with the current text colour. */
const ICONS: Record<string, ReactNode> = {
  undo: <path d="M6 4 2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8" />,
  redo: <path d="m10 4 3.5 3.5L10 11m3-3.5H6.5a3.5 3.5 0 0 0 0 7H8" />,
  text: <path d="M3 3.5h10M8 3.5v10M6 13.5h4" />,
  rect: <rect x="2.5" y="4" width="11" height="8.5" rx="1" />,
  ellipse: <ellipse cx="8" cy="8.25" rx="5.5" ry="4.5" />,
  line: <path d="M3 13 13 3" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="m2.5 11 3.5-3.5 3 3 2-2 2.5 2.5" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
  piano: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M5.5 3v10M8 3v10M10.5 3v10" />
    </>
  ),
  sound: (
    <>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M5.5 14h5" />
    </>
  ),
  keys: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 9.5h2M7 9.5h2M10 9.5h2M4 6.5h1.5M9.5 6.5h2.5" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon-svg" viewBox="0 0 16 16" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

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
    <span
      className={dirty ? 'save-status pending' : 'save-status'}
      data-testid="save-status"
      title={isDraft ? 'Kept safe as a draft. Use Save to choose where the deck lives.' : undefined}
    >
      {dirty ? 'Saving…' : isDraft ? 'Draft' : 'Saved'}
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
      title="Screen the audience sees"
      value={value ?? ''}
      onChange={(e) => setShowDisplay(Number(e.target.value))}
    >
      {displays.map((d) => (
        <option key={d.id} value={d.id}>
          {d.primary ? 'This screen' : d.label} ({d.width}×{d.height})
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
  const piano = useSettings((s) => s.piano.enabled);
  const soundIn = useSettings((s) => s.audioInput.enabled);
  const keys = useSettings((s) => s.keysOverlay.control);
  const act = (action: Action) => () => dispatch(action, 'ui');

  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="tool-group deck">
        <span className="wordmark" aria-hidden>
          sk
        </span>
        <input
          className="deck-title"
          value={title}
          placeholder="Deck title"
          aria-label="Deck title"
          onChange={(e) => setTitle(e.target.value)}
          data-testid="deck-title"
        />
        <button className="quiet" onClick={act({ type: 'file.new' })} title="New deck (⌘N)">
          New
        </button>
        <button className="quiet" onClick={act({ type: 'file.open' })} title="Open a deck (⌘O)">
          Open
        </button>
        <button
          className="quiet"
          onClick={act({ type: 'file.save' })}
          data-testid="save"
          title="Save (⌘S)"
        >
          Save
        </button>
      </div>

      <div className="tool-group">
        <button
          className="tool"
          onClick={act({ type: 'edit.undo' })}
          disabled={!canUndo}
          title={undoLabel ? `Undo ${undoLabel} (⌘Z)` : 'Undo (⌘Z)'}
          aria-label="Undo"
          data-testid="undo"
        >
          <Icon name="undo" />
        </button>
        <button
          className="tool"
          onClick={act({ type: 'edit.redo' })}
          disabled={!canRedo}
          title={redoLabel ? `Redo ${redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)'}
          aria-label="Redo"
          data-testid="redo"
        >
          <Icon name="redo" />
        </button>
      </div>

      <div className="tool-group insert" aria-label="Add to slide">
        <button
          className="tool labelled"
          onClick={act({ type: 'element.add', kind: 'text' })}
          data-testid="add-text"
          title="Add text"
        >
          <Icon name="text" />
          Text
        </button>
        <button
          className="tool"
          onClick={act({ type: 'element.add', kind: 'rect' })}
          data-testid="add-rect"
          title="Add rectangle"
          aria-label="Rectangle"
        >
          <Icon name="rect" />
        </button>
        <button
          className="tool"
          onClick={act({ type: 'element.add', kind: 'ellipse' })}
          title="Add ellipse"
          aria-label="Ellipse"
        >
          <Icon name="ellipse" />
        </button>
        <button
          className="tool"
          onClick={act({ type: 'element.add', kind: 'line' })}
          title="Add line"
          aria-label="Line"
        >
          <Icon name="line" />
        </button>
        <button
          className="tool labelled"
          onClick={act({ type: 'element.add', kind: 'image' })}
          title="Add images"
        >
          <Icon name="image" />
          Image
        </button>
        <select
          className="add-animation"
          data-testid="add-animation"
          aria-label="Add an animation"
          value=""
          onChange={(e) => {
            if (e.target.value)
              dispatch(
                { type: 'element.add', kind: 'animation', animationId: e.target.value },
                'ui',
              );
          }}
        >
          <option value="">Add animation</option>
          {listAnimations().map((a) => (
            <option key={a.id} value={a.id} title={a.description}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <span className="spacer" />
      <SaveStatus />

      <div className="tool-group">
        <button
          className={piano ? 'tool toggle on' : 'tool toggle'}
          onClick={act({ type: 'audio.togglePiano' })}
          aria-pressed={piano}
          title={piano ? 'Piano sound is on (⇧⌘P)' : 'Piano sound is off (⇧⌘P)'}
          data-testid="toggle-piano"
        >
          <Icon name="piano" />
        </button>
        <button
          className={soundIn ? 'tool toggle on' : 'tool toggle'}
          onClick={act({ type: 'audio.toggleInput' })}
          aria-pressed={soundIn}
          title={soundIn ? 'Sound input is on (⇧⌘L)' : 'Sound input is off (⇧⌘L)'}
          data-testid="toggle-sound-input"
        >
          <Icon name="sound" />
        </button>
        <button
          className={keys ? 'tool toggle on' : 'tool toggle'}
          onClick={act({ type: 'view.toggleKeys' })}
          aria-pressed={keys}
          title={keys ? 'Hide the keys picture (⇧⌘K)' : 'Show the keys picture (⇧⌘K)'}
          data-testid="toggle-keys"
        >
          <Icon name="keys" />
        </button>
        <MidiStatusBadge status={midiStatus} detail={midiDetail} />
      </div>

      <div className="tool-group show">
        <DisplayPicker />
        <button
          onClick={act({ type: 'show.start', rehearsal: true })}
          data-testid="rehearse"
          title="Present with a timer (⇧⌘↩)"
        >
          Rehearse
        </button>
        <button
          className="primary"
          onClick={act({ type: 'show.start', rehearsal: false })}
          data-testid="present"
          title="Present (⌘↩)"
        >
          Present
        </button>
      </div>
    </div>
  );
}
