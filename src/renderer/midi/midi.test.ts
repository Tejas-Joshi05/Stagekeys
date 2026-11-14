import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiBus } from './bus';
import { MidiInputState } from './inputState';
import { parseMidi } from './parse';
import { MidiService } from './service';
import { MockMidiSource, WebMidiSource } from './source';
import { ALL_DEVICES, useMidiStore } from './store';

describe('parseMidi', () => {
  it('parses note on with channel, note and velocity', () => {
    expect(parseMidi([0x90, 60, 100])).toEqual({
      type: 'noteOn',
      channel: 1,
      note: 60,
      velocity: 100,
    });
    expect(parseMidi([0x9f, 61, 1])).toMatchObject({ channel: 16, note: 61 });
  });

  it('treats note on with velocity 0 as note off', () => {
    expect(parseMidi([0x90, 60, 0])).toEqual({
      type: 'noteOff',
      channel: 1,
      note: 60,
      velocity: 0,
    });
  });

  it('parses note off', () => {
    expect(parseMidi([0x82, 64, 40])).toEqual({
      type: 'noteOff',
      channel: 3,
      note: 64,
      velocity: 40,
    });
  });

  it('parses control change, including sustain', () => {
    expect(parseMidi([0xb0, 1, 77])).toEqual({ type: 'cc', channel: 1, controller: 1, value: 77 });
    expect(parseMidi([0xb0, 64, 127])).toEqual({
      type: 'cc',
      channel: 1,
      controller: 64,
      value: 127,
    });
  });

  it('parses pitch bend into -1..1 with 0 at centre', () => {
    expect(parseMidi([0xe0, 0x00, 0x40])).toMatchObject({ type: 'pitchBend', value: 0 });
    expect(parseMidi([0xe0, 0x7f, 0x7f])).toMatchObject({ value: 1 });
    expect(parseMidi([0xe0, 0x00, 0x00])).toMatchObject({ value: -1 });
  });

  it('returns null for system, unsupported and malformed messages', () => {
    expect(parseMidi([0xf8])).toBeNull();
    expect(parseMidi([0xf0, 1, 2, 0xf7])).toBeNull();
    expect(parseMidi([0xc0, 5])).toBeNull();
    expect(parseMidi([0x90, 60])).toBeNull();
    expect(parseMidi([])).toBeNull();
    expect(parseMidi([60, 60, 60])).toBeNull();
  });
});

describe('MidiInputState', () => {
  it('tracks held notes, CC values and sustain', () => {
    const s = new MidiInputState();
    s.apply({ type: 'noteOn', channel: 1, note: 60, velocity: 90 });
    expect(s.held.get(60)).toBe(90);
    expect(s.lastVelocity).toBe(90);
    s.apply({ type: 'noteOff', channel: 1, note: 60, velocity: 0 });
    expect(s.held.size).toBe(0);

    expect(s.apply({ type: 'cc', channel: 1, controller: 7, value: 50 })).toBe(0);
    expect(s.apply({ type: 'cc', channel: 1, controller: 7, value: 80 })).toBe(50);
    s.apply({ type: 'cc', channel: 1, controller: 64, value: 127 });
    expect(s.sustain).toBe(true);
    s.releaseAll();
    expect(s.sustain).toBe(false);
  });
});

