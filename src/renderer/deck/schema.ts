import { z } from 'zod';
import { CurveSchema, MappingSchema, ZoneSchema } from '../mapping';

/**
 * Deck schema, version 1.
 *
 * Any change to the shape of a saved deck must:
 *   1. bump CURRENT_SCHEMA_VERSION,
 *   2. add a numbered migration in ./migrations with a test and fixture.
 */
export const CURRENT_SCHEMA_VERSION = 1;

const finite = z.number().refine(Number.isFinite, 'Must be a finite number');
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

const ElementBase = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  x: finite,
  y: finite,
  width: finite.min(1),
  height: finite.min(1),
  /** Degrees, clockwise, around the element's centre. */
  rotation: finite.default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
});

export const TextElementSchema = ElementBase.extend({
  type: z.literal('text'),
  text: z.string(),
  fontFamily: z.string().min(1),
  fontSize: finite.min(1),
  fontWeight: z.number().int().min(100).max(900),
  color: colour,
  align: z.enum(['left', 'center', 'right']),
  /** Multiple of the font size. */
  lineHeight: finite.min(0.5).max(4),
});

export const ShapeElementSchema = ElementBase.extend({
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line']),
  fill: colour,
  stroke: colour,
  strokeWidth: finite.min(0),
  cornerRadius: finite.min(0).default(0),
});

export const ImageElementSchema = ElementBase.extend({
  type: z.literal('image'),
  assetId: z.string().min(1),
});

/** Drives one numeric animation parameter from a live MIDI value. */
export const BindingSchema = z.object({
  param: z.string().min(1),
  source: z.enum(['velocity', 'cc', 'pitchBend', 'note']),
  /** Controller number, used when source is `cc`. */
  controller: z.number().int().min(0).max(127).default(1),
  curve: CurveSchema.default('linear'),
  min: finite,
  max: finite,
});

/** Which notes an animation reacts to on its own, without an explicit mapping. */
export const ListenSchema = z.object({
  mode: z.enum(['all', 'zone', 'range', 'none']).default('all'),
  zoneId: z.string().optional(),
  from: z.number().int().min(0).max(127).default(0),
  to: z.number().int().min(0).max(127).default(127),
});

export const AnimationElementSchema = ElementBase.extend({
  type: z.literal('animation'),
  animationId: z.string().min(1),
  /** Validated against the animation's own schema when it is instantiated. */
  params: z.record(z.string(), z.unknown()).default({}),
  bindings: z.array(BindingSchema).default([]),
  listen: ListenSchema.default({ mode: 'all', from: 0, to: 127 }),
});

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ShapeElementSchema,
  ImageElementSchema,
  AnimationElementSchema,
]);

export const TransitionSchema = z.object({
  kind: z.enum(['cut', 'fade', 'slide', 'zoom']).default('cut'),
  /** Milliseconds. */
  duration: finite.min(0).max(5000).default(400),
});

export const SlideSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  background: z.object({ color: colour }),
  elements: z.array(ElementSchema),
  notes: z.string().default(''),
  /** How this slide arrives. */
  transition: TransitionSchema.default({ kind: 'cut', duration: 400 }),
  /** Per-slide MIDI mappings. These win over the deck's global mappings. */
  mappings: z.array(MappingSchema).default([]),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  /** File name inside the bundle's assets/ folder. */
  file: z.string().min(1),
  mime: z.string(),
  width: finite.min(1),
  height: finite.min(1),
  name: z.string().default(''),
});

export const DeckSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  meta: z.object({
    title: z.string(),
    created: z.string(),
    updated: z.string(),
    canvas: z.object({ width: finite.min(16), height: finite.min(16) }),
  }),
  slides: z.array(SlideSchema).min(1),
  mappings: z.array(MappingSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  assets: z.record(z.string(), AssetSchema).default({}),
});

export type Deck = z.infer<typeof DeckSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type SlideElement = z.infer<typeof ElementSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type AnimationElement = z.infer<typeof AnimationElementSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type Listen = z.infer<typeof ListenSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type ElementType = SlideElement['type'];
