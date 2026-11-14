import type { Container } from 'pixi.js';
import { TRANSITION_GLYPH_NAMES, TRANSITION_KINDS } from '../deck';

export { TRANSITION_KINDS };
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  cut: 'Cut',
  fade: 'Fade',
  dip: 'Dip to black',
  slide: 'Slide sideways',
  'slide-up': 'Slide up',
  cover: 'Cover',
  zoom: 'Zoom',
  'ascii-dissolve': 'ASCII dissolve',
  'ascii-wipe': 'ASCII wipe',
  'ascii-scan': 'ASCII typewriter',
  'ascii-rain': 'ASCII rain',
  'ascii-iris': 'ASCII iris',
};

export type GlyphTransitionKind = Extract<TransitionKind, `ascii-${string}`>;

/** The transitions that break the old slide into character cells. */
export function isGlyphTransition(kind: TransitionKind): kind is GlyphTransitionKind {
  return kind.startsWith('ascii-');
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface SlidePose {
  alpha: number;
  x: number;
  y: number;
  scale: number;
}

export interface TransitionFrame {
  incoming: SlidePose;
  outgoing: SlidePose;
}

export const RESTING: SlidePose = { alpha: 1, x: 0, y: 0, scale: 1 };

/**
 * Where the incoming and outgoing slides should be at progress t (0..1).
 * `direction` is +1 when moving forward through the deck, -1 when going back.
 * Pure, so every transition can be unit-tested. The ASCII transitions do not
 * move the slides at all (see GlyphTransition), so they rest here.
 */
export function transitionFrame(
  kind: TransitionKind,
  t: number,
  width: number,
  direction: 1 | -1,
  height: number = (width * 9) / 16,
): TransitionFrame {
  const p = easeInOut(clamp01(t));
  switch (kind) {
    case 'fade':
      return { incoming: { ...RESTING, alpha: p }, outgoing: RESTING };
    case 'dip':
      // Out to black over the first half, in from black over the second.
      return {
        incoming: { ...RESTING, alpha: clamp01(p * 2 - 1) },
        outgoing: { ...RESTING, alpha: clamp01(1 - p * 2) },
      };
    case 'slide':
      return {
        incoming: { ...RESTING, x: direction * width * (1 - p) },
        outgoing: { ...RESTING, x: -direction * width * p },
      };
    case 'slide-up':
      return {
        incoming: { ...RESTING, y: direction * height * (1 - p) },
        outgoing: { ...RESTING, y: -direction * height * p },
      };
    case 'cover':
      // The new slide slides over the old one, which stays put and dims a little.
      return {
        incoming: { ...RESTING, x: direction * width * (1 - p) },
        outgoing: { ...RESTING, alpha: 1 - 0.5 * p },
      };
    case 'zoom':
      return {
        incoming: { ...RESTING, alpha: p, scale: 0.88 + 0.12 * p },
        outgoing: { ...RESTING, alpha: 1 - p, scale: 1 + 0.12 * p },
      };
    default:
      // Cut, and the ASCII kinds, where the old slide is drawn by the glyph layer.
      return { incoming: RESTING, outgoing: { ...RESTING, alpha: 0 } };
  }
}

/** Applies a pose to a scene root whose pivot is at the slide centre. */
export function applyFrame(root: Container, pose: SlidePose, width: number, height: number): void {
  root.pivot.set(width / 2, height / 2);
  root.position.set(width / 2 + pose.x, height / 2 + pose.y);
  root.scale.set(pose.scale);
  root.alpha = pose.alpha;
}

// ── ASCII transitions: the order the cells turn over ───────────────────────

/** Cheap deterministic noise in 0..1. */
function noise(a: number, b: number, c: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** How much of the transition is spent staggering the cells; the rest is one cell's own turn. */
export const CELL_STAGGER = 0.62;

/**
 * When a cell starts to turn over, 0 (first) to 1 (last). Going back through
 * the deck runs each pattern the other way.
 */
export function cellDelay(
  kind: GlyphTransitionKind,
  col: number,
  row: number,
  cols: number,
  rows: number,
  direction: 1 | -1,
): number {
  const x = cols > 1 ? col / (cols - 1) : 0;
  const y = rows > 1 ? row / (rows - 1) : 0;
  const forward = direction === 1;
  switch (kind) {
    case 'ascii-dissolve':
      return noise(col, row, 7);
    case 'ascii-wipe':
      return clamp01(0.86 * (forward ? x : 1 - x) + 0.14 * noise(col, row, 3));
    case 'ascii-scan': {
      // Row by row, like a terminal redrawing the screen.
      const at = (row * cols + col) / Math.max(1, cols * rows - 1);
      return forward ? at : 1 - at;
    }
    case 'ascii-rain':
      // Each column starts at its own moment and falls (or, going back, rises).
      return clamp01(0.5 * noise(col, 0, 5) + 0.5 * (forward ? y : 1 - y));
    case 'ascii-iris': {
      const dx = (x - 0.5) * 2;
      const dy = (y - 0.5) * 2;
      const distance = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
      return clamp01(0.9 * (forward ? distance : 1 - distance) + 0.1 * noise(col, row, 11));
    }
  }
}

/** A cell's own progress (0 not started, 1 done) at transition progress t. */
export function cellProgress(t: number, delay: number): number {
  return clamp01((clamp01(t) - delay * CELL_STAGGER) / (1 - CELL_STAGGER));
}

/** How much of the old slide still shows in a cell: all of it, then gone by the middle of its turn. */
export function tileAlpha(u: number): number {
  const v = clamp01((u - 0.3) / 0.3);
  return 1 - v * v * (3 - 2 * v);
}

/** How strongly the cell's glyph shows: in quickly, held, then out. */
export function glyphAlpha(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return u < 0.25 ? u / 0.25 : u > 0.6 ? (1 - u) / 0.4 : 1;
}

/**
 * Which glyph of a light-to-heavy set of `count` characters (index 0 is the
 * empty one) a cell shows: the ink swells and thins again, flickering as it goes.
 */
export function glyphIndex(u: number, cell: number, count: number): number {
  if (count < 2) return 0;
  const swell = Math.sin(Math.PI * clamp01(u));
  const flicker = noise(cell, Math.floor(u * 9), 1);
  const ix = Math.round(swell * (0.45 + 0.55 * flicker) * (count - 1));
  return ix < 1 ? 1 : ix > count - 1 ? count - 1 : ix;
}

export type TransitionGlyphs = (typeof TRANSITION_GLYPH_NAMES)[number];

/** The glyph sets on offer, light to heavy. The first character of each is the empty one. */
export const TRANSITION_GLYPHS: Record<TransitionGlyphs, string> = {
  riso: " .'`,-:;~+=<>*ixo%S&#8@MW",
  code: ' .,:;()<>{}=/*#',
  dots: ' .:oO0@',
  binary: ' .01',
  slashes: ' .-/\\|X#',
  blocks: ' ░▒▓█',
};

/** Columns and rows for a cell size, with the cell grown if the grid would be too fine to stay fast. */
export function glyphGrid(
  width: number,
  height: number,
  cell: number,
  maxCells = 6000,
): { cell: number; cols: number; rows: number } {
  let size = Math.max(8, Number.isFinite(cell) ? cell : 40);
  const least = Math.sqrt((width * height) / maxCells);
  if (size < least) size = least;
  let cols = Math.ceil(width / size);
  let rows = Math.ceil(height / size);
  while (cols * rows > maxCells) {
    size *= 1.05;
    cols = Math.ceil(width / size);
    rows = Math.ceil(height / size);
  }
  return { cell: size, cols, rows };
}
