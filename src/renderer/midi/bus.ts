import type { MidiMessage, ParsedMidi } from './types';

export type MidiListener = (message: MidiMessage, previousCc: number) => void;

const RING_SIZE = 512;

/**
 * Lightweight MIDI event bus. Listeners are called synchronously on arrival
 * (the mapping engine needs that for instant navigation), and every message is
 * also kept in a ring buffer that render loops and the monitor panel poll at
 * their own pace. Nothing here causes a React render.
 */
export class MidiBus {
  private readonly listeners: MidiListener[] = [];
  private readonly ring: (MidiMessage | undefined)[] = new Array<MidiMessage | undefined>(
    RING_SIZE,
  );
  private nextSeq = 1;

  /** Listeners run in registration order. Returns an unsubscribe function. */
  subscribe(listener: MidiListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(parsed: ParsedMidi, device: string, time: number, previousCc: number): MidiMessage {
    const message: MidiMessage = { ...parsed, device, time, seq: this.nextSeq++, consumed: false };
    this.ring[message.seq % RING_SIZE] = message;
    for (const listener of [...this.listeners]) {
      try {
        listener(message, previousCc);
      } catch {
        // A broken listener must never stop MIDI from flowing.
      }
    }
    return message;
  }

  /** Sequence number of the most recent message (0 if none yet). */
  get head(): number {
    return this.nextSeq - 1;
  }

  /** Messages with seq greater than `afterSeq`, oldest first. Older than the ring are dropped. */
  since(afterSeq: number): MidiMessage[] {
    const out: MidiMessage[] = [];
    const start = Math.max(afterSeq + 1, this.nextSeq - RING_SIZE, 1);
    for (let seq = start; seq < this.nextSeq; seq++) {
      const m = this.ring[seq % RING_SIZE];
      if (m && m.seq === seq) out.push(m);
    }
    return out;
  }

  /** The most recent `count` messages, oldest first. */
  recent(count: number): MidiMessage[] {
    return this.since(this.head - count);
  }
}
