import { create } from 'zustand';
import type { AudioInputSettings } from '../../ipc/settings';
import {
  bandsFromSpectrum,
  LevelFollower,
  rms,
  SILENT_RAW,
  type AudioLevels,
  type RawLevels,
} from './levels';

/*
 * Sound input: a microphone or line input, measured so animations can react
 * to it. The sound is never recorded, played back or sent anywhere; it goes
 * into an analyser and nothing else.
 *
 * Like MIDI, nothing here touches React per frame. Render loops call
 * `audioInput.read()` and get the same mutable levels object back.
 */

export type AudioInputStatus =
  /** Switched off in settings. */
  | 'off'
  /** Switched on, but this window is not the one listening (the stage is). */
  | 'paused'
  | 'starting'
  | 'live'
  /** The operating system or the user refused microphone access. */
  | 'blocked'
  /** No usable input device, or the one in use went away. */
  | 'no-input'
  /** This environment has no audio capture at all. */
  | 'unavailable';

export const useAudioInputStore = create<{ status: AudioInputStatus }>(() => ({ status: 'off' }));

export interface AudioInputOptions {
  /** Asks the operating system for access. Must not prompt during a show. */
  requestAccess: () => Promise<boolean>;
  /** Tests: never open a real device; levels come from `inject` only. */
  mock: boolean;
  onProblem: (message: string) => void;
}

const FFT_SIZE = 2048;
/** Reads closer together than this share one measurement (several animations, one frame). */
const MIN_READ_GAP_MS = 2;

interface Capture {
  context: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  spectrum: Float32Array<ArrayBuffer>;
  binHz: number;
  onEnded: () => void;
}

export class AudioInput {
  private readonly follower = new LevelFollower();
  private readonly raw: RawLevels = { ...SILENT_RAW };
  private settings: AudioInputSettings = { enabled: false, sensitivity: 0.5, deviceId: '' };
  private options: AudioInputOptions | null = null;
  private windowActive = true;
  private injected: RawLevels | null = null;
  private capture: Capture | null = null;
  /** Bumped on every open or close, so a slow open that was overtaken gives up. */
  private generation = 0;
  private lastRead = 0;
  private watchingDevices = false;

  /** The live levels object. Stable for the app's lifetime. */
  get levels(): AudioLevels {
    return this.follower.levels;
  }

  get sensitivity(): number {
    return this.settings.sensitivity;
  }

  start(options: AudioInputOptions): void {
    this.options = options;
    this.reconcile();
  }

  configure(settings: AudioInputSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (previous.enabled !== settings.enabled || previous.deviceId !== settings.deviceId) {
      if (previous.deviceId !== settings.deviceId) this.close();
      this.reconcile();
    }
  }

