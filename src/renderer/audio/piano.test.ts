import { describe, expect, it } from 'vitest';
import { decayFor, midiToHz, PianoEngine, velocityGain } from './piano';

describe('piano', () => {
  it('tunes A4 to 440 Hz and octaves double', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });

  it('louder for harder hits, silent at zero', () => {
    expect(velocityGain(0)).toBe(0);
    expect(velocityGain(127)).toBe(1);
    expect(velocityGain(100)).toBeGreaterThan(velocityGain(40));
  });

  it('low notes ring longer than high notes', () => {
    expect(decayFor(36, 'grand')).toBeGreaterThan(decayFor(84, 'grand'));
    expect(decayFor(127, 'felt')).toBeGreaterThanOrEqual(0.6);
  });

  it('does nothing without Web Audio, and never throws', () => {
    const engine = new PianoEngine({
      enabled: true,
      volume: 0.5,
      sound: 'felt',
      skipMapped: true,
      pads: false,
    });
    expect(() => {
      engine.noteOn(60, 100);
      engine.setSustain(true);
      engine.noteOff(60);
      engine.setSustain(false);
      engine.allOff();
      engine.dispose();
    }).not.toThrow();
  });
});
