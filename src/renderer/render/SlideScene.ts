import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { AnimationInstance, getAnimation, type AnimationErrorHandler } from '../animations';
import type {
  AnimationElement,
  Deck,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
} from '../deck';
import type { MidiInputState, MidiMessage } from '../midi';
import { hexToNumber } from '../shared/util';
import type { AssetTextures } from './textures';

export interface SceneOptions {
  textures: AssetTextures;
  /**
   * live:  animations run and react to MIDI (stage and editor);
   * final: animations draw their finished state once (thumbnails, export).
   */
  animations: 'live' | 'final';
  /** Editor only: outline animation elements so they can be seen and selected while idle. */
  placeholders: boolean;
  onAnimationError: AnimationErrorHandler;
  /** Called when something changed outside a sync (an image finished loading). */
  onChange: () => void;
}

interface ElementView {
  element: SlideElement;
  node: Container;
  animation: AnimationInstance | null;
  cancelTexture: (() => void) | null;
}

function applyTransform(node: Container, el: SlideElement, hiddenExtra: boolean): void {
  node.position.set(el.x + el.width / 2, el.y + el.height / 2);
  node.pivot.set(el.width / 2, el.height / 2);
  node.rotation = (el.rotation * Math.PI) / 180;
  node.alpha = el.opacity;
  node.visible = !el.hidden && !hiddenExtra;
}

function buildText(el: TextElement): Container {
  const text = new Text({
    text: el.text,
    style: {
      fontFamily: el.fontFamily,
      fontSize: el.fontSize,
      fontWeight: String(el.fontWeight) as '400',
      fill: el.color,
      align: el.align,
      lineHeight: el.fontSize * el.lineHeight,
      wordWrap: true,
      wordWrapWidth: el.width,
    },
  });
  if (el.align === 'center') {
    text.anchor.set(0.5, 0);
    text.x = el.width / 2;
  } else if (el.align === 'right') {
    text.anchor.set(1, 0);
    text.x = el.width;
  }
  return text;
}

function buildShape(el: ShapeElement): Container {
  const g = new Graphics();
  const fill = hexToNumber(el.fill);
  const stroke = hexToNumber(el.stroke);
  if (el.shape === 'line') {
    g.moveTo(0, el.height / 2)
      .lineTo(el.width, el.height / 2)
      .stroke({ color: stroke, width: Math.max(1, el.strokeWidth), cap: 'round' });
    return g;
  }
  if (el.shape === 'rect') {
    const radius = Math.min(el.cornerRadius, el.width / 2, el.height / 2);
    if (radius > 0) g.roundRect(0, 0, el.width, el.height, radius);
    else g.rect(0, 0, el.width, el.height);
  } else {
    g.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2);
  }
  g.fill({ color: fill });
  if (el.strokeWidth > 0) g.stroke({ color: stroke, width: el.strokeWidth, alignment: 0.5 });
  return g;
}

function buildPlaceholder(el: AnimationElement, label: string): Container {
  const box = new Container();
  const outline = new Graphics()
    .rect(0, 0, el.width, el.height)
    .stroke({ color: 0xd8a4af, width: 2, alpha: 0.35 });
  const text = new Text({
    text: label,
    style: { fontFamily: 'IBM Plex Mono', fontSize: 20, fill: '#d8a4af' },
  });
  text.alpha = 0.6;
  text.position.set(10, 8);
  box.addChild(outline, text);
  return box;
}

/**
 * Turns one slide into Pixi display objects, and keeps them in step with the
 * deck. The same class draws the editor canvas, thumbnails, the stage and
 * exports, so what is edited is what is presented.
 */
export class SlideScene {
  readonly root = new Container();
  private readonly background = new Graphics();
  private readonly layer = new Container();
  private readonly views = new Map<string, ElementView>();
  private slide: Slide | null = null;
  private size = { width: 0, height: 0 };
  private bgColor = '';
  private editingId: string | null = null;
  private zones: Deck['zones'] = [];
  private destroyed = false;

  constructor(private readonly options: SceneOptions) {
    this.root.addChild(this.background, this.layer);
  }

  /** True when the slide has animation elements, i.e. it needs redrawing every frame. */
  get hasAnimations(): boolean {
    for (const view of this.views.values()) if (view.animation) return true;
    return false;
  }