  /** Changes how sensitive the levels are, at once, without touching the device. */
  setSensitivity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.settings = { ...this.settings, sensitivity: Math.min(1, Math.max(0, value)) };
  }

  /** Only one window listens at a time: the editor while editing, the stage during a show. */
  setWindowActive(active: boolean): void {
    if (active === this.windowActive) return;
    this.windowActive = active;
    this.reconcile();
  }

  /** Tests and development: feed raw levels as if a device delivered them. null stops. */
  inject(raw: RawLevels | null): void {
    this.injected = raw ? { ...raw } : null;
  }

  /** Measures (at most once per frame) and returns the shaped levels. Never throws. */
  read(now: number = performance.now()): AudioLevels {
    const levels = this.follower.levels;
    const elapsed = now - this.lastRead;
    if (elapsed < MIN_READ_GAP_MS && elapsed >= 0) return levels;
    this.lastRead = now;
    const listening = this.settings.enabled && this.windowActive;
    const source = listening ? (this.injected ?? this.measure()) : null;
    levels.active = source !== null;
    if (source === null && this.follower.silent) return levels;
    const dt = elapsed > 0 ? Math.min(0.1, elapsed / 1000) : 0;
    return this.follower.step(source ?? SILENT_RAW, dt, this.settings.sensitivity);
  }

  private measure(): RawLevels | null {
    const capture = this.capture;
    if (!capture) return null;
    try {
      capture.analyser.getFloatTimeDomainData(capture.samples);
      capture.analyser.getFloatFrequencyData(capture.spectrum);
    } catch {
      return null;
    }
    this.raw.level = rms(capture.samples);
    return bandsFromSpectrum(capture.spectrum, capture.binHz, this.raw);
  }

  private setStatus(status: AudioInputStatus): void {
    if (useAudioInputStore.getState().status !== status) useAudioInputStore.setState({ status });
  }

  /** Opens or closes the device so that it matches the settings and which window is listening. */
  private reconcile(): void {
    const options = this.options;
    if (!options) return;
    if (!this.settings.enabled) {
      this.close();
      this.setStatus('off');
      return;
    }
    if (!this.windowActive) {
      this.close();
      this.setStatus('paused');
      return;
    }
    if (options.mock) {
      this.setStatus('live');
      return;
    }
    if (this.capture) return;
    void this.open(options);
  }

  private async open(options: AudioInputOptions): Promise<void> {
    const generation = ++this.generation;
    const stale = (): boolean => generation !== this.generation;
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia || typeof AudioContext === 'undefined') {
      this.setStatus('unavailable');
      return;
    }
    this.setStatus('starting');
    this.watchDevices(media);
    try {
      const allowed = await options.requestAccess();
      if (stale()) return;
      if (!allowed) {
        this.setStatus('blocked');
        options.onProblem(
          'Sound input is blocked. Allow the microphone for Stagekeys in System Settings › Privacy & Security.',
        );
        return;
      }
      const stream = await this.openStream(media);
      if (stale()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const context = new AudioContext({ latencyHint: 'interactive' });
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // Smoothing is done by the level follower, where the sensitivity controls it.
      analyser.smoothingTimeConstant = 0;
      // Into the analyser only: connecting it to the speakers would feed back.
      context.createMediaStreamSource(stream).connect(analyser);
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const onEnded = (): void => {
        if (this.capture?.stream !== stream) return;
        this.close();
        this.setStatus('no-input');
        options.onProblem('Sound input stopped: the input device went away.');
      };
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', onEnded);
      this.capture = {
        context,
        stream,
        analyser,
        samples: new Float32Array(FFT_SIZE),
        spectrum: new Float32Array(analyser.frequencyBinCount),
        binHz: context.sampleRate / FFT_SIZE,
        onEnded,
      };
      this.setStatus('live');
    } catch (e) {
      if (stale()) return;
      const name = e instanceof DOMException ? e.name : '';
      const refused = name === 'NotAllowedError' || name === 'SecurityError';
      this.setStatus(refused ? 'blocked' : 'no-input');
      options.onProblem(
        refused
          ? 'Sound input is blocked. Allow the microphone for Stagekeys in System Settings › Privacy & Security.'
          : 'No sound input was found. Plug one in, or choose another in the MIDI & sound tab.',
      );
    }
  }

  private async openStream(media: MediaDevices): Promise<MediaStream> {
    // Raw sound: the browser's voice clean-up would flatten exactly what we want to see.
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const id = this.settings.deviceId;
    if (id) {
      try {
        return await media.getUserMedia({ audio: { ...base, deviceId: { exact: id } } });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        // The chosen device is gone: fall back to the default one rather than to silence.
        if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw e;
      }
    }
    return media.getUserMedia({ audio: base });
  }

  /** A device plugged in later brings sound input back without anyone touching the app. */
  private watchDevices(media: MediaDevices): void {
    if (this.watchingDevices) return;
    this.watchingDevices = true;
    media.addEventListener('devicechange', this.onDeviceChange);
  }

  private readonly onDeviceChange = (): void => {
    if (useAudioInputStore.getState().status === 'no-input') this.reconcile();
  };

  private close(): void {
    this.generation++;
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    for (const track of capture.stream.getTracks()) {
      track.removeEventListener('ended', capture.onEnded);
      track.stop();
    }
    void capture.context.close().catch(() => undefined);
  }

  /** Lets go of the device and every listener. */
  dispose(): void {
    this.close();
    if (this.watchingDevices && typeof navigator !== 'undefined') {
      navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    }
    this.watchingDevices = false;
    this.options = null;
    this.follower.reset();
    this.setStatus('off');
  }
}

/** The one sound input for this window. */
export const audioInput = new AudioInput();

export interface AudioDevice {
  id: string;
  label: string;
}

/** Input devices by name. Names are only available once access has been granted. */
export async function listAudioInputs(): Promise<AudioDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== '' && d.deviceId !== 'default')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  } catch {
    return [];
  }
}

export const AUDIO_STATUS_TEXT: Record<AudioInputStatus, string> = {
  off: 'Off',
  paused: 'The stage is listening',
  starting: 'Starting…',
  live: 'Listening',
  blocked: 'Blocked: allow the microphone in System Settings',
  'no-input': 'No input device',
  unavailable: 'Not available here',
};
