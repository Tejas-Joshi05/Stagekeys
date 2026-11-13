import { Graphics } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

interface Bloom {
  g: Graphics;
  age: number;
  size: number;
  active: boolean;
}

const POOL = 12;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** A shape blooms outward on each note. Size follows the `size` parameter (bound to velocity by default). */
export const bloom = defineAnimation({
  id: 'bloom',
  name: 'Bloom',
  description:
    'A shape blooms outward on each note. Bind velocity to Size to make harder hits bloom bigger.',
  inputs: ['trigger', 'velocity'],
  defaultSize: { width: 700, height: 700 },
  defaultBindings: [{ param: 'size', source: 'velocity', min: 0.25, max: 1 }],
  // Every parameter is read in update, so edits apply without a restart.
  rebuildOn: [],
  params: z.object({
    size: param.number('Size', 0.8, 0.05, 1),
    colour: param.colour('Colour', '#ff5fa2'),
    shape: param.choice('Shape', ['circle', 'ring', 'petals'], 'circle'),
    duration: param.number('Duration (s)', 1.2, 0.1, 6, 0.05),
    startOpacity: param.number('Start opacity', 0.9, 0.05, 1),
  }),

  setup(ctx) {
    const blooms: Bloom[] = [];
    for (let i = 0; i < POOL; i++) {
      const g = new Graphics();
      g.visible = false;
      g.position.set(ctx.width / 2, ctx.height / 2);
      ctx.root.addChild(g);
      blooms.push({ g, age: 0, size: 0, active: false });
    }
    return { blooms, next: 0, radius: Math.min(ctx.width, ctx.height) / 2, drawnKey: '' };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    // Redraw the unit shape only when its look changes, not every frame.
    const key = `${p.shape}|${p.colour}`;
    if (key !== state.drawnKey) {
      state.drawnKey = key;
      const colour = hexToNumber(p.colour);
      for (const b of state.blooms) {
        b.g.clear();
        if (p.shape === 'circle') {
          b.g.circle(0, 0, state.radius).fill({ color: colour });
        } else if (p.shape === 'ring') {
          b.g
            .circle(0, 0, state.radius * 0.94)
            .stroke({ color: colour, width: state.radius * 0.12 });
        } else {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            b.g
              .ellipse(
                Math.cos(a) * state.radius * 0.5,
                Math.sin(a) * state.radius * 0.5,
                state.radius * 0.5,
                state.radius * 0.28,
              )
              .fill({ color: colour, alpha: 0.75 });
          }
        }
      }
    }

    for (const _trigger of inputs.triggers) {
      const b = state.blooms[state.next];
      state.next = (state.next + 1) % state.blooms.length;
      if (!b) continue;
      b.active = true;
      b.age = 0;
      b.size = p.size;
      b.g.rotation = Math.random() * Math.PI * 2;
    }

    for (const b of state.blooms) {
      if (!b.active) continue;
      b.age += frame.dt;
      const t = b.age / p.duration;
      if (t >= 1) {
        b.active = false;
        b.g.visible = false;
        continue;
      }
      b.g.visible = true;
      b.g.scale.set(Math.max(0.001, easeOutCubic(t) * b.size));
      b.g.alpha = p.startOpacity * (1 - t) * (1 - t);
    }
  },

  teardown() {
    // Everything lives under root; the host destroys it.
  },

  showFinal(state, p) {
    const b = state.blooms[0];
    if (!b) return;
    b.g
      .clear()
      .circle(0, 0, state.radius)
      .fill({ color: hexToNumber(p.colour) });
    b.g.visible = true;
    b.g.scale.set(p.size * 0.8);
    b.g.alpha = 0.5;
  },
});
