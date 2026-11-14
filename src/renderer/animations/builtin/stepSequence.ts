import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

interface Step {
  box: Container;
  panel: Graphics;
  highlight: Graphics;
  connector: Graphics | null;
  /** 0 hidden → 1 fully in. */
  appear: number;
  /** 1 while this is the newest step, easing to 0 once a later one arrives. */
  glow: number;
  cx: number;
  cy: number;
}

const paramsSchema = z.object({
  steps: param.text('Steps (one per line)', 'Key press\nMIDI message\nMapping\nAction\nPixels'),
  direction: param.choice('Direction', ['horizontal', 'vertical'], 'horizontal'),
  colour: param.colour('Box colour', '#23262f'),
  activeColour: param.colour('Active colour', '#ffb84d'),
  textColour: param.colour('Text colour', '#ffffff'),
  fontFamily: param.font('Font', 'Inter Variable'),
  fontSize: param.number('Font size', 40, 8, 200, 1),
  gap: param.number('Gap between steps', 0.35, 0.05, 1.5),
  speed: param.number('Reveal time (s)', 0.45, 0.05, 3),
  loop: param.boolean('Start again after the last step', false),
});

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * A pipeline that is revealed one step per key press. Earlier steps stay
 * visible and a signal dot travels along the connector to each new step:
 * the "playable explainer".
 */
export const stepSequence = defineAnimation({
  id: 'step-sequence',
  name: 'Step sequence',
  summary: 'a diagram revealed step by step',
  description:
    'Each key press reveals the next step and sends a signal to it. Earlier steps stay visible.',
  inputs: ['trigger'],
  defaultSize: { width: 1600, height: 260 },
  params: paramsSchema,

  setup(ctx) {
    const p = ctx.params;
    const labels = p.steps
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const n = Math.max(1, labels.length);
    const horizontal = p.direction === 'horizontal';
    const along = horizontal ? ctx.width : ctx.height;
    const across = horizontal ? ctx.height : ctx.width;
    // n boxes and n-1 gaps, each gap being `gap` box-lengths long.
    const boxAlong = along / (n + (n - 1) * p.gap);
    const gapAlong = boxAlong * p.gap;
    const boxW = horizontal ? boxAlong : across;
    const boxH = horizontal ? across : boxAlong;
    const radius = Math.min(boxW, boxH) * 0.14;
    const colour = hexToNumber(p.colour);
    const active = hexToNumber(p.activeColour);

    const style = new TextStyle({
      fontFamily: p.fontFamily,
      fontSize: p.fontSize,
      fontWeight: '600',
      fill: p.textColour,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: boxW * 0.86,
    });

    const connectors = new Container();
    const boxes = new Container();
    const signal = new Graphics()
      .circle(0, 0, Math.max(6, Math.min(boxW, boxH) * 0.07))
      .fill({ color: active });
    signal.visible = false;
    ctx.root.addChild(connectors, boxes, signal);

    const steps: Step[] = labels.map((label, i) => {
      const start = i * (boxAlong + gapAlong);
      const x = horizontal ? start : 0;
      const y = horizontal ? 0 : start;
      const box = new Container();
      box.position.set(x + boxW / 2, y + boxH / 2);
      const panel = new Graphics()
        .roundRect(-boxW / 2, -boxH / 2, boxW, boxH, radius)
        .fill({ color: colour });
      const highlight = new Graphics()
        .roundRect(-boxW / 2, -boxH / 2, boxW, boxH, radius)
        .stroke({ color: active, width: Math.max(3, Math.min(boxW, boxH) * 0.035) });
      const text = new Text({ text: label, style });
      text.anchor.set(0.5);
      box.addChild(panel, highlight, text);
      box.alpha = 0;
      boxes.addChild(box);

      let connector: Graphics | null = null;
      if (i > 0) {
        connector = new Graphics();
        const from = start - gapAlong;
        const mid = across / 2;
        if (horizontal) connector.moveTo(from, mid).lineTo(start, mid);
        else connector.moveTo(mid, from).lineTo(mid, start);
        connector.stroke({ color: active, width: Math.max(3, across * 0.02), alpha: 0.7 });
        connector.alpha = 0;
        connectors.addChild(connector);
      }
      return {
        box,
        panel,
        highlight,
        connector,
        appear: 0,
        glow: 0,
        cx: x + boxW / 2,
        cy: y + boxH / 2,
      };
    });

    return { steps, signal, revealed: 0, horizontal, slide: Math.min(boxW, boxH) * 0.18 };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    for (const _trigger of inputs.triggers) {
      if (state.revealed >= state.steps.length) {
        if (!p.loop) continue;
        for (const s of state.steps) {
          s.appear = 0;
          s.glow = 0;
        }
        state.revealed = 0;
        continue;
      }
      state.revealed += 1;
    }

    const rate = frame.dt / p.speed;
    const newest = state.revealed - 1;
    state.signal.visible = false;
    state.steps.forEach((s, i) => {
      const targetAppear = i < state.revealed ? 1 : 0;
      s.appear = targetAppear === 1 ? Math.min(1, s.appear + rate) : 0;
      const targetGlow = i === newest ? 1 : 0;
      s.glow += (targetGlow - s.glow) * Math.min(1, rate * 2);

      const e = easeOut(s.appear);
      s.box.alpha = e;
      const offset = (1 - e) * state.slide;
      s.box.position.set(
        s.cx - (state.horizontal ? offset : 0),
        s.cy - (state.horizontal ? 0 : offset),
      );
      s.highlight.alpha = s.glow;
      if (s.connector) s.connector.alpha = e;

      // While the newest step is arriving, run the signal dot from the previous step to it.
      const prev = state.steps[i - 1];
      if (i === newest && prev && s.appear < 1) {
        state.signal.visible = true;
        state.signal.position.set(prev.cx + (s.cx - prev.cx) * e, prev.cy + (s.cy - prev.cy) * e);
      }
    });
  },

  teardown() {
    // Everything lives under root; the host destroys it.
  },

  progress: (state) => ({ done: state.revealed, total: state.steps.length }),

  showFinal(state) {
    state.revealed = state.steps.length;
    state.steps.forEach((s, i) => {
      s.appear = 1;
      s.glow = i === state.steps.length - 1 ? 1 : 0;
      s.box.alpha = 1;
      s.box.position.set(s.cx, s.cy);
      s.highlight.alpha = s.glow;
      if (s.connector) s.connector.alpha = 1;
    });
    state.signal.visible = false;
  },
});
