import { useEffect, useMemo, useState } from 'react';
import type { Action } from '../actions';
import { AUDIO_STATUS_TEXT, AudioMeter, type AudioLevels } from '../audio';
import { useDeckStore } from '../deck';
import { KeysOverlayView, MidiMonitorView, MidiStatusBadge } from '../midi';
import { useSlideImage } from '../render';
import { useSettings } from '../shared/settings';
import { formatDuration } from '../shared/util';
import { cheatSheet } from './cheatSheet';
import { presenterInput, sendToStage, usePresenterStore } from './control';
import { talkClock } from './preflight';

const NO_SOUND: AudioLevels = { active: false, level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
/** The stage's sound levels, as last reported (ten times a second). */
const stageAudio = (): AudioLevels => usePresenterStore.getState().stage?.audio ?? NO_SOUND;

const NOTES_SIZE_KEY = 'stagekeys.presenter.notesSize';
const NOTES_SIZES = [18, 23, 28, 34, 42] as const;

function readNotesSize(): number {
  try {
    const saved = Number(globalThis.localStorage?.getItem(NOTES_SIZE_KEY));
    return NOTES_SIZES.includes(saved as (typeof NOTES_SIZES)[number]) ? saved : 23;
  } catch {
    return 23;
  }
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span>
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

/** The laptop-screen view during a show: current and next slide, notes, timer, clock and MIDI state. */
export function PresenterView() {
  const deck = useDeckStore((s) => s.deck);
  const path = useDeckStore((s) => s.path);
  const stage = usePresenterStore((s) => s.stage);
  const rehearsal = usePresenterStore((s) => s.rehearsal);
  const piano = useSettings((s) => s.piano.enabled);
  const soundIn = useSettings((s) => s.audioInput.enabled);
  const soundStatus = usePresenterStore((s) => s.stage?.audio?.status ?? 'off');
  const keysOnStage = useSettings((s) => s.keysOverlay.stage);
  const keysHere = useSettings((s) => s.keysOverlay.control);

  const profile = useSettings((s) => s.controller);
  const [notesSize, setNotesSize] = useState(readNotesSize);
  const resizeNotes = (step: 1 | -1) => () => {
    const at = NOTES_SIZES.indexOf(notesSize as (typeof NOTES_SIZES)[number]);
    const next = NOTES_SIZES[Math.min(NOTES_SIZES.length - 1, Math.max(0, at + step))] ?? 23;
    setNotesSize(next);
    try {
      globalThis.localStorage?.setItem(NOTES_SIZE_KEY, String(next));
    } catch {
      // Not remembered; harmless.
    }
  };

  const index = stage?.slideIndex ?? 0;
  const lines = useMemo(
    () => (deck ? cheatSheet(deck, index, profile) : []),
    [deck, index, profile],
  );
  const clock = talkClock(stage?.elapsedMs ?? 0, deck?.meta.targetMinutes ?? 0);
  const steps = stage?.steps;
  const current = deck?.slides[index];
  const next = deck?.slides[index + 1];
  const currentImage = useSlideImage(current, deck, path, 960, 0);
  const nextImage = useSlideImage(next, deck, path, 480, 0);

  const act = (action: Action) => () => sendToStage(action, 'ui');

  return (
    <div className="presenter" data-testid="presenter-view">
      <header className="presenter-bar">
        <span className="presenter-mode">{rehearsal ? 'Rehearsal' : 'Presenting'}</span>
        <span className="presenter-count" data-testid="presenter-slide-count">
          Slide {index + 1} / {stage?.slideCount ?? deck?.slides.length ?? 0}
        </span>
        {steps && (
          <span
            className={steps.done >= steps.total ? 'presenter-steps done' : 'presenter-steps'}
            data-testid="presenter-steps"
            title="Key-press reveals on this slide"
          >
            {steps.done >= steps.total
              ? `all ${steps.total} revealed`
              : `revealed ${steps.done} of ${steps.total}`}
          </span>
        )}
        <span className="presenter-timer" data-testid="presenter-timer">
          {formatDuration(stage?.elapsedMs ?? 0)}
        </span>
        {clock.state !== 'none' && (
          <span className={`presenter-countdown ${clock.state}`} data-testid="presenter-countdown">
            {clock.text}
          </span>
        )}
        <span className="presenter-slide-time" title="Time on this slide">
          this slide {formatDuration(stage?.slideElapsedMs ?? 0)}
        </span>
        <span className="presenter-clock">
          <Clock />
        </span>
        <MidiStatusBadge status={stage?.midiStatus ?? 'starting'} detail={stage?.midiDetail} />
      </header>

      <div className="presenter-body">
        <section className="presenter-slides">
          <div className={stage?.black ? 'presenter-current is-black' : 'presenter-current'}>
            {currentImage ? (
              <img src={currentImage} alt="Current slide" />
            ) : (
              <div className="slide-blank" />
            )}
            {stage?.black && <div className="black-badge">BLACK SCREEN</div>}
          </div>
          <div className="presenter-next">
            <div className="label">Next</div>
            {next ? (
              nextImage ? (
                <img src={nextImage} alt="Next slide" />
              ) : (
                <div className="slide-blank" />
              )
            ) : (
              <div className="slide-blank end">End of deck</div>
            )}
          </div>
        </section>

        <section className="presenter-notes">
          <div className="label notes-label">
            Notes
            <span className="notes-size">
              <button
                className="icon"
                onClick={resizeNotes(-1)}
                disabled={notesSize === NOTES_SIZES[0]}
                title="Smaller notes"
                aria-label="Smaller notes"
              >
                A−
              </button>
              <button
                className="icon"
                onClick={resizeNotes(1)}
                disabled={notesSize === NOTES_SIZES[NOTES_SIZES.length - 1]}
                title="Bigger notes"
                aria-label="Bigger notes"
                data-testid="notes-bigger"
              >
                A+
              </button>
            </span>
          </div>
          <div className="notes-text" style={{ fontSize: notesSize }} data-testid="presenter-notes">
            {current?.notes || <span className="muted">No notes for this slide.</span>}
          </div>
          {lines.length > 0 && (
            <div className="cheat-sheet" data-testid="cheat-sheet">
              <div className="label">On this slide</div>
              <ul>
                {lines.map((line, i) => (
                  <li key={i} className={line.here ? 'here' : ''}>
                    <span className="cheat-input">{line.input}</span>
                    <span className="cheat-does">{line.does}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="presenter-side">
          {keysHere && (
            <>
              <div className="label">Playing</div>
              <KeysOverlayView input={presenterInput} width={292} />
            </>
          )}
          {soundIn && (
            <>
              <div className="label">Sound in</div>
              <AudioMeter read={stageAudio} width={292} height={64} />
              {soundStatus !== 'live' && (
                <div className="presenter-stats warn" data-testid="presenter-sound-status">
                  {AUDIO_STATUS_TEXT[soundStatus]}
                </div>
              )}
            </>
          )}
          <div className="label">MIDI</div>
          <MidiMonitorView lines={stage?.monitor ?? []} />
          <div className="presenter-stats">
            {stage ? `${stage.fps.toFixed(0)} fps` : 'Waiting for stage…'}
            {stage && stage.latencyMs > 0 && ` · ${stage.latencyMs.toFixed(1)} ms`}
            {stage && stage.animationErrors > 0 && (
              <span className="warn"> · {stage.animationErrors} animation error(s) skipped</span>
            )}
          </div>
        </section>
      </div>

      <footer className="presenter-controls">
        <button onClick={act({ type: 'nav.prev' })}>← Previous</button>
        <button
          className="primary"
          onClick={act({ type: 'nav.next' })}
          data-testid="presenter-next"
        >
          Next →
        </button>
        <button onClick={act({ type: 'show.blackToggle' })}>Black (B)</button>
        <button onClick={act({ type: 'show.panic' })}>Panic (H)</button>
        <button
          className={piano ? 'toggle on' : 'toggle'}
          aria-pressed={piano}
          onClick={act({ type: 'audio.togglePiano' })}
        >
          Piano {piano ? 'on' : 'off'} (P)
        </button>
        <button
          className={soundIn ? 'toggle on' : 'toggle'}
          aria-pressed={soundIn}
          onClick={act({ type: 'audio.toggleInput' })}
          data-testid="presenter-sound"
        >
          Sound in {soundIn ? 'on' : 'off'} (L)
        </button>
        <button
          className={keysOnStage ? 'toggle on' : 'toggle'}
          aria-pressed={keysOnStage}
          onClick={act({ type: 'view.toggleKeys' })}
          data-testid="presenter-keys"
        >
          Keys on screen {keysOnStage ? 'on' : 'off'} (K)
        </button>
        <span className="spacer" />
        <button className="danger" onClick={act({ type: 'show.end' })} data-testid="presenter-end">
          End show (Esc)
        </button>
      </footer>
    </div>
  );
}
