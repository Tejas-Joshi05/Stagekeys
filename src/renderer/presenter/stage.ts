import { actionForKey, actions, dispatch } from '../actions';
import { parseDeck } from '../deck';
import { startMappingEngine } from '../mapping';
import { midi, MockMidiSource, toMonitorLine, useMidiStore, WebMidiSource } from '../midi';
import { getDeckResources, loadBundledFonts } from '../render';
import { api } from '../shared/api';
import { errorMessage, logger } from '../shared/log';
import { formatDuration } from '../shared/util';
import { ControlMessageSchema, type StageMessage, type StageState } from './messages';
import { StagePlayer } from './StagePlayer';
import { ShowTimeline } from './timeline';

declare global {
  interface Window {
    /** Test and development hook: feed raw MIDI bytes into this window. */
    __stagekeysMidi?: (bytes: number[]) => void;
    __stagekeysStage?: { slideIndex: () => number; black: () => boolean; fps: () => number };
  }
}

const send = (message: StageMessage): void => {
  try {
    api().sendShowMessage(message);
  } catch {
    // The presenter view may be gone; the show goes on regardless.
  }
};

function showFatal(root: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'stage-fatal';
  el.textContent = text;
  root.appendChild(el);
}

/**
 * The stage window. Deliberately plain TypeScript with no React: it holds the
 * deck, MIDI input, mappings and the render loop, so the show keeps running
 * even if the presenter view on the laptop has a problem.
 */
