import type { Action } from '../actions';
import { SUSTAIN_CC, type MidiMessage } from '../midi';
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

/** Holds the one pending "Learn" request, if any. */
export class LearnSession {
  private pending: { id: string; action: Action; done: LearnCallback } | null = null;
  private readonly listeners = new Set<() => void>();

  get activeId(): string | null {
    return this.pending?.id ?? null;
  }

  start(id: string, action: Action, done: LearnCallback): void {
    this.pending = { id, action, done };
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
    const learned = learnFromMessage(m, pending.action);
    if (learned) {
      this.pending = null;
      pending.done(learned);
      this.notify();
    }
    return true;
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
