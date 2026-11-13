import { Container, Sprite, Texture } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { FLOWERS, flowerImage, type FlowerName } from '../art';
import { defineAnimation, param } from '../define';

/*
 * Tejas's pressed flowers, as they bloom in on the website's opening screen.
 * Each key blooms its own flower (the same key always gives the same one) at
 * a spot that follows the keyboard from left to right; velocity sets its size.
 * Letting go makes it open out and fade, unless the sustain pedal is down.
 * A mapped trigger blooms the whole bouquet from the opening screen, and the
 * next one opens it out again.
 */

interface Bloom {
  holder: Container;
  shadow: Sprite;
  flower: Sprite;
  active: boolean;
  /** Seconds since it started blooming in. */
  age: number;
  /** Seconds since it started opening out, or -1 while it is still in. */
  out: number;
  note: number | null;
  x: number;
  y: number;
  rot: number;
  size: number;
  phase: number;
  born: number;
}

/** The opening screen's arrangement, in vmin from the centre (x, y, tilt in degrees, width). */
const BOUQUET: { name: FlowerName; x: number; y: number; r: number; s: number }[] = [
  { name: 'lily', x: -27, y: -17, r: -28, s: 22 },
  { name: 'star', x: 26, y: -20, r: 34, s: 20 },
  { name: 'mum', x: 31, y: 14, r: -14, s: 17 },
  { name: 'zinnia', x: -8, y: 29, r: 22, s: 13 },
  { name: 'aster', x: -31, y: 15, r: 12, s: 14 },
  { name: 'sprig', x: 9, y: -31, r: -18, s: 16 },
  { name: 'daisy', x: 0, y: 0, r: 0, s: 30 },
];

interface FlowerTextures {
  flower: Texture;
  shadow: Texture;
  aspect: number;
}

const cache = new Map<FlowerName, FlowerTextures>();

/**
 * The flower and its flat silhouette (tinted for the off-register ink). Made
 * once and kept for the app's lifetime, like the bundled fonts: they are small,
 * every renderer can share them, and no instance can destroy a texture another
 * one is still drawing with.
 */
function flowerTextures(name: FlowerName): FlowerTextures | null {
  const cached = cache.get(name);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const image = flowerImage(name);
  if (!image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const made = {
    flower: Texture.from(image),
    shadow: Texture.from(canvas),
    aspect: image.naturalHeight / image.naturalWidth,
  };
  cache.set(name, made);
  return made;
}

const POOL = 24;
const OUT_TIME = 1.15;
// cubic-bezier(.2,.8,.2,1) is close to this.
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3.2);
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const FLOWER_LABELS = FLOWERS as unknown as readonly [FlowerName, ...FlowerName[]];

