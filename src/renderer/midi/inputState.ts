import { SUSTAIN_CC, type ParsedMidi } from './types';

/**
 * The current state of the controller: which notes are held, CC positions,
 * pitch bend, sustain. Written on message arrival, read by the render loop.
 * Plain mutable data; nothing here touches React.
 */
export class MidiInputState {
  readonly held = new Map<number, number>();
  /** Channel each held note arrived on, so pads (their own channel) can be told from keys. */
  readonly heldChannel = new Map<number, number>();
  readonly cc = new Uint8Array(128);
  pitchBend = 0;
  sustain = false;
  lastNote = -1;
  lastVelocity = 0;
  /** Goes up on every change, so views can skip redrawing when nothing moved. */
  version = 0;

  /** Applies a message and returns the previous value of the affected CC (0 for other messages). */
  apply(m: ParsedMidi): number {
    this.version++;
    switch (m.type) {
      case 'noteOn':
        this.held.set(m.note, m.velocity);
        this.heldChannel.set(m.note, m.channel);
        this.lastNote = m.note;
        this.lastVelocity = m.velocity;
        return 0;
      case 'noteOff':
        this.held.delete(m.note);
        this.heldChannel.delete(m.note);
        return 0;
      case 'cc': {
        const previous = this.cc[m.controller] ?? 0;
        this.cc[m.controller] = m.value;
        if (m.controller === SUSTAIN_CC) this.sustain = m.value >= 64;
        return previous;
      }
      case 'pitchBend':
        this.pitchBend = m.value;
        return 0;
    }
  }

  /** Forget held notes, e.g. when a device disappears mid-chord. */
  releaseAll(): void {
    this.version++;
    this.held.clear();
    this.heldChannel.clear();
    this.sustain = false;
    this.pitchBend = 0;
  }
}