  /** Brings the display objects in line with the slide. Cheap when little changed. */
  sync(slide: Slide, deck: Deck): void {
    if (this.destroyed) return;
    const { width, height } = deck.meta.canvas;
    if (
      slide.background.color !== this.bgColor ||
      width !== this.size.width ||
      height !== this.size.height
    ) {
      this.bgColor = slide.background.color;
      this.size = { width, height };
      this.background
        .clear()
        .rect(0, 0, width, height)
        .fill({ color: hexToNumber(this.bgColor) });
    }
    this.zones = deck.zones;
    this.slide = slide;

    const present = new Set<string>();
    slide.elements.forEach((el, index) => {
      present.add(el.id);
      let view = this.views.get(el.id);
      if (!view) {
        view = this.createView(el, deck);
        this.views.set(el.id, view);
        this.layer.addChild(view.node);
      } else if (view.element !== el) {
        view = this.updateView(view, el, deck);
      }
      applyTransform(view.node, el, el.id === this.editingId);
      if (this.layer.getChildIndex(view.node) !== index) this.layer.setChildIndex(view.node, index);
    });
    for (const [id, view] of this.views) {
      if (!present.has(id)) {
        this.destroyView(view);
        this.views.delete(id);
      }
    }
  }

  private createView(el: SlideElement, deck: Deck): ElementView {
    const node = new Container();
    const view: ElementView = { element: el, node, animation: null, cancelTexture: null };
    this.fill(view, deck);
    return view;
  }

  /** Builds the contents of a view from its element. */
  private fill(view: ElementView, deck: Deck): void {
    const el = view.element;
    switch (el.type) {
      case 'text':
        view.node.addChild(buildText(el));
        break;
      case 'shape':
        view.node.addChild(buildShape(el));
        break;
      case 'image': {
        const sprite = new Sprite(Texture.EMPTY);
        sprite.width = el.width;
        sprite.height = el.height;
        view.node.addChild(sprite);
        const asset = deck.assets[el.assetId];
        if (asset) {
          const show = (texture: Texture): void => {
            if (sprite.destroyed) return;
            sprite.texture = texture;
            sprite.width = el.width;
            sprite.height = el.height;
          };
          const request = this.options.textures.request(asset, (texture) => {
            show(texture);
            this.options.onChange();
          });
          view.cancelTexture = request.cancel;
          if (request.texture) show(request.texture);
        }
        break;
      }
      case 'animation': {
        const def = getAnimation(el.animationId);
        if (this.options.placeholders) {
          view.node.addChild(
            buildPlaceholder(el, def ? def.name : `Unknown animation: ${el.animationId}`),
          );
        }
        if (def) {
          const instance = new AnimationInstance(def, el, this.options.onAnimationError);
          view.animation = instance;
          view.node.addChild(instance.root);
          if (this.options.animations === 'final') instance.showFinal();
        }
        break;
      }
    }
  }

  private updateView(view: ElementView, el: SlideElement, deck: Deck): ElementView {
    const previous = view.element;
    // An animation that only moved, or whose bindings changed, keeps running undisturbed.
    if (
      view.animation &&
      el.type === 'animation' &&
      previous.type === 'animation' &&
      previous.animationId === el.animationId &&
      view.animation.canReconfigure(el)
    ) {
      view.animation.reconfigure(el);
      view.element = el;
      return view;
    }
    this.clearView(view);
    view.element = el;
    this.fill(view, deck);
    return view;
  }

  private clearView(view: ElementView): void {
    view.cancelTexture?.();
    view.cancelTexture = null;
    if (view.animation) {
      view.node.removeChild(view.animation.root);
      view.animation.destroy();
      view.animation = null;
    }
    for (const child of view.node.removeChildren()) child.destroy({ children: true });
  }

  private destroyView(view: ElementView): void {
    this.clearView(view);
    view.node.destroy({ children: true });
  }

  /** Hides one element while it is being edited as text in a DOM overlay. */
  setEditing(id: string | null): void {
    this.editingId = id;
    for (const view of this.views.values()) {
      applyTransform(view.node, view.element, view.element.id === id);
    }
  }

  /** Feeds this frame's MIDI messages to the animations. */
  offerMidi(messages: readonly MidiMessage[]): void {
    if (messages.length === 0) return;
    for (const view of this.views.values()) {
      if (!view.animation) continue;
      for (const message of messages) view.animation.offer(message, this.zones);
    }
  }

  update(dt: number, input: MidiInputState): void {
    for (const view of this.views.values()) view.animation?.update(dt, input);
  }

  trigger(elementId: string, value: number): boolean {
    const animation = this.views.get(elementId)?.animation;
    animation?.trigger(value);
    return animation != null;
  }

  setParam(elementId: string, name: string, value: number): boolean {
    const animation = this.views.get(elementId)?.animation;
    animation?.setParam(name, value);
    return animation != null;
  }

  /** Puts every animation back to its starting state (panic). */
  resetAnimations(): void {
    for (const view of this.views.values()) view.animation?.reset();
  }

  get currentSlideId(): string | null {
    return this.slide?.id ?? null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of this.views.values()) this.destroyView(view);
    this.views.clear();
    this.root.destroy({ children: true });
  }
}
