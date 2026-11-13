// Pixi generates shader glue with `new Function` by default, which a strict
// Content Security Policy forbids. This import swaps in the eval-free path.
import 'pixi.js/unsafe-eval';
import { autoDetectRenderer, type Renderer } from 'pixi.js';

export interface SlideSize {
  width: number;
  height: number;
}

const MAX_BACKING_WIDTH = 3840;

export async function createRenderer(
  canvas: HTMLCanvasElement,
  size: SlideSize,
): Promise<Renderer> {
  return autoDetectRenderer({
    preference: 'webgl',
    canvas,
    width: size.width,
    height: size.height,
    resolution: 1,
    autoDensity: false,
    antialias: true,
    backgroundColor: 0x000000,
    powerPreference: 'high-performance',
  });
}

/**
 * Sizes the drawing buffer for a canvas shown `cssWidth` CSS pixels wide.
 * The renderer always works in slide coordinates (e.g. 1920x1080); only its
 * resolution changes, so text and shapes stay sharp at any size.
 */
export function fitRenderer(
  renderer: Renderer,
  size: SlideSize,
  cssWidth: number,
  dpr: number,
): void {
  const backing = Math.min(MAX_BACKING_WIDTH, Math.max(16, Math.round(cssWidth * dpr)));
  const resolution = backing / size.width;
  if (
    Math.abs(renderer.resolution - resolution) > 0.001 ||
    renderer.width !== size.width ||
    renderer.height !== size.height
  ) {
    renderer.resize(size.width, size.height, resolution);
  }
}
