import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';
import { ATLAS_FONT_PX, RAMP, sharedGlyphAtlas, type GlyphAtlas } from '../glyphs';

/*
 * A frame of ASCII ink around the slide: dense at the edge, empty in the
 * middle, printed in two inks like the garden. It listens to two different
 * things and answers each in its own way:
 *
 *   SOUND (a microphone or line input) moves the WHOLE shape, smoothly, in the
 *   main ink: it breathes with the loudness, thickens with the bass, sparkles
 *   with the treble and kicks on beats.
 *
 *   MIDI makes LOCAL marks in a third ink: each key bites into the frame where
 *   that key sits, held keys keep their bite, harder hits bite deeper.
 *
 * Pitch bend slides the opening sideways; the mod wheel makes the edge restless.
 */

export const VIGNETTE_SHAPES = [
  'oval',
  'circle',
  'box',
  'diamond',
  'hexagon',
  'triangle',
  'star',
  'heart',
  'letterbox',
  'curtains',
  'corners',
] as const;
export type VignetteShape = (typeof VIGNETTE_SHAPES)[number];

/** Glyph ramps, light to heavy. The first character of each is the empty cell. */
const GLYPH_SETS = {
  riso: RAMP,
  code: ' .,:;()<>{}=/*#',
  dots: ' .:oO0@',
  binary: ' .01',
  slashes: ' .-/\\|X#',
  blocks: ' ░▒▓█',
} as const;
type GlyphSet = keyof typeof GLYPH_SETS;
const GLYPH_SET_NAMES = Object.keys(GLYPH_SETS) as [GlyphSet, ...GlyphSet[]];

const SAMPLE_DT = 1 / 30;
const MAX_CELLS = 24000;
const MAX_HITS = 16;
const MAX_RINGS = 10;
const RING_LIFE = 1.6;
const RING_SPEED = 1.5;
const RING_BAND = 0.14;
const MOD_WHEEL = 1;
const TAU = Math.PI * 2;

const paramsSchema = z.object({
  shape: param.choice('Shape of the opening', VIGNETTE_SHAPES, 'oval'),
  opening: param.number('Opening size', 0.62, 0.05, 1.5),
  softness: param.number('Edge softness', 0.5, 0.02, 1.5),
  density: param.number('Ink strength', 0.85, 0.1, 1),
  invert: param.boolean('Fill the middle instead of the edge', false),
  glyphs: param.choice('Glyphs', GLYPH_SET_NAMES, 'riso'),
  inkColour: param.colour('Ink', '#4f4b2e'),
  misColour: param.colour('Second ink', '#d8a4af'),
  keyColour: param.colour('Key ink (MIDI)', '#d8a4af'),
  print: param.choice('Print as', ['riso on light', 'ink', 'glow on dark'], 'riso on light'),
  cellSize: param.number('Glyph size (px)', 18, 8, 48, 1),
  grain: param.number('Grain', 0.35, 0, 1),
  drift: param.number('Grain flicker speed', 1, 0, 3),
  wobble: param.number('Edge wobble', 0.12, 0, 1),
  audioReacts: param.choice(
    'Sound makes it',
    ['breathe', 'close in', 'open up', 'shiver', 'equaliser', 'do nothing'],
    'breathe',
  ),
  audioAmount: param.number('Sound amount', 0.7, 0, 2),
  beatKick: param.number('Beat kick', 0.35, 0, 1),
  midiReacts: param.choice(
    'A key press makes it',
    ['bite', 'ripple', 'flash', 'iris', 'do nothing'],
    'bite',
  ),
  midiAmount: param.number('Key amount', 0.7, 0, 2),
  keysFrom: param.choice(
    'Keys come in from',
    ['bottom', 'top', 'left', 'right', 'all around'],
    'bottom',
  ),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * How far a point is from the centre of the opening, in the shape's own
 * measure: 0 at the centre, 1 where the shape touches the nearest edge of the
 * box. `nx`, `ny` run -1..1 across the box; `aspect` is width / height.
 */
export function shapeDistance(
  shape: VignetteShape,
  nx: number,
  ny: number,
  aspect: number,
): number {
  // For shapes that must not stretch with the box: the shorter half-side is 1.
  const ux = aspect > 1 ? nx * aspect : nx;
  const uy = aspect > 1 ? ny : ny / aspect;
  switch (shape) {
    case 'oval':
      return Math.hypot(nx, ny);
    case 'circle':
      return Math.hypot(ux, uy);
    case 'box': {
      const a = nx * nx * nx;
      const b = ny * ny * ny;
      return Math.pow(a * a + b * b, 1 / 6);
    }
    case 'diamond':
      return Math.abs(ux) + Math.abs(uy);
    case 'hexagon':
      return Math.max(Math.abs(ux) * 0.866 + Math.abs(uy) * 0.5, Math.abs(uy));
    case 'triangle':
      return Math.max(Math.abs(ux) * 0.866 - uy * 0.5, uy) * 2;
    case 'star': {
      const r = Math.hypot(ux, uy);
      const turn = ((Math.atan2(uy, ux) + Math.PI / 2) / TAU) * 5;
      const tip = Math.abs((turn - Math.floor(turn)) * 2 - 1);
      return r / (0.45 + 0.55 * Math.pow(tip, 1.4));
    }
    case 'heart': {
      const x = ux * 1.15;
      const y = -(uy - 0.22) * 1.15;
      return Math.hypot(x, y - 0.8 * Math.sqrt(Math.abs(x)));
    }
    case 'letterbox':
      return Math.abs(ny);
    case 'curtains':
      return Math.abs(nx);
    case 'corners':
      return Math.sqrt(Math.abs(nx * ny));
  }
}

/** Where a key lands on the rim of the box, -1..1 on each axis. Low notes first. */
export function rimPoint(note: number, from: Params['keysFrom']): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, (note - 36) / 48));
  const along = u * 2 - 1;
  switch (from) {
    case 'bottom':
      return { x: along, y: 1 };
    case 'top':
      return { x: along, y: -1 };
    case 'left':
      return { x: -1, y: -along };
    case 'right':
      return { x: 1, y: -along };
    case 'all around': {
      // Clockwise from the left edge, over the top.
      const a = Math.PI + u * TAU;
      const x = Math.cos(a);
      const y = Math.sin(a);
      const m = Math.max(Math.abs(x), Math.abs(y));
      return { x: x / m, y: y / m };
    }
  }
}

