import { Graphics } from 'pixi.js';
import { z } from 'zod';
import { hexToNumber } from '../../shared/util';
import { defineAnimation, param } from '../define';

/*
 * A piano roll that draws itself as you play: every key sends up a bar from
 * its place along the edge, as long as the key is held, and the bar drifts
 * away when you let go. Low notes on the left, high notes on the right, so the
 * audience can see the shape of what is being played. Printed twice, slightly
 * off register, like the other riso animations.
 */

const MAX_BARS = 96;

interface Bar {
  active: boolean;
  note: number;
  /** Seconds (animation time) when the key went down, and when it came up (-1 while held). */
  on: number;
  off: number;
  velocity: number;
  colour: number;
}

const paramsSchema = z.object({
  colour: param.colour('Colour (low notes)', '#d8a4af'),
  colourHigh: param.colour('Colour (high notes)', '#c1bc77'),
  misColour: param.colour('Second ink', '#efe6d8'),
  misregister: param.number('Second ink offset (px)', 5, 0, 30, 0.5),
  direction: param.choice('Bars travel', ['up', 'down'], 'up'),
  speed: param.number('Speed', 0.35, 0.05, 2),
  lowNote: param.integer('Lowest note', 36, 0, 127),
  highNote: param.integer('Highest note', 84, 0, 127),
  barWidth: param.number('Bar width', 0.8, 0.1, 1),
  velocityShows: param.choice('Harder hits are', ['brighter', 'wider', 'the same'], 'brighter'),
  rounded: param.boolean('Rounded ends', true),
});
type Params = z.infer<typeof paramsSchema>;

/** Mixes two 0xRRGGBB colours. t = 0 gives a, 1 gives b. */
export function mixColour(a: number, b: number, t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const ch = (shift: number): number =>
    Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * u);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Where a bar sits: its top and bottom edge in pixels, or null once it has left the box. */
export function barSpan(
  age: number,
  sinceRelease: number,
  speed: number,
  height: number,
  direction: Params['direction'],
): { y: number; h: number } | null {
  const head = Math.min(height, age * speed * height);
  const tail = sinceRelease < 0 ? 0 : sinceRelease * speed * height;
  if (tail >= height) return null;
  const h = head - tail;
  if (h <= 0) return { y: 0, h: 0 };
  return direction === 'up' ? { y: height - head, h } : { y: tail, h };
}

function draw(
  g: Graphics,
  bars: readonly Bar[],
  t: number,
  p: Params,
  W: number,
  H: number,
): number {
  const low = Math.min(p.lowNote, p.highNote);
  const high = Math.max(p.lowNote, p.highNote);
  const slot = W / (high - low + 1);
  const mis = hexToNumber(p.misColour);
  let drawn = 0;
  g.clear();
  // Two passes, so the second ink always prints underneath every bar.
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0 && p.misregister <= 0) continue;
    for (const bar of bars) {
      if (!bar.active) continue;
      const span = barSpan(t - bar.on, bar.off < 0 ? -1 : t - bar.off, p.speed, H, p.direction);
      if (!span || span.h < 0.5) continue;
      const width =
        slot * p.barWidth * (p.velocityShows === 'wider' ? 0.35 + 0.65 * bar.velocity : 1);
      const x = (bar.note - low) * slot + (slot - width) / 2;
      const offset = pass === 0 ? p.misregister : 0;
      const radius = p.rounded ? Math.min(width / 2, span.h / 2) : 0;
      if (radius > 0) g.roundRect(x + offset, span.y + offset * 0.75, width, span.h, radius);
      else g.rect(x + offset, span.y + offset * 0.75, width, span.h);
      const alpha = p.velocityShows === 'brighter' ? 0.35 + 0.65 * bar.velocity : 1;
      g.fill({ color: pass === 0 ? mis : bar.colour, alpha: pass === 0 ? alpha * 0.55 : alpha });
      if (pass === 1) drawn += 1;
    }
  }
  return drawn;
}

