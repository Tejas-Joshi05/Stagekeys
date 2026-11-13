import type { PianoSettings } from '../../ipc/settings';

/*
 * A small piano made from Web Audio nodes, so it needs no sample files and
 * starts instantly. Three voices:
 *   grand    - bright, many harmonics, a felt-hammer knock;
 *   felt     - the soft, muted upright sound (default);
 *   electric - a two-operator FM tine, like a Rhodes.
 * Up to MAX_VOICES notes at once; the oldest is stolen beyond that.
 */

const MAX_VOICES = 24;

interface Voice {
  note: number;
  started: number;
  /** Released by the key but held by the sustain pedal. */
  sustained: boolean;
  gain: GainNode;
  stop(at: number): void;
}

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** Velocity 1..127 to a gain: a gentle curve so soft playing stays audible. */
export const velocityGain = (velocity: number): number =>
  Math.pow(Math.min(127, Math.max(0, velocity)) / 127, 1.6);

/** How long a note rings while held, in seconds: low notes ring longer, as on a real piano. */
export const decayFor = (note: number, sound: PianoSettings['sound']): number => {
  const base = sound === 'electric' ? 3.2 : sound === 'felt' ? 2.6 : 5;
  return Math.max(0.6, base * Math.pow(2, -(note - 48) / 30));
};

