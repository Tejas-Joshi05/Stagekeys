import type { Container } from 'pixi.js';

export type TransitionKind = 'cut' | 'fade' | 'slide' | 'zoom';

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface TransitionFrame {
  incoming: { alpha: number; x: number; scale: number };
  outgoing: { alpha: number; x: number; scale: number };
}

/**
 * Where the incoming and outgoing slides should be at progress t (0..1).
 * `direction` is +1 when moving forward through the deck, -1 when going back.
 * Pure, so every transition can be unit-tested.
 */
export function transitionFrame(
  kind: TransitionKind,
  t: number,
  width: number,
  direction: 1 | -1,
): TransitionFrame {
  const p = easeInOut(Math.min(1, Math.max(0, t)));
  switch (kind) {
    case 'cut':
      return {
        incoming: { alpha: 1, x: 0, scale: 1 },
        outgoing: { alpha: 0, x: 0, scale: 1 },
      };
    case 'fade':
      return {
        incoming: { alpha: p, x: 0, scale: 1 },
        outgoing: { alpha: 1, x: 0, scale: 1 },
      };
    case 'slide':
      return {
        incoming: { alpha: 1, x: direction * width * (1 - p), scale: 1 },
        outgoing: { alpha: 1, x: -direction * width * p, scale: 1 },
      };
    case 'zoom':
      return {
        incoming: { alpha: p, x: 0, scale: 0.88 + 0.12 * p },
        outgoing: { alpha: 1 - p, x: 0, scale: 1 + 0.12 * p },
      };
  }
}

/** Applies a frame to a scene root whose pivot is at the slide centre. */
export function applyFrame(
  root: Container,
  frame: TransitionFrame['incoming'],
  width: number,
  height: number,
): void {
  root.pivot.set(width / 2, height / 2);
  root.position.set(width / 2 + frame.x, height / 2);
  root.scale.set(frame.scale);
  root.alpha = frame.alpha;
}
