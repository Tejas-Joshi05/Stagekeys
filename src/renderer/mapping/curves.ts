import { clamp01 } from '../shared/util';
import type { Curve } from './types';

/** Shapes a 0..1 value. All curves map 0 to 0 and 1 to 1 and are monotonic. */
export function applyCurve(curve: Curve, t: number): number {
  const x = clamp01(t);
  switch (curve) {
    case 'linear':
      return x;
    case 'exponential':
      // Gentle at the bottom, steep at the top: soft playing stays subtle.
      return x * x * x;
    case 'logarithmic':
      // Steep at the bottom, flat at the top: light touches already register.
      return Math.log1p(9 * x) / Math.log(10);
  }
}

export function scaleValue(curve: Curve, t: number, min: number, max: number): number {
  return min + (max - min) * applyCurve(curve, t);
}
