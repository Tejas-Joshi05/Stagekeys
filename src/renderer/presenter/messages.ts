import { z } from 'zod';
import { ActionSchema } from '../actions';

/** Messages between the control window (presenter view) and the stage window. Relayed by main. */

export const ControlMessageSchema = z.object({
  t: z.literal('action'),
  action: ActionSchema,
  source: z.enum(['keyboard', 'ui']),
});
export type ControlMessage = z.infer<typeof ControlMessageSchema>;

const MonitorLineSchema = z.object({
  seq: z.number(),
  text: z.string(),
  device: z.string(),
  channel: z.number(),
  mapped: z.boolean(),
});

export const StageStateSchema = z.object({
  t: z.literal('state'),
  slideIndex: z.number().int(),
  slideCount: z.number().int(),
  black: z.boolean(),
  rehearsal: z.boolean(),
  elapsedMs: z.number(),
  slideElapsedMs: z.number(),
  midiStatus: z.enum(['starting', 'connected', 'no-devices', 'disconnected', 'unavailable']),
  midiDetail: z.string(),
  devices: z.array(z.string()),
  monitor: z.array(MonitorLineSchema),
  fps: z.number(),
  latencyMs: z.number(),
  animationErrors: z.number().int(),
  /** What is being played, for the keys picture in the presenter view: [note, velocity, channel]. */
  held: z.array(z.tuple([z.number(), z.number(), z.number()])).default([]),
  /** Non-zero controller positions: [cc, value]. */
  cc: z.array(z.tuple([z.number(), z.number()])).default([]),
  pitchBend: z.number().default(0),
  sustain: z.boolean().default(false),
  /** Sound input on the stage, for the meter in the presenter view. */
  audio: z
    .object({
      status: z.enum(['off', 'paused', 'starting', 'live', 'blocked', 'no-input', 'unavailable']),
      active: z.boolean(),
      level: z.number(),
      bass: z.number(),
      mid: z.number(),
      treble: z.number(),
      beat: z.number(),
    })
    .optional(),
});
export type StageState = z.infer<typeof StageStateSchema>;

export const StageReportSchema = z.object({
  t: z.literal('report'),
  rehearsal: z.boolean(),
  totalMs: z.number(),
  slides: z.array(
    z.object({
      index: z.number().int(),
      name: z.string(),
      ms: z.number(),
      visits: z.number().int(),
    }),
  ),
});
export type StageReport = z.infer<typeof StageReportSchema>;

export const StageNoticeSchema = z.object({
  t: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const StageMessageSchema = z.discriminatedUnion('t', [
  StageStateSchema,
  StageReportSchema,
  StageNoticeSchema,
]);
export type StageMessage = z.infer<typeof StageMessageSchema>;
