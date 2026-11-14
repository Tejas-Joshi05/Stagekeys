import { z } from 'zod';

/**
 * App-wide settings, kept in `settings.json` in the app data folder. These are
 * about this machine and this controller, not about a deck, so they live
 * outside deck files. Main owns the file; both windows get every change.
 *
 * Every field has a default, so an old or damaged file always loads.
 */

const midi7 = z.number().int().min(0).max(127);

export const PianoSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** 0..1 */
  volume: z.number().min(0).max(1).default(0.7),
  sound: z.enum(['grand', 'felt', 'electric']).default('felt'),
  /** Keys that trigger a mapping (next slide, etc.) stay silent. */
  skipMapped: z.boolean().default(true),
  /** Whether the pads make sound too. */
  pads: z.boolean().default(false),
});

/**
 * Sound coming in (a microphone or line input), which animations can react to.
 * Nothing is recorded or sent anywhere: it is only measured, frame by frame.
 */
export const AudioInputSchema = z.object({
  enabled: z.boolean().default(false),
  /** 0 = stiffest (only loud sound moves things, slowly) .. 1 = most sensitive (twitches at a whisper). */
  sensitivity: z.number().min(0).max(1).default(0.5),
  /** Input device id from the browser; empty means the system default. */
  deviceId: z.string().max(512).default(''),
});

export const KeysOverlaySchema = z.object({
  /** The small controller picture in the editor and presenter view. */
  control: z.boolean().default(true),
  /** The same picture on the audience screen. */
  stage: z.boolean().default(false),
  corner: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).default('bottom-right'),
});

/**
 * Where the MPK mini IV's controls live in MIDI. Factory presets differ, so
 * these can be taught from the hardware in the MIDI tab.
 */
export const ControllerSchema = z.object({
  /** Channel the pads send on (1..16). Keys on other channels are keys. */
  padChannel: z.number().int().min(1).max(16).default(10),
  /** Note sent by each pad, left to right, bottom row first (pads 1-8, bank A). */
  padNotes: z.array(midi7).length(8).default([36, 37, 38, 39, 40, 41, 42, 43]),
  /** CC sent by each knob, K1-K8. */
  knobCCs: z.array(midi7).length(8).default([70, 71, 72, 73, 74, 75, 76, 77]),
  /** Lowest note of the 25 keys at the current octave. */
  keysLow: midi7.default(48),
});

export const SettingsSchema = z.object({
  piano: PianoSettingsSchema.default(PianoSettingsSchema.parse({})),
  keysOverlay: KeysOverlaySchema.default(KeysOverlaySchema.parse({})),
  controller: ControllerSchema.default(ControllerSchema.parse({})),
  audioInput: AudioInputSchema.default(AudioInputSchema.parse({})),
});

export type AppSettings = z.infer<typeof SettingsSchema>;
export type PianoSettings = z.infer<typeof PianoSettingsSchema>;
export type KeysOverlaySettings = z.infer<typeof KeysOverlaySchema>;
export type ControllerProfile = z.infer<typeof ControllerSchema>;
export type AudioInputSettings = z.infer<typeof AudioInputSchema>;

/** A change to one or more groups. Each group given is merged over the current one. */
export interface SettingsPatch {
  piano?: Partial<PianoSettings>;
  keysOverlay?: Partial<KeysOverlaySettings>;
  controller?: Partial<ControllerProfile>;
  audioInput?: Partial<AudioInputSettings>;
}

/**
 * The same fields as a settings group, all optional and WITHOUT their
 * defaults. Plain `.partial()` is not enough: a defaulted field that is left
 * out would be filled in with its default, so a patch of `{ enabled: true }`
 * would quietly reset every other setting in the group.
 */
function patchOf(group: z.ZodObject): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(group.shape)) {
    const bare = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = (bare as z.ZodType).optional();
  }
  return z.strictObject(shape);
}

export const SettingsPatchSchema: z.ZodType<SettingsPatch> = z.object({
  piano: patchOf(PianoSettingsSchema).optional(),
  keysOverlay: patchOf(KeysOverlaySchema).optional(),
  controller: patchOf(ControllerSchema).optional(),
  audioInput: patchOf(AudioInputSchema).optional(),
}) as unknown as z.ZodType<SettingsPatch>;

export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({});

/** Applies a patch. Returns the merged settings, or the current ones if the result is invalid. */
export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  const merged = SettingsSchema.safeParse({
    piano: { ...current.piano, ...patch.piano },
    keysOverlay: { ...current.keysOverlay, ...patch.keysOverlay },
    controller: { ...current.controller, ...patch.controller },
    audioInput: { ...current.audioInput, ...patch.audioInput },
  });
  return merged.success ? merged.data : current;
}

/** Reads a settings file's text, falling back group by group to defaults. Never throws. */
export function parseSettings(text: string | null): AppSettings {
  if (!text) return DEFAULT_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  const whole = SettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const group = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  return {
    piano: group(PianoSettingsSchema, obj.piano, DEFAULT_SETTINGS.piano),
    keysOverlay: group(KeysOverlaySchema, obj.keysOverlay, DEFAULT_SETTINGS.keysOverlay),
    controller: group(ControllerSchema, obj.controller, DEFAULT_SETTINGS.controller),
    audioInput: group(AudioInputSchema, obj.audioInput, DEFAULT_SETTINGS.audioInput),
  };
}
