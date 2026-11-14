import type { Action } from '../actions';
import { SUSTAIN_CC, type MidiMessage } from '../midi';
import { chordTrigger } from './chords';
import type { Filters, Trigger } from './types';

export interface Learned {
  trigger: Trigger;
  filters: Filters;
}

/**
 * MIDI Learn: turns the first key press or knob move into a trigger.
 * Returns null for messages that should not complete learning (note-off,
 * pitch bend), so releasing a previously held key does not get captured.
 */
export function learnFromMessage(m: MidiMessage, action: Action): Learned | null {
  if (m.type === 'noteOn') {
    return { trigger: { kind: 'noteOn' }, filters: { noteFrom: m.note, noteTo: m.note } };
  }
  if (m.type === 'cc') {
    if (m.controller === SUSTAIN_CC) return { trigger: { kind: 'sustainDown' }, filters: {} };
    // A knob driving a parameter should be continuous; anything else is a one-shot.
    return action.type === 'anim.setParam' || action.type === 'audio.setSensitivity'
      ? { trigger: { kind: 'ccValue', controller: m.controller }, filters: {} }
      : { trigger: { kind: 'ccAbove', controller: m.controller, threshold: 64 }, filters: {} };
  }
  return null;
}

type LearnCallback = (learned: Learned) => void;

interface Pending {
  id: string;
  action: Action;
  done: LearnCallback;
  /** Learning a chord: wait for several keys held together, then for all of them to be let go. */
  chord: boolean;
}

/** Holds the one pending "Learn" request, if any. */
export class LearnSession {
  private pending: Pending | null = null;
  private readonly listeners = new Set<() => void>();
  /** Chord learning: keys down right now, and every key of the chord so far. */
  private readonly heldNow = new Set<number>();
  private readonly gathered = new Set<number>();

  get activeId(): string | null {
    return this.pending?.id ?? null;
  }

  /**
   * The keys of the chord being learned, lowest first. Views poll this on a
   * timer; nothing is notified per key.
   */
  get chordNotes(): number[] {
    return [...this.gathered].sort((a, b) => a - b);
  }

  start(id: string, action: Action, done: LearnCallback): void {
    this.begin({ id, action, done, chord: false });
  }

  /** Learns a chord: hold two or more keys together, then let go. */
  startChord(id: string, action: Action, done: LearnCallback): void {
    this.begin({ id, action, done, chord: true });
  }

  private begin(pending: Pending): void {
    this.pending = pending;
    this.heldNow.clear();
    this.gathered.clear();
    this.notify();
  }

  cancel(): void {
    if (!this.pending) return;
    this.pending = null;
    this.notify();
  }

  /** Offers a message to the session. Returns true if learning was waiting (the message is used up). */
  offer(m: MidiMessage): boolean {
    const pending = this.pending;
    if (!pending) return false;
    if (pending.chord) {
      this.offerChord(pending, m);
      return true;
    }
    const learned = learnFromMessage(m, pending.action);
    if (learned) {
      this.pending = null;
      pending.done(learned);
      this.notify();
    }
    return true;
  }

  private offerChord(pending: Pending, m: MidiMessage): void {
    if (m.type === 'noteOn') {
      // A fresh press after everything was let go starts the chord again.
      if (this.heldNow.size === 0) this.gathered.clear();
      this.heldNow.add(m.note);
      if (this.gathered.size < 10) this.gathered.add(m.note);
      return;
    }
    if (m.type !== 'noteOff') return;
    this.heldNow.delete(m.note);
    // One key on its own is not a chord: keep waiting.
    if (this.heldNow.size > 0 || this.gathered.size < 2) return;
    this.pending = null;
    pending.done({ trigger: chordTrigger([...this.gathered]), filters: {} });
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const learnSession = new LearnSession();
