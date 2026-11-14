import type { Action } from '../actions';
import { SUSTAIN_CC, type MidiMessage } from '../midi';
import { clamp01 } from '../shared/util';
import { scaleValue } from './curves';
import type { Filters, Mapping } from './types';

function passesCommonFilters(filters: Filters, m: MidiMessage): boolean {
  if (filters.device !== undefined && filters.device !== m.device) return false;
  if (filters.channel !== undefined && filters.channel !== m.channel) return false;
  return true;
}

function passesNoteRange(filters: Filters, note: number): boolean {
  const from = filters.noteFrom ?? 0;
  const to = filters.noteTo ?? 127;
  return note >= Math.min(from, to) && note <= Math.max(from, to);
}

/**
 * Does this mapping fire for this message? Returns the raw 0..1 value carried
 * by the message (velocity or CC position), or null if it does not match.
 * `previousCc` is the controller's value before this message, so threshold
 * triggers fire once on the crossing instead of on every message past it.
 */
export function matchMapping(mapping: Mapping, m: MidiMessage, previousCc: number): number | null {
  if (!mapping.enabled) return null;
  const { trigger, filters } = mapping;
  if (!passesCommonFilters(filters, m)) return null;

  switch (trigger.kind) {
    case 'noteOn': {
      if (m.type !== 'noteOn' || !passesNoteRange(filters, m.note)) return null;
      if (m.velocity < (filters.velocityMin ?? 0) || m.velocity > (filters.velocityMax ?? 127)) {
        return null;
      }
      return m.velocity / 127;
    }
    case 'noteOff':
      if (m.type !== 'noteOff' || !passesNoteRange(filters, m.note)) return null;
      return 0;
    case 'ccAbove':
      if (m.type !== 'cc' || m.controller !== trigger.controller) return null;
      return m.value >= trigger.threshold && previousCc < trigger.threshold ? m.value / 127 : null;
    case 'ccBelow':
      if (m.type !== 'cc' || m.controller !== trigger.controller) return null;
      return m.value <= trigger.threshold && previousCc > trigger.threshold ? m.value / 127 : null;
    case 'ccValue':
      if (m.type !== 'cc' || m.controller !== trigger.controller) return null;
      return m.value / 127;
    case 'sustainDown':
      if (m.type !== 'cc' || m.controller !== SUSTAIN_CC) return null;
      return m.value >= 64 && previousCc < 64 ? 1 : null;
    case 'sustainUp':
      if (m.type !== 'cc' || m.controller !== SUSTAIN_CC) return null;
      return m.value < 64 && previousCc >= 64 ? 0 : null;
  }
}

export interface MappingMatch {
  mapping: Mapping;
  value: number;
  scope: 'slide' | 'global';
}

/**
 * Finds the mappings that fire for a message. Per-slide mappings win: if any
 * mapping on the current slide matches, global mappings are not consulted.
 */
export function resolveMappings(
  m: MidiMessage,
  previousCc: number,
  slideMappings: readonly Mapping[],
  globalMappings: readonly Mapping[],
): MappingMatch[] {
  const collect = (list: readonly Mapping[], scope: MappingMatch['scope']): MappingMatch[] => {
    const out: MappingMatch[] = [];
    for (const mapping of list) {
      const value = matchMapping(mapping, m, previousCc);
      if (value !== null) out.push({ mapping, value, scope });
    }
    return out;
  };
  const local = collect(slideMappings, 'slide');
  return local.length > 0 ? local : collect(globalMappings, 'global');
}

/** True when the trigger carries a meaningful value (velocity or knob position). */
export function carriesValue(mapping: Mapping): boolean {
  return mapping.trigger.kind === 'noteOn' || mapping.trigger.kind === 'ccValue';
}

/** Builds the action to dispatch, feeding the shaped value into it where the action takes one. */
export function actionFor(match: MappingMatch): Action {
  const { mapping, value } = match;
  const action = mapping.action;
  if (!carriesValue(mapping)) return action;
  const scaled = scaleValue(mapping.curve, value, mapping.min, mapping.max);
  if (action.type === 'anim.trigger') return { ...action, value: clamp01(scaled) };
  if (action.type === 'anim.setParam') return { ...action, value: scaled };
  if (action.type === 'audio.setSensitivity') return { ...action, value: clamp01(scaled) };
  return action;
}
