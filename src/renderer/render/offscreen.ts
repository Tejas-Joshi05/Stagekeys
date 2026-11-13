import { Container, type Renderer } from 'pixi.js';
import type { Deck, Slide } from '../deck';
import { createRenderer, fitRenderer } from './pixi';
import { SlideScene } from './SlideScene';
import type { AssetTextures } from './textures';

/**
 * Renders slides off screen for thumbnails and PNG/PDF export, using the same
 * scene code as the stage. Jobs run one at a time on a single WebGL context.
 */
export class OffscreenRenderer {
  private renderer: Renderer | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  constructor(private readonly textures: AssetTextures) {}

  /** Draws a slide and returns it on a fresh 2D canvas `pixelWidth` pixels wide. */
  render(slide: Slide, deck: Deck, pixelWidth: number): Promise<HTMLCanvasElement> {
    const job = this.queue.then(() => this.draw(slide, deck, pixelWidth));
    this.queue = job.catch(() => undefined);
    return job;
  }

  async toPng(slide: Slide, deck: Deck, pixelWidth: number): Promise<Uint8Array> {
    const canvas = await this.render(slide, deck, pixelWidth);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not encode the slide as PNG');
    return new Uint8Array(await blob.arrayBuffer());
  }

  private async draw(slide: Slide, deck: Deck, pixelWidth: number): Promise<HTMLCanvasElement> {
    if (this.destroyed) throw new Error('Renderer was destroyed');
    const size = deck.meta.canvas;
    this.renderer ??= await createRenderer(document.createElement('canvas'), size);
    const renderer = this.renderer;
    fitRenderer(renderer, size, pixelWidth, 1);

    const stage = new Container();
    const scene = new SlideScene({
      textures: this.textures,
      animations: 'final',
      placeholders: false,
      onAnimationError: () => undefined,
      onChange: () => undefined,
    });
    try {
      stage.addChild(scene.root);
      scene.sync(slide, deck);
      await this.textures.settled();
      renderer.render(stage);
      // Copy straight away: the WebGL buffer is only guaranteed until the next frame.
      const out = document.createElement('canvas');
      out.width = renderer.canvas.width;
      out.height = renderer.canvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('2D canvas is not available');
      ctx.drawImage(renderer.canvas as HTMLCanvasElement, 0, 0);
      return out;
    } finally {
      scene.destroy();
      stage.destroy();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer?.destroy();
    this.renderer = null;
  }
}
