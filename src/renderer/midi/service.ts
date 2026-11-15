import { MidiBus } from './bus';
import { MidiInputState } from './inputState';
import { parseMidi } from './parse';
import type { MidiSource } from './source';
import { ALL_DEVICES, useMidiStore } from './store';
import type { MidiDevice, MidiStatus } from './types';

export const VIRTUAL_DEVICE = 'Virtual Keyboard';
const SELECTION_KEY = 'stagekeys.midi.selection';
/**
 * Some keyboards appear as several ports (the MPK mini IV has a MIDI port, a
 * DAW port and a software port) and send the same key press on more than one.
 * The same bytes from a different port this soon after are that echo, not a
 * second press.
 */
const ECHO_MS = 25;
const ECHO_MEMORY = 16;

interface Heard {
  device: string;
  status: number;
  d1: number;
  d2: number;
  time: number;
}

interface ServiceHooks {
  onWarn?: (message: string) => void;
  onInfo?: (message: string) => void;
}

/**
 * Owns the MIDI source for this window: device selection, hot-plug status and
 * turning raw bytes into bus messages. Failure to get MIDI access is a status,
 * not an exception.
 */
export class MidiService {
  readonly bus: MidiBus;
  readonly input: MidiInputState;
  private source: MidiSource | null = null;
  private hooks: ServiceHooks = {};
  private wasConnected = false;
  private readonly heard: Heard[] = [];
  private heardAt = 0;

  constructor(bus = new MidiBus(), input = new MidiInputState()) {
    this.bus = bus;
    this.input = input;
  }

  setHooks(hooks: ServiceHooks): void {
    this.hooks = hooks;
  }

  async start(source: MidiSource): Promise<void> {
    this.stop();
    this.source = source;
    try {
      const saved = globalThis.localStorage?.getItem(SELECTION_KEY);
      if (saved) useMidiStore.setState({ selection: saved });
    } catch {
      // No storage available (tests); keep the default.
    }
    useMidiStore.setState({ status: 'starting', detail: '' });
    try {
      await source.start(
        (device, data, time) => this.receive(device.name, data, time),
        (devices) => this.devicesChanged(devices),
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      useMidiStore.setState({ status: 'unavailable', detail, devices: [] });
      this.hooks.onWarn?.(`MIDI unavailable: ${detail}`);
    }
  }

  stop(): void {
    this.source?.stop();
    this.source = null;
    this.input.releaseAll();
    this.wasConnected = false;
    this.heard.length = 0;
    this.heardAt = 0;
  }

  select(selection: string): void {
    useMidiStore.setState({ selection });
    try {
      globalThis.localStorage?.setItem(SELECTION_KEY, selection);
    } catch {
      // Ignore: selection simply will not persist.
    }
    this.updateStatus(useMidiStore.getState().devices);
  }

  /** Feeds a message in as if it came from the virtual keyboard, bypassing device selection. */
  inject(data: ArrayLike<number>, time = performance.now()): void {
    this.receive(VIRTUAL_DEVICE, data, time, true);
  }

  private receive(device: string, data: ArrayLike<number>, time: number, force = false): void {
    const { selection } = useMidiStore.getState();
    if (!force && selection !== ALL_DEVICES && selection !== device) return;
    const parsed = parseMidi(data);
    if (!parsed) return;
    if (!force && this.isEcho(device, data, time)) return;
    const previousCc = this.input.apply(parsed);
    this.bus.emit(parsed, device, time, previousCc);
  }

  /** True when another port delivered these exact bytes a moment ago. Remembers the message otherwise. */
  private isEcho(device: string, data: ArrayLike<number>, time: number): boolean {
    const status = data[0] ?? 0;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;
    for (const h of this.heard) {
      if (
        h.device !== device &&
        h.status === status &&
        h.d1 === d1 &&
        h.d2 === d2 &&
        Math.abs(time - h.time) <= ECHO_MS
      ) {
        return true;
      }
    }
    const slot = this.heard[this.heardAt];
    if (slot) {
      slot.device = device;
      slot.status = status;
      slot.d1 = d1;
      slot.d2 = d2;
      slot.time = time;
    } else {
      this.heard[this.heardAt] = { device, status, d1, d2, time };
    }
    this.heardAt = (this.heardAt + 1) % ECHO_MEMORY;
    return false;
  }

  private devicesChanged(devices: MidiDevice[]): void {
    useMidiStore.setState({ devices });
    this.updateStatus(devices);
  }

  private updateStatus(devices: MidiDevice[]): void {
    const { selection, status: previous } = useMidiStore.getState();
    let status: MidiStatus;
    let detail = '';
    if (selection === ALL_DEVICES) {
      status = devices.length > 0 ? 'connected' : this.wasConnected ? 'disconnected' : 'no-devices';
      if (status === 'disconnected') detail = 'MIDI device disconnected. Waiting for it to return.';
    } else if (devices.some((d) => d.name === selection)) {
      status = 'connected';
    } else {
      status = 'disconnected';
      detail = `"${selection}" is not connected. Waiting for it to return.`;
    }

    if (status === 'connected') {
      if (previous === 'disconnected') this.hooks.onInfo?.('MIDI device reconnected.');
      this.wasConnected = true;
    } else if (status === 'disconnected' && previous === 'connected') {
      // Keys held at the moment of unplugging would otherwise stay "down" forever.
      this.input.releaseAll();
      this.hooks.onWarn?.(detail);
    }
    useMidiStore.setState({ status, detail });
  }
}

/** The MIDI service for this window. */
export const midi = new MidiService();
