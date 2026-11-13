export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

/** A parsed channel message, before device and timing information is attached. */
export type ParsedMidi =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'pitchBend'; channel: number; value: number };

export type MidiMessage = ParsedMidi & {
  /** Device name. Names survive a replug; ids often do not. */
  device: string;
  /** Arrival time on the performance.now() clock. */
  time: number;
  /** Monotonic sequence number assigned by the bus. */
  seq: number;
  /** Set by the mapping engine when a mapping used this message. */
  consumed: boolean;
};

export const SUSTAIN_CC = 64;

export type MidiStatus = 'starting' | 'connected' | 'no-devices' | 'disconnected' | 'unavailable';
