import { newId } from '../shared/util';
import {
  CURRENT_SCHEMA_VERSION,
  type AnimationElement,
  type Deck,
  type ImageElement,
  type ShapeElement,
  type Slide,
  type TextElement,
} from './schema';

export const DEFAULT_CANVAS = { width: 1920, height: 1080 } as const;
export const DEFAULT_FONT = 'Inter Variable';

export function createSlide(name = ''): Slide {
  return {
    id: newId('slide'),
    name,
    background: { color: '#101014' },
    elements: [],
    notes: '',
    transition: { kind: 'cut', duration: 400 },
    mappings: [],
  };
}

export function createEmptyDeck(title = 'Untitled', now: Date = new Date()): Deck {
  const stamp = now.toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      title,
      created: stamp,
      updated: stamp,
      canvas: { ...DEFAULT_CANVAS },
      targetMinutes: 0,
    },
    slides: [createSlide()],
    mappings: [],
    zones: [],
    assets: {},
  };
}

const base = (name: string, x: number, y: number, width: number, height: number) => ({
  id: newId('el'),
  name,
  x,
  y,
  width,
  height,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

export function createText(x: number, y: number): TextElement {
  return {
    ...base('Text', x, y, 900, 140),
    type: 'text',
    text: 'Text',
    fontFamily: DEFAULT_FONT,
    fontSize: 96,
    fontWeight: 700,
    color: '#ffffff',
    align: 'left',
    lineHeight: 1.2,
  };
}

export function createShape(shape: ShapeElement['shape'], x: number, y: number): ShapeElement {
  const isLine = shape === 'line';
  return {
    ...base(
      shape === 'rect' ? 'Rectangle' : shape === 'ellipse' ? 'Ellipse' : 'Line',
      x,
      y,
      isLine ? 500 : 400,
      isLine ? 20 : 300,
    ),
    type: 'shape',
    shape,
    fill: '#5b8cff',
    stroke: '#ffffff',
    strokeWidth: isLine ? 6 : 0,
    cornerRadius: 0,
  };
}

export function createImage(
  assetId: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageElement {
  return { ...base(name || 'Image', x, y, width, height), type: 'image', assetId };
}

export function createAnimation(
  animationId: string,
  name: string,
  x: number,
  y: number,
  width = 600,
  height = 600,
): AnimationElement {
  return {
    ...base(name, x, y, width, height),
    type: 'animation',
    animationId,
    params: {},
    bindings: [],
    listen: { mode: 'all', from: 0, to: 127 },
  };
}
