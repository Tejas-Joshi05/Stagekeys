import { clamp01 } from '../shared/util';

/*
 * Turning raw loudness into something animations can use.
 *
 * Everything here is plain arithmetic with no Web Audio in it, so it can be
 * tested, and so the same code shapes a real microphone and injected test
 * levels. One number, the sensitivity, decides the whole feel:
 *
 *   1  most sensitive: huge gain, no gate, instant. A whisper fills the meter.
 *   0  stiffest: no gain, a high gate, slow to rise and slower to fall. Only
 *      loud sound moves anything, and then only gradually.
 */

/** What animations read each frame. Every value is 0..1. */
export interface AudioLevels {
  /** True while sound input is switched on and delivering sound. */
  active: boolean;
  /** Overall loudness. */
  level: number;
  /** Roughly 40-250 Hz: kick drums, a low voice, the left hand. */
  bass: number;
  /** Roughly 250 Hz-2 kHz: most of a voice. */
  mid: number;
  /** Roughly 2-8 kHz: consonants, claps, cymbals. */
  treble: number;
  /** Jumps to 1 on a sudden rise (a clap, a kick, a hard consonant) and fades in about a quarter second. */
  beat: number;
}

/** Linear amplitudes straight from the analyser, before any shaping. Full scale is about 1. */
export interface RawLevels {
  level: number;
  bass: number;
  mid: number;
  treble: number;
}

export interface AudioResponse {
  /** Multiplier applied to the raw amplitude. */
  gain: number;
  /** Amplified sound below this is ignored (0..1). */
  gate: number;
  /** Seconds to rise most of the way to a louder sound. 0 is instant. */
  attack: number;
  /** Seconds to fall most of the way back. */
  release: number;
  /** A beat fires when the sound is this many times its recent average. */
  beatRatio: number;
}

export const SILENT_RAW: RawLevels = { level: 0, bass: 0, mid: 0, treble: 0 };

const BEAT_FADE_S = 0.12;
const BEAT_GAP_S = 0.11;
const AVERAGE_S = 0.4;
/** Higher bands carry less energy, so they are lifted to sit level with the bass. */
const MID_TILT = 1.4;
const TREBLE_TILT = 2.5;

/** The whole range of the sensitivity slider, from stiffest (0) to most sensitive (1). */
export function responseFor(sensitivity: number): AudioResponse {
  const s = clamp01(Number.isFinite(sensitivity) ? sensitivity : 0.5);
  const stiff = 1 - s;
  return {
    // 1x at the stiff end, about 32x in the middle (speech fills the meter), 1000x at the top.
    gain: Math.pow(10, 3 * s),
    gate: 0.35 * stiff * stiff,
    attack: 0.5 * stiff * stiff,
    release: 0.04 + 1.6 * stiff * stiff,
    beatRatio: 1.15 + 1.35 * stiff,
  };
}

const approach = (current: number, target: number, dt: number, seconds: number): number =>
  seconds <= 0 ? target : current + (target - current) * (1 - Math.exp(-dt / seconds));

/** Amplifies, gates and clips one raw amplitude to 0..1. */
function shape(amplitude: number, r: AudioResponse): number {
  const v = (amplitude * r.gain - r.gate) / (1 - r.gate);
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** Moves a level towards its target: quickly up (attack), slowly down (release). */
function follow(current: number, target: number, dt: number, r: AudioResponse): number {
  const next = approach(current, target, dt, target > current ? r.attack : r.release);
  return next < 0.0005 && target === 0 ? 0 : next;
}

/** Smooths raw loudness into `levels`, according to the sensitivity. Allocates nothing per step. */
export class LevelFollower {
  readonly levels: AudioLevels = {
    active: false,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0,
  };
  private average = 0;
  private sinceBeat = 1;
  /** The response for the sensitivity last seen, so it is only worked out when the slider moves. */
  private response = responseFor(0.5);
  private responseAt = 0.5;

  /** True when every value has settled at zero, so stepping with silence would change nothing. */
  get silent(): boolean {
    const l = this.levels;
    return l.level === 0 && l.bass === 0 && l.mid === 0 && l.treble === 0 && l.beat === 0;
  }

  step(raw: RawLevels, dt: number, sensitivity: number): AudioLevels {
    if (sensitivity !== this.responseAt) {
      this.response = responseFor(sensitivity);
      this.responseAt = sensitivity;
    }
    const r = this.response;
    const l = this.levels;
    l.level = follow(l.level, shape(raw.level, r), dt, r);
    l.bass = follow(l.bass, shape(raw.bass, r), dt, r);
    l.mid = follow(l.mid, shape(raw.mid * MID_TILT, r), dt, r);
    l.treble = follow(l.treble, shape(raw.treble * TREBLE_TILT, r), dt, r);

    // Beats: the sound jumping well above its own recent average.
    const energy = Math.min(4, raw.level * r.gain);
    this.sinceBeat += dt;
    if (
      energy > r.gate + 0.05 &&
      energy > this.average * r.beatRatio &&
      this.sinceBeat >= BEAT_GAP_S
    ) {
      l.beat = 1;
      this.sinceBeat = 0;
    } else if (l.beat > 0) {
      l.beat *= Math.exp(-dt / BEAT_FADE_S);
      if (l.beat < 0.002) l.beat = 0;
    }
    this.average = approach(this.average, energy, dt, AVERAGE_S);
    if (this.average < 1e-6) this.average = 0;
    return l;
  }

  reset(): void {
    const l = this.levels;
    l.level = l.bass = l.mid = l.treble = l.beat = 0;
    this.average = 0;
    this.sinceBeat = 1;
  }
}

/**
 * Loudness of three bands from an analyser's spectrum (decibels per bin, as
 * `getFloatFrequencyData` gives it). Written into `out`.
 */
export function bandsFromSpectrum(
  decibels: Float32Array,
  binHz: number,
  out: RawLevels,
): RawLevels {
  let bass = 0;
  let mid = 0;
  let treble = 0;
  const last = Math.min(decibels.length - 1, Math.floor(8000 / binHz));
  for (let i = Math.max(1, Math.floor(40 / binHz)); i <= last; i++) {
    const db = decibels[i] ?? -Infinity;
    if (db < -100) continue;
    const power = Math.pow(10, db / 10);
    const hz = i * binHz;
    if (hz < 250) bass += power;
    else if (hz < 2000) mid += power;
    else treble += power;
  }
  // The analyser's window and scaling leave a full-scale tone at roughly a quarter.
  out.bass = Math.sqrt(bass) * 4;
  out.mid = Math.sqrt(mid) * 4;
  out.treble = Math.sqrt(treble) * 4;
  return out;
}

/** Root-mean-square loudness of a block of samples. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}
