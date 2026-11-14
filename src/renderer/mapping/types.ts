import { z } from 'zod';
import { ActionSchema } from '../actions';

const midi7 = z.number().int().min(0).max(127);

export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('noteOn') }),
  z.object({ kind: z.literal('noteOff') }),
  z.object({ kind: z.literal('ccAbove'), controller: midi7, threshold: midi7 }),
  z.object({ kind: z.literal('ccBelow'), controller: midi7, threshold: midi7 }),
  z.object({ kind: z.literal('ccValue'), controller: midi7 }),
  z.object({ kind: z.literal('sustainDown') }),
  z.object({ kind: z.literal('sustainUp') }),
  z.object({
    kind: z.literal('chord'),
    /** The keys that make the chord, as MIDI note numbers. */
    notes: z.array(midi7).min(2).max(10),
    /** Match the note names in any octave (C + E + G anywhere), not these exact keys. */
    anyOctave: z.boolean().default(false),
    /** Only fire when no key outside the chord is held as well. */
    exact: z.boolean().default(true),
    /** The keys must go down within this many milliseconds of each other. 0 means no limit. */
    within: z.number().int().min(0).max(5000).default(300),
  }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerKind = Trigger['kind'];

export const FiltersSchema = z.object({
  device: z.string().optional(),
  channel: z.number().int().min(1).max(16).optional(),
  noteFrom: midi7.optional(),
  noteTo: midi7.optional(),
  velocityMin: midi7.optional(),
  velocityMax: midi7.optional(),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const CurveSchema = z.enum(['linear', 'exponential', 'logarithmic']);
export type Curve = z.infer<typeof CurveSchema>;

export const MappingSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  trigger: TriggerSchema,
  filters: FiltersSchema.default({}),
  action: ActionSchema,
  /** Shapes the incoming velocity or CC value before it drives a parameter. */
  curve: CurveSchema.default('linear'),
  /** Output range the shaped 0..1 value is scaled into. */
  min: z.number().default(0),
  max: z.number().default(1),
});
export type Mapping = z.infer<typeof MappingSchema>;

export const ZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colour: z.string(),
  fromNote: midi7,
  toNote: midi7,
});
export type Zone = z.infer<typeof ZoneSchema>;

export const MAPPING_FILE_FORMAT = 'stagekeys-mappings';

/** Mappings saved on their own so they can be reused across decks. */
export const MappingFileSchema = z.object({
  format: z.literal(MAPPING_FILE_FORMAT),
  version: z.literal(1),
  mappings: z.array(MappingSchema),
  zones: z.array(ZoneSchema).default([]),
});
export type MappingFile = z.infer<typeof MappingFileSchema>;

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  noteOn: 'Note on',
  noteOff: 'Note off',
  ccAbove: 'CC rises above',
  ccBelow: 'CC falls below',
  ccValue: 'CC value (continuous)',
  sustainDown: 'Sustain pedal down',
  sustainUp: 'Sustain pedal up',
  chord: 'Chord (several keys together)',
};
