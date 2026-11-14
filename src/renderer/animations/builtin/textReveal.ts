import { CanvasTextMetrics, Text, TextStyle } from 'pixi.js';
import { z } from 'zod';
import { defineAnimation, param } from '../define';

interface Unit {
  text: Text;
  shown: boolean;
  alpha: number;
}

const paramsSchema = z.object({
  text: param.text('Text', 'Art over optimisation'),
  mode: param.choice('Reveal by', ['word', 'letter', 'line'], 'word'),
  perPress: param.integer('Units per key press', 1, 1, 20),
  fade: param.number('Fade in (s)', 0.25, 0, 3),
  fontFamily: param.font('Font', 'Inter Variable'),
  fontSize: param.number('Font size', 96, 8, 400, 1),
  fontWeight: param.integer('Font weight', 700, 100, 900),
  colour: param.colour('Colour', '#ffffff'),
  align: param.choice('Align', ['left', 'center', 'right'], 'left'),
  lineHeight: param.number('Line height', 1.2, 0.6, 3, 0.05),
  loop: param.boolean('Start again after the last one', false),
});
type Params = z.infer<typeof paramsSchema>;

/** Splits one laid-out line into the pieces that appear together. Spaces stay attached to the word before them. */
export function splitUnits(line: string, mode: Params['mode']): string[] {
  if (mode === 'line') return line.length > 0 ? [line] : [];
  if (mode === 'letter') return [...line];
  return line.match(/\S+\s*|\s+/g) ?? [];
}

/** Text that appears word by word, letter by letter or line by line as keys are pressed. */
export const textReveal = defineAnimation({
  id: 'text-reveal',
  name: 'Text reveal',
  summary: 'words appear as you press keys',
  description: 'Text appears word by word or letter by letter on key presses.',
  inputs: ['trigger'],
  defaultSize: { width: 1200, height: 300 },
  params: paramsSchema,

  setup(ctx) {
    const p = ctx.params;
    const style = new TextStyle({
      fontFamily: p.fontFamily,
      fontSize: p.fontSize,
      fontWeight: String(p.fontWeight) as TextStyle['fontWeight'],
      fill: p.colour,
      lineHeight: p.fontSize * p.lineHeight,
      wordWrap: true,
      wordWrapWidth: ctx.width,
    });
    const flat = style.clone();
    flat.wordWrap = false;

    // Lay the whole text out once so words never move as later ones appear.
    const metrics = CanvasTextMetrics.measureText(p.text, style);
    const units: Unit[] = [];
    metrics.lines.forEach((line, row) => {
      const lineWidth = CanvasTextMetrics.measureText(line, flat).width;
      const offset =
        p.align === 'center'
          ? (ctx.width - lineWidth) / 2
          : p.align === 'right'
            ? ctx.width - lineWidth
            : 0;
      let prefix = '';
      for (const piece of splitUnits(line, p.mode)) {
        const x = prefix.length > 0 ? CanvasTextMetrics.measureText(prefix, flat).width : 0;
        prefix += piece;
        if (piece.trim().length === 0) continue;
        const text = new Text({ text: piece, style: flat });
        text.position.set(offset + x, row * metrics.lineHeight);
        text.alpha = 0;
        ctx.root.addChild(text);
        units.push({ text, shown: false, alpha: 0 });
      }
    });
    return { units, revealed: 0 };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    for (const _trigger of inputs.triggers) {
      if (state.revealed >= state.units.length) {
        if (!p.loop) continue;
        for (const u of state.units) {
          u.shown = false;
          u.alpha = 0;
          u.text.alpha = 0;
        }
        state.revealed = 0;
        continue;
      }
      const end = Math.min(state.units.length, state.revealed + p.perPress);
      for (let i = state.revealed; i < end; i++) {
        const unit = state.units[i];
        if (unit) unit.shown = true;
      }
      state.revealed = end;
    }
    for (const u of state.units) {
      if (!u.shown || u.alpha >= 1) continue;
      u.alpha = p.fade <= 0 ? 1 : Math.min(1, u.alpha + frame.dt / p.fade);
      u.text.alpha = u.alpha;
    }
  },

  teardown() {
    // Text objects live under root; the host destroys them.
  },

  progress: (state) => ({ done: state.revealed, total: state.units.length }),

  showFinal(state) {
    for (const u of state.units) {
      u.shown = true;
      u.alpha = 1;
      u.text.alpha = 1;
    }
    state.revealed = state.units.length;
  },
});