describe('MidiBus', () => {
  it('delivers messages to listeners in order and assigns sequence numbers', () => {
    const bus = new MidiBus();
    const seen: number[] = [];
    bus.subscribe((m) => seen.push(m.seq));
    bus.emit({ type: 'noteOn', channel: 1, note: 1, velocity: 1 }, 'd', 0, 0);
    bus.emit({ type: 'noteOn', channel: 1, note: 2, velocity: 1 }, 'd', 0, 0);
    expect(seen).toEqual([1, 2]);
    expect(bus.head).toBe(2);
  });

  it('lets a poller read everything since a sequence number', () => {
    const bus = new MidiBus();
    for (let i = 0; i < 5; i++) {
      bus.emit({ type: 'noteOn', channel: 1, note: i, velocity: 1 }, 'd', 0, 0);
    }
    expect(bus.since(3).map((m) => m.seq)).toEqual([4, 5]);
    expect(bus.recent(2).map((m) => m.seq)).toEqual([4, 5]);
    expect(bus.since(5)).toEqual([]);
  });

  it('drops the oldest messages once the ring is full, without throwing', () => {
    const bus = new MidiBus();
    for (let i = 0; i < 2000; i++) {
      bus.emit({ type: 'cc', channel: 1, controller: 1, value: i % 128 }, 'd', 0, 0);
    }
    const all = bus.since(0);
    expect(all.length).toBe(512);
    expect(all.at(-1)?.seq).toBe(2000);
  });

  it('keeps flowing when a listener throws', () => {
    const bus = new MidiBus();
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    bus.subscribe(good);
    bus.emit({ type: 'noteOn', channel: 1, note: 1, velocity: 1 }, 'd', 0, 0);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('MidiService hot-plugging', () => {
  const keys = { id: 'a', name: 'Keys', manufacturer: 'Acme' };
  const pads = { id: 'b', name: 'Pads', manufacturer: 'Acme' };

  beforeEach(() => {
    useMidiStore.setState({ devices: [], selection: ALL_DEVICES, status: 'starting', detail: '' });
  });

  it('reports connected, then disconnected, then reconnects without errors', async () => {
    const service = new MidiService();
    const warn = vi.fn();
    const info = vi.fn();
    service.setHooks({ onWarn: warn, onInfo: info });
    const source = new MockMidiSource([keys]);
    await service.start(source);
    expect(useMidiStore.getState().status).toBe('connected');

    source.send('a', [0x90, 60, 100]);
    expect(service.input.held.has(60)).toBe(true);

    source.unplug('a');
    expect(useMidiStore.getState().status).toBe('disconnected');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(service.input.held.size).toBe(0);

    // The replugged device gets a new id, as real hardware often does.
    source.plug({ ...keys, id: 'a2' });
    expect(useMidiStore.getState().status).toBe('connected');
    expect(info).toHaveBeenCalledWith('MIDI device reconnected.');
    source.send('a2', [0x90, 62, 100]);
    expect(service.bus.head).toBe(2);
  });

  it('listens only to the selected device and matches it by name after a replug', async () => {
    const service = new MidiService();
    const source = new MockMidiSource([keys, pads]);
    await service.start(source);
    service.select('Keys');
    source.send('b', [0x90, 40, 100]);
    expect(service.bus.head).toBe(0);
    source.send('a', [0x90, 60, 100]);
    expect(service.bus.head).toBe(1);

    source.unplug('a');
    expect(useMidiStore.getState().status).toBe('disconnected');
    source.plug({ ...keys, id: 'zzz' });
    expect(useMidiStore.getState().status).toBe('connected');
  });

  it('reports no-devices rather than an error when nothing is plugged in', async () => {
    const service = new MidiService();
    await service.start(new MockMidiSource());
    expect(useMidiStore.getState().status).toBe('no-devices');
  });

  it('turns a failed MIDI access request into a status, not an exception', async () => {
    const service = new MidiService();
    await expect(
      service.start({
        start: () => Promise.reject(new Error('denied')),
        stop: () => undefined,
      }),
    ).resolves.toBeUndefined();
    expect(useMidiStore.getState()).toMatchObject({ status: 'unavailable', detail: 'denied' });
  });

  it('accepts injected virtual keyboard messages regardless of selection', async () => {
    const service = new MidiService();
    await service.start(new MockMidiSource([keys]));
    service.select('Keys');
    service.inject([0x90, 72, 64]);
    expect(service.bus.recent(1)[0]).toMatchObject({ note: 72, device: 'Virtual Keyboard' });
  });

  it('ignores garbage bytes', async () => {
    const service = new MidiService();
    const source = new MockMidiSource([keys]);
    await service.start(source);
    source.send('a', [0xff, 0xff]);
    source.send('a', []);
    expect(service.bus.head).toBe(0);
  });
});

describe('WebMidiSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in for the browser's MIDI access with one connected keyboard. */
  function fakeAccess() {
    const input = {
      id: 'in-1',
      name: 'MPK mini',
      manufacturer: 'AKAI',
      state: 'connected',
      onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null,
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      onstatechange: null as (() => void) | null,
    };
    return { input, access };
  }

  it('attaches to connected devices and lets go of them on stop', async () => {
    const { input, access } = fakeAccess();
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve(access) });
    const source = new WebMidiSource();
    const onMessage = vi.fn();
    const onDevices = vi.fn();
    await source.start(onMessage, onDevices);
    expect(onDevices).toHaveBeenCalledWith([
      { id: 'in-1', name: 'MPK mini', manufacturer: 'AKAI' },
    ]);
    input.onmidimessage?.({ data: Uint8Array.from([0x90, 60, 100]), timeStamp: 5 });
    expect(onMessage).toHaveBeenCalledTimes(1);
    source.stop();
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });

  it('does not attach if it was stopped while waiting for access', async () => {
    const { input, access } = fakeAccess();
    let grant: (value: unknown) => void = () => undefined;
    vi.stubGlobal('navigator', {
      requestMIDIAccess: () => new Promise((resolve) => (grant = resolve)),
    });
    const source = new WebMidiSource();
    const onDevices = vi.fn();
    const starting = source.start(vi.fn(), onDevices);
    source.stop(); // e.g. a show starts before MIDI access arrived
    grant(access);
    await starting;
    // No second listener left behind to double every key press.
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(onDevices).not.toHaveBeenCalled();
  });
});
