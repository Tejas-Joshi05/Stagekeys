/** Pure geometry for the canvas editor. All coordinates are slide pixels. */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, about the box centre. */
  rotation: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function rotatePoint(p: Point, centre: Point, deg: number): Point {
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
}

export function corners(b: Box): Point[] {
  const c = centreOf(b);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => rotatePoint(p, c, b.rotation));
}

/** Axis-aligned bounds of a (possibly rotated) box. */
export function boundsOf(b: Box): Rect {
  const pts = corners(b);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function unionBounds(boxes: readonly Box[]): Rect | null {
  if (boxes.length === 0) return null;
  const all = boxes.map(boundsOf);
  return {
    left: Math.min(...all.map((r) => r.left)),
    top: Math.min(...all.map((r) => r.top)),
    right: Math.max(...all.map((r) => r.right)),
    bottom: Math.max(...all.map((r) => r.bottom)),
  };
}

/** Is the point inside the box? Thin boxes (lines) get a minimum grabbable thickness. */
export function hitTest(b: Box, p: Point, minSize = 14): boolean {
  const local = rotatePoint(p, centreOf(b), -b.rotation);
  const padX = Math.max(0, (minSize - b.width) / 2);
  const padY = Math.max(0, (minSize - b.height) / 2);
  return (
    local.x >= b.x - padX &&
    local.x <= b.x + b.width + padX &&
    local.y >= b.y - padY &&
    local.y <= b.y + b.height + padY
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Position of a resize handle in slide coordinates. */
export function handlePoint(b: Box, handle: Handle): Point {
  const fx = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5;
  const fy = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5;
  return rotatePoint({ x: b.x + b.width * fx, y: b.y + b.height * fy }, centreOf(b), b.rotation);
}

export interface ResizeOptions {
  keepAspect?: boolean;
  minSize?: number;
}

/**
 * Resizes a box by dragging one of its handles to `pointer`. The opposite
 * edge or corner stays fixed on screen, including for rotated boxes.
 */
export function resizeBox(
  start: Box,
  handle: Handle,
  pointer: Point,
  options: ResizeOptions = {},
): Box {
  const min = options.minSize ?? 8;
  const c = centreOf(start);
  // Work in the box's own unrotated frame.
  const p = rotatePoint(pointer, c, -start.rotation);
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (handle.includes('w')) left = Math.min(p.x, right - min);
  if (handle.includes('e')) right = Math.max(p.x, left + min);
  if (handle.includes('n')) top = Math.min(p.y, bottom - min);
  if (handle.includes('s')) bottom = Math.max(p.y, top + min);

  if (options.keepAspect && handle.length === 2 && start.height > 0) {
    const aspect = start.width / start.height;
    let width = right - left;
    let height = bottom - top;
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    if (handle.includes('w')) left = right - width;
    else right = left + width;
    if (handle.includes('n')) top = bottom - height;
    else bottom = top + height;
  }

  const width = right - left;
  const height = bottom - top;
  // The new centre in the old frame, rotated back into slide space.
  const centre = rotatePoint({ x: (left + right) / 2, y: (top + bottom) / 2 }, c, start.rotation);
  return {
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
    rotation: start.rotation,
  };
}

/** Angle for the rotate handle: 0 when the pointer is straight above the centre. */
export function rotationFor(centre: Point, pointer: Point, snap: boolean): number {
  let deg = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  deg = ((deg % 360) + 360) % 360;
  return deg > 180 ? deg - 360 : deg;
}

export interface SnapTargets {
  xs: readonly number[];
  ys: readonly number[];
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** Guide lines to draw: x positions of vertical guides, y positions of horizontal ones. */
  guides: { vertical: number[]; horizontal: number[] };
}

/** Snap targets: canvas edges and centre, plus the edges and centres of other elements. */
export function snapTargets(
  canvas: { width: number; height: number },
  others: readonly Box[],
): SnapTargets {
  const xs = [0, canvas.width / 2, canvas.width];
  const ys = [0, canvas.height / 2, canvas.height];
  for (const b of others) {
    const r = boundsOf(b);
    xs.push(r.left, (r.left + r.right) / 2, r.right);
    ys.push(r.top, (r.top + r.bottom) / 2, r.bottom);
  }
  return { xs, ys };
}

function nearest(candidates: readonly number[], targets: readonly number[], threshold: number) {
  let best: { delta: number; at: number } | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const delta = t - c;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: t };
      }
    }
  }
  return best;
}

/** Given where the moving selection would land, returns the small correction that snaps it. */
export function snapMove(moving: Rect, targets: SnapTargets, threshold: number): SnapResult {
  const x = nearest(
    [moving.left, (moving.left + moving.right) / 2, moving.right],
    targets.xs,
    threshold,
  );
  const y = nearest(
    [moving.top, (moving.top + moving.bottom) / 2, moving.bottom],
    targets.ys,
    threshold,
  );
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    guides: { vertical: x ? [x.at] : [], horizontal: y ? [y.at] : [] },
  };
}

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * How far each box must move to be aligned. One box aligns to the canvas;
 * several align to the bounds of the group.
 */
export function alignOffsets(
  boxes: readonly (Box & { id: string })[],
  mode: AlignMode,
  canvas: { width: number; height: number },
): Map<string, Point> {
  const out = new Map<string, Point>();
  const frame: Rect | null =
    boxes.length > 1
      ? unionBounds(boxes)
      : { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
  if (!frame) return out;
  for (const b of boxes) {
    const r = boundsOf(b);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = frame.left - r.left;
    else if (mode === 'right') dx = frame.right - r.right;
    else if (mode === 'centre') dx = (frame.left + frame.right) / 2 - (r.left + r.right) / 2;
    else if (mode === 'top') dy = frame.top - r.top;
    else if (mode === 'bottom') dy = frame.bottom - r.bottom;
    else dy = (frame.top + frame.bottom) / 2 - (r.top + r.bottom) / 2;
    out.set(b.id, { x: dx, y: dy });
  }
  return out;
}
