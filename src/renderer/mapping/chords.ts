import type { MidiMessage } from '../midi';
import { noteName } from '../shared/util';
import type { Trigger } from './types';

/*
 * Chords: several keys held together acting as one control.
 *
 * A chord fires on the key that completes it, the moment that key goes down,
 * so it adds no delay. The keys pressed on the way there have already been
 * seen on their own; that is the price of not waiting.
 */

export type ChordTrigger = Extract<Trigger, { kind: 'chord' }>;

const CHANNELS = 16;
const NOTES = 128;
/**
 * A key held longer than this no longer spoils an "only these keys" chord. A
 * note-off that never arrived (a cable pulled mid-chord) would otherwise
 * switch every such chord off for the rest of the show.
 */
const STUCK_MS = 15_000;

/** Scratch space for `completes`, so matching allocates nothing. */
const newestOfClass = new Float64Array(12);

/** Which keys are down, per channel, and when each went down. */
export class ChordTracker {
  private readonly down = new Uint8Array(CHANNELS * NOTES);
  private readonly since = new Float64Array(CHANNELS * NOTES);

  /** Call with every message, before matching. */
  track(m: MidiMessage): void {
    if (m.type !== 'noteOn' && m.type !== 'noteOff') return;
    if (m.channel < 1 || m.channel > CHANNELS || m.note < 0 || m.note >= NOTES) return;
    const i = (m.channel - 1) * NOTES + m.note;
    if (m.type === 'noteOn') {
      this.down[i] = 1;
      this.since[i] = m.time;
    } else {
      this.down[i] = 0;
    }
  }

  /** Forget every held key. */
  reset(): void {
    this.down.fill(0);
  }

  /** Is this note-on the key that completes the chord? The message must have been tracked already. */
  completes(chord: ChordTrigger, m: MidiMessage): boolean {
    if (m.type !== 'noteOn' || m.channel < 1 || m.channel > CHANNELS) return false;
    const base = (m.channel - 1) * NOTES;
    const { notes, within, exact } = chord;
    const now = m.time;

    if (!chord.anyOctave) {
      if (!notes.includes(m.note)) return false;
      for (const note of notes) {
        if (this.down[base + note] !== 1) return false;
        if (within > 0 && now - (this.since[base + note] ?? 0) > within) return false;
      }
      if (exact) {
        for (let n = 0; n < NOTES; n++) {
          if (this.down[base + n] !== 1 || notes.includes(n)) continue;
          if (now - (this.since[base + n] ?? 0) < STUCK_MS) return false;
        }
      }
      return true;
    }

    // Any octave: every note name of the chord must be down somewhere.
    let wanted = 0;
    for (const note of notes) wanted |= 1 << (note % 12);
    if ((wanted & (1 << (m.note % 12))) === 0) return false;
    newestOfClass.fill(-1);
    let found = 0;
    for (let n = 0; n < NOTES; n++) {
      if (this.down[base + n] !== 1) continue;
      const bit = 1 << (n % 12);
      const at = this.since[base + n] ?? 0;
      if ((wanted & bit) === 0) {
        if (exact && now - at < STUCK_MS) return false;
        continue;
      }
      found |= bit;
      if (at > (newestOfClass[n % 12] ?? -1)) newestOfClass[n % 12] = at;
    }
    if (found !== wanted) return false;
    if (within > 0) {
      for (let pc = 0; pc < 12; pc++) {
        if ((wanted & (1 << pc)) !== 0 && now - (newestOfClass[pc] ?? 0) > within) return false;
      }
    }
    return true;
  }
}

const NAME_TO_CLASS: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/**
 * Reads keys typed by hand: "C4 E4 G4", "c4, eb4, g4", "60 64 67". A name
 * without an octave lands in octave 4. Returns the notes, sorted and without
 * repeats, or null if any part cannot be read.
 */
export function parseChordNotes(text: string): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(/[\s,+]+/)) {
    if (part === '') continue;
    let note: number;
    if (/^\d+$/.test(part)) {
      note = Number(part);
    } else {
      const found = /^([a-g])([#♯b♭]?)(-?\d+)?$/i.exec(part);
      if (!found) return null;
      const base = NAME_TO_CLASS[(found[1] ?? '').toLowerCase()];
      if (base === undefined) return null;
      const accidental = found[2] === '#' || found[2] === '♯' ? 1 : found[2] ? -1 : 0;
      const octave = found[3] === undefined ? 4 : Number(found[3]);
      note = (octave + 1) * 12 + base + accidental;
    }
    if (!Number.isInteger(note) || note < 0 || note > 127) return null;
    out.add(note);
  }
  return [...out].sort((a, b) => a - b);
}

/** "C4 E4 G4", the form `parseChordNotes` reads back. */
export function formatChordNotes(notes: readonly number[]): string {
  return notes.map(noteName).join(' ');
}

/** "C4 + E4 + G4", or "C + E + G in any octave". */
export function describeChord(chord: ChordTrigger): string {
  if (!chord.anyOctave) return chord.notes.map(noteName).join(' + ');
  const classes = [...new Set(chord.notes.map((n) => n % 12))].sort((a, b) => a - b);
  return `${classes.map((pc) => noteName(pc).replace(/-?\d+$/, '')).join(' + ')} in any octave`;
}

/** A chord trigger with the usual settings. Notes are sorted and repeats dropped. */
export function chordTrigger(notes: readonly number[]): ChordTrigger {
  return {
    kind: 'chord',
    notes: [...new Set(notes)].sort((a, b) => a - b),
    anyOctave: false,
    exact: true,
    within: 300,
  };
}
