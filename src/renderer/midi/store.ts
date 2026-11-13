import { create } from 'zustand';
import type { MidiDevice, MidiStatus } from './types';

export const ALL_DEVICES = 'all';

export interface MidiStoreState {
  devices: MidiDevice[];
  /** `ALL_DEVICES`, or the name of the one device to listen to. */
  selection: string;
  status: MidiStatus;
  /** Human-readable explanation when status is `unavailable` or `disconnected`. */
  detail: string;
}

/** Device list and connection status. Changes only on plug/unplug, never per message. */
export const useMidiStore = create<MidiStoreState>(() => ({
  devices: [],
  selection: ALL_DEVICES,
  status: 'starting',
  detail: '',
}));
