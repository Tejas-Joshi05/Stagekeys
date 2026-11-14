import { Container, Text, TextStyle } from 'pixi.js';
import { z } from 'zod';
import { noteName } from '../../shared/util';
import { defineAnimation, param } from '../define';

/*
 * "This keyboard doesn't send music, it sends two numbers: which key, and how
 * hard." This shows exactly those two numbers, live, as each key is played,
 * with an ASCII bar for each. The text is only rebuilt when a key arrives, not
 * every frame.
 */

const BAR_CELLS = 20;

const paramsSchema = z.object({
  keyLabel: param.text('Label for the key', 'which key'),
  velocityLabel: param.text('Label for the velocity', 'how hard'),
  show: param.choice(
    'Show',
    ['both numbers', 'key only', 'how hard only', 'raw message'],
    'both numbers',
  ),
  bars: param.boolean('Draw bars', true),
  noteNames: param.boolean('Add the note name (C4)', true),
  fontFamily: param.font('Font', 'IBM Plex Mono'),
  fontSize: param.number('Font size', 72, 12, 300, 1),
  fontWeight: param.integer('Font weight', 500, 100, 900),
  colour: param.colour('Colour', '#efe6d8'),
  accent: param.colour('Number colour', '#d8a4af'),
  idle: param.number('Brightness when nothing is held', 0.45, 0, 1),
  fade: param.number('Settle time (s)', 0.6, 0.05, 5),
});
type Params = z.infer<typeof paramsSchema>;

/** An ASCII bar like `[#########---------------]` for a value from 0 to `max`. */
export function asciiBar(value: number, max: number, cells = BAR_CELLS): string {
  const filled = Math.round((Math.min(max, Math.max(0, value)) / max) * cells);
  return `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`;
}

const hex = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** The lines to show for the last key played. `note` is -1 before anything has been played. */
export function readoutLines(
  note: number,
  velocity: number,
  p: Pick<Params, 'show' | 'bars' | 'noteNames' | 'keyLabel' | 'velocityLabel'>,
): { labels: string; values: string } {
  const none = note < 0;
  const pad = (n: number): string => (none ? '--' : String(n)).padStart(3, ' ');
  const rows: [string, string][] = [];
  if (p.show === 'raw message') {
    rows.push(['bytes', none ? '-- -- --' : `90 ${hex(note)} ${hex(velocity)}`]);
    rows.push([
      'means',
      none ? 'note on, key --, velocity --' : `note on, key ${note}, velocity ${velocity}`,
    ]);
  } else {
    if (p.show !== 'how hard only') {
      const name = p.noteNames && !none ? `  ${noteName(note)}` : '';
      rows.push([p.keyLabel, `${pad(note)}${name}`]);
      if (p.bars) rows.push(['', asciiBar(none ? 0 : note, 127)]);
    }
    if (p.show !== 'key only') {
      rows.push([p.velocityLabel, pad(velocity)]);
      if (p.bars) rows.push(['', asciiBar(none ? 0 : velocity, 127)]);
    }
  }
  return { labels: rows.map((r) => r[0]).join('\n'), values: rows.map((r) => r[1]).join('\n') };
}

function restyle(text: Text, p: Params, fill: string): void {
  const style = text.style as TextStyle;
  style.fontFamily = p.fontFamily;
  style.fontSize = p.fontSize;
  style.fontWeight = String(p.fontWeight) as TextStyle['fontWeight'];
  style.lineHeight = p.fontSize * 1.25;
  style.fill = fill;
}

/** Writes the lines and keeps the whole readout inside the element's width. */
function layout(
  state: { box: Container; labels: Text; values: Text; width: number },
  p: Params,
  note: number,
  velocity: number,
): void {
  restyle(state.labels, p, p.colour);
  restyle(state.values, p, p.accent);
  const lines = readoutLines(note, velocity, p);
  state.labels.text = lines.labels;
  state.values.text = lines.values;
  // Values start one gap to the right of the widest label.
  state.values.x = lines.labels.trim() === '' ? 0 : state.labels.width + p.fontSize * 0.8;
  const content = state.values.x + state.values.width;
  state.box.scale.set(content > state.width ? state.width / content : 1);
}

export const midiReadout = defineAnimation({
  id: 'midi-readout',
  name: 'MIDI readout',
  summary: 'the two numbers a key sends',
  groups: [
    { title: 'What it shows', params: ['show', 'keyLabel', 'velocityLabel', 'bars', 'noteNames'] },
    { title: 'Type', params: ['fontFamily', 'fontSize', 'fontWeight', 'colour', 'accent'] },
    { title: 'Brightness', params: ['idle', 'fade'] },
  ],
  description:
    'Shows what the keyboard really sends: which key and how hard, as two live numbers with ASCII bars. Made for the "it only sends two numbers" moment.',
  inputs: ['trigger', 'velocity', 'heldNotes'],
  defaultSize: { width: 1300, height: 420 },
  params: paramsSchema,
  // Everything is restyled live.
  rebuildOn: [],
  paramsFor: ({ dark }) => (dark ? {} : { colour: '#4f4b2e', accent: '#b97f8c' }),

  setup(ctx) {
    const make = (): Text =>
      new Text({ text: '', style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontSize: 72 }) });
    const labels = make();
    const values = make();
    const box = new Container();
    box.addChild(labels, values);
    ctx.root.addChild(box);
    return { box, labels, values, width: ctx.width, note: -1, velocity: 0, energy: 0, key: '' };
  },

  update(state, frame, inputs) {
    const p = inputs.params;
    let changed = false;
    for (const trigger of inputs.triggers) {
      // A mapped trigger carries no key: show its value as the "how hard" number.
      state.note = trigger.note ?? state.note;
      state.velocity = Math.round(trigger.value * 127);
      state.energy = 1;
      changed = true;
    }
    const key = `${p.show}|${p.bars}|${p.noteNames}|${p.keyLabel}|${p.velocityLabel}|${p.fontFamily}|${p.fontSize}|${p.fontWeight}|${p.colour}|${p.accent}`;
    if (changed || key !== state.key) {
      state.key = key;
      layout(state, p, state.note, state.velocity);
    }
    // Bright while a key is down, settling to the idle brightness after.
    if (inputs.held.size > 0) state.energy = 1;
    else state.energy *= Math.exp(-frame.dt / (p.fade / 3));
    const alpha = p.idle + (1 - p.idle) * state.energy;
    state.labels.alpha = p.idle + (1 - p.idle) * 0.6 * state.energy;
    state.values.alpha = alpha;
  },

  teardown() {
    // Text objects live under root; the host destroys them.
  },

  showFinal(state, p) {
    layout(state, p, 60, 97);
    state.labels.alpha = 1;
    state.values.alpha = 1;
  },
});
