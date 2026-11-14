import { Graphics } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

/** A shape that sits at rest and kicks outward on each note, then settles back. */
export const pulse = defineAnimation({
  id: 'pulse',
  name: 'Pulse',
  summary: 'a shape pulses on each note',
  description: 'A shape that pulses on each note and settles back to its resting size.',
  inputs: ['trigger', 'velocity'],
  defaultSize: { width: 400, height: 400 },
  // Every parameter is read in update, so edits apply without a restart.
  rebuildOn: [],
  params: z.object({
    colour: param.colour('Colour', '#5b8cff'),
    shape: param.choice('Shape', ['circle', 'square', 'ring'], 'circle'),
    restScale: param.number('Resting size', 0.6, 0.05, 1),
    amount: param.number('Pulse amount', 0.4, 0, 1),
    decay: param.number('Settle time (s)', 0.35, 0.03, 3),
    useVelocity: param.boolean('Harder hits pulse more', true),
  }),

  setup(ctx) {
    const g = new Graphics();
    g.position.set(ctx.width / 2, ctx.height / 2);
    ctx.root.addChild(g);
    return { g, energy: 0, radius: Math.min(ctx.width, ctx.height) / 2, drawnKey: '' };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    const key = `${p.shape}|${p.colour}`;
    if (key !== state.drawnKey) {
      state.drawnKey = key;
      const colour = hexToNumber(p.colour);
      const r = state.radius;
      state.g.clear();
      if (p.shape === 'circle') state.g.circle(0, 0, r).fill({ color: colour });
      else if (p.shape === 'square')
        state.g.roundRect(-r, -r, r * 2, r * 2, r * 0.12).fill({ color: colour });
      else state.g.circle(0, 0, r * 0.92).stroke({ color: colour, width: r * 0.16 });
    }
    for (const trigger of inputs.triggers) {
      state.energy = Math.max(state.energy, p.useVelocity ? trigger.value : 1);
    }
    // Exponential decay: independent of frame rate.
    state.energy *= Math.exp(-frame.dt / (p.decay / 3));
    if (state.energy < 0.001) state.energy = 0;
    state.g.scale.set(Math.min(1, p.restScale + p.amount * state.energy));
    state.g.alpha = 0.75 + 0.25 * state.energy;
  },

  teardown() {
    // Everything lives under root; the host destroys it.
  },

  showFinal(state, p) {
    state.g
      .clear()
      .circle(0, 0, state.radius)
      .fill({ color: hexToNumber(p.colour) });
    state.g.scale.set(p.restScale);
  },
});
