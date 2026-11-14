import { DEFAULT_SETTINGS } from '../../ipc/settings';
import { createAnimation, createEmptyDeck } from '../deck';
import type { Mapping } from '../mapping';
import { cheatSheet } from './cheatSheet';
import { preflight, talkClock } from './preflight';
import { describe, expect, it } from 'vitest';
import { ControlMessageSchema, StageMessageSchema } from './messages';
import { ShowTimeline } from './timeline';
import { TRANSITION_GLYPH_NAMES } from '../deck';
import {
  cellDelay,
  cellProgress,
  glyphAlpha,
  glyphGrid,
  glyphIndex,
  isGlyphTransition,
  tileAlpha,
  TRANSITION_GLYPHS,
  TRANSITION_HINTS,
  TRANSITION_KINDS,
  TRANSITION_LABELS,
  transitionFrame,
} from './transitions';

describe('ShowTimeline (rehearsal timings)', () => {
  it('adds up time per slide across visits', () => {
    const t = new ShowTimeline();
    t.enter(0, 1000);
    t.enter(1, 4000);
    t.enter(0, 9000);
    t.enter(2, 10_000);
    const report = t.finish(16_000, ['Intro', 'Demo', 'End']);
    expect(report.totalMs).toBe(15_000);
    expect(report.slides).toEqual([
      { index: 0, name: 'Intro', ms: 4000, visits: 2 },
      { index: 1, name: 'Demo', ms: 5000, visits: 1 },
      { index: 2, name: 'End', ms: 6000, visits: 1 },
    ]);
  });

  it('reports elapsed time and time on the current slide', () => {
    const t = new ShowTimeline();
    expect(t.elapsed(500)).toBe(0);
    t.enter(0, 1000);
    t.enter(1, 3000);
    expect(t.elapsed(4500)).toBe(3500);
    expect(t.currentSlideElapsed(4500)).toBe(1500);
  });

  it('produces an empty report for a show that never showed a slide', () => {
    expect(new ShowTimeline().finish(100, [])).toEqual({ totalMs: 0, slides: [] });
  });
});

describe('transitions', () => {
  const W = 1920;
  it.each(TRANSITION_KINDS)('%s ends with the incoming slide fully in place', (kind) => {
    for (const direction of [1, -1] as const) {
      const end = transitionFrame(kind, 1, W, direction).incoming;
      expect(end.alpha).toBe(1);
      expect(end.scale).toBe(1);
      expect(Math.abs(end.x)).toBe(0);
      expect(Math.abs(end.y)).toBe(0);
    }
  });

  it('has a label for every kind, and knows which ones are drawn in characters', () => {
    for (const kind of TRANSITION_KINDS) expect(TRANSITION_LABELS[kind]).toBeTruthy();
    expect(TRANSITION_KINDS.filter(isGlyphTransition)).toEqual([
      'ascii-dissolve',
      'ascii-wipe',
      'ascii-scan',
      'ascii-rain',
      'ascii-iris',
    ]);
  });

  it('slide up moves vertically, by the slide height', () => {
    expect(transitionFrame('slide-up', 0, W, 1, 1080).incoming).toMatchObject({ x: 0, y: 1080 });
    expect(transitionFrame('slide-up', 0, W, -1, 1080).incoming.y).toBe(-1080);
    expect(transitionFrame('slide-up', 1, W, 1, 1080).outgoing.y).toBe(-1080);
  });

  it('cover leaves the old slide where it is', () => {
    const mid = transitionFrame('cover', 0.5, W, 1);
    expect(mid.outgoing.x).toBe(0);
    expect(mid.incoming.x).toBeCloseTo(W / 2);
  });

  it('dip passes through black: neither slide shows at the halfway point', () => {
    const mid = transitionFrame('dip', 0.5, W, 1);
    expect(mid.incoming.alpha).toBe(0);
    expect(mid.outgoing.alpha).toBe(0);
    expect(transitionFrame('dip', 0, W, 1).outgoing.alpha).toBe(1);
  });

  it('fade starts with the incoming slide invisible', () => {
    expect(transitionFrame('fade', 0, W, 1).incoming.alpha).toBe(0);
  });

  it('slide enters from the right going forward and from the left going back', () => {
    expect(transitionFrame('slide', 0, W, 1).incoming.x).toBe(W);
    expect(transitionFrame('slide', 0, W, -1).incoming.x).toBe(-W);
    expect(transitionFrame('slide', 1, W, 1).outgoing.x).toBe(-W);
  });

  it('clamps progress outside 0..1', () => {
    expect(transitionFrame('fade', 5, W, 1).incoming.alpha).toBe(1);
    expect(transitionFrame('fade', -5, W, 1).incoming.alpha).toBe(0);
  });

  it('cut shows the incoming slide immediately', () => {
    expect(transitionFrame('cut', 0, W, 1)).toMatchObject({
      incoming: { alpha: 1 },
      outgoing: { alpha: 0 },
    });
  });
});

