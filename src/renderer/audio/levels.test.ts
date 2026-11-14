import { describe, expect, it } from 'vitest';
import { AudioInput } from './input';
import { bandsFromSpectrum, LevelFollower, responseFor, rms, type RawLevels } from './levels';

const raw = (level: number, partial: Partial<RawLevels> = {}): RawLevels => ({
  level,
  bass: level,
  mid: level,
  treble: level,
  ...partial,
});

/** Runs the follower for a while on steady sound and returns the level it settles at. */
function settle(sensitivity: number, level: number, seconds = 6): number {
  const follower = new LevelFollower();
  for (let t = 0; t < seconds; t += 1 / 60) follower.step(raw(level), 1 / 60, sensitivity);
  return follower.levels.level;
}

describe('sound sensitivity', () => {
  it('covers the whole range, from stiff to as sensitive as it gets', () => {
    const stiff = responseFor(0);
    const middle = responseFor(0.5);
    const keen = responseFor(1);
    expect(stiff.gain).toBe(1);
    expect(keen.gain).toBeCloseTo(1000);
    expect(middle.gain).toBeGreaterThan(stiff.gain);
    expect(middle.gain).toBeLessThan(keen.gain);
    // Most sensitive: nothing is gated and it follows the sound instantly.
    expect(keen.gate).toBe(0);
    expect(keen.attack).toBe(0);
    // Stiffest: a real gate, slow to rise, slower to fall.
    expect(stiff.gate).toBeGreaterThan(0.3);
    expect(stiff.attack).toBeGreaterThan(0.3);
    expect(stiff.release).toBeGreaterThan(stiff.attack);
    expect(stiff.beatRatio).toBeGreaterThan(keen.beatRatio);
  });

  it('gets steadily more responsive as the slider goes up', () => {
    let previous = responseFor(0);
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const next = responseFor(s);
      expect(next.gain).toBeGreaterThan(previous.gain);
      expect(next.gate).toBeLessThanOrEqual(previous.gate);
      expect(next.attack).toBeLessThanOrEqual(previous.attack);
      expect(next.release).toBeLessThan(previous.release);
      previous = next;
    }
  });

  it('treats out-of-range and broken values safely', () => {
    expect(responseFor(-3)).toEqual(responseFor(0));
    expect(responseFor(9)).toEqual(responseFor(1));
    expect(responseFor(Number.NaN)).toEqual(responseFor(0.5));
  });

  it('a whisper fills the meter at the top and does nothing at the bottom', () => {
    const whisper = 0.002;
    expect(settle(1, whisper)).toBe(1);
    expect(settle(0.5, whisper)).toBeLessThan(0.1);
    expect(settle(0, whisper)).toBe(0);
  });

  it('ordinary speech moves the middle setting but not the stiffest', () => {
    const speech = 0.03;
    expect(settle(0.5, speech)).toBeGreaterThan(0.5);
    expect(settle(0, speech)).toBe(0);
    // Even the stiffest setting gives way to something really loud.
    expect(settle(0, 0.9)).toBeGreaterThan(0.5);
  });

  it('is instant at the top and slow at the bottom', () => {
    const keen = new LevelFollower();
    keen.step(raw(0.5), 1 / 60, 1);
    expect(keen.levels.level).toBe(1);

    const stiff = new LevelFollower();
    stiff.step(raw(1), 1 / 60, 0);
    expect(stiff.levels.level).toBeLessThan(0.1);
  });

  it('falls back to exactly zero in silence', () => {
    const follower = new LevelFollower();
    for (let i = 0; i < 30; i++) follower.step(raw(0.4), 1 / 60, 0.6);
    expect(follower.silent).toBe(false);
    for (let i = 0; i < 60 * 20; i++) follower.step(raw(0), 1 / 60, 0.6);
    expect(follower.silent).toBe(true);
  });

  it('keeps every value inside 0..1 whatever comes in', () => {
    const follower = new LevelFollower();
    for (const level of [0, 0.001, 0.5, 5, 1000]) {
      const l = follower.step(raw(level), 1 / 60, 1);
      for (const v of [l.level, l.bass, l.mid, l.treble, l.beat]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fires a beat on a sudden rise, not on steady sound, and lets it fade', () => {
    const follower = new LevelFollower();
    for (let i = 0; i < 120; i++) follower.step(raw(0.01), 1 / 60, 0.5);
    expect(follower.levels.beat).toBe(0);
    follower.step(raw(0.2), 1 / 60, 0.5);
    expect(follower.levels.beat).toBe(1);
    for (let i = 0; i < 120; i++) follower.step(raw(0.2), 1 / 60, 0.5);
    expect(follower.levels.beat).toBe(0);
  });

  it('the stiffest setting ignores a clap that the middle setting catches', () => {
    const clap = (sensitivity: number): number => {
      const follower = new LevelFollower();
      for (let i = 0; i < 60; i++) follower.step(raw(0.005), 1 / 60, sensitivity);
      follower.step(raw(0.15), 1 / 60, sensitivity);
      return follower.levels.beat;
    };
    expect(clap(0.5)).toBe(1);
    expect(clap(0)).toBe(0);
  });
});

describe('measuring sound', () => {
  it('computes loudness of a block of samples', () => {
    expect(rms(new Float32Array(8))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('sorts a spectrum into bass, middle and treble', () => {
    const binHz = 48000 / 2048;
    const spectrum = (hz: number): Float32Array => {
      const bins = new Float32Array(1024).fill(-Infinity);
      bins[Math.round(hz / binHz)] = -12;
      return bins;
    };
    const out: RawLevels = { level: 0, bass: 0, mid: 0, treble: 0 };
    bandsFromSpectrum(spectrum(100), binHz, out);
    expect(out.bass).toBeGreaterThan(0.5);
    expect(out.mid).toBe(0);
    expect(out.treble).toBe(0);
    bandsFromSpectrum(spectrum(1000), binHz, out);
    expect(out).toMatchObject({ bass: 0, treble: 0 });
    expect(out.mid).toBeGreaterThan(0.5);
    bandsFromSpectrum(spectrum(5000), binHz, out);
    expect(out).toMatchObject({ bass: 0, mid: 0 });
    expect(out.treble).toBeGreaterThan(0.5);
    // Silence, and anything above 8 kHz, counts for nothing.
    bandsFromSpectrum(spectrum(15000), binHz, out);
    expect(out).toMatchObject({ bass: 0, mid: 0, treble: 0 });
  });
});

describe('sound input', () => {
  const options = { requestAccess: () => Promise.resolve(false), mock: true, onProblem: () => {} };
  const on = { enabled: true, sensitivity: 1, deviceId: '' };

  it('is silent and inactive while switched off, even if sound is injected', () => {
    const input = new AudioInput();
    input.start(options);
    input.inject({ level: 0.5, bass: 0.5, mid: 0.5, treble: 0.5 });
    const levels = input.read(1000);
    expect(levels.active).toBe(false);
    expect(levels.level).toBe(0);
  });

  it('follows injected sound once switched on, and returns the same object every time', () => {
    const input = new AudioInput();
    input.start(options);
    input.configure(on);
    input.inject({ level: 0.5, bass: 0.5, mid: 0, treble: 0 });
    const first = input.read(1000);
    const second = input.read(1016);
    expect(second).toBe(first);
    expect(second.active).toBe(true);
    expect(second.level).toBe(1);
    expect(second.bass).toBe(1);
    expect(second.mid).toBe(0);
  });

  it('measures once per frame however many animations read it', () => {
    const input = new AudioInput();
    input.start(options);
    input.configure({ ...on, sensitivity: 0.3 });
    input.inject({ level: 0.2, bass: 0, mid: 0, treble: 0 });
    input.read(1000);
    const once = input.read(1016).level;
    // Two more reads inside the same frame must not advance the smoothing.
    expect(input.read(1016.5).level).toBe(once);
    expect(input.read(1017).level).toBe(once);
    expect(input.read(1033).level).toBeGreaterThan(once);
  });

  it('goes quiet in the window that is not listening, and the sensitivity applies at once', () => {
    const input = new AudioInput();
    input.start(options);
    input.configure(on);
    input.inject({ level: 0.01, bass: 0, mid: 0, treble: 0 });
    input.read(1000);
    expect(input.read(1016).level).toBe(1);
    input.setSensitivity(0);
    for (let t = 1032; t < 30000; t += 16) input.read(t);
    expect(input.levels.level).toBe(0);
    input.setSensitivity(1);
    input.setWindowActive(false);
    expect(input.read(30100).active).toBe(false);
    input.setSensitivity(Number.NaN);
    expect(input.sensitivity).toBe(1);
  });
});
