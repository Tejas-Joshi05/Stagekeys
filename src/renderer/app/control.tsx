import { createRoot } from 'react-dom/client';
import { actionForKey, actions, ActionSchema, dispatch } from '../actions';
import { preloadArt } from '../animations';
import { audioInput, startAudioInput, startPiano } from '../audio';
import { autosave, discardPristineDraft, flushSaves, getCurrentSlide, useDeckStore } from '../deck';
import { controlPicker, learnSession, startMappingEngine } from '../mapping';
import { midi, MockMidiSource, WebMidiSource, type MidiSource } from '../midi';
import { initShowBridge, usePresenterStore } from '../presenter';
import { loadBundledFonts } from '../render';
import { api } from '../shared/api';
import { errorMessage, logger } from '../shared/log';
import { notify } from '../shared/notify';
import { initSettings } from '../shared/settings';
import { App } from './App';
import { useAppStore } from './appStore';
import { registerControlActions } from './controlActions';

const NO_MAPPINGS = { slide: [], global: [] } as const;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Starts the control window: the editor, and the presenter view during a show. */
export async function runControl(root: HTMLElement): Promise<void> {
  window.addEventListener('error', (e) => logger.error('Window error', e.message));
  window.addEventListener('unhandledrejection', (e) =>
    logger.error('Unhandled rejection', String(e.reason)),
  );
  actions.setErrorSink((action, error) => {
    logger.error(`Action ${action.type} failed`, errorMessage(error));
    notify('warn', `“${action.type}” could not be completed. Details are in the log.`);
  });

  const info = await api().getInfo();
  useAppStore.setState({ info });
  await Promise.all([loadBundledFonts(), preloadArt(), initSettings()]);
  registerControlActions();

  // ── MIDI for the editor (monitor, Learn, live preview) ────────────────────
  const makeSource = (): MidiSource =>
    info.e2e
      ? new MockMidiSource([{ id: 'mock', name: 'Mock Keys', manufacturer: 'Stagekeys' }])
      : new WebMidiSource();
  midi.setHooks({
    onWarn: (message) => {
      logger.warn(message);
      notify('warn', message);
    },
    onInfo: (message) => {
      logger.info(message);
      notify('info', message);
    },
  });
  startMappingEngine({
    bus: midi.bus,
    dispatch,
    learn: learnSession,
    picker: controlPicker,
    // During a show the stage window owns MIDI; this window stays out of the way.
    isActive: () => !usePresenterStore.getState().active,
    getMappings: () => {
      const state = useDeckStore.getState();
      if (!state.deck) return NO_MAPPINGS;
      return {
        slide: getCurrentSlide(state)?.mappings ?? NO_MAPPINGS.slide,
        global: state.deck.mappings,
      };
    },
  });
  // After the mapping engine, so keys that trigger a mapping can stay silent.
  startPiano({ bus: midi.bus, isActive: () => !usePresenterStore.getState().active });
  // Sound input for audio-reactive animations: this window listens while editing,
  // the stage window during a show.
  startAudioInput({
    requestAccess: () => api().requestMicrophone(),
    mock: info.e2e && !info.fakeMic,
    onProblem: (message) => {
      logger.warn(message);
      notify('warn', message);
    },
  });
  initShowBridge({
    onShowStarting: () => {
      learnSession.cancel();
      controlPicker.enabled = false;
      midi.stop();
      audioInput.setWindowActive(false);
    },
    onShowEnded: () => {
      audioInput.setWindowActive(true);
      void midi.start(makeSource());
    },
  });
  void midi.start(makeSource());
  if (info.e2e || info.isDev) {
    window.__stagekeysMidi = (bytes) => midi.inject(bytes);
    window.__stagekeysAudio = (raw) => audioInput.inject(raw);
    window.__stagekeysSound = () => audioInput.read().level;
  }

  // ── Keyboard, clipboard and menu all become actions ───────────────────────
  window.addEventListener('keydown', (e) => {
    const presenting = usePresenterStore.getState().active;
    if (!presenting && isEditable(e.target)) return;
    const action = actionForKey(e, presenting ? 'show' : 'editor');
    if (!action) return;
    e.preventDefault();
    dispatch(action, 'keyboard');
  });
  for (const [event, type] of [
    ['copy', 'edit.copy'],
    ['cut', 'edit.cut'],
    ['paste', 'edit.paste'],
  ] as const) {
    document.addEventListener(event, (e) => {
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      dispatch({ type }, 'keyboard');
    });
  }
  api().onMenuAction((raw) => {
    const parsed = ActionSchema.safeParse(raw);
    if (!parsed.success) return;
    const action = parsed.data;
    // In a text field, the Edit menu should edit the text, not the slide.
    if (isEditable(document.activeElement)) {
      if (action.type === 'edit.undo') return void document.execCommand('undo');
      if (action.type === 'edit.redo') return void document.execCommand('redo');
      if (action.type === 'edit.selectAll') return void document.execCommand('selectAll');
      if (action.type === 'edit.duplicate') return;
    }
    dispatch(action, 'menu');
  });

  // ── Saving ────────────────────────────────────────────────────────────────
  autosave.start();
  api().onFlushRequest(() => {
    void (async () => {
      let error: string | null;
      try {
        error = await flushSaves();
        if (!error) await discardPristineDraft();
      } catch (e) {
        error = errorMessage(e);
      }
      api().flushDone(error);
    })();
  });

  createRoot(root).render(<App />);
  logger.info('Control window ready');
}
