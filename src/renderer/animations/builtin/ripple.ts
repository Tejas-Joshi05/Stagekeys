import { Graphics } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

interface Ring {
  age: number;
  delay: number;
  x: number;
  y: number;
  strength: number;
  active: boolean;
}

const MAX_RINGS = 48;

/** Rings expand from a point on each note. */
export const ripple = defineAnimation({
  id: 'ripple',
  name: 'Ripple',
  description: 'Rings expand from a point on each note. Optionally the point moves with the pitch.',
  inputs: ['trigger', 'velocity'],
  defaultSize: { width: 900, height: 600 },
  // Every parameter is read in update, so edits apply without a restart.
  rebuildOn: [],
  params: z.object({
    colour: param.colour('Colour', '#7df0d0'),
    rings: param.integer('Rings per note', 3, 1, 8),
    speed: param.number('Speed', 0.6, 0.05, 3),
    thickness: param.number('Line thickness', 6, 1, 40, 0.5),
    duration: param.number('Duration (s)', 1.6, 0.2, 8, 0.05),
    originX: param.number('Origin X', 0.5, 0, 1),
    originY: param.number('Origin Y', 0.5, 0, 1),
    followPitch: param.boolean('Low notes left, high notes right', false),
  }),

  setup(ctx) {
    const g = new Graphics();
    ctx.root.addChild(g);
    const rings: Ring[] = Array.from({ length: MAX_RINGS }, () => ({
      age: 0,
      delay: 0,
      x: 0,
      y: 0,
      strength: 0,
      active: false,
    }));
    return { g, rings, next: 0, width: ctx.width, height: ctx.height };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    for (const trigger of inputs.triggers) {
      const fx =
        p.followPitch && trigger.note !== null
          ? Math.min(1, Math.max(0, (trigger.note - 36) / 60))
          : p.originX;
      for (let i = 0; i < p.rings; i++) {
        const ring = state.rings[state.next];
        state.next = (state.next + 1) % state.rings.length;
        if (!ring) continue;
        ring.active = true;
        ring.age = 0;
        ring.delay = i * 0.14;
        ring.x = fx * state.width;
        ring.y = p.originY * state.height;
        ring.strength = 0.35 + 0.65 * trigger.value;
      }
    }

    const colour = hexToNumber(p.colour);
    const reach = Math.max(state.width, state.height) * p.speed;
    state.g.clear();
    for (const ring of state.rings) {
      if (!ring.active) continue;
      ring.age += frame.dt;
      const t = (ring.age - ring.delay) / p.duration;
      if (t >= 1) {
        ring.active = false;
        continue;
      }
      if (t <= 0) continue;
      const eased = 1 - Math.pow(1 - t, 2);
      state.g.circle(ring.x, ring.y, Math.max(1, eased * reach)).stroke({
        color: colour,
        width: p.thickness * (1 - t * 0.6),
        alpha: ring.strength * (1 - t),
      });
    }
  },

  teardown() {
    // Everything lives under root; the host destroys it.
  },

  showFinal(state, p) {
    const colour = hexToNumber(p.colour);
    const reach = Math.max(state.width, state.height) * p.speed;
    state.g.clear();
    for (let i = 1; i <= p.rings; i++) {
      state.g
        .circle(p.originX * state.width, p.originY * state.height, (reach * i) / (p.rings + 1))
        .stroke({ color: colour, width: p.thickness, alpha: 0.5 });
    }
  },
});
