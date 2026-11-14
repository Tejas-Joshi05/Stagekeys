import type { ControllerProfile } from '../../ipc/settings';
import { controlFor, MOD_CC, padFor, SUSTAIN_CC, type ControlRef, type MidiMessage } from '../midi';
import { useSettings } from '../shared/settings';
import { noteName } from '../shared/util';
import { describeChord } from './chords';
import type { Filters, Mapping, Trigger } from './types';

/*
 * Mappings seen from the controller's side: which mappings belong to a pad,
 * key or knob, how to make a new one for it, and a plain-language name for
 * whatever a mapping listens to.
 */

const noteSpan = (f: Filters): [number, number] => {
  const from = f.noteFrom ?? 0;
  const to = f.noteTo ?? 127;
  return [Math.min(from, to), Math.max(from, to)];
};

const isNoteTrigger = (t: Trigger): boolean => t.kind === 'noteOn' || t.kind === 'noteOff';
const triggerCc = (t: Trigger): number | null =>
  t.kind === 'ccAbove' || t.kind === 'ccBelow' || t.kind === 'ccValue' ? t.controller : null;

/** Does this mapping fire for this physical control? */
export function mappingTouches(m: Mapping, ref: ControlRef, profile: ControllerProfile): boolean {
  const t = m.trigger;
  const f = m.filters;
  switch (ref.kind) {
    case 'key': {
      if (!isNoteTrigger(t)) return false;
      if (f.channel !== undefined && f.channel === profile.padChannel) return false;
      const [lo, hi] = noteSpan(f);
      return ref.note >= lo && ref.note <= hi;
    }
    case 'pad': {
      if (!isNoteTrigger(t)) return false;
      if (f.channel !== undefined && f.channel !== profile.padChannel) return false;
      const [lo, hi] = noteSpan(f);
      // A whole-keyboard mapping without a channel also fires for pads; that is shown, but only exact pad mappings count as "this pad's".
      return ref.note >= lo && ref.note <= hi && (f.channel === profile.padChannel || lo === hi);
    }
    case 'knob':
      return triggerCc(t) === ref.cc;
    case 'mod':
      return triggerCc(t) === MOD_CC;
    case 'cc':
      return triggerCc(t) === ref.cc;
    case 'sustain':
      return t.kind === 'sustainDown' || t.kind === 'sustainUp';
    case 'pitch':
      return false;
  }
}

/** The trigger and filters for a new mapping on this control. */
export function triggerForControl(
  ref: ControlRef,
  profile: ControllerProfile,
  continuous: boolean,
): { trigger: Trigger; filters: Filters } | null {
  switch (ref.kind) {
    case 'key':
      return { trigger: { kind: 'noteOn' }, filters: { noteFrom: ref.note, noteTo: ref.note } };
    case 'pad':
      return {
        trigger: { kind: 'noteOn' },
        filters: { noteFrom: ref.note, noteTo: ref.note, channel: profile.padChannel },
      };
    case 'knob':
    case 'cc':
    case 'mod': {
      const controller = ref.kind === 'mod' ? MOD_CC : ref.cc;
      return continuous
        ? { trigger: { kind: 'ccValue', controller }, filters: {} }
        : { trigger: { kind: 'ccAbove', controller, threshold: 64 }, filters: {} };
    }
    case 'sustain':
      return { trigger: { kind: 'sustainDown' }, filters: {} };
    case 'pitch':
      return null;
  }
}

/** The control a mapping is attached to, when it is attached to exactly one. */
export function controlOfMapping(m: Mapping, profile: ControllerProfile): ControlRef | null {
  const t = m.trigger;
  const f = m.filters;
  if (isNoteTrigger(t)) {
    if (f.noteFrom === undefined || f.noteFrom !== f.noteTo) return null;
    if (f.channel === profile.padChannel)
      return { kind: 'pad', note: f.noteFrom, ...padFor(f.noteFrom, profile) };
    return { kind: 'key', note: f.noteFrom };
  }
  const cc = triggerCc(t);
  if (cc !== null) {
    if (cc === MOD_CC) return { kind: 'mod' };
    const knob = profile.knobCCs.indexOf(cc);
    return knob >= 0 ? { kind: 'knob', index: knob, cc } : { kind: 'cc', cc };
  }
  if (t.kind === 'sustainDown' || t.kind === 'sustainUp') return { kind: 'sustain' };
  return null;
}

/** "Pad 3", "C4", "Keys C2–B2", "Any key", "Knob 2 turned past halfway"… */
export function describeInput(m: Mapping, profile: ControllerProfile): string {
  const t = m.trigger;
  const f = m.filters;
  const ref = controlOfMapping(m, profile);
  if (t.kind === 'chord') {
    const where = f.channel === profile.padChannel ? ' on the pads' : '';
    return `Chord ${describeChord(t)}${where}`;
  }
  const releaseSuffix = t.kind === 'noteOff' ? ' (let go)' : '';
  if (isNoteTrigger(t)) {
    if (ref?.kind === 'pad')
      return `Pad ${ref.index + 1}${ref.bank === 'B' ? ' bank B' : ''}${releaseSuffix}`;
    if (ref?.kind === 'key') return `${noteName(ref.note)}${releaseSuffix}`;
    if (f.noteFrom === undefined && f.noteTo === undefined) {
      return f.channel === profile.padChannel
        ? `Any pad${releaseSuffix}`
        : `Any key${releaseSuffix}`;
    }
    const [lo, hi] = noteSpan(f);
    return `Keys ${noteName(lo)}–${noteName(hi)}${releaseSuffix}`;
  }
  const name =
    ref?.kind === 'knob'
      ? `Knob ${ref.index + 1}`
      : ref?.kind === 'mod'
        ? 'Mod wheel'
        : `CC ${triggerCc(t) ?? ''}`;
  switch (t.kind) {
    case 'ccValue':
      return name;
    case 'ccAbove':
      return `${name} turned up past ${Math.round((t.threshold / 127) * 100)}%`;
    case 'ccBelow':
      return `${name} turned down past ${Math.round((t.threshold / 127) * 100)}%`;
    case 'sustainDown':
      return 'Sustain pedal down';
    case 'sustainUp':
      return 'Sustain pedal up';
    default:
      return name;
  }
}

/**
 * "Pick by pressing": while on, every key, pad or knob selects that control
 * in the mapping editor instead of firing its mapping. The editor polls
 * `latest` on a timer, so no React render happens per message.
 */
export class ControlPicker {
  enabled = false;
  /** The most recent control touched, with a counter so pollers can see repeats. */
  latest: { ref: ControlRef; seq: number } | null = null;

  constructor(private readonly profile: () => ControllerProfile) {}

  /** Returns true when the message was used for picking (and should do nothing else). */
  offer(m: MidiMessage): boolean {
    if (!this.enabled) return false;
    if (m.type === 'noteOff') return true;
    if (m.type === 'cc' && m.controller === SUSTAIN_CC && m.value < 64) return true;
    const ref = controlFor(m, this.profile());
    if (ref) this.latest = { ref, seq: m.seq };
    return true;
  }
}

/** The control window's picker. */
export const controlPicker = new ControlPicker(() => useSettings.getState().controller);
