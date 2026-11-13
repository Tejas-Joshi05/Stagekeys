import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { PLANTS, plantImage, type PlantName } from '../art';
import { defineAnimation, param } from '../define';
import { hash, inkToGlyph, RAMP, RAMP_MAX, sharedGlyphAtlas, type GlyphAtlas } from '../glyphs';

/*
 * The live ASCII plants from tejasjoshi.vercel.app, made playable.
 *
 * Each plant is a greyscale ink-density map. About 30 times a second the map is
 * drawn into a small hidden canvas with a little wind, sampled once per grid
 * cell, and each cell gets the glyph whose weight matches. Glyphs are GPU
 * particles from one atlas, printed twice like a riso: a second ink slightly
 * off register underneath, the main ink on top.
 *
 * What MIDI does:
 *   - a key press sends a ripple of flickering glyphs out from that key's
 *     position (harder hits ripple further), or moves to the next plant;
 *   - a mapped trigger (no key) always moves to the next plant, with the
 *     website's centre-out ripple between plants;
 *   - held keys thicken the ink; pitch bend leans the plant; the mod wheel
 *     (bound to Wind by default) blows it about.
 */

const CHARS = `${RAMP}v`;
const BIRD_UP = RAMP.length; // 'v'
const BIRD_FLAT = RAMP.indexOf('-');
const SS = 2; // samples per cell edge
const SAMPLE_DT = 1 / 30;
const TRANS = 1.7; // seconds for the plant-to-plant ripple
const ENTER = 2.8; // seconds for the first grow-in
const MAX_CELLS = 24000;
const MAX_BIRDS = 6;
const MAX_RIPPLES = 12;
const MOD_WHEEL = 1;

const PLANT_LABELS = PLANTS as unknown as readonly [PlantName, ...PlantName[]];

const paramsSchema = z.object({
  plant: param.choice('Plant', PLANT_LABELS, 'tulip'),
  keyPress: param.choice(
    'A key press',
    ['ripple', 'next plant', 'ripple and next plant', 'grow again'],
    'ripple',
  ),
  inkColour: param.colour('Ink', '#4f4b2e'),
  misColour: param.colour('Second ink', '#d8a4af'),
  print: param.choice('Print as', ['riso on light', 'ink', 'glow on dark'], 'riso on light'),
  cellSize: param.number('Glyph size (px)', 15, 8, 48, 1),
  fit: param.number('Plant size', 0.85, 0.3, 1),
  wind: param.number('Wind (the mod wheel adds more)', 0, 0, 1),
  sway: param.number('Idle sway', 1, 0, 3),
  rippleSize: param.number('Ripple reach', 0.6, 0.1, 1.5),
  autoChange: param.number('Change plant every (s, 0 = never)', 0, 0, 120, 1),
  growIn: param.boolean('Grow in when the slide appears', true),
  birds: param.boolean('Birds fly past', true),
});
type Params = z.infer<typeof paramsSchema>;

interface Ripple {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

interface Bird {
  dx: number;
  dy: number;
  ph: number;
  f: number;
}

interface Garden {
  W: number;
  H: number;
  cell: number;
  cols: number;
  rows: number;
  gx0: number;
  gy0: number;
  atlas: GlyphAtlas | null;
  ink: ParticleContainer<Particle> | null;
  mis: ParticleContainer<Particle> | null;
  inkCells: Particle[];
  misCells: Particle[];
  birdParticles: Particle[];
  off: CanvasRenderingContext2D | null;
  cur: Uint8Array;
  prev: Uint8Array;
  plant: number;
  prevPlant: number;
  /** -1 none, otherwise the start time of the plant-to-plant ripple. */
  trans: number;
  /** -1 waiting for the art, >= 0 grow-in start time, -2 grown. */
  enterT: number;
  lastSwitch: number;
  sinceSample: number;
  wind: number;
  ripples: Ripple[];
  flock: { t0: number; dur: number; y: number; birds: Bird[] } | null;
  nextFlock: number;
  printKey: string;
  /** The Plant setting last seen, to notice when it is changed in the editor. */
  plantParam: string;
}

const ease3 = (x: number): number => 1 - Math.pow(1 - x, 3);

function plantIndex(name: string): number {
  const i = (PLANTS as readonly string[]).indexOf(name);
  return i < 0 ? 0 : i;
}

/** Draws plant `index` into the sampling canvas and writes a glyph index per cell into `out`. */
function sample(
  s: Garden,
  index: number,
  t: number,
  p: Params,
  boost: number,
  bend: number,
  out: Uint8Array,
): void {
  out.fill(0);
  const g = s.off;
  const name = PLANTS[index];
  const im = name ? plantImage(name) : null;
  if (!g || !im) return;
  const ow = s.cols * SS;
  const oh = s.rows * SS;
  const k = SS / s.cell;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, ow, oh);

