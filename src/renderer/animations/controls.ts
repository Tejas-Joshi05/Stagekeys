import { z } from 'zod';
import type { RegisteredAnimation } from './define';

/** A description of one editor control, derived from an animation's parameter schema. */
export type ParamControl = { key: string; label: string } & (
  | { kind: 'number'; min: number; max: number; step: number; default: number }
  | { kind: 'boolean'; default: boolean }
  | { kind: 'choice'; options: string[]; default: string }
  | { kind: 'colour'; default: string }
  | { kind: 'font'; default: string }
  | { kind: 'text'; multiline: boolean; default: string }
);

interface JsonProperty {
  type?: string;
  title?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  ui?: string;
  step?: number;
}

const cache = new WeakMap<z.ZodObject, ParamControl[]>();

/**
 * Reads the parameter schema (through zod's JSON Schema output) and returns
 * the controls the properties panel should show. Unknown field types are
 * skipped rather than guessed at.
 */
export function controlsFor(animation: RegisteredAnimation): ParamControl[] {
  const cached = cache.get(animation.schema);
  if (cached) return cached;
  const json = z.toJSONSchema(animation.schema, { io: 'input' }) as {
    properties?: Record<string, JsonProperty>;
  };
  const controls: ParamControl[] = [];
  for (const [key, prop] of Object.entries(json.properties ?? {})) {
    const label = prop.title ?? key;
    if (prop.type === 'number' || prop.type === 'integer') {
      const isInt = prop.type === 'integer';
      controls.push({
        key,
        label,
        kind: 'number',
        min: prop.minimum ?? 0,
        max: prop.maximum ?? 1,
        step: prop.step ?? (isInt ? 1 : 0.01),
        default: typeof prop.default === 'number' ? prop.default : 0,
      });
    } else if (prop.type === 'boolean') {
      controls.push({ key, label, kind: 'boolean', default: prop.default === true });
    } else if (prop.type === 'string' && Array.isArray(prop.enum)) {
      const options = prop.enum.filter((o): o is string => typeof o === 'string');
      controls.push({
        key,
        label,
        kind: 'choice',
        options,
        default: typeof prop.default === 'string' ? prop.default : (options[0] ?? ''),
      });
    } else if (prop.type === 'string') {
      const def = typeof prop.default === 'string' ? prop.default : '';
      if (prop.ui === 'colour') controls.push({ key, label, kind: 'colour', default: def });
      else if (prop.ui === 'font') controls.push({ key, label, kind: 'font', default: def });
      else
        controls.push({
          key,
          label,
          kind: 'text',
          multiline: prop.ui === 'multiline',
          default: def,
        });
    }
  }
  cache.set(animation.schema, controls);
  return controls;
}

/** The numeric parameters, i.e. the ones a MIDI value can be bound to. */
export function bindableParams(
  animation: RegisteredAnimation,
): Extract<ParamControl, { kind: 'number' }>[] {
  return controlsFor(animation).filter(
    (c): c is Extract<ParamControl, { kind: 'number' }> => c.kind === 'number',
  );
}
