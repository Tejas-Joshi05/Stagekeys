import { describe, expect, it } from 'vitest';
import {
  alignOffsets,
  boundsOf,
  handlePoint,
  hitTest,
  rectFromPoints,
  rectsIntersect,
  resizeBox,
  rotatePoint,
  rotationFor,
  snapMove,
  snapTargets,
  type Box,
} from './geometry';

const box = (partial: Partial<Box> = {}): Box => ({
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  ...partial,
});
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

describe('hit testing', () => {
  it('hits inside and misses outside an unrotated box', () => {
    expect(hitTest(box(), { x: 150, y: 150 })).toBe(true);
    expect(hitTest(box(), { x: 99, y: 150 })).toBe(false);
  });

  it('accounts for rotation', () => {
    const rotated = box({ rotation: 90 });
    // After a quarter turn the box is tall: 100 wide, 200 high around the same centre.
    expect(hitTest(rotated, { x: 200, y: 60 })).toBe(true);
    expect(hitTest(rotated, { x: 120, y: 150 })).toBe(false);
  });

  it('gives thin lines a grabbable thickness', () => {
    const line = box({ height: 2 });
    expect(hitTest(line, { x: 150, y: 106 })).toBe(true);
    expect(hitTest(line, { x: 150, y: 120 })).toBe(false);
  });
});

describe('bounds and marquee', () => {
  it('computes rotated bounds', () => {
    const r = boundsOf(box({ rotation: 90 }));
    expect(r.left).toBeCloseTo(150);
    expect(r.right).toBeCloseTo(250);
    expect(r.top).toBeCloseTo(50);
    expect(r.bottom).toBeCloseTo(250);
  });

  it('marquee rectangles intersect regardless of drag direction', () => {
    const marquee = rectFromPoints({ x: 400, y: 400 }, { x: 250, y: 150 });
    expect(rectsIntersect(marquee, boundsOf(box()))).toBe(true);
    expect(rectsIntersect(rectFromPoints({ x: 0, y: 0 }, { x: 50, y: 50 }), boundsOf(box()))).toBe(
      false,
    );
  });
});

describe('resizing', () => {
  it('dragging the south-east handle grows the box and keeps the top-left fixed', () => {
    const out = resizeBox(box(), 'se', { x: 400, y: 300 });
    expect(out).toMatchObject({ x: 100, y: 100, width: 300, height: 200 });
  });

  it('dragging the north-west handle keeps the bottom-right fixed', () => {
    const out = resizeBox(box(), 'nw', { x: 50, y: 80 });
    expect(out).toMatchObject({ x: 50, y: 80, width: 250, height: 120 });
  });

  it('edge handles change one dimension only', () => {
    const out = resizeBox(box(), 'e', { x: 500, y: 999 });
    expect(out).toMatchObject({ x: 100, y: 100, width: 400, height: 100 });
  });

  it('never collapses below the minimum size', () => {
    const out = resizeBox(box(), 'e', { x: -500, y: 0 }, { minSize: 8 });
    expect(out.width).toBe(8);
  });

  it('keeps the aspect ratio on corner drags when asked', () => {
    const out = resizeBox(box(), 'se', { x: 500, y: 150 }, { keepAspect: true });
    expect(out.width / out.height).toBeCloseTo(2);
  });

  it('keeps the opposite corner fixed on screen for a rotated box', () => {
    const start = box({ rotation: 30 });
    const anchorBefore = handlePoint(start, 'nw');
    const out = resizeBox(start, 'se', { x: 420, y: 330 });
    close(handlePoint(out, 'nw'), anchorBefore);
    expect(out.rotation).toBe(30);
  });
});

describe('rotation', () => {
  it('is 0 straight up, 90 to the right, and snaps to 15 degrees', () => {
    const c = { x: 0, y: 0 };
    expect(rotationFor(c, { x: 0, y: -10 }, false)).toBeCloseTo(0);
    expect(rotationFor(c, { x: 10, y: 0 }, false)).toBeCloseTo(90);
    expect(rotationFor(c, { x: -10, y: 0 }, false)).toBeCloseTo(-90);
    expect(rotationFor(c, { x: 10, y: -9 }, true)).toBe(45);
  });

  it('rotatePoint turns clockwise in screen coordinates', () => {
    close(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 10 });
  });
});

describe('snapping', () => {
  const canvas = { width: 1920, height: 1080 };

  it('snaps the centre of a moving box to the canvas centre', () => {
    const moving = { left: 855, top: 500, right: 1055, bottom: 600 }; // centre x = 955
    const snap = snapMove(moving, snapTargets(canvas, []), 8);
    expect(snap.dx).toBe(5);
    expect(snap.guides.vertical).toEqual([960]);
    expect(snap.dy).toBe(0);
    expect(snap.guides.horizontal).toEqual([]);
  });

  it('snaps edges to another element', () => {
    const other = box({ x: 300, y: 300, width: 100, height: 100 });
    const moving = { left: 403, top: 700, right: 503, bottom: 800 };
    const snap = snapMove(moving, snapTargets(canvas, [other]), 8);
    expect(snap.dx).toBe(-3);
    expect(snap.guides.vertical).toEqual([400]);
  });

  it('does not snap when nothing is within the threshold', () => {
    const snap = snapMove({ left: 33, top: 33, right: 77, bottom: 77 }, snapTargets(canvas, []), 4);
    expect(snap).toEqual({ dx: 0, dy: 0, guides: { vertical: [], horizontal: [] } });
  });
});

describe('alignment', () => {
  const canvas = { width: 1920, height: 1080 };
  it('aligns a single element to the canvas', () => {
    const offsets = alignOffsets([{ id: 'a', ...box() }], 'centre', canvas);
    expect(offsets.get('a')).toEqual({ x: 760, y: 0 });
  });

  it('aligns several elements to the group bounds', () => {
    const a = { id: 'a', ...box({ x: 100 }) };
    const b = { id: 'b', ...box({ x: 500 }) };
    const left = alignOffsets([a, b], 'left', canvas);
    expect(left.get('a')).toEqual({ x: 0, y: 0 });
    expect(left.get('b')).toEqual({ x: -400, y: 0 });
    const right = alignOffsets([a, b], 'right', canvas);
    expect(right.get('a')).toEqual({ x: 400, y: 0 });
  });
});
