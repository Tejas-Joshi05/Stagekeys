import { describe, expect, it } from 'vitest';
import { hash, inkToGlyph, RAMP_MAX } from './glyphs';

describe('ASCII glyph weighting', () => {
  it('leaves paper empty and puts the heaviest glyph on full ink', () => {
    expect(inkToGlyph(0, 0.5)).toBe(0);
    expect(inkToGlyph(0.05, 0.5)).toBe(0);
    expect(inkToGlyph(1, 0.5)).toBe(RAMP_MAX);
  });

  it('gets heavier with darker ink and with held keys', () => {
    const light = inkToGlyph(0.3, 0.5);
    const dark = inkToGlyph(0.7, 0.5);
    expect(light).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(light);
    expect(inkToGlyph(0.3, 0.5, 0.2)).toBeGreaterThan(light);
  });

  it('noise is deterministic and in range', () => {
    expect(hash(1, 2, 3)).toBe(hash(1, 2, 3));
    for (let i = 0; i < 50; i++) {
      const h = hash(i, i * 3, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