  const iw = im.naturalWidth;
  const ih = im.naturalHeight;
  const scale = Math.min((s.W * p.fit) / iw, (s.H * p.fit) / ih);
  const w = iw * scale;
  const h = ih * scale;
  const ang =
    p.sway * (0.018 * Math.sin(t * 0.5) + 0.01 * Math.sin(t * 1.3)) +
    // Kept small so a full gust plus full bend (about 12°) never pushes the plant out of its box.
    s.wind * (0.04 + 0.03 * Math.sin(t * 2.1) + 0.015 * Math.sin(t * 5.3)) +
    bend * 0.13;
  const breathe = 1 + 0.008 * p.sway * Math.sin(t * 0.8);
  g.setTransform(k, 0, 0, k, -s.gx0 * k, -s.gy0 * k);
  g.translate(s.W / 2, s.H / 2 + h / 2);
  g.rotate(ang);
  g.scale(breathe, breathe);
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, -w / 2, -h, w, h);

  const data = g.getImageData(0, 0, ow, oh).data;
  const inv = 1 / (SS * SS * 255);
  const step = Math.floor(t * 8);
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      let sum = 0;
      for (let yy = 0; yy < SS; yy++) {
        const o = ((r * SS + yy) * ow + c * SS) * 4;
        for (let xx = 0; xx < SS; xx++) sum += data[o + xx * 4] ?? 255;
      }
      out[r * s.cols + c] = inkToGlyph(1 - sum * inv, hash(c, r, step + 7), boost);
    }
  }
}

function switchTo(s: Garden, next: number, t: number): void {
  const name = PLANTS[next];
  if (next === s.plant || s.trans >= 0 || !name || !plantImage(name)) return;
  s.prevPlant = s.plant;
  s.plant = next;
  s.trans = t;
  s.lastSwitch = t;
}

function applyPrint(s: Garden, p: Params): void {
  const key = `${p.print}|${p.inkColour}|${p.misColour}`;
  if (key === s.printKey || !s.ink || !s.mis) return;
  s.printKey = key;
  s.ink.blendMode =
    p.print === 'riso on light' ? 'multiply' : p.print === 'glow on dark' ? 'add' : 'normal';
  s.mis.blendMode = p.print === 'glow on dark' ? 'add' : 'normal';
  const ink = hexToNumber(p.inkColour);
  const mis = hexToNumber(p.misColour);
  for (const q of s.inkCells) q.tint = ink;
  for (const q of s.misCells) q.tint = mis;
  for (const q of s.birdParticles) q.tint = ink;
}