export const pressedBloom = defineAnimation({
  id: 'pressed-bloom',
  name: 'Pressed flowers',
  description:
    'Tejas’s riso pressed flowers bloom in where you play. Each key has its own flower, harder hits bloom bigger, and letting go opens it out. A mapped trigger blooms the whole bouquet.',
  inputs: ['trigger', 'velocity', 'heldNotes', 'sustain', 'pitchBend'],
  defaultSize: { width: 1920, height: 1080 },
  defaultBindings: [{ param: 'size', source: 'velocity', min: 0.45, max: 1 }],
  params: z.object({
    size: param.number('Flower size', 0.8, 0.1, 1.5),
    bloomTime: param.number('Bloom time (s)', 0.95, 0.1, 4, 0.05),
    onRelease: param.choice('When a key is let go', ['open out', 'stay'], 'open out'),
    firstFlower: param.choice('Flower for single triggers', FLOWER_LABELS, 'daisy'),
    misColour: param.colour('Second ink', '#d8a4af'),
    misOffset: param.number('Off register (px)', 4, 0, 20, 0.5),
    brighten: param.boolean('Lighten for dark slides', false),
    bob: param.number('Idle drift', 1, 0, 3),
  }),

  paramsFor: ({ dark }) => (dark ? { brighten: false, misColour: '#8f6a72' } : {}),

  setup(ctx) {
    const textures = new Map<FlowerName, FlowerTextures>();
    for (const name of FLOWERS) {
      const tex = flowerTextures(name);
      if (tex) textures.set(name, tex);
    }
    const blooms: Bloom[] = [];
    for (let i = 0; i < POOL; i++) {
      const holder = new Container();
      const shadow = new Sprite();
      const flower = new Sprite();
      shadow.anchor.set(0.5);
      flower.anchor.set(0.5);
      holder.addChild(shadow, flower);
      holder.visible = false;
      ctx.root.addChild(holder);
      blooms.push({
        holder,
        shadow,
        flower,
        active: false,
        age: 0,
        out: -1,
        note: null,
        x: 0,
        y: 0,
        rot: 0,
        size: 0,
        phase: i * 1.7,
        born: 0,
      });
    }
    return {
      blooms,
      textures,
      W: ctx.width,
      H: ctx.height,
      bouquetUp: false,
      misKey: '',
      brightKey: false,
      time: 0,
    };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    const { blooms, textures, W, H } = state;
    state.time = frame.time;
    const vmin = Math.min(W, H) / 100;

    if (state.misKey !== p.misColour) {
      state.misKey = p.misColour;
      const tint = hexToNumber(p.misColour);
      for (const b of blooms) b.shadow.tint = tint;
    }

    const free = (): Bloom | undefined => {
      const idle = blooms.find((b) => !b.active);
      if (idle) return idle;
      // All in use: recycle the oldest.
      return blooms.reduce<Bloom | undefined>(
        (old, b) => (!old || b.born < old.born ? b : old),
        undefined,
      );
    };
    const start = (
      name: FlowerName,
      x: number,
      y: number,
      rot: number,
      width: number,
      note: number | null,
    ): void => {
      const tex = textures.get(name);
      const b = free();
      if (!tex || !b) return;
      b.flower.texture = tex.flower;
      b.shadow.texture = tex.shadow;
      b.flower.width = width;
      b.flower.height = width * tex.aspect;
      b.shadow.width = width;
      b.shadow.height = width * tex.aspect;
      b.active = true;
      b.age = 0;
      b.out = -1;
      b.note = note;
      b.x = x;
      b.y = y;
      b.rot = rot;
      b.size = width;
      b.born = frame.time;
    };

    for (const trigger of inputs.triggers) {
      if (trigger.note === null) {
        // Mapped trigger: the opening bouquet in, or out again.
        if (state.bouquetUp) {
          for (const b of blooms) if (b.active && b.note === -1 && b.out < 0) b.out = 0;
          state.bouquetUp = false;
        } else {
          for (const f of BOUQUET) {
            start(
              f.name,
              W / 2 + f.x * vmin * 1.2,
              H / 2 + f.y * vmin * 1.2,
              (f.r * Math.PI) / 180,
              f.s * vmin * 1.2 * p.size * 1.25,
              -1,
            );
          }
          state.bouquetUp = true;
        }
        continue;
      }
      const note = trigger.note;
      const name =
        FLOWERS[((note % FLOWERS.length) + FLOWERS.length) % FLOWERS.length] ?? p.firstFlower;
      const across = Math.min(1, Math.max(0, (note - 36) / 48));
      const x = W * (0.08 + 0.84 * across);
      const y = H * (0.2 + 0.6 * ((Math.sin(note * 2.399) + 1) / 2));
      const rot = (((note * 37) % 60) - 30) * (Math.PI / 180);
      start(name, x, y, rot, Math.min(W, H) * 0.32 * p.size, note);
    }

    // Let go: open out, unless the sustain pedal holds it or the flower is set to stay.
    if (p.onRelease === 'open out') {
      for (const b of blooms) {
        if (!b.active || b.out >= 0 || b.note === null || b.note < 0) continue;
        if (!inputs.held.has(b.note) && !inputs.sustain && b.age > p.bloomTime * 0.4) b.out = 0;
      }
    }

    const t = frame.time;
    for (const b of blooms) {
      if (!b.active) {
        b.holder.visible = false;
        continue;
      }
      b.age += frame.dt;
      b.holder.visible = true;
      const k = Math.min(1, b.age / p.bloomTime);
      const e = easeOut(k);
      let scale = 0.25 + 0.75 * e;
      let rot = b.rot * (1 + 1.8 * (1 - e));
      let alpha = Math.min(1, k * 1.6);
      let spread = 1;
      if (b.out >= 0) {
        b.out += frame.dt;
        const q = Math.min(1, b.out / OUT_TIME);
        const o = easeInOut(q);
        scale *= 1 + 0.7 * o;
        rot = b.rot * (1 - o);
        alpha *= 1 - o;
        spread = 1 + 1.8 * o;
        if (q >= 1) {
          b.active = false;
          b.holder.visible = false;
          continue;
        }
      }
      const bob = p.bob * Math.sin(t * 0.55 + b.phase) * vmin * 0.35;
      const cx = W / 2 + (b.x - W / 2) * spread;
      const cy = H / 2 + (b.y - H / 2) * spread;
      b.holder.position.set(cx, cy + bob);
      b.holder.rotation =
        rot + inputs.pitchBend * 0.35 + p.bob * Math.sin(t * 0.3 + b.phase) * 0.035;
      b.holder.scale.set(scale);
      b.holder.alpha = alpha;
      b.shadow.position.set(p.misOffset / scale, (p.misOffset * 0.75) / scale);
      b.shadow.alpha = 0.75;
    }

    if (state.brightKey !== p.brighten) {
      state.brightKey = p.brighten;
      for (const b of blooms) b.flower.blendMode = p.brighten ? 'add' : 'normal';
    }
  },

  teardown() {
    // Sprites live under root, which the host destroys. Flower textures are shared and stay.
  },

  showFinal(state, p) {
    const vmin = Math.min(state.W, state.H) / 100;
    state.blooms.forEach((b, i) => {
      const f = BOUQUET[i];
      const tex = f ? state.textures.get(f.name) : undefined;
      if (!f || !tex) {
        b.holder.visible = false;
        return;
      }
      const width = f.s * vmin * 1.2 * p.size * 1.25;
      b.flower.texture = tex.flower;
      b.shadow.texture = tex.shadow;
      b.flower.width = b.shadow.width = width;
      b.flower.height = b.shadow.height = width * tex.aspect;
      b.shadow.tint = hexToNumber(p.misColour);
      b.shadow.position.set(p.misOffset, p.misOffset * 0.75);
      b.shadow.alpha = 0.75;
      b.holder.visible = true;
      b.holder.alpha = 1;
      b.holder.scale.set(1);
      b.holder.rotation = (f.r * Math.PI) / 180;
      b.holder.position.set(state.W / 2 + f.x * vmin * 1.2, state.H / 2 + f.y * vmin * 1.2);
    });
  },
});