interface Hit {
  note: number;
  x: number;
  y: number;
  t0: number;
  strength: number;
  level: number;
  held: boolean;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

interface Vignette {
  W: number;
  H: number;
  cols: number;
  rows: number;
  count: number;
  ramp: number;
  atlas: GlyphAtlas | null;
  ink: ParticleContainer<Particle> | null;
  mis: ParticleContainer<Particle> | null;
  inkCells: Particle[];
  misCells: Particle[];
  /** Per cell: position -1..1, a fixed random number, distance and angle for the current shape. */
  nx: Float32Array;
  ny: Float32Array;
  seed: Float32Array;
  dist: Float32Array;
  theta: Float32Array;
  /** What each cell shows now, so only cells that change are written to the GPU. */
  shown: Uint8Array;
  keyed: Uint8Array;
  distKey: string;
  printKey: string;
  inkTint: number;
  keyTint: number;
  hits: Hit[];
  rings: Ring[];
  flash: number;
  iris: number;
  wobbleT: number;
  sinceSample: number;
}

function applyPrint(s: Vignette, p: Params): void {
  const key = `${p.print}|${p.inkColour}|${p.misColour}|${p.keyColour}`;
  if (key === s.printKey || !s.ink || !s.mis) return;
  s.printKey = key;
  s.ink.blendMode =
    p.print === 'riso on light' ? 'multiply' : p.print === 'glow on dark' ? 'add' : 'normal';
  s.mis.blendMode = p.print === 'glow on dark' ? 'add' : 'normal';
  s.inkTint = hexToNumber(p.inkColour);
  s.keyTint = hexToNumber(p.keyColour);
  const mis = hexToNumber(p.misColour);
  s.inkCells.forEach((q, k) => {
    q.tint = s.keyed[k] ? s.keyTint : s.inkTint;
  });
  for (const q of s.misCells) q.tint = mis;
}

/** Recomputes each cell's distance and angle when the shape or the centre moves. */
function measure(s: Vignette, shape: VignetteShape, shift: number): void {
  const key = `${shape}|${shift.toFixed(3)}`;
  if (key === s.distKey) return;
  s.distKey = key;
  const aspect = s.W / s.H;
  for (let k = 0; k < s.count; k++) {
    const x = (s.nx[k] ?? 0) - shift;
    const y = s.ny[k] ?? 0;
    s.dist[k] = shapeDistance(shape, x, y, aspect);
    s.theta[k] = Math.atan2(y, x);
  }
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface Live {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  bend: number;
  mod: number;
}

const STILL: Live = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, bend: 0, mod: 0 };

/** Works out every cell's glyph for this moment and writes the ones that changed. */
function draw(s: Vignette, t: number, p: Params, live: Live): void {
  if (!s.atlas) return;
  measure(s, p.shape, live.bend * 0.3);

  // ── Sound: moves the whole shape ──────────────────────────────────────────
  const A = p.audioReacts === 'do nothing' ? 0 : p.audioAmount;
  let open = p.opening;
  let wobble = p.wobble + live.mod * 0.5;
  let thick = 0;
  let sparkle = 0;
  let eq = 0;
  switch (p.audioReacts) {
    case 'breathe':
      open -= A * 0.3 * live.level;
      thick = A * 0.35 * live.bass;
      sparkle = A * 0.5 * live.treble;
      break;
    case 'close in':
      open *= 1 - Math.min(0.95, A * live.level);
      thick = A * 0.3 * live.bass;
      break;
    case 'open up':
      open += A * 0.6 * live.level;
      break;
    case 'shiver':
      wobble += A * (0.5 * live.level + 0.6 * live.treble);
      sparkle = A * 0.35 * live.treble;
      break;
    case 'equaliser':
      eq = A * 0.45;
      break;
    case 'do nothing':
      break;
  }
  if (A > 0) open -= p.beatKick * 0.15 * live.beat;

  // ── MIDI: whole-shape parts (flash, iris). Local marks are added per cell. ──
  const M = p.midiReacts === 'do nothing' ? 0 : p.midiAmount;
  const openBeforeKeys = open;
  if (s.flash > 0.004) open -= 0.2 * s.flash * M;
  if (s.iris > 0.004) open *= 1 - Math.min(0.97, s.iris * M);
  const keysMoveEdge = open !== openBeforeKeys;

  const soft = Math.max(0.02, p.softness);
  const top = s.ramp - 1;
  const step = Math.floor(t * 6 * p.drift);
  const grain = p.grain * 0.25;
  const glyphs = s.atlas.glyphs;
  const hits = s.hits;
  const rings = s.rings;
  const flashInk = s.flash * M * 0.6;

  for (let k = 0; k < s.count; k++) {
    const d = s.dist[k] ?? 0;
    const x = s.nx[k] ?? 0;
    const y = s.ny[k] ?? 0;
    let o = open;
    let o0 = openBeforeKeys;
    if (wobble > 0) {
      const a = s.theta[k] ?? 0;
      const w =
        1 +
        wobble *
          (0.5 * Math.sin(a * 3 + s.wobbleT * 0.7) +
            0.3 * Math.sin(a * 7 - s.wobbleT * 1.1) +
            0.2 * Math.sin(a * 13 + s.wobbleT * 1.9));
      o *= w;
      o0 *= w;
    }
    if (eq > 0) {
      // Bass pushes in from below, treble from above, the middle from the sides.
      const push =
        eq *
        (live.bass * (y > 0 ? y : 0) + live.treble * (y < 0 ? -y : 0) + live.mid * Math.abs(x));
      o -= push;
      o0 -= push;
    }
    let e = smooth((d - o) / soft);
    if (p.invert) e = 1 - e;
    let ink = e * p.density * (1 + thick);

    // Local MIDI marks, counted apart so they can be printed in the key ink.
    let key = flashInk * e;
    if (keysMoveEdge) {
      let e0 = smooth((d - o0) / soft);
      if (p.invert) e0 = 1 - e0;
      // Ink that is only there because a key moved the edge belongs to the key.
      const moved = (e - e0) * p.density;
      if (moved > 0) {
        key += moved;
        ink -= moved;
      }
    }
    for (const h of hits) {
      const dx = x - h.x;
      const dy = y - h.y;
      const reach = 0.2 + 0.2 * h.strength;
      const q = (dx * dx + dy * dy) / (reach * reach);
      if (q < 6) key += h.level * M * Math.exp(-q);
    }
    for (const r of rings) {
      const age = t - r.t0;
      const off = Math.abs(Math.hypot(x - r.x, y - r.y) - age * RING_SPEED);
      if (off < RING_BAND) key += r.strength * M * (1 - age / RING_LIFE) * (1 - off / RING_BAND);
    }

    let total = ink + key;
    const noise = (s.seed[k] ?? 0) + step * 0.6180339;
    const n = noise - Math.floor(noise);
    if (total > 0.03) total += (n - 0.5) * grain;
    let ix = total <= 0.04 ? 0 : Math.round(total * top);
    if (ix > top) ix = top;
    else if (ix < 1 && total > 0.04) ix = 1;
    // Treble: glyphs along the edge flicker.
    if (sparkle > 0 && e > 0.02 && e < 0.75 && n < sparkle * 0.6) {
      const roll = n * 7919;
      ix = 1 + Math.floor((roll - Math.floor(roll)) * top);
    }
    const keyed = key > 0.06 && key > ink * 0.6 ? 1 : 0;

    if (ix === s.shown[k] && keyed === s.keyed[k]) continue;
    const inkCell = s.inkCells[k];
    const misCell = s.misCells[k];
    if (!inkCell || !misCell) continue;
    if (ix !== s.shown[k]) {
      const tex = ix > 0 ? glyphs[ix] : undefined;
      if (!tex) {
        inkCell.alpha = 0;
        misCell.alpha = 0;
        s.shown[k] = 0;
      } else {
        inkCell.texture = tex;
        misCell.texture = tex;
        inkCell.alpha = 1;
        misCell.alpha = 0.8;
        s.shown[k] = ix;
      }
    }
    if (keyed !== s.keyed[k]) {
      inkCell.tint = keyed ? s.keyTint : s.inkTint;
      s.keyed[k] = keyed;
    }
  }
}

export const asciiVignette = defineAnimation({
  id: 'ascii-vignette',
  name: 'ASCII vignette',
  description:
    'A frame of ASCII ink around the slide, in a shape you choose. Sound input moves the whole frame (it breathes, closes in, shivers or works as an equaliser); keys leave their own marks in a third ink (bites where the key sits, ripples, a flash or an iris). Pitch bend slides the opening sideways and the mod wheel makes the edge restless.',
  inputs: ['audio', 'trigger', 'velocity', 'heldNotes', 'pitchBend', 'cc'],
  defaultSize: { width: 1920, height: 1080 },
  params: paramsSchema,
  // The grid and the glyph sheet are built in setup; everything else changes live.
  rebuildOn: ['cellSize', 'glyphs'],
  paramsFor: ({ dark }) =>
    dark
      ? {
          inkColour: '#efe6d8',
          misColour: '#d8a4af',
          keyColour: '#c1bc77',
          print: 'glow on dark' as const,
        }
      : {},

  setup(ctx) {
    const p = ctx.params;
    const W = ctx.width;
    const H = ctx.height;
    let cell = p.cellSize;
    while ((W / cell) * (H / cell) > MAX_CELLS) cell *= 1.15;
    const cols = Math.max(1, Math.floor(W / cell));
    const rows = Math.max(1, Math.floor(H / cell));
    const count = cols * rows;
    const chars = GLYPH_SETS[p.glyphs];
    const s: Vignette = {
      W,
      H,
      cols,
      rows,
      count,
      ramp: [...chars].length,
      atlas: null,
      ink: null,
      mis: null,
      inkCells: [],
      misCells: [],
      nx: new Float32Array(count),
      ny: new Float32Array(count),
      seed: new Float32Array(count),
      dist: new Float32Array(count),
      theta: new Float32Array(count),
      shown: new Uint8Array(count),
      keyed: new Uint8Array(count),
      distKey: '',
      printKey: '',
      inkTint: 0xffffff,
      keyTint: 0xffffff,
      hits: [],
      rings: [],
      flash: 0,
      iris: 0,
      wobbleT: 0,
      sinceSample: SAMPLE_DT,
    };
    const gx0 = (W - cols * cell) / 2;
    const gy0 = (H - rows * cell) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        s.nx[k] = ((gx0 + (c + 0.5) * cell) / W) * 2 - 1;
        s.ny[k] = ((gy0 + (r + 0.5) * cell) / H) * 2 - 1;
        const h = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
        s.seed[k] = h - Math.floor(h);
      }
    }

    // Shared and kept for the app's lifetime; see sharedGlyphAtlas.
    s.atlas = sharedGlyphAtlas(chars, 'IBM Plex Mono');
    const empty = s.atlas?.glyphs[0];
    if (!s.atlas || !empty) return s; // No DOM (unit tests): an inert vignette.

    const make = (): ParticleContainer<Particle> => {
      const container = new ParticleContainer<Particle>({
        texture: s.atlas?.sheet,
        dynamicProperties: {
          position: false,
          uvs: true,
          color: true,
          vertex: false,
          rotation: false,
        },
      });
      container.boundsArea = new Rectangle(0, 0, W, H);
      return container;
    };
    s.mis = make();
    s.ink = make();
    s.mis.position.set((1.6 * cell) / 13, (1.2 * cell) / 13);
    const scale = (cell * 1.04) / ATLAS_FONT_PX;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const opts = {
          texture: empty,
          x: gx0 + (c + 0.5) * cell,
          y: gy0 + (r + 0.5) * cell,
          scaleX: scale,
          scaleY: scale,
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 0,
        };
        s.misCells.push(s.mis.addParticle(new Particle(opts)));
        s.inkCells.push(s.ink.addParticle(new Particle(opts)));
      }
    }
    ctx.root.addChild(s.mis, s.ink);
    applyPrint(s, p);
    return s;
  },

  update(s, frame, inputs) {
    if (!s.atlas) return;
    const p = inputs.params;
    const t = frame.time;
    applyPrint(s, p);

    // ── Keys ────────────────────────────────────────────────────────────────
    const mode = p.midiReacts;
    for (const trigger of inputs.triggers) {
      const strength = 0.35 + 0.65 * trigger.value;
      const note = trigger.note;
      // A mapped trigger has no key, so no place on the rim: it acts on the whole frame.
      if (mode === 'flash' || (mode === 'bite' && note === null)) {
        s.flash = Math.max(s.flash, strength);
      } else if (mode === 'iris') {
        s.iris = Math.max(s.iris, strength);
      } else if (mode === 'ripple') {
        const at = note === null ? { x: 0, y: 0 } : rimPoint(note, p.keysFrom);
        s.rings.push({ ...at, t0: t, strength });
        if (s.rings.length > MAX_RINGS) s.rings.shift();
      } else if (mode === 'bite' && note !== null) {
        // Centred a little inside the rim, so the bite reaches into the opening
        // instead of hiding in ink that is already full.
        const rim = rimPoint(note, p.keysFrom);
        const inward = (v: number): number => (Math.abs(v) > 0.999 ? v * 0.72 : v);
        const at = { x: inward(rim.x), y: inward(rim.y) };
        const again = s.hits.find((h) => h.note === note);
        if (again) Object.assign(again, at, { t0: t, strength, held: true });
        else {
          s.hits.push({ note, ...at, t0: t, strength, level: 0, held: true });
          if (s.hits.length > MAX_HITS) s.hits.shift();
        }
      }
    }
    for (const note of inputs.releases) {
      for (const h of s.hits) if (h.note === note) h.held = false;
    }

    // ── Envelopes, every frame, so they are smooth whatever the sample rate ──
    const dt = frame.dt;
    for (const h of s.hits) {
      // A key that is no longer down (released while another slide was up) lets go.
      if (h.held && !inputs.held.has(h.note) && t - h.t0 > 0.05) h.held = false;
      const target = h.held ? h.strength * (0.65 + 0.35 * Math.exp(-(t - h.t0) / 0.3)) : 0;
      h.level += (target - h.level) * (1 - Math.exp(-dt * (target > h.level ? 30 : 3.2)));
    }
    if (s.hits.length > 0) s.hits = s.hits.filter((h) => h.held || h.level > 0.01);
    if (s.rings.length > 0) s.rings = s.rings.filter((r) => t - r.t0 < RING_LIFE);
    s.flash = s.flash > 0.004 ? s.flash * Math.exp(-dt / 0.3) : 0;
    s.iris = s.iris > 0.004 ? s.iris * Math.exp(-dt / 0.45) : 0;
    const audio = inputs.audio;
    const mod = inputs.cc(MOD_WHEEL);
    s.wobbleT += dt * (1 + 2 * mod + (p.audioReacts === 'shiver' ? 4 * audio.level : 0));

    s.sinceSample += dt;
    if (s.sinceSample < SAMPLE_DT) return;
    s.sinceSample = 0;
    draw(s, t, p, {
      level: audio.level,
      bass: audio.bass,
      mid: audio.mid,
      treble: audio.treble,
      beat: audio.beat,
      bend: inputs.pitchBend,
      mod,
    });
  },

  teardown() {
    // Particles live under root, which the host destroys. The atlas is shared and stays.
  },

  showFinal(s, p) {
    if (!s.atlas) return;
    s.hits = [];
    s.rings = [];
    s.flash = 0;
    s.iris = 0;
    applyPrint(s, p);
    draw(s, 0, p, STILL);
  },
});
