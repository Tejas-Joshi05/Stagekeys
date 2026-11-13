import { describe, expect, it } from 'vitest';
import { ControlMessageSchema, StageMessageSchema } from './messages';
import { ShowTimeline } from './timeline';
import { transitionFrame } from './transitions';

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
  it.each(['fade', 'slide', 'zoom'] as const)(
    '%s ends with the incoming slide fully in place',
    (kind) => {
      const end = transitionFrame(kind, 1, W, 1);
      expect(end.incoming).toEqual({ alpha: 1, x: 0, scale: 1 });
    },
  );

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
