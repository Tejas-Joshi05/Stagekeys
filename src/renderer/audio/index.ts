import type { MidiBus } from '../midi';
import { updateSettings, useSettings } from '../shared/settings';
import { audioInput, type AudioInputOptions } from './input';
import { PianoEngine } from './piano';

export { decayFor, midiToHz, PianoEngine, velocityGain } from './piano';
export {
  AUDIO_STATUS_TEXT,
  AudioInput,
  audioInput,
  listAudioInputs,
  useAudioInputStore,
  type AudioDevice,
  type AudioInputStatus,
} from './input';
export {
  bandsFromSpectrum,
  LevelFollower,
  responseFor,
  rms,
  SILENT_RAW,
  type AudioLevels,
  type AudioResponse,
  type RawLevels,
} from './levels';
export { AudioMeter } from './AudioMeter';

export interface PianoOptions {
  bus: MidiBus;
  /** Return false while this window should stay silent (the stage owns MIDI during a show). */
  isActive?: () => boolean;
}

/**
 * Plays notes from the MIDI bus when the piano is switched on in settings.
 * Subscribe after the mapping engine, so keys that trigger a mapping are
 * already marked and can stay silent. Returns a stop function.
 */
export function startPiano(options: PianoOptions): () => void {
  const engine = new PianoEngine(useSettings.getState().piano);
  engine.warm();
  const unsubscribeSettings = useSettings.subscribe((s, prev) => {
    if (s.piano !== prev.piano) engine.configure(s.piano);
  });
  const unsubscribeBus = options.bus.subscribe((message) => {
    if (options.isActive && !options.isActive()) return;
    const { piano, controller } = useSettings.getState();
    if (message.type === 'cc') {
      if (message.controller === 64) engine.setSustain(message.value >= 64);
      return;
    }
    if (message.type !== 'noteOn' && message.type !== 'noteOff') return;
    if (!piano.pads && message.channel === controller.padChannel) return;
    if (message.type === 'noteOn') {
      if (piano.skipMapped && message.consumed) return;
      engine.noteOn(message.note, message.velocity);
    } else {
      engine.noteOff(message.note);
    }
  });
  return () => {
    unsubscribeBus();
    unsubscribeSettings();
    engine.dispose();
  };
}

/**
 * Follows the sound-input settings for this window. Returns a stop function.
 * The stage and the editor each call this; only the one that is "active"
 * holds the device.
 */
export function startAudioInput(options: AudioInputOptions): () => void {
  audioInput.configure(useSettings.getState().audioInput);
  audioInput.start(options);
  const unsubscribe = useSettings.subscribe((s, prev) => {
    if (s.audioInput !== prev.audioInput) audioInput.configure(s.audioInput);
  });
  return () => {
    unsubscribe();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    audioInput.dispose();
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sets the sensitivity (0 stiffest .. 1 most sensitive). It takes effect at
 * once; saving is held back briefly, so a knob sweeping through a hundred
 * values writes the settings file once and causes one React update, not a hundred.
 */
export function setAudioSensitivity(value: number): void {
  if (!Number.isFinite(value)) return;
  audioInput.setSensitivity(value);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    updateSettings({ audioInput: { sensitivity: audioInput.sensitivity } });
  }, 250);
}