export const noteTrails = defineAnimation({
  id: 'note-trails',
  name: 'Note trails',
  summary: 'a piano roll drawn as you play',
  groups: [
    { title: 'Bars', params: ['direction', 'speed', 'barWidth', 'velocityShows', 'rounded'] },
    { title: 'Colour', params: ['colour', 'colourHigh', 'misColour', 'misregister'] },
    { title: 'Keyboard range', params: ['lowNote', 'highNote'] },
  ],
  description:
    'A piano roll that draws itself as you play. Each key sends up a bar from its place along the edge for as long as it is held; the bar drifts away when you let go. Low notes left, high notes right.',
  inputs: ['trigger', 'velocity', 'heldNotes'],
  defaultSize: { width: 1920, height: 1080 },
  params: paramsSchema,
  // Everything is read each frame.
  rebuildOn: [],
  paramsFor: ({ dark }) =>
    dark ? {} : { colour: '#b97f8c', colourHigh: '#8d8b4c', misColour: '#4f4b2e' },

  setup(ctx) {
    const g = new Graphics();
    ctx.root.addChild(g);
    const bars: Bar[] = Array.from({ length: MAX_BARS }, () => ({
      active: false,
      note: 0,
      on: 0,
      off: -1,
      velocity: 0,
      colour: 0xffffff,
    }));
    return { g, bars, next: 0, live: 0, empty: true, W: ctx.width, H: ctx.height };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    const t = frame.time;
    const low = Math.min(p.lowNote, p.highNote);
    const high = Math.max(p.lowNote, p.highNote);

    for (const trigger of inputs.triggers) {
      const note = trigger.note;
      // A mapped trigger has no key, so no place on the roll.
      if (note === null || note < low || note > high) continue;
      // The same key again: its last bar is let go and a new one starts.
      for (const bar of state.bars) {
        if (bar.active && bar.note === note && bar.off < 0) bar.off = t;
      }
      const bar = state.bars[state.next];
      state.next = (state.next + 1) % state.bars.length;
      if (!bar) continue;
      bar.active = true;
      bar.note = note;
      bar.on = t;
      bar.off = -1;
      bar.velocity = trigger.value;
      bar.colour = mixColour(
        hexToNumber(p.colour),
        hexToNumber(p.colourHigh),
        high === low ? 0 : (note - low) / (high - low),
      );
      state.live += 1;
    }
    for (const note of inputs.releases) {
      for (const bar of state.bars) {
        if (bar.active && bar.note === note && bar.off < 0) bar.off = t;
      }
    }
    if (state.live === 0) {
      // Nothing on screen: clear once, then cost nothing until the next key.
      if (!state.empty) {
        state.g.clear();
        state.empty = true;
      }
      return;
    }

    let live = 0;
    for (const bar of state.bars) {
      if (!bar.active) continue;
      // A key that is no longer down without a release having arrived (panic, a lost device).
      if (bar.off < 0 && t - bar.on > 0.05 && !inputs.held.has(bar.note)) bar.off = t;
      if (bar.off >= 0 && (t - bar.off) * p.speed >= 1) bar.active = false;
      else live += 1;
    }
    state.live = live;
    draw(state.g, state.bars, t, p, state.W, state.H);
    state.empty = false;
  },

  teardown() {
    // The Graphics lives under root; the host destroys it.
  },

  showFinal(state, p) {
    // A small phrase frozen mid-flight, so thumbnails and exports show what it is.
    const low = Math.min(p.lowNote, p.highNote);
    const high = Math.max(p.lowNote, p.highNote);
    const phrase: [number, number, number][] = [
      [0.1, 2.4, 1.4],
      [0.3, 2.0, 1.2],
      [0.45, 1.7, 0.2],
      [0.6, 1.2, -1],
      [0.75, 0.8, -1],
      [0.9, 0.5, 0.1],
    ];
    const a = hexToNumber(p.colour);
    const b = hexToNumber(p.colourHigh);
    state.bars.forEach((bar, i) => {
      const step = phrase[i];
      bar.active = step !== undefined;
      if (!step) return;
      bar.note = Math.round(low + step[0] * (high - low));
      bar.on = -step[1] / (p.speed / 0.35);
      bar.off = step[2] < 0 ? -1 : -step[2] / (p.speed / 0.35);
      bar.velocity = 0.5 + 0.5 * step[0];
      bar.colour = mixColour(a, b, step[0]);
    });
    draw(state.g, state.bars, 0, p, state.W, state.H);
    state.empty = false;
  },
});
