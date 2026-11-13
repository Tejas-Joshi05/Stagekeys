import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../ipc/settings';
import type { MidiMessage } from '../midi';
import {
  ControlPicker,
  controlOfMapping,
  describeInput,
  mappingTouches,
  triggerForControl,
} from './controls';
import type { Mapping } from './types';

const profile = DEFAULT_SETTINGS.controller;

const mapping = (partial: Partial<Mapping>): Mapping => ({
  id: 'm',
  name: '',
  enabled: true,
  trigger: { kind: 'noteOn' },
  filters: {},
  action: { type: 'nav.next' },
  curve: 'linear',
  min: 0,
  max: 1,
  ...partial,
});

describe('mappings seen from the controller', () => {
  it('builds triggers for keys, pads and knobs', () => {
    expect(triggerForControl({ kind: 'key', note: 60 }, profile, false)).toEqual({
      trigger: { kind: 'noteOn' },
      filters: { noteFrom: 60, noteTo: 60 },
    });
    expect(
      triggerForControl({ kind: 'pad', index: 0, bank: 'A', note: 36 }, profile, false),
    ).toEqual({
      trigger: { kind: 'noteOn' },
      filters: { noteFrom: 36, noteTo: 36, channel: 10 },
    });
    expect(triggerForControl({ kind: 'knob', index: 0, cc: 70 }, profile, true)?.trigger).toEqual({
      kind: 'ccValue',
      controller: 70,
    });
    expect(triggerForControl({ kind: 'knob', index: 0, cc: 70 }, profile, false)?.trigger).toEqual({
      kind: 'ccAbove',
      controller: 70,
      threshold: 64,
    });
    expect(triggerForControl({ kind: 'pitch' }, profile, true)).toBeNull();
  });

  it('round-trips a control through a mapping', () => {
    const pad = { kind: 'pad', index: 3, bank: 'A', note: 39 } as const;
    const made = triggerForControl(pad, profile, false);
    if (!made) throw new Error('no trigger');
    const m = mapping(made);
    expect(controlOfMapping(m, profile)).toEqual(pad);
    expect(mappingTouches(m, pad, profile)).toBe(true);
    expect(mappingTouches(m, { kind: 'key', note: 39 }, profile)).toBe(false);
    expect(describeInput(m, profile)).toBe('Pad 4');
  });

  it('describes ranges, any key and knob thresholds in plain words', () => {
    expect(describeInput(mapping({ filters: { noteFrom: 48, noteTo: 59 } }), profile)).toBe(
      'Keys C3–B3',
    );
    expect(describeInput(mapping({}), profile)).toBe('Any key');
    expect(
      describeInput(
        mapping({ trigger: { kind: 'ccAbove', controller: 71, threshold: 64 } }),
        profile,
      ),
    ).toBe('Knob 2 turned up past 50%');
    expect(describeInput(mapping({ trigger: { kind: 'ccValue', controller: 1 } }), profile)).toBe(
      'Mod wheel',
    );
  });

  it('a key range touches every key in it', () => {
    const m = mapping({ filters: { noteFrom: 48, noteTo: 59 } });
    expect(mappingTouches(m, { kind: 'key', note: 50 }, profile)).toBe(true);
    expect(mappingTouches(m, { kind: 'key', note: 60 }, profile)).toBe(false);
    expect(controlOfMapping(m, profile)).toBeNull();
  });

  it('the picker swallows messages only while enabled', () => {
    const picker = new ControlPicker(() => profile);
    const msg: MidiMessage = {
      type: 'noteOn',
      channel: 1,
      note: 60,
      velocity: 90,
      device: 'K',
      time: 0,
      seq: 7,
      consumed: false,
    };
    expect(picker.offer(msg)).toBe(false);
    picker.enabled = true;
    expect(picker.offer(msg)).toBe(true);
    expect(picker.latest).toEqual({ ref: { kind: 'key', note: 60 }, seq: 7 });
  });
});
