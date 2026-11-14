import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';
import { ATLAS_FONT_PX, sharedGlyphAtlas } from '../glyphs';

/*
 * A burst of glyphs: every key (or a mapped pad) throws a handful of
 * characters into the air from where that key sits, and they tumble and fall
 * back. Optionally a clap or a beat in the sound input sets one off too.
 *
 * All particles are made once. A burst only wakes some of them up, so playing
 * fast allocates nothing.
 */

const POOL = 600;

const GLYPHS = {
  code: '{}()<>=/*#;[]',
  riso: "+=<>*ixo%S&#8@MW.:;~'",
  stars: '*+.x·:',
} as const;
type GlyphSet = keyof typeof GLYPHS;
const GLYPH_NAMES = Object.keys(GLYPHS) as [GlyphSet, ...GlyphSet[]];

const paramsSchema = z.object({
  glyphs: param.choice('Glyphs', GLYPH_NAMES, 'code'),
  count: param.integer('Glyphs per hit', 36, 1, 150),
  from: param.choice(
    'They fly from',
    ['where the key is', 'bottom centre', 'centre', 'anywhere'],
    'where the key is',
  ),
  speed: param.number('Speed', 1, 0.1, 3),
  spread: param.number('Spread (degrees)', 110, 5, 360, 1),
  gravity: param.number('Gravity', 1, 0, 3),
  life: param.number('Life (s)', 1.8, 0.2, 6, 0.05),
  size: param.number('Glyph size (px)', 34, 8, 140, 1),
  spin: param.number('Tumble', 1, 0, 4),
  colour: param.colour('Ink', '#efe6d8'),
  colour2: param.colour('Second ink', '#d8a4af'),
  colour3: param.colour('Third ink', '#c1bc77'),
  glow: param.boolean('Glow (for dark slides)', true),
  soundBeats: param.boolean('Claps and beats in the sound burst too', false),
});
type Params = z.infer<typeof paramsSchema>;

interface Burst {
  W: number;
  H: number;
  container: ParticleContainer<Particle> | null;
  particles: Particle[];
  /** Per particle: velocity, age, lifetime (0 = asleep) and spin. */
  vx: Float32Array;
  vy: Float32Array;
  age: Float32Array;
  life: Float32Array;
  spin: Float32Array;
  next: number;
  awake: number;
  seed: number;
  lastBeat: number;
  glow: boolean | null;
}

