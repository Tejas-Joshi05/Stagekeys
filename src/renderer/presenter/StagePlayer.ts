import { Container, Graphics, RenderTexture, type Renderer } from 'pixi.js';
import type { Deck } from '../deck';
import type { MidiBus, MidiInputState } from '../midi';
import { createRenderer, fitRenderer, SlideScene, type AssetTextures } from '../render';
import { FrameMeter } from '../shared/fps';
import { applyFrame, transitionFrame, type TransitionKind } from './transitions';

export interface StagePlayerOptions {
  canvas: HTMLCanvasElement;
  deck: Deck;
  textures: AssetTextures;
  bus: MidiBus;
  input: MidiInputState;
  onAnimationError: (elementId: string, phase: string, error: unknown) => void;
  onFrameSummary?: (summary: {
    fps: number;
    worstFrameMs: number;
    latencyAvg: number;
    latencyMax: number;
  }) => void;
}

interface ActiveTransition {
  kind: TransitionKind;
  duration: number;
  elapsed: number;
  direction: 1 | -1;
  outgoing: SlideScene;
}

const BLACK_FADE_S = 0.18;

/**
 * Draws the show: the current slide, the transition into it, the black
 * screen, and live animations. Owns its own requestAnimationFrame loop and
 * reads MIDI from the bus once per frame.
 */
export class StagePlayer {
  readonly meter = new FrameMeter();
  private renderer: Renderer | null = null;
  private readonly stage = new Container();
  private readonly slides = new Container();
  private readonly blackout = new Graphics();
  private scene: SlideScene | null = null;
  private transition: ActiveTransition | null = null;
  private black = false;
  private blackAmount = 0;
  private index = -1;
  private raf = 0;
  private lastFrame = 0;
  private lastSeq: number;
  private destroyed = false;
  private readonly size: { width: number; height: number };

  constructor(private readonly options: StagePlayerOptions) {
    this.size = options.deck.meta.canvas;
    this.lastSeq = options.bus.head;
    this.blackout.rect(0, 0, this.size.width, this.size.height).fill({ color: 0x000000 });
    this.blackout.alpha = 0;
    this.stage.addChild(this.slides, this.blackout);
  }

  async init(): Promise<void> {
    this.renderer = await createRenderer(this.options.canvas, this.size);
    if (this.destroyed) {
      this.renderer.destroy();
      this.renderer = null;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Draws every slide once, off screen, before the show starts. Shaders get
   * compiled and images uploaded now rather than the first time a slide
   * appears in front of the audience. Bounded by a time budget so a huge deck
   * still starts promptly; anything left over warms up on first use as before.
   */
  async warmUp(budgetMs = 4000): Promise<number> {
    const renderer = this.renderer;
    if (!renderer) return 0;
    const deck = this.options.deck;
    const target = RenderTexture.create({ width: this.size.width, height: this.size.height });
    const start = performance.now();
    let warmed = 0;
    try {
      for (const slide of deck.slides) {
        if (this.destroyed || performance.now() - start > budgetMs) break;
        const scene = this.newScene();
        try {
          scene.sync(slide, deck);
          scene.update(1 / 60, this.options.input);
          renderer.render({ container: scene.root, target });
          warmed++;
        } finally {
          scene.destroy();
        }
        // Let the window breathe between slides.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      target.destroy(true);
    }
    return warmed;
  }

  resize(cssWidth: number, dpr: number): void {
    if (this.renderer) fitRenderer(this.renderer, this.size, cssWidth, dpr);
  }

  get slideIndex(): number {
    return this.index;
  }

  get isBlack(): boolean {
    return this.black;
  }

  private newScene(): SlideScene {
    return new SlideScene({
      textures: this.options.textures,
      animations: 'live',
      placeholders: false,
      onAnimationError: this.options.onAnimationError,
      onChange: () => undefined,
    });
  }

  /** Shows a slide. `animate` false means cut regardless of the slide's transition. */
  goto(index: number, animate = true): boolean {
    const deck = this.options.deck;
    const target = Math.min(deck.slides.length - 1, Math.max(0, index));
    const slide = deck.slides[target];
    if (!slide || target === this.index) return false;

    this.finishTransition();
    const outgoing = this.scene;
    const incoming = this.newScene();
    incoming.sync(slide, deck);
    this.slides.addChild(incoming.root);
    this.scene = incoming;
    const direction: 1 | -1 = target >= this.index ? 1 : -1;
    this.index = target;

    const kind = animate ? slide.transition.kind : 'cut';
    const duration = slide.transition.duration / 1000;
    if (outgoing && kind !== 'cut' && duration > 0) {
      this.transition = { kind, duration, elapsed: 0, direction, outgoing };
      this.applyTransition();
    } else {
      outgoing?.destroy();
      applyFrame(incoming.root, { alpha: 1, x: 0, scale: 1 }, this.size.width, this.size.height);
    }
    return true;
  }

  private applyTransition(): void {
    const t = this.transition;
    if (!t || !this.scene) return;
    const frame = transitionFrame(t.kind, t.elapsed / t.duration, this.size.width, t.direction);
    applyFrame(this.scene.root, frame.incoming, this.size.width, this.size.height);
    applyFrame(t.outgoing.root, frame.outgoing, this.size.width, this.size.height);
  }

  /** Jumps any running transition to its end and frees the outgoing slide. */
  private finishTransition(): void {
    const t = this.transition;
    if (!t) return;
    this.transition = null;
    t.outgoing.destroy();
    if (this.scene) {
      applyFrame(this.scene.root, { alpha: 1, x: 0, scale: 1 }, this.size.width, this.size.height);
    }
  }

  setBlack(black: boolean): void {
    this.black = black;
  }

  trigger(elementId: string, value: number): void {
    this.scene?.trigger(elementId, value);
  }

  setParam(elementId: string, name: string, value: number): void {
    this.scene?.setParam(elementId, name, value);
  }

  /** Back to a calm, known state on the current slide: no black, no transition, animations reset. */
  panic(): void {
    this.finishTransition();
    this.black = false;
    this.blackAmount = 0;
    this.blackout.alpha = 0;
    this.scene?.resetAnimations();
    this.options.input.releaseAll();
  }

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    try {
      const { bus, input } = this.options;
      const messages = bus.head > this.lastSeq ? bus.since(this.lastSeq) : [];
      this.lastSeq = bus.head;

      if (this.scene) {
        this.scene.offerMidi(messages);
        this.scene.update(dt, input);
      }
      if (this.transition) {
        this.transition.elapsed += dt;
        if (this.transition.elapsed >= this.transition.duration) this.finishTransition();
        else this.applyTransition();
      }
      const target = this.black ? 1 : 0;
      if (this.blackAmount !== target) {
        const step = dt / BLACK_FADE_S;
        this.blackAmount =
          target > this.blackAmount
            ? Math.min(target, this.blackAmount + step)
            : Math.max(target, this.blackAmount - step);
        this.blackout.alpha = this.blackAmount;
      }

      this.renderer?.render(this.stage);

      if (messages.length > 0) {
        const done = performance.now();
        for (const m of messages) this.meter.midiLatency(done - m.time);
      }
      const summary = this.meter.tick(now);
      if (summary) this.options.onFrameSummary?.(summary);
    } catch (e) {
      // A bad frame must not stop the loop; the next frame gets another chance.
      this.options.onAnimationError('stage', 'frame', e);
    }
  };

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.finishTransition();
    this.scene?.destroy();
    this.scene = null;
    this.stage.destroy({ children: true });
    this.renderer?.destroy();
    this.renderer = null;
  }
}
