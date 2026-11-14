import type { MidiDevice } from './types';

export type RawMidiHandler = (device: MidiDevice, data: Uint8Array, time: number) => void;
export type DevicesHandler = (devices: MidiDevice[]) => void;

/**
 * Where MIDI comes from. Web MIDI and the mock implement this; later inputs
 * (OSC, audio analysis) can follow the same shape.
 */
export interface MidiSource {
  start(onMessage: RawMidiHandler, onDevices: DevicesHandler): Promise<void>;
  stop(): void;
}

/** Real devices through the Web MIDI API, with hot-plug support. */
export class WebMidiSource implements MidiSource {
  private access: MIDIAccess | null = null;
  private readonly attached = new Map<string, MIDIInput>();
  private onMessage: RawMidiHandler = () => undefined;
  private onDevices: DevicesHandler = () => undefined;
  private stopped = false;

  async start(onMessage: RawMidiHandler, onDevices: DevicesHandler): Promise<void> {
    this.onMessage = onMessage;
    this.onDevices = onDevices;
    this.stopped = false;
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      throw new Error('Web MIDI is not available in this environment.');
    }
    const access = await navigator.requestMIDIAccess({ sysex: false });
    // Stopped while waiting for access (a show started or ended in that moment):
    // attaching now would leave a second listener and every key would fire twice.
    if (this.stopped) return;
    this.access = access;
    access.onstatechange = () => this.refresh();
    this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.access) this.access.onstatechange = null;
    for (const input of this.attached.values()) input.onmidimessage = null;
    this.attached.clear();
    this.access = null;
  }

  /** Re-reads the device list. Called on every plug or unplug. */
  private refresh(): void {
    const access = this.access;
    if (!access) return;
    const devices: MidiDevice[] = [];
    const present = new Set<string>();
    access.inputs.forEach((input) => {
      if (input.state !== 'connected') return;
      present.add(input.id);
      const device: MidiDevice = {
        id: input.id,
        name: input.name ?? 'Unknown device',
        manufacturer: input.manufacturer ?? '',
      };
      devices.push(device);
      if (this.attached.get(input.id) !== input) {
        input.onmidimessage = (event) => {
          if (event.data) this.onMessage(device, event.data, event.timeStamp);
        };
        this.attached.set(input.id, input);
      }
    });
    for (const [id, input] of this.attached) {
      if (!present.has(id)) {
        input.onmidimessage = null;
        this.attached.delete(id);
      }
    }
    this.onDevices(devices);
  }
}

/** A scriptable source for tests, the virtual keyboard and working without hardware. */
export class MockMidiSource implements MidiSource {
  private readonly devices = new Map<string, MidiDevice>();
  private onMessage: RawMidiHandler = () => undefined;
  private onDevices: DevicesHandler = () => undefined;
  private started = false;

  constructor(initial: MidiDevice[] = []) {
    for (const d of initial) this.devices.set(d.id, d);
  }

  start(onMessage: RawMidiHandler, onDevices: DevicesHandler): Promise<void> {
    this.onMessage = onMessage;
    this.onDevices = onDevices;
    this.started = true;
    this.onDevices([...this.devices.values()]);
    return Promise.resolve();
  }

  stop(): void {
    this.started = false;
  }

  plug(device: MidiDevice): void {
    this.devices.set(device.id, device);
    if (this.started) this.onDevices([...this.devices.values()]);
  }

  unplug(id: string): void {
    this.devices.delete(id);
    if (this.started) this.onDevices([...this.devices.values()]);
  }

  send(id: string, data: ArrayLike<number>, time = performance.now()): void {
    const device = this.devices.get(id);
    if (!device || !this.started) return;
    this.onMessage(device, Uint8Array.from(data), time);
  }
}
