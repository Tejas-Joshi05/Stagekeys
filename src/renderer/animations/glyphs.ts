import { Rectangle, Texture } from 'pixi.js';

/** Light to heavy, the same 25-step ramp the website uses. Index 0 is empty. */
export const RAMP = " .'`,-:;~+=<>*ixo%S&#8@MW";
export const RAMP_MAX = RAMP.length - 1;

/** The font size glyphs are drawn at inside the atlas. Particles scale from this. */
export const ATLAS_FONT_PX = 48;

export interface GlyphAtlas {
  /** The whole sheet. Every glyph texture shares its source, which a ParticleContainer requires. */
  sheet: Texture;
  /** One texture per character of `chars`, in order. */
  glyphs: Texture[];
  destroy(): void;
}

/**
 * Draws each character once, white, into a canvas sheet. Tinted per particle,
 * so one sheet serves both inks. Returns null without a DOM (unit tests).
 */
export function createGlyphAtlas(
  chars: string,
  fontFamily: string,
  weight = 500,
): GlyphAtlas | null {
  if (typeof document === 'undefined') return null;
  const slot = Math.ceil(ATLAS_FONT_PX * 1.25);
  const perRow = 8;
  const rows = Math.ceil(chars.length / perRow);
  const canvas = document.createElement('canvas');
  canvas.width = slot * perRow;
  canvas.height = slot * rows;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${weight} ${ATLAS_FONT_PX}px "${fontFamily}", "JetBrains Mono Variable", monospace`;
  [...chars].forEach((ch, i) => {
    g.fillText(ch, (i % perRow) * slot + slot / 2, Math.floor(i / perRow) * slot + slot / 2);
  });

  const sheet = Texture.from(canvas);
  const glyphs = [...chars].map(
    (_, i) =>
      new Texture({
        source: sheet.source,
        frame: new Rectangle((i % perRow) * slot, Math.floor(i / perRow) * slot, slot, slot),
      }),
  );
  return {
    sheet,
    glyphs,
    destroy() {
      for (const glyph of glyphs) glyph.destroy(false);
      sheet.destroy(true);
    },
  };
}

/** Cheap deterministic noise in 0..1, as on the website. */
export function hash(a: number, b: number, c: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Ink darkness (0 white .. 1 full ink) to a ramp index, 0 meaning no glyph.
 * A steep S-curve applied twice: darks go dense, highlights stay sparse, little
 * mush in between. `boost` thickens the ink (held keys).
 */
export function inkToGlyph(darkness: number, noise: number, boost = 0): number {
  if (darkness < 0.1) return 0;
  let e = (darkness - 0.12) / 0.74;
  e = e < 0 ? 0 : e > 1 ? 1 : e;
  e = e * e * (3 - 2 * e);
  e = 0.35 * e + 0.65 * e * e * (3 - 2 * e);
  let d = 0.03 + 0.97 * e + boost;
  d += (noise - 0.5) * 0.04;
  const ix = Math.round(d * RAMP_MAX);
  return ix < 1 ? 1 : ix > RAMP_MAX ? RAMP_MAX : ix;
}

const shared = new Map<string, GlyphAtlas | null>();

/**
 * One atlas per character set and font for the whole app. It is tiny, every
 * renderer can draw from it, and keeping it alive means no instance ever
 * destroys a texture another one (or the GPU batch) is still using.
 */
export function sharedGlyphAtlas(
  chars: string,
  fontFamily: string,
  weight = 500,
): GlyphAtlas | null {
  const key = `${chars}|${fontFamily}|${weight}`;
  if (!shared.has(key)) shared.set(key, createGlyphAtlas(chars, fontFamily, weight));
  return shared.get(key) ?? null;
}