export async function runStage(root: HTMLElement): Promise<void> {
  root.className = 'stage-root';

  // Show-safe: nothing here may throw to the top level or open a dialog.
  window.addEventListener('error', (e) => logger.error('Stage error', e.message));
  window.addEventListener('unhandledrejection', (e) =>
    logger.error('Stage rejection', String(e.reason)),
  );
  actions.setErrorSink((action, error) =>
    logger.error(`Action ${action.type} failed on stage`, errorMessage(error)),
  );

  const [info, init] = await Promise.all([api().getInfo(), api().getShowInit()]);
  if (!init) {
    showFatal(root, 'No show to present.');
    return;
  }
  const parsed = parseDeck(init.deckJson);
  if (!parsed.ok) {
    logger.error('Stage could not read the deck', parsed.error);
    send({
      t: 'notice',
      level: 'error',
      message: `The stage could not read the deck: ${parsed.error}`,
    });
    showFatal(root, 'This deck could not be opened.');
    return;
  }
  const deck = parsed.deck;
  await loadBundledFonts();

  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  const fpsEl = document.createElement('div');
  fpsEl.className = 'fps-overlay';
  fpsEl.hidden = true;
  const timerEl = document.createElement('div');
  timerEl.className = 'rehearsal-timer';
  timerEl.hidden = !init.rehearsal;
  root.append(canvas, fpsEl, timerEl);

  let animationErrors = 0;
  const timeline = new ShowTimeline();
  const player = new StagePlayer({
    canvas,
    deck,
    textures: getDeckResources(init.deckPath).textures,
    bus: midi.bus,
    input: midi.input,
    onAnimationError: (elementId, phase, error) => {
      animationErrors += 1;
      logger.error(
        `Animation ${elementId} failed in ${phase}; it has been switched off`,
        errorMessage(error),
      );
    },
    onFrameSummary: (summary) => {
      if (info.isDev && summary.latencyAvg > 0) {
        logger.debug('MIDI to frame latency', {
          avgMs: Number(summary.latencyAvg.toFixed(2)),
          maxMs: Number(summary.latencyMax.toFixed(2)),
          fps: Number(summary.fps.toFixed(1)),
        });
      }
      if (summary.fps < 50) {
        logger.warn('Frame rate dipped', {
          fps: Number(summary.fps.toFixed(1)),
          worstFrameMs: Number(summary.worstFrameMs.toFixed(1)),
        });
      }
    },
  });
  player.meter.attach(fpsEl);

  const fit = (): void => {
    const { width, height } = deck.meta.canvas;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    const cssWidth = Math.max(1, Math.floor(width * scale));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${Math.max(1, Math.floor(height * scale))}px`;
    player.resize(cssWidth, window.devicePixelRatio || 1);
  };

  try {
    await player.init();
  } catch (e) {
    logger.error('Stage renderer failed to start', errorMessage(e));
    send({ t: 'notice', level: 'error', message: 'The stage could not start its renderer.' });
    showFatal(root, 'The renderer could not start.');
    return;
  }
  fit();
  window.addEventListener('resize', fit);

  const goto = (index: number, animate = true): void => {
    if (player.goto(index, animate)) timeline.enter(player.slideIndex, performance.now());
  };
  goto(Math.min(init.slideIndex, deck.slides.length - 1), false);

  // ── Actions: the only way anything happens on stage ───────────────────────
  actions.register('nav.next', () => goto(player.slideIndex + 1));
  actions.register('nav.prev', () => goto(player.slideIndex - 1));
  actions.register('nav.goto', (a) => goto(a.index));
  actions.register('nav.gotoNamed', (a) => {
    const index = deck.slides.findIndex((s) => s.id === a.slideId);
    if (index >= 0) goto(index);
  });
  actions.register('show.blackToggle', () => player.setBlack(!player.isBlack));
  actions.register('show.panic', () => {
    player.panic();
    logger.info('Panic: stage reset to a calm state', { slide: player.slideIndex });
  });
  actions.register('anim.trigger', (a) => player.trigger(a.elementId, a.value ?? 1));
  actions.register('anim.setParam', (a) => player.setParam(a.elementId, a.param, a.value));
  actions.register('view.toggleFps', () => {
    fpsEl.hidden = !fpsEl.hidden;
  });
  let ending = false;
  actions.register('show.end', () => {
    if (ending) return;
    ending = true;
    const report = timeline.finish(
      performance.now(),
      deck.slides.map((s, i) => s.name || `Slide ${i + 1}`),
    );
    logger.info(init.rehearsal ? 'Rehearsal timings' : 'Show timings', report);
    send({ t: 'report', rehearsal: init.rehearsal, ...report });
    void api().endShow();
  });

  // ── Keyboard fallback: always works, with or without MIDI ─────────────────
  window.addEventListener('keydown', (e) => {
    const action = actionForKey(e, 'show');
    if (!action) return;
    e.preventDefault();
    dispatch(action, 'keyboard');
  });
  api().onShowMessage((raw) => {
    const message = ControlMessageSchema.safeParse(raw);
    if (message.success) dispatch(message.data.action, message.data.source);
  });

  // ── MIDI ──────────────────────────────────────────────────────────────────
  midi.setHooks({
    onWarn: (message) => {
      logger.warn(message);
      send({ t: 'notice', level: 'warn', message });
    },
    onInfo: (message) => {
      logger.info(message);
      send({ t: 'notice', level: 'info', message });
    },
  });
  startMappingEngine({
    bus: midi.bus,
    dispatch,
    getMappings: () => ({
      slide: deck.slides[player.slideIndex]?.mappings ?? [],
      global: deck.mappings,
    }),
  });
  if (info.e2e) {
    await midi.start(
      new MockMidiSource([{ id: 'mock', name: 'Mock Keys', manufacturer: 'Stagekeys' }]),
    );
  } else {
    await midi.start(new WebMidiSource());
  }
  if (info.e2e || info.isDev) {
    window.__stagekeysMidi = (bytes) => midi.inject(bytes);
    window.__stagekeysStage = {
      slideIndex: () => player.slideIndex,
      black: () => player.isBlack,
      fps: () => player.meter.fps,
    };
  }

  // ── Status for the presenter view, ten times a second ─────────────────────
  setInterval(() => {
    const now = performance.now();
    const midiState = useMidiStore.getState();
    const state: StageState = {
      t: 'state',
      slideIndex: player.slideIndex,
      slideCount: deck.slides.length,
      black: player.isBlack,
      rehearsal: init.rehearsal,
      elapsedMs: timeline.elapsed(now),
      slideElapsedMs: timeline.currentSlideElapsed(now),
      midiStatus: midiState.status,
      midiDetail: midiState.detail,
      devices: midiState.devices.map((d) => d.name),
      monitor: midi.bus.recent(12).map(toMonitorLine).reverse(),
      fps: player.meter.fps,
      latencyMs: player.meter.latency,
      animationErrors,
    };
    send(state);
    if (init.rehearsal) {
      timerEl.textContent = `${formatDuration(state.elapsedMs)}  ·  slide ${state.slideIndex + 1}/${state.slideCount}  ${formatDuration(state.slideElapsedMs)}`;
    }
  }, 100);

  logger.info('Stage ready', { slides: deck.slides.length, rehearsal: init.rehearsal });
}
