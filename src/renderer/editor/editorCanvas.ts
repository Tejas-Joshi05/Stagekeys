import { Container, type Renderer } from 'pixi.js';
import type { Deck, Slide } from '../deck';
import type { MidiBus, MidiInputState } from '../midi';
import { createRenderer, fitRenderer, SlideScene, type AssetTextures } from '../render';
import { FrameMeter } from '../shared/fps';
import { errorMessage, logger } from '../shared/log';

/**
 * The editor's live canvas. It uses the same SlideScene as the stage, and
 * animations run here too, so playing a key while editing shows exactly what
 * the audience will see.
 */
export class EditorCanvas {
  readonly meter = new FrameMeter();
  private renderer: Renderer | null = null;
  private readonly stage = new Container();
  private scene: SlideScene | null = null;
  private dirty = true;
  private raf = 0;
  private lastFrame = 0;
  private lastSeq: number;
  private destroyed = false;
  private editingId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly size: { width: number; height: number },
    private readonly textures: AssetTextures,
    private readonly bus: MidiBus,
    private readonly input: MidiInputState,
  ) {
    this.lastSeq = bus.head;
  }

  async init(): Promise<boolean> {
    const renderer = await createRenderer(this.canvas, this.size);
    if (this.destroyed) {
      renderer.destroy();
      return false;
    }
    this.renderer = renderer;
    this.raf = requestAnimationFrame(this.frame);
    return true;
  }

  show(slide: Slide, deck: Deck): void {
    if (this.destroyed) return;
    if (!this.scene || this.scene.currentSlideId !== slide.id) {
      // A different slide: start its animations fresh.
      this.scene?.destroy();
      this.scene = new SlideScene({
        textures: this.textures,
        animations: 'live',
        placeholders: true,
        onAnimationError: (id, phase, error) =>
          logger.error(`Animation ${id} failed in ${phase} (editor preview)`, errorMessage(error)),
        onChange: () => {
          this.dirty = true;
        },
      });
      this.scene.setEditing(this.editingId);
      this.stage.addChild(this.scene.root);
    }
    this.scene.sync(slide, deck);
    this.dirty = true;
  }

  setEditing(id: string | null): void {
    this.editingId = id;
    this.scene?.setEditing(id);
    this.dirty = true;
  }

  resize(cssWidth: number, dpr: number): void {
    if (!this.renderer) return;
    fitRenderer(this.renderer, this.size, cssWidth, dpr);
    this.dirty = true;
  }

  trigger(elementId: string, value: number): void {
    this.scene?.trigger(elementId, value);
  }

  setParam(elementId: string, name: string, value: number): void {
    this.scene?.setParam(elementId, name, value);
  }

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try {
      const scene = this.scene;
      const messages = this.bus.head > this.lastSeq ? this.bus.since(this.lastSeq) : [];
      this.lastSeq = this.bus.head;
      if (scene?.hasAnimations) {
        scene.offerMidi(messages);
        scene.update(dt, this.input);
        this.dirty = true;
      }
      if (this.dirty && this.renderer) {
        this.dirty = false;
        this.renderer.render(this.stage);
        if (messages.length > 0) {
          const done = performance.now();
          for (const m of messages) this.meter.midiLatency(done - m.time);
        }
      }
      this.meter.tick(now);
    } catch (e) {
      logger.error('Editor canvas frame failed', errorMessage(e));
    }
  };

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.scene?.destroy();
    this.scene = null;
    this.stage.destroy({ children: true });
    this.renderer?.destroy();
    this.renderer = null;
  }
}

/** The canvas currently on screen, so action handlers can preview animations in the editor. */
let active: EditorCanvas | null = null;
export const setActiveCanvas = (canvas: EditorCanvas | null): void => {
  active = canvas;
};
export const previewTrigger = (elementId: string, value: number): void =>
  active?.trigger(elementId, value);
export const previewSetParam = (elementId: string, name: string, value: number): void =>
  active?.setParam(elementId, name, value);
