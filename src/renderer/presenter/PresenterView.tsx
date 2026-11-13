import { useEffect, useState } from 'react';
import type { Action } from '../actions';
import { useDeckStore } from '../deck';
import { KeysOverlayView, MidiMonitorView, MidiStatusBadge } from '../midi';
import { useSlideImage } from '../render';
import { useSettings } from '../shared/settings';
import { formatDuration } from '../shared/util';
import { presenterInput, sendToStage, usePresenterStore } from './control';

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
  const keysOnStage = useSettings((s) => s.keysOverlay.stage);
  const keysHere = useSettings((s) => s.keysOverlay.control);

  const index = stage?.slideIndex ?? 0;
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
        <span className="presenter-timer" data-testid="presenter-timer">
          {formatDuration(stage?.elapsedMs ?? 0)}
        </span>
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
          <div className="label">Notes</div>
          <div className="notes-text" data-testid="presenter-notes">
            {current?.notes || <span className="muted">No notes for this slide.</span>}
          </div>
        </section>

        <section className="presenter-side">
          {keysHere && (
            <>
              <div className="label">Playing</div>
              <KeysOverlayView input={presenterInput} width={292} />
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
