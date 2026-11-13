import type { Container } from 'pixi.js';
import { z } from 'zod';

/** What an animation reacts to. Shown in the editor so you know what will drive it. */
export type MidiInputKind = 'trigger' | 'velocity' | 'heldNotes' | 'cc' | 'pitchBend' | 'sustain';

/** One "go" signal: a key press that passed the element's note filter, or a mapped trigger action. */
export interface Trigger {
  /** 0..1. Velocity for key presses; the mapping's shaped value for mapped triggers. */
  value: number;
  /** MIDI note number, or null when the trigger came from a mapping rather than a key. */
  note: number | null;
}

export interface FrameInfo {
  /** Seconds since this instance was set up. */
  time: number;
  /** Seconds since the previous frame (capped, so a stall never causes a jump). */
  dt: number;
  frame: number;
}

export interface AnimationInputs<P> {
  /** Parameters for this frame, with MIDI bindings and overrides already applied. */
  params: P;
  triggers: readonly Trigger[];
  /** Notes released this frame. */
  releases: readonly number[];
  /** Currently held notes: note number → velocity (1..127). */
  held: ReadonlyMap<number, number>;
  /** Current position of a controller, 0..1. */
  cc: (controller: number) => number;
  /** -1..1. */
  pitchBend: number;
  sustain: boolean;
}

export interface AnimationContext<P> {
  /** Draw into this. Local coordinates run from (0,0) to (width,height). */
  root: Container;
  width: number;
  height: number;
  params: P;
  /**
   * Register anything that needs destroying and is not a child of `root`
   * (generated textures, filters). The host destroys these after teardown.
   */
  own<T extends { destroy(): void }>(resource: T): T;
}

export interface AnimationDefinition<S extends z.ZodObject, State> {
  id: string;
  name: string;
  description: string;
  /** Parameter schema. Every field needs a default; the properties panel is generated from it. */
  params: S;
  inputs: readonly MidiInputKind[];
  /** Size of a newly placed instance, in slide pixels. */
  defaultSize?: { width: number; height: number };
  /** Bindings a newly placed instance starts with. */
  defaultBindings?: readonly DefaultBinding[];
  setup(ctx: AnimationContext<z.infer<S>>): State;
  update(state: State, frame: FrameInfo, inputs: AnimationInputs<z.infer<S>>): void;
  /** Release anything `setup` created that is not under `root` or registered with `own`. */
  teardown(state: State): void;
  /** Draw the finished state, for thumbnails and the PNG/PDF backup export. */
  showFinal?(state: State, params: z.infer<S>): void;
}

export interface DefaultBinding {
  param: string;
  source: 'velocity' | 'cc' | 'pitchBend' | 'note';
  controller?: number;
  min: number;
  max: number;
}

export type ParamValues = Record<string, unknown>;

/** A definition with its parameter types erased, so different animations can share one registry. */
export interface RegisteredAnimation {
  id: string;
  name: string;
  description: string;
  schema: z.ZodObject;
  inputs: readonly MidiInputKind[];
  defaultSize: { width: number; height: number };
  defaultBindings: readonly DefaultBinding[];
  /** Validates stored parameters, falling back to defaults for anything invalid. */
  parseParams(raw: unknown): ParamValues;
  setup(ctx: AnimationContext<ParamValues>): unknown;
  update(state: unknown, frame: FrameInfo, inputs: AnimationInputs<ParamValues>): void;
  teardown(state: unknown): void;
  showFinal: ((state: unknown, params: ParamValues) => void) | null;
}

export function defineAnimation<S extends z.ZodObject, State>(
  def: AnimationDefinition<S, State>,
): RegisteredAnimation {
  type P = z.infer<S>;
  const defaults = def.params.parse({}) as ParamValues;
  const showFinal = def.showFinal;
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    schema: def.params,
    inputs: def.inputs,
    defaultSize: def.defaultSize ?? { width: 600, height: 600 },
    defaultBindings: def.defaultBindings ?? [],
    parseParams(raw) {
      const source = typeof raw === 'object' && raw !== null ? (raw as ParamValues) : {};
      const whole = def.params.safeParse(source);
      if (whole.success) return whole.data as ParamValues;
      // Keep every individually valid value; only the bad ones fall back to defaults.
      const out: ParamValues = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (!(key in source)) continue;
        const one = def.params.safeParse({ ...defaults, [key]: source[key] });
        if (one.success) out[key] = (one.data as ParamValues)[key];
      }
      return out;
    },
    setup: (ctx) => def.setup(ctx as AnimationContext<P>),
    update: (state, frame, inputs) =>
      def.update(state as State, frame, inputs as AnimationInputs<P>),
    teardown: (state) => def.teardown(state as State),
    showFinal: showFinal ? (state, params) => showFinal(state as State, params as P) : null,
  };
}

// ── Parameter helpers ───────────────────────────────────────────────────────
// Small wrappers so animation files read cleanly and the editor knows which
// control to show. `title` becomes the label; `ui` picks a specialised control.

export const param = {
  number: (title: string, def: number, min: number, max: number, step = 0.01) =>
    z.number().min(min).max(max).default(def).meta({ title, step }),
  integer: (title: string, def: number, min: number, max: number) =>
    z.number().int().min(min).max(max).default(def).meta({ title, step: 1 }),
  boolean: (title: string, def: boolean) => z.boolean().default(def).meta({ title }),
  colour: (title: string, def: string) =>
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default(def)
      .meta({ title, ui: 'colour' }),
  choice: <const T extends readonly [string, ...string[]]>(
    title: string,
    options: T,
    def: T[number],
  ) => z.enum(options).default(def).meta({ title }),
  text: (title: string, def: string) => z.string().default(def).meta({ title, ui: 'multiline' }),
  font: (title: string, def: string) => z.string().min(1).default(def).meta({ title, ui: 'font' }),
};