describe('show messages', () => {
  it('validates control → stage actions', () => {
    expect(
      ControlMessageSchema.safeParse({
        t: 'action',
        action: { type: 'nav.next' },
        source: 'keyboard',
      }).success,
    ).toBe(true);
    expect(
      ControlMessageSchema.safeParse({ t: 'action', action: { type: 'rm -rf' }, source: 'ui' })
        .success,
    ).toBe(false);
  });

  it('rejects malformed stage messages', () => {
    expect(StageMessageSchema.safeParse({ t: 'state' }).success).toBe(false);
    expect(StageMessageSchema.safeParse({ t: 'notice', level: 'warn', message: 'x' }).success).toBe(
      true,
    );
  });
});

describe('pre-show checks', () => {
  const ready = { midiConnected: true, soundEnabled: false, soundBroken: false };

  it('says nothing when everything is in place', () => {
    expect(preflight(createEmptyDeck(), ready)).toEqual([]);
  });

  it('warns about a missing keyboard and points at the fallback keys', () => {
    const warnings = preflight(createEmptyDeck(), { ...ready, midiConnected: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/No MIDI keyboard/);
  });

  it('warns when slides react to sound but sound input is off or broken', () => {
    const deck = createEmptyDeck();
    deck.slides[0]?.elements.push(createAnimation('ascii-vignette', 'Vignette', 0, 0));
    expect(preflight(deck, ready).join(' ')).toMatch(/sound input is off/);
    expect(preflight(deck, { ...ready, soundEnabled: true })).toEqual([]);
    expect(preflight(deck, { ...ready, soundEnabled: true, soundBroken: true }).join(' ')).toMatch(
      /cannot hear anything/,
    );

    // A vignette told to ignore sound does not count; a sound binding on anything does.
    const quiet = createEmptyDeck();
    const still = createAnimation('ascii-vignette', 'Vignette', 0, 0);
    still.params = { audioReacts: 'do nothing' };
    quiet.slides[0]?.elements.push(still);
    expect(preflight(quiet, ready)).toEqual([]);
    const bound = createAnimation('pulse', 'Pulse', 0, 0);
    bound.bindings.push({
      param: 'amount',
      source: 'audioBass',
      controller: 1,
      curve: 'linear',
      min: 0,
      max: 1,
    });
    quiet.slides[0]?.elements.push(bound);
    expect(preflight(quiet, ready).join(' ')).toMatch(/sound input is off/);
  });

  it('counts unknown animations and mappings that point at nothing', () => {
    const deck = createEmptyDeck();
    deck.slides[0]?.elements.push(createAnimation('from-the-future', 'Mystery', 0, 0));
    const mapping = (action: Mapping['action']): Mapping => ({
      id: `m${deck.mappings.length}`,
      name: '',
      enabled: true,
      trigger: { kind: 'noteOn' },
      filters: {},
      action,
      curve: 'linear',
      min: 0,
      max: 1,
    });
    deck.mappings.push(
      mapping({ type: 'anim.trigger', elementId: 'gone' }),
      mapping({ type: 'nav.gotoNamed', slideId: 'gone' }),
      mapping({ type: 'nav.next' }),
      { ...mapping({ type: 'anim.trigger', elementId: 'also-gone' }), enabled: false },
    );
    const text = preflight(deck, ready).join(' ');
    expect(text).toMatch(/1 animation in this deck is not in this version/);
    expect(text).toMatch(/2 mappings point at something that no longer exists/);
  });
});

describe('talk countdown', () => {
  it('shows nothing without a planned length', () => {
    expect(talkClock(60_000, 0)).toEqual({ text: '', state: 'none' });
  });

  it('counts down, warns near the end and counts up once over', () => {
    expect(talkClock(0, 15)).toEqual({ text: '15:00 left', state: 'ok' });
    expect(talkClock(5 * 60_000, 15)).toEqual({ text: '10:00 left', state: 'ok' });
    // The last tenth of a 15 minute talk is 90 seconds.
    expect(talkClock(13.5 * 60_000, 15)).toEqual({ text: '01:30 left', state: 'soon' });
    expect(talkClock(15 * 60_000, 15)).toEqual({ text: '00:00 left', state: 'soon' });
    expect(talkClock(15 * 60_000 + 42_000, 15)).toEqual({ text: '00:42 over', state: 'over' });
    // A short talk still gets a full minute of warning.
    expect(talkClock(4 * 60_000 + 1, 5).state).toBe('soon');
    expect(talkClock(-500, 5)).toEqual({ text: '05:00 left', state: 'ok' });
  });
});

describe('what the keys do on this slide', () => {
  it('lists slide mappings, what animations react to, then whole-deck mappings', () => {
    const deck = createEmptyDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error('no slide');
    const garden = createAnimation('ascii-garden', '', 0, 0);
    garden.bindings.push(
      { param: 'wind', source: 'cc', controller: 1, curve: 'linear', min: 0, max: 1 },
      { param: 'sway', source: 'cc', controller: 71, curve: 'linear', min: 0, max: 3 },
      { param: 'fit', source: 'audioBass', controller: 1, curve: 'linear', min: 0.3, max: 1 },
    );
    const silent = createAnimation('pulse', 'Quiet pulse', 0, 0);
    silent.listen = { mode: 'none', from: 0, to: 127 };
    const hidden = createAnimation('ripple', 'Hidden', 0, 0);
    hidden.hidden = true;
    slide.elements.push(garden, silent, hidden);
    const base = { name: '', enabled: true, curve: 'linear' as const, min: 0, max: 1 };
    slide.mappings.push({
      ...base,
      id: 'm1',
      trigger: { kind: 'noteOn' },
      filters: { noteFrom: 36, noteTo: 36, channel: 10 },
      action: { type: 'anim.trigger', elementId: silent.id },
    });
    deck.mappings.push(
      {
        ...base,
        id: 'm2',
        trigger: { kind: 'noteOn' },
        filters: { noteFrom: 37, noteTo: 37, channel: 10 },
        action: { type: 'nav.next' },
      },
      {
        ...base,
        id: 'm3',
        enabled: false,
        trigger: { kind: 'noteOn' },
        filters: { noteFrom: 38, noteTo: 38, channel: 10 },
        action: { type: 'nav.prev' },
      },
    );
    expect(cheatSheet(deck, 0, DEFAULT_SETTINGS.controller)).toEqual([
      { input: 'Pad 1', does: 'Play Quiet pulse', here: true },
      { input: 'Keys', does: 'Play ASCII garden', here: true },
      { input: 'Mod wheel', does: 'Wind (the mod wheel adds more) of ASCII garden', here: true },
      { input: 'Knob 2', does: 'Idle sway of ASCII garden', here: true },
      { input: 'Sound: bass', does: 'Plant size of ASCII garden', here: true },
      { input: 'Pad 2', does: 'Next slide', here: false },
    ]);
    expect(cheatSheet(deck, 7, DEFAULT_SETTINGS.controller)).toEqual([]);
  });
});

describe('ASCII transitions', () => {
  const kinds = TRANSITION_KINDS.filter(isGlyphTransition);
  const COLS = 48;
  const ROWS = 27;

  it.each(kinds)('%s gives every cell a start between 0 and 1, both ways', (kind) => {
    for (const direction of [1, -1] as const) {
      let lo = 1;
      let hi = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const d = cellDelay(kind, c, r, COLS, ROWS, direction);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(1);
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
      }
      // The cells are spread over the whole transition, not bunched together.
      expect(lo).toBeLessThan(0.15);
      expect(hi).toBeGreaterThan(0.85);
    }
  });

  it.each(kinds)('%s going back is the forward order exactly reversed', (kind) => {
    for (const [c, r] of [
      [0, 0],
      [7, 3],
      [47, 26],
      [20, 13],
    ] as const) {
      expect(cellDelay(kind, c, r, COLS, ROWS, -1)).toBeCloseTo(
        1 - cellDelay(kind, c, r, COLS, ROWS, 1),
      );
    }
  });

  it('has a one-line description for every transition', () => {
    for (const kind of TRANSITION_KINDS) expect(TRANSITION_HINTS[kind].length).toBeGreaterThan(10);
  });

  it('survives a grid of one cell', () => {
    for (const kind of kinds) expect(Number.isFinite(cellDelay(kind, 0, 0, 1, 1, 1))).toBe(true);
  });

  it('the patterns run in the directions their names say', () => {
    expect(cellDelay('ascii-scan', 0, 0, COLS, ROWS, 1)).toBe(0);
    expect(cellDelay('ascii-scan', COLS - 1, ROWS - 1, COLS, ROWS, 1)).toBe(1);
    expect(cellDelay('ascii-scan', 0, 0, COLS, ROWS, -1)).toBe(1);
    expect(cellDelay('ascii-wipe', 0, 5, COLS, ROWS, 1)).toBeLessThan(
      cellDelay('ascii-wipe', COLS - 1, 5, COLS, ROWS, 1),
    );
    expect(cellDelay('ascii-wipe', 0, 5, COLS, ROWS, -1)).toBeGreaterThan(
      cellDelay('ascii-wipe', COLS - 1, 5, COLS, ROWS, -1),
    );
    expect(cellDelay('ascii-rain', 7, 0, COLS, ROWS, 1)).toBeLessThan(
      cellDelay('ascii-rain', 7, ROWS - 1, COLS, ROWS, 1),
    );
    expect(cellDelay('ascii-iris', 24, 13, COLS, ROWS, 1)).toBeLessThan(
      cellDelay('ascii-iris', 0, 0, COLS, ROWS, 1),
    );
    expect(cellDelay('ascii-iris', 24, 13, COLS, ROWS, -1)).toBeGreaterThan(
      cellDelay('ascii-iris', 0, 0, COLS, ROWS, -1),
    );
  });

  it('every cell has not started at the beginning and is finished at the end', () => {
    for (const delay of [0, 0.3, 1]) {
      expect(cellProgress(0, delay)).toBe(0);
      expect(cellProgress(1, delay)).toBe(1);
    }
    expect(cellProgress(0.5, 0)).toBe(1);
    expect(cellProgress(0.5, 1)).toBe(0);
    expect(cellProgress(7, 1)).toBe(1);
  });

  it('a cell shows the old slide, then a glyph, then nothing but the new slide', () => {
    expect(tileAlpha(0)).toBe(1);
    expect(tileAlpha(1)).toBe(0);
    expect(tileAlpha(0.7)).toBe(0);
    expect(glyphAlpha(0)).toBe(0);
    expect(glyphAlpha(1)).toBe(0);
    expect(glyphAlpha(0.4)).toBe(1);
    for (let u = 0; u <= 1; u += 0.05) {
      expect(tileAlpha(u)).toBeGreaterThanOrEqual(0);
      expect(tileAlpha(u)).toBeLessThanOrEqual(1);
      expect(glyphAlpha(u)).toBeGreaterThanOrEqual(0);
      expect(glyphAlpha(u)).toBeLessThanOrEqual(1);
    }
  });

  it('always picks a real, non-empty glyph from the set', () => {
    for (const name of TRANSITION_GLYPH_NAMES) {
      const count = [...TRANSITION_GLYPHS[name]].length;
      expect(TRANSITION_GLYPHS[name].startsWith(' ')).toBe(true);
      for (let cell = 0; cell < 50; cell++) {
        for (let u = 0; u <= 1; u += 0.1) {
          const ix = glyphIndex(u, cell, count);
          expect(ix).toBeGreaterThanOrEqual(1);
          expect(ix).toBeLessThan(count);
        }
      }
    }
    expect(glyphIndex(0.5, 3, 1)).toBe(0);
  });

  it('covers the slide and never makes more cells than it can draw quickly', () => {
    const normal = glyphGrid(1920, 1080, 40);
    expect(normal).toEqual({ cell: 40, cols: 48, rows: 27 });
    const tiny = glyphGrid(1920, 1080, 12, 6000);
    expect(tiny.cols * tiny.rows).toBeLessThanOrEqual(6000);
    expect(tiny.cols * tiny.cell).toBeGreaterThanOrEqual(1920);
    expect(tiny.rows * tiny.cell).toBeGreaterThanOrEqual(1080);
    expect(glyphGrid(1920, 1080, Number.NaN).cell).toBe(40);
  });
});