/** A small deterministic random source, so thumbnails and exports always look the same. */
function random(s: Burst): number {
  s.seed = (s.seed * 1664525 + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

/** Where a burst starts for this key, in pixels. `note` is null for a mapped trigger or a beat. */
export function burstOrigin(
  from: Params['from'],
  note: number | null,
  width: number,
  height: number,
  roll: number,
): { x: number; y: number } {
  switch (from) {
    case 'centre':
      return { x: width / 2, y: height / 2 };
    case 'bottom centre':
      return { x: width / 2, y: height };
    case 'anywhere':
      return { x: width * (0.1 + 0.8 * roll), y: height * (0.3 + 0.5 * ((roll * 7.13) % 1)) };
    case 'where the key is':
      return {
        x:
          note === null
            ? width * (0.1 + 0.8 * roll)
            : width * Math.min(1, Math.max(0, (note - 36) / 48)),
        y: height,
      };
  }
}

function burst(s: Burst, p: Params, note: number | null, strength: number): void {
  const origin = burstOrigin(p.from, note, s.W, s.H, random(s));
  const count = Math.max(1, Math.round(p.count * (0.35 + 0.65 * strength)));
  const inks = [hexToNumber(p.colour), hexToNumber(p.colour2), hexToNumber(p.colour3)];
  const spread = (p.spread * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const k = s.next;
    s.next = (s.next + 1) % s.particles.length;
    const particle = s.particles[k];
    if (!particle) continue;
    // Straight up, give or take half the spread.
    const angle = -Math.PI / 2 + (random(s) - 0.5) * spread;
    const v = p.speed * s.H * (0.45 + 0.75 * random(s)) * (0.55 + 0.45 * strength);
    if ((s.life[k] ?? 0) <= 0) s.awake += 1;
    s.vx[k] = Math.cos(angle) * v;
    s.vy[k] = Math.sin(angle) * v;
    s.age[k] = 0;
    s.life[k] = p.life * (0.6 + 0.4 * random(s));
    s.spin[k] = (random(s) - 0.5) * 6 * p.spin;
    particle.x = origin.x;
    particle.y = origin.y;
    particle.rotation = random(s) * 6.283;
    particle.tint = inks[Math.floor(random(s) * inks.length)] ?? 0xffffff;
    particle.alpha = 1;
  }
}

function step(s: Burst, p: Params, dt: number): void {
  if (s.awake === 0) return;
  const pull = p.gravity * s.H * 1.4;
  let awake = 0;
  for (let k = 0; k < s.particles.length; k++) {
    const life = s.life[k] ?? 0;
    if (life <= 0) continue;
    const particle = s.particles[k];
    if (!particle) continue;
    const age = (s.age[k] ?? 0) + dt;
    if (age >= life) {
      s.life[k] = 0;
      particle.alpha = 0;
      continue;
    }
    s.age[k] = age;
    const vy = (s.vy[k] ?? 0) + pull * dt;
    s.vy[k] = vy;
    particle.x += (s.vx[k] ?? 0) * dt;
    particle.y += vy * dt;
    particle.rotation += (s.spin[k] ?? 0) * dt;
    const left = 1 - age / life;
    particle.alpha = left > 0.35 ? 1 : left / 0.35;
    awake += 1;
  }
  s.awake = awake;
}

function applyLook(s: Burst, p: Params): void {
  if (!s.container || s.glow === p.glow) return;
  s.glow = p.glow;
  s.container.blendMode = p.glow ? 'add' : 'normal';
}

export const glyphBurst = defineAnimation({
  id: 'glyph-burst',
  name: 'Glyph burst',
  summary: 'keys throw glyphs into the air',
  groups: [
    {
      title: 'Glyphs',
      params: ['glyphs', 'count', 'size', 'glow', 'colour', 'colour2', 'colour3'],
    },
    { title: 'Flight', params: ['from', 'speed', 'spread', 'gravity', 'life', 'spin'] },
    { title: 'When there is sound', params: ['soundBeats'] },
  ],
  description:
    'Every key throws a handful of glyphs into the air from where that key sits; they tumble and fall back. Harder hits throw more, further. A mapped pad sets one off too, and so can a clap or a beat in the sound input.',
  inputs: ['trigger', 'velocity', 'audio'],
  defaultSize: { width: 1920, height: 1080 },
  params: paramsSchema,
  // The particles are sized and given their glyphs once, in setup.
  rebuildOn: ['glyphs', 'size'],
  paramsFor: ({ dark }) =>
    dark ? {} : { colour: '#4f4b2e', colour2: '#b97f8c', colour3: '#8d8b4c', glow: false },
  listensToSound: (p) => p.soundBeats,

  setup(ctx) {
    const p = ctx.params;
    const s: Burst = {
      W: ctx.width,
      H: ctx.height,
      container: null,
      particles: [],
      vx: new Float32Array(POOL),
      vy: new Float32Array(POOL),
      age: new Float32Array(POOL),
      life: new Float32Array(POOL),
      spin: new Float32Array(POOL),
      next: 0,
      awake: 0,
      seed: 20261205,
      lastBeat: 0,
      glow: null,
    };
    // Shared and kept for the app's lifetime; see sharedGlyphAtlas.
    const atlas = sharedGlyphAtlas(GLYPHS[p.glyphs], 'IBM Plex Mono');
    if (!atlas || atlas.glyphs.length === 0) return s; // No DOM (unit tests): an inert burst.
    const container = new ParticleContainer<Particle>({
      texture: atlas.sheet,
      // Glyph and size never change after setup, so only these three are uploaded each frame.
      dynamicProperties: { position: true, rotation: true, color: true, uvs: false, vertex: false },
    });
    // Glyphs fly past the edges; do not let the bounds cull the whole burst.
    container.boundsArea = new Rectangle(-ctx.width, -ctx.height, ctx.width * 3, ctx.height * 3);
    const base = p.size / ATLAS_FONT_PX;
    for (let k = 0; k < POOL; k++) {
      const texture = atlas.glyphs[k % atlas.glyphs.length];
      if (!texture) continue;
      const scale = base * (0.6 + 0.8 * random(s));
      s.particles.push(
        container.addParticle(
          new Particle({
            texture,
            scaleX: scale,
            scaleY: scale,
            anchorX: 0.5,
            anchorY: 0.5,
            alpha: 0,
          }),
        ),
      );
    }
    s.container = container;
    ctx.root.addChild(container);
    applyLook(s, p);
    return s;
  },

  update(s, frame, inputs) {
    if (!s.container) return;
    const p = inputs.params;
    applyLook(s, p);
    for (const trigger of inputs.triggers) burst(s, p, trigger.note, trigger.value);
    // A beat arrives as a jump to 1 that then fades: fire on the jump only.
    const beat = inputs.audio.beat;
    if (p.soundBeats && beat > 0.95 && s.lastBeat <= 0.95) {
      burst(s, p, null, 0.4 + 0.6 * inputs.audio.level);
    }
    s.lastBeat = beat;
    step(s, p, frame.dt);
  },

  teardown() {
    // Particles live under root, which the host destroys. The atlas is shared and stays.
  },

  showFinal(s, p) {
    if (!s.container) return;
    applyLook(s, p);
    // One burst from the middle, caught a moment after it left.
    s.seed = 20261205;
    burst(s, { ...p, from: 'bottom centre' }, null, 1);
    for (let i = 0; i < 24; i++) step(s, p, 1 / 60);
    for (const particle of s.particles) if (particle.alpha > 0) particle.alpha = 1;
  },
});
