import type { ControllerProfile } from '../../ipc/settings';
import { isBlackKey } from '../shared/util';
import type { ParsedMidi } from './types';

/*
 * The AKAI MPK mini IV as Stagekeys sees it: 25 keys, 8 pads (two banks),
 * 8 endless knobs, a pitch wheel, a mod wheel and a sustain pedal input.
 * The profile (settings) says which MIDI notes and CCs each control sends.
 */

export const KEY_COUNT = 25;
export const PAD_COUNT = 8;
export const KNOB_COUNT = 8;
export const MOD_CC = 1;

export type ControlRef =
  | { kind: 'key'; note: number }
  | { kind: 'pad'; index: number; bank: 'A' | 'B'; note: number }
  | { kind: 'knob'; index: number; cc: number }
  | { kind: 'pitch' }
  | { kind: 'mod' }
  | { kind: 'sustain' }
  | { kind: 'cc'; cc: number };

export function isPadNote(channel: number, profile: ControllerProfile): boolean {
  return channel === profile.padChannel;
}

/** Which pad a note on the pad channel is: bank A from the profile, bank B the eight after. */
export function padFor(
  note: number,
  profile: ControllerProfile,
): { index: number; bank: 'A' | 'B' } {
  const a = profile.padNotes.indexOf(note);
  if (a >= 0) return { index: a, bank: 'A' };
  const base = profile.padNotes[0] ?? 36;
  const offset = note - base;
  return { index: ((offset % 8) + 8) % 8, bank: offset >= 8 && offset < 16 ? 'B' : 'A' };
}

/** The physical control a message came from. */
export function controlFor(m: ParsedMidi, profile: ControllerProfile): ControlRef | null {
  switch (m.type) {
    case 'noteOn':
    case 'noteOff':
      if (isPadNote(m.channel, profile))
        return { kind: 'pad', note: m.note, ...padFor(m.note, profile) };
      return { kind: 'key', note: m.note };
    case 'pitchBend':
      return { kind: 'pitch' };
    case 'cc': {
      if (m.controller === MOD_CC) return { kind: 'mod' };
      if (m.controller === 64) return { kind: 'sustain' };
      const knob = profile.knobCCs.indexOf(m.controller);
      return knob >= 0
        ? { kind: 'knob', index: knob, cc: m.controller }
        : { kind: 'cc', cc: m.controller };
    }
  }
}

export function controlLabel(ref: ControlRef, noteName: (n: number) => string): string {
  switch (ref.kind) {
    case 'key':
      return noteName(ref.note);
    case 'pad':
      return `Pad ${ref.index + 1}${ref.bank === 'B' ? ' (bank B)' : ''}`;
    case 'knob':
      return `Knob ${ref.index + 1}`;
    case 'pitch':
      return 'Pitch wheel';
    case 'mod':
      return 'Mod wheel';
    case 'sustain':
      return 'Sustain pedal';
    case 'cc':
      return `CC ${ref.cc}`;
  }
}

/**
 * The lowest note of the 25 keys to show. Starts at the profile's octave and
 * moves by whole octaves so every held key is visible (the hardware's OCT
 * buttons shift the notes it sends; this follows along).
 */
export function keysWindow(low: number, held: Iterable<number>): number {
  let lo = low;
  for (const note of held) {
    while (note < lo && lo - 12 >= 0) lo -= 12;
    while (note >= lo + KEY_COUNT && lo + 12 <= 127 - KEY_COUNT + 1) lo += 12;
  }
  return lo;
}

/** White and black keys of a 25-key window, for drawing. */
export function keyLayout(low: number): {
  whites: number[];
  blacks: { note: number; afterWhite: number }[];
} {
  const whites: number[] = [];
  const blacks: { note: number; afterWhite: number }[] = [];
  for (let n = low; n < low + KEY_COUNT; n++) {
    if (isBlackKey(n)) blacks.push({ note: n, afterWhite: whites.length });
    else whites.push(n);
  }
  return { whites, blacks };
}