/** Works out each cell's glyph for this moment and writes it to both inks. */
function draw(s: Garden, t: number): void {
  const n = s.cols * s.rows;
  const ep = s.enterT >= 0 ? t - s.enterT : s.enterT === -1 ? -1 : 1e9;
  const p = s.trans < 0 ? 1 : Math.min(1, (t - s.trans) / TRANS);
  const step = Math.floor(t * 8);
  const { cols, rows, cell, gx0, gy0, W, H, cur, prev } = s;

  // Grow-in: bounds of the plant, so it grows from its base, stem first.
  let gb = 0;
  let gt = H;
  let gw = 1;
  if (ep >= 0 && ep < ENTER) {
    for (let k = 0; k < n; k++) {
      if (!cur[k]) continue;
      const y = gy0 + (Math.floor(k / cols) + 0.5) * cell;
      const x = gx0 + ((k % cols) + 0.5) * cell;
      if (y > gb) gb = y;
      if (y < gt) gt = y;
      gw = Math.max(gw, Math.abs(x - W / 2));
    }
  }
  const gh = Math.max(cell, gb - gt);
  const reach = Math.hypot(W, H);
  const band = cell * 3.4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const x = gx0 + (c + 0.5) * cell;
      const y = gy0 + (r + 0.5) * cell;
      const ix = cur[k] ?? 0;
      let g = 0;
      if (ep === -1) {
        g = 0;
      } else if (ep < ENTER) {
        if (ix) {
          let v = (gb - y) / gh;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          const u = Math.min(1, Math.abs(x - W / 2) / gw);
          const tr =
            0.1 + (ENTER - 0.6) * (v * 0.72 + u * 0.28 * (0.5 + 0.5 * v)) + hash(c, r, 5) * 0.12;
          const q = (ep - tr) / 0.45;
          g = q <= 0 ? 0 : q >= 1 ? ix : Math.max(1, Math.round(ix * ease3(q)));
        }
      } else if (s.trans >= 0) {
        // The website's plant change: a ripple from the centre, each cell
        // flickering before it lands on the next plant.
        const a = prev[k] ?? 0;
        if (a || ix) {
          const rr = Math.hypot((c - cols / 2) / (cols / 2), (r - rows / 2) / (rows / 2)) / 1.42;
          const tc = 0.62 * (rr * 0.78 + hash(c, r, 3) * 0.22);
          const q = (p - tc) / 0.26;
          if (q <= 0) g = a;
          else if (q >= 1) g = ix;
          else
            g =
              hash(c, r, 17) > 0.85 && (!a || !ix)
                ? 0
                : 1 + Math.floor(hash(c, r, step * 3 + 1) * RAMP_MAX);
        }
      } else {
        g = ix;
      }

      // Key ripples: a ring of flickering glyphs moving out from the key.
      for (const rp of s.ripples) {
        const radius = (t - rp.t0) * reach * 0.55;
        const d = Math.abs(Math.hypot(x - rp.x, y - rp.y) - radius);
        if (d > band) continue;
        const fade = rp.strength * (1 - radius / (reach * rp.strength + 1));
        if (fade <= 0) continue;
        const chance = (1 - d / band) * fade;
        if (g ? hash(c, r, step + 11) < chance * 1.8 : hash(c, r, step + 23) < chance * 0.7) {
          g = 1 + Math.floor(hash(c, r, step * 5 + 3) * RAMP_MAX);
        }
      }

      const inkCell = s.inkCells[k];
      const misCell = s.misCells[k];
      if (!inkCell || !misCell) continue;
      const tex = s.atlas?.glyphs[g];
      if (g === 0 || !tex) {
        inkCell.alpha = 0;
        misCell.alpha = 0;
      } else {
        inkCell.texture = tex;
        misCell.texture = tex;
        inkCell.alpha = 1;
        misCell.alpha = 0.8;
      }
    }
  }
  if (ep >= ENTER && s.enterT >= 0) {
    s.enterT = -2;
    s.lastSwitch = t;
  }
  if (p >= 1) s.trans = -1;
}

