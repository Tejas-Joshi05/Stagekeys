import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../ipc/settings';
import { controlFor, keyLayout, keysWindow, padFor } from './controller';
import { MidiInputState } from './inputState';

const profile = DEFAULT_SETTINGS.controller;

describe('MPK mini IV controller model', () => {
  it('tells pads from keys by channel, and knobs and wheels by CC', () => {
    expect(controlFor({ type: 'noteOn', channel: 10, note: 38, velocity: 90 }, profile)).toEqual({
      kind: 'pad',
      note: 38,
      index: 2,
      bank: 'A',
    });
    expect(controlFor({ type: 'noteOn', channel: 1, note: 38, velocity: 90 }, profile)).toEqual({
      kind: 'key',
      note: 38,
    });
    expect(controlFor({ type: 'cc', channel: 1, controller: 72, value: 3 }, profile)).toEqual({
      kind: 'knob',
      index: 2,
      cc: 72,
    });
    expect(controlFor({ type: 'cc', channel: 1, controller: 1, value: 3 }, profile)).toEqual({
      kind: 'mod',
    });
    expect(controlFor({ type: 'cc', channel: 1, controller: 64, value: 127 }, profile)).toEqual({
      kind: 'sustain',
    });
    expect(controlFor({ type: 'pitchBend', channel: 1, value: 0.5 }, profile)).toEqual({
      kind: 'pitch',
    });
    expect(controlFor({ type: 'cc', channel: 1, controller: 20, value: 3 }, profile)).toEqual({
      kind: 'cc',
      cc: 20,
    });
  });

  it('places bank B pads after bank A', () => {
    expect(padFor(44, profile)).toEqual({ index: 0, bank: 'B' });
    expect(padFor(51, profile)).toEqual({ index: 7, bank: 'B' });
  });

  it('moves the 25-key window by octaves to show held keys', () => {
    expect(keysWindow(48, [])).toBe(48);
    expect(keysWindow(48, [72])).toBe(48);
    expect(keysWindow(48, [73])).toBe(60);
    expect(keysWindow(48, [40])).toBe(36);
  });

  it('lays out 15 white and 10 black keys from C', () => {
    const { whites, blacks } = keyLayout(48);
    expect(whites).toHaveLength(15);
    expect(blacks).toHaveLength(10);
    expect(blacks[0]).toEqual({ note: 49, afterWhite: 1 });
  });

  it('remembers the channel of each held note and counts changes', () => {
    const input = new MidiInputState();
    const v0 = input.version;
    input.apply({ type: 'noteOn', channel: 10, note: 36, velocity: 100 });
    expect(input.heldChannel.get(36)).toBe(10);
    input.apply({ type: 'noteOff', channel: 10, note: 36, velocity: 0 });
    expect(input.heldChannel.has(36)).toBe(false);
    expect(input.version).toBe(v0 + 2);
  });
});
