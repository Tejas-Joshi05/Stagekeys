import { useEffect } from 'react';
import { dispatch } from '../actions';
import { useAppStore } from './appStore';

const STEPS: readonly { title: string; text: string }[] = [
  {
    title: '1. Build slides',
    text: 'Add text, shapes, images and animations from the toolbar. Click something to change it in Properties, on the right. Notes for yourself go under the slide.',
  },
  {
    title: '2. Plug in the keyboard',
    text: 'Animations react to any key straight away. Press Test in an animation’s settings, or just play, to see it in the editor.',
  },
  {
    title: '3. Decide what the controls do',
    text: 'Open the Mapping tab, press a pad, key or knob, and choose what it does: next slide, play an animation, turn a setting. “Map a chord” makes several keys held together act as one.',
  },
  {
    title: '4. Rehearse, then present',
    text: 'Rehearse runs the show with a timer and tells you how long each slide took. Present does the same on the audience screen chosen in the toolbar.',
  },
];

const SHOW_KEYS: readonly [string, string][] = [
  ['→  ↓  Space  Enter', 'Next slide'],
  ['←  ↑  Backspace', 'Previous slide (its transition plays in reverse)'],
  ['Home', 'First slide'],
  ['B  or  .', 'Black screen on or off'],
  ['H', 'Calm everything down: clears black, resets animations, stays on the slide'],
  ['K', 'Show or hide the keys picture'],
  ['P', 'Piano sound on or off'],
  ['L', 'Sound input (microphone) on or off'],
  ['Esc', 'End the show'],
];

const EDITOR_KEYS: readonly [string, string][] = [
  ['⌘Z  ⇧⌘Z', 'Undo, redo'],
  ['⌘S  ⇧⌘S', 'Save, save as'],
  ['⌘D', 'Duplicate the selection'],
  ['⌘A  Esc', 'Select everything, select nothing'],
  ['Arrows  ⇧Arrows', 'Nudge by 1, by 10'],
  ['⌘]  ⌘[', 'Bring forward, send backward (add ⇧ for all the way)'],
  ['Delete', 'Remove the selection'],
  ['Page Down  Page Up', 'Next slide, previous slide'],
  ['⌘M', 'New slide'],
  ['⌘↩  ⇧⌘↩', 'Present, rehearse'],
  ['⇧⌘K  ⇧⌘P  ⇧⌘L', 'Keys picture, piano sound, sound input'],
  ['?  or  F1', 'This help'],
];

function Keys({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className="help-keys">
      {rows.map(([keys, what]) => (
        <div key={keys}>
          <dt>{keys}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The built-in help: how the app fits together, and every keyboard shortcut. */
export function Help() {
  const open = useAppStore((s) => s.help);
  const close = (): void => useAppStore.setState({ help: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal help"
        role="dialog"
        aria-label="Stagekeys help"
        data-testid="help"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>How Stagekeys works</h2>
        <div className="help-steps">
          {STEPS.map((step) => (
            <div key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
        <h3>During a show</h3>
        <Keys rows={SHOW_KEYS} />
        <p className="hint">
          These always work, even if the MIDI keyboard is unplugged. On Windows use Ctrl where this
          says ⌘.
        </p>
        <h3>While editing</h3>
        <Keys rows={EDITOR_KEYS} />
        <p className="hint">
          The full guide, with every animation and setting, is docs/GUIDE.md in the Stagekeys
          repository.
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={close} data-testid="help-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A small "?" for places outside the toolbar. */
export function HelpButton() {
  return (
    <button className="link" onClick={() => dispatch({ type: 'view.toggleHelp' }, 'ui')}>
      How does this work?
    </button>
  );
}