/** A flock of 3-6 small 'v's crossing near the top every 10-18 seconds, flapping between v and -. */
function birds(s: Garden, t: number, on: boolean): void {
  const hide = (): void => {
    for (const b of s.birdParticles) b.alpha = 0;
  };
  if (!on || s.enterT !== -2) return hide();
  if (!s.flock) {
    if (!s.nextFlock) s.nextFlock = t + 4;
    if (t < s.nextFlock) return hide();
    const count = 3 + Math.floor(Math.random() * 4);
    s.flock = {
      t0: t,
      dur: 13 + Math.random() * 5,
      y: s.cell * 1.6 + Math.random() * s.H * 0.16,
      birds: Array.from({ length: count }, (_, j) => ({
        dx: -j * s.cell * (1.8 + Math.random() * 1.6),
        dy: j ? (Math.random() - 0.5) * s.cell * 3 : 0,
        ph: Math.random() * 6.28,
        f: 5 + Math.random() * 2,
      })),
    };
  }
  const q = (t - s.flock.t0) / s.flock.dur;
  if (q > 1) {
    s.flock = null;
    s.nextFlock = t + 10 + Math.random() * 8;
    return hide();
  }
  s.birdParticles.forEach((particle, j) => {
    const b = s.flock?.birds[j];
    const tex = s.atlas?.glyphs[b && Math.sin(t * b.f + b.ph) > -0.2 ? BIRD_UP : BIRD_FLAT];
    if (!b || !tex || !s.flock) {
      particle.alpha = 0;
      return;
    }
    particle.texture = tex;
    particle.x = -s.cell * 2 + q * (s.W + s.cell * 8) + b.dx;
    particle.y = s.flock.y + b.dy + Math.sin(t * 1.3 + b.ph) * s.cell * 0.6 - q * s.cell;
    particle.alpha = particle.x > 0 && particle.x < s.W ? 0.55 : 0;
  });
}