export class PianoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private waves = new Map<string, PeriodicWave>();
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private sustain = false;
  private settings: PianoSettings;

  constructor(settings: PianoSettings) {
    this.settings = settings;
  }

  configure(settings: PianoSettings): void {
    const wasOn = this.settings.enabled;
    this.settings = settings;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(settings.volume * 0.5, this.ctx.currentTime, 0.02);
    }
    if (wasOn && !settings.enabled) this.allOff();
  }

  /** Creates the audio graph on first use. Returns null where Web Audio is unavailable. */
  private context(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    if (typeof AudioContext === 'undefined') return null;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = this.settings.volume * 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);

    // A short room so it sounds like an instrument rather than a test tone.
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const room = ctx.createConvolver();
    room.buffer = impulse(ctx, 1.9);
    dry.connect(master);
    dry.connect(room).connect(wet).connect(master);

    this.noise = noiseBuffer(ctx);
    this.ctx = ctx;
    this.master = master;
    this.dry = dry;
    return ctx;
  }

  private wave(ctx: AudioContext, kind: 'grand' | 'felt'): PeriodicWave {
    let wave = this.waves.get(kind);
    if (!wave) {
      const amps =
        kind === 'grand'
          ? [0, 1, 0.62, 0.38, 0.3, 0.18, 0.14, 0.09, 0.07, 0.05, 0.035, 0.025]
          : [0, 1, 0.32, 0.12, 0.06, 0.025, 0.012];
      const real = new Float32Array(amps.length);
      const imag = Float32Array.from(amps);
      wave = ctx.createPeriodicWave(real, imag);
      this.waves.set(kind, wave);
    }
    return wave;
  }

  noteOn(note: number, velocity: number): void {
    if (!this.settings.enabled) return;
    const ctx = this.context();
    if (!ctx || !this.dry) return;
    // Retriggering a key that is still sounding: let the old one go quickly.
    for (const v of this.voices) if (v.note === note) this.release(v, ctx.currentTime, 0.04);
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      oldest?.stop(ctx.currentTime + 0.02);
    }
    const voice = this.makeVoice(ctx, this.dry, note, velocityGain(velocity));
    this.voices.push(voice);
  }

  noteOff(note: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const v of this.voices) {
      if (v.note !== note || v.sustained) continue;
      if (this.sustain) v.sustained = true;
      else this.release(v, ctx.currentTime);
    }
  }

  setSustain(down: boolean): void {
    this.sustain = down;
    const ctx = this.ctx;
    if (down || !ctx) return;
    for (const v of [...this.voices]) if (v.sustained) this.release(v, ctx.currentTime);
  }

  /** Silences everything quickly (turned off, panic, device unplugged). */
  allOff(): void {
    const ctx = this.ctx;
    this.sustain = false;
    if (!ctx) return;
    for (const v of [...this.voices]) this.release(v, ctx.currentTime, 0.05);
  }

  dispose(): void {
    this.allOff();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private release(v: Voice, now: number, time?: number): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    const tail = time ?? (this.settings.sound === 'felt' ? 0.45 : 0.3);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
    v.gain.gain.setTargetAtTime(0, now, tail / 4);
    v.stop(now + tail * 1.6);
  }

  private makeVoice(ctx: AudioContext, out: AudioNode, note: number, level: number): Voice {
    const now = ctx.currentTime;
    const hz = midiToHz(note);
    const sound = this.settings.sound;
    const decay = decayFor(note, sound);
    const gain = ctx.createGain();
    gain.connect(out);
    const sources: AudioScheduledSourceNode[] = [];
    const peak = level * (sound === 'electric' ? 0.55 : 0.42);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + (sound === 'felt' ? 0.008 : 0.003));
    gain.gain.setTargetAtTime(peak * 0.08, now + 0.01, decay / 3);

    if (sound === 'electric') {
      // Two-operator FM: a sine carrier whose brightness (mod index) dies away.
      const carrier = ctx.createOscillator();
      carrier.frequency.value = hz;
      const mod = ctx.createOscillator();
      mod.frequency.value = hz;
      const index = ctx.createGain();
      const depth = hz * (1.2 + 2.8 * level);
      index.gain.setValueAtTime(depth, now);
      index.gain.setTargetAtTime(hz * 0.3, now, 0.25);
      mod.connect(index).connect(carrier.frequency);
      const bell = ctx.createOscillator();
      bell.frequency.value = hz * 4.01;
      const bellGain = ctx.createGain();
      bellGain.gain.setValueAtTime(0.08 * level, now);
      bellGain.gain.setTargetAtTime(0, now, 0.12);
      bell.connect(bellGain).connect(gain);
      carrier.connect(gain);
      sources.push(carrier, mod, bell);
    } else {
      // Additive tone through a low-pass that closes as the note decays.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const bright = sound === 'grand' ? 9 + 18 * level : 3 + 6 * level;
      filter.frequency.setValueAtTime(Math.min(18000, hz * bright), now);
      filter.frequency.setTargetAtTime(
        Math.min(18000, hz * (sound === 'grand' ? 3 : 1.6)),
        now,
        decay / 4,
      );
      filter.connect(gain);
      const wave = this.wave(ctx, sound);
      for (const cents of sound === 'grand' ? [-1.5, 1.5] : [-3, 0, 3]) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(wave);
        osc.frequency.value = hz;
        osc.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = sound === 'grand' ? 0.5 : 0.34;
        osc.connect(g).connect(filter);
        sources.push(osc);
      }
      // The hammer: a very short filtered knock.
      if (this.noise) {
        const knock = ctx.createBufferSource();
        knock.buffer = this.noise;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = Math.min(6000, hz * 3);
        band.Q.value = 1.2;
        const kg = ctx.createGain();
        const amount = (sound === 'grand' ? 0.35 : 0.22) * level;
        kg.gain.setValueAtTime(amount, now);
        kg.gain.exponentialRampToValueAtTime(0.0001, now + (sound === 'felt' ? 0.06 : 0.035));
        knock.connect(band).connect(kg).connect(gain);
        sources.push(knock);
      }
    }
    for (const s of sources) s.start(now);
    const end = now + decay * 3 + 0.5;
    for (const s of sources) s.stop(end);
    let stopped = false;
    const voice: Voice = {
      note,
      started: now,
      sustained: false,
      gain,
      stop: (at) => {
        if (stopped) return;
        stopped = true;
        for (const s of sources) {
          try {
            s.stop(at);
          } catch {
            // Already stopped.
          }
        }
        setTimeout(() => gain.disconnect(), Math.max(0, (at - ctx.currentTime) * 1000) + 100);
      },
    };
    // Notes ring out on their own; forget them once they are silent.
    sources[0]?.addEventListener('ended', () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      gain.disconnect();
    });
    return voice;
  }
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
  }
  return buffer;
}