export const asciiGarden = defineAnimation({
  id: 'ascii-garden',
  name: 'ASCII garden',
  description:
    'The live ASCII plants from tejasjoshi.vercel.app. Keys send ripples through the glyphs, a mapped trigger grows the next plant, held keys thicken the ink, pitch bend leans it and the mod wheel blows it about.',
  inputs: ['trigger', 'velocity', 'heldNotes', 'pitchBend', 'cc'],
  defaultSize: { width: 1000, height: 900 },
  params: paramsSchema,
  // Only the grid needs rebuilding; everything else, the plant included, changes live.
  rebuildOn: ['cellSize'],
  // The website prints olive ink on cream paper; on a dark slide, cream ink glows instead.
  paramsFor: ({ dark }) =>
    dark ? { inkColour: '#efe6d8', misColour: '#d8a4af', print: 'glow on dark' as const } : {},

  setup(ctx) {
    const p = ctx.params;
    const W = ctx.width;
    const H = ctx.height;
    let cell = p.cellSize;
    while ((W / cell) * (H / cell) > MAX_CELLS) cell *= 1.15;
    const cols = Math.max(1, Math.floor(W / cell));
    const rows = Math.max(1, Math.floor(H / cell));
    const s: Garden = {
      W,
      H,
      cell,
      cols,
      rows,
      gx0: (W - cols * cell) / 2,
      gy0: (H - rows * cell) / 2,
      atlas: null,
      ink: null,
      mis: null,
      inkCells: [],
      misCells: [],
      birdParticles: [],
      off: null,
      cur: new Uint8Array(cols * rows),
      prev: new Uint8Array(cols * rows),
      plant: plantIndex(p.plant),
      prevPlant: plantIndex(p.plant),
      trans: -1,
      enterT: p.growIn ? -1 : -2,
      lastSwitch: 0,
      sinceSample: SAMPLE_DT,
      wind: 0,
      ripples: [],
      flock: null,
      nextFlock: 0,
      printKey: '',
      plantParam: p.plant,
    };

    // Shared and kept for the app's lifetime; see sharedGlyphAtlas.
    s.atlas = sharedGlyphAtlas(CHARS, 'IBM Plex Mono');
    if (!s.atlas) return s; // No DOM (unit tests): an inert garden.
    const canvas = document.createElement('canvas');
    canvas.width = cols * SS;
    canvas.height = rows * SS;
    s.off = canvas.getContext('2d', { willReadFrequently: true });

    const make = (): ParticleContainer<Particle> => {
      const container = new ParticleContainer<Particle>({
        texture: s.atlas?.sheet,
        dynamicProperties: {
          position: true,
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
    // Off register by about a pixel and a half at the website's 13px cell.
    s.mis.position.set((1.6 * cell) / 13, (1.2 * cell) / 13);
    const scale = (cell * 1.04) / 48;
    const empty = s.atlas.glyphs[0];
    if (!empty) return s;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const opts = {
          texture: empty,
          x: s.gx0 + (c + 0.5) * cell,
          y: s.gy0 + (r + 0.5) * cell,
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
    for (let i = 0; i < MAX_BIRDS; i++) {
      s.birdParticles.push(
        s.ink.addParticle(
          new Particle({
            texture: empty,
            scaleX: scale,
            scaleY: scale,
            anchorX: 0.5,
            anchorY: 0.5,
            alpha: 0,
          }),
        ),
      );
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

    if (s.enterT === -1) {
      const name = PLANTS[s.plant];
      if (name && plantImage(name)) s.enterT = t;
    }

    const advance = (): void => switchTo(s, (s.plant + 1) % PLANTS.length, t);
    for (const trigger of inputs.triggers) {
      if (trigger.note === null) {
        advance();
        continue;
      }
      const note = trigger.note;
      const ripple = (): void => {
        const x = s.W * Math.min(1, Math.max(0, (note - 36) / 48));
        s.ripples.push({
          x,
          y: s.H * (0.45 + Math.random() * 0.25),
          t0: t,
          strength: p.rippleSize * (0.35 + 0.65 * trigger.value),
        });
        if (s.ripples.length > MAX_RIPPLES) s.ripples.shift();
      };
      if (p.keyPress === 'ripple') ripple();
      else if (p.keyPress === 'next plant') advance();
      else if (p.keyPress === 'ripple and next plant') {
        ripple();
        advance();
      } else if (s.enterT === -2 && s.trans < 0) s.enterT = t;
    }
    if (p.autoChange > 0 && s.enterT === -2 && s.trans < 0 && t - s.lastSwitch > p.autoChange)
      advance();

    const reach = Math.hypot(s.W, s.H);
    s.ripples = s.ripples.filter(
      (rp) => (t - rp.t0) * reach * 0.55 < reach * rp.strength + s.cell * 3,
    );
    // The Wind setting is the calm level; the mod wheel blows harder on top of it.
    const wind = Math.max(p.wind, inputs.cc(MOD_WHEEL));
    s.wind += (wind - s.wind) * Math.min(1, frame.dt * 4);
    // Choosing another plant in the editor grows it with the plant-change ripple.
    if (p.plant !== s.plantParam) {
      const target = plantIndex(p.plant);
      switchTo(s, target, t);
      // Mid-change, the switch waits; it is retried next frame.
      if (s.plant === target) s.plantParam = p.plant;
    }

    s.sinceSample += frame.dt;
    if (s.sinceSample >= SAMPLE_DT) {
      s.sinceSample = 0;
      const boost = Math.min(0.22, inputs.held.size * 0.05) + (inputs.sustain ? 0.04 : 0);
      sample(s, s.plant, t, p, boost, inputs.pitchBend, s.cur);
      if (s.trans >= 0) sample(s, s.prevPlant, t, p, boost, inputs.pitchBend, s.prev);
      draw(s, t);
    }
    birds(s, t, p.birds);
  },

  teardown() {
    // Particles live under root, which the host destroys. The atlas is shared and stays.
  },

  showFinal(s, p) {
    if (!s.atlas) return;
    s.enterT = -2;
    s.trans = -1;
    s.ripples = [];
    s.flock = null;
    applyPrint(s, p);
    sample(s, s.plant, 0, p, 0, 0, s.cur);
    draw(s, 0);
    for (const b of s.birdParticles) b.alpha = 0;
  },
});
