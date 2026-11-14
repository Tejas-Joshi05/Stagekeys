import { describe, expect, it, vi } from 'vitest';
import { MidiBus, type MidiMessage, type ParsedMidi } from '../midi';
import { applyCurve, scaleValue } from './curves';
import { startMappingEngine } from './engine';
import { parseMappingFile, serialiseMappings } from './file';
import { LearnSession, learnFromMessage } from './learn';
import { actionFor, matchMapping, resolveMappings } from './match';
import { MappingSchema, type Mapping } from './types';

const msg = (parsed: ParsedMidi, device = 'Keys'): MidiMessage => ({
  ...parsed,
  device,
  time: 0,
  seq: 1,
  consumed: false,
});
const noteOn = (note: number, velocity = 100, channel = 1) =>
  msg({ type: 'noteOn', channel, note, velocity });
const noteOff = (note: number) => msg({ type: 'noteOff', channel: 1, note, velocity: 0 });
const cc = (controller: number, value: number) =>
  msg({ type: 'cc', channel: 1, controller, value });

const mapping = (partial: Partial<Mapping> & Pick<Mapping, 'trigger'>): Mapping =>
  MappingSchema.parse({ id: 'm', action: { type: 'nav.next' }, ...partial });

describe('matchMapping: triggers', () => {
  it('note on matches note on only', () => {
    const m = mapping({ trigger: { kind: 'noteOn' } });
    expect(matchMapping(m, noteOn(60, 127), 0)).toBe(1);
    expect(matchMapping(m, noteOff(60), 0)).toBeNull();
    expect(matchMapping(m, cc(1, 5), 0)).toBeNull();
  });

  it('note off matches note off only', () => {
    const m = mapping({ trigger: { kind: 'noteOff' } });
    expect(matchMapping(m, noteOff(60), 0)).toBe(0);
    expect(matchMapping(m, noteOn(60), 0)).toBeNull();
  });

  it('CC above fires once, on the upward crossing', () => {
    const m = mapping({ trigger: { kind: 'ccAbove', controller: 7, threshold: 64 } });
    expect(matchMapping(m, cc(7, 70), 10)).not.toBeNull();
    expect(matchMapping(m, cc(7, 90), 70)).toBeNull();
    expect(matchMapping(m, cc(7, 30), 90)).toBeNull();
    expect(matchMapping(m, cc(8, 100), 0)).toBeNull();
  });

  it('CC below fires once, on the downward crossing', () => {
    const m = mapping({ trigger: { kind: 'ccBelow', controller: 7, threshold: 64 } });
    expect(matchMapping(m, cc(7, 50), 100)).not.toBeNull();
    expect(matchMapping(m, cc(7, 20), 50)).toBeNull();
  });

  it('CC value fires on every message with the normalised value', () => {
    const m = mapping({ trigger: { kind: 'ccValue', controller: 1 } });
    expect(matchMapping(m, cc(1, 127), 0)).toBe(1);
    expect(matchMapping(m, cc(1, 0), 127)).toBe(0);
  });

  it('sustain down and up fire on pedal edges', () => {
    const down = mapping({ trigger: { kind: 'sustainDown' } });
    const up = mapping({ trigger: { kind: 'sustainUp' } });
    expect(matchMapping(down, cc(64, 127), 0)).toBe(1);
    expect(matchMapping(down, cc(64, 127), 127)).toBeNull();
    expect(matchMapping(up, cc(64, 0), 127)).toBe(0);
    expect(matchMapping(up, cc(64, 0), 0)).toBeNull();
    expect(matchMapping(down, cc(65, 127), 0)).toBeNull();
  });

  it('a disabled mapping never matches', () => {
    const m = mapping({ trigger: { kind: 'noteOn' }, enabled: false });
    expect(matchMapping(m, noteOn(60), 0)).toBeNull();
  });
});

describe('matchMapping: filters', () => {
  it('filters by single note and by note range', () => {
    const single = mapping({ trigger: { kind: 'noteOn' }, filters: { noteFrom: 60, noteTo: 60 } });
    expect(matchMapping(single, noteOn(60), 0)).not.toBeNull();
    expect(matchMapping(single, noteOn(61), 0)).toBeNull();

    const range = mapping({ trigger: { kind: 'noteOn' }, filters: { noteFrom: 48, noteTo: 59 } });
    expect(matchMapping(range, noteOn(48), 0)).not.toBeNull();
    expect(matchMapping(range, noteOn(59), 0)).not.toBeNull();
    expect(matchMapping(range, noteOn(47), 0)).toBeNull();
    expect(matchMapping(range, noteOn(60), 0)).toBeNull();
  });

  it('accepts a range entered backwards', () => {
    const m = mapping({ trigger: { kind: 'noteOn' }, filters: { noteFrom: 59, noteTo: 48 } });
    expect(matchMapping(m, noteOn(50), 0)).not.toBeNull();
  });

  it('filters by velocity range', () => {
    const m = mapping({
      trigger: { kind: 'noteOn' },
      filters: { velocityMin: 80, velocityMax: 120 },
    });
    expect(matchMapping(m, noteOn(60, 79), 0)).toBeNull();
    expect(matchMapping(m, noteOn(60, 80), 0)).not.toBeNull();
    expect(matchMapping(m, noteOn(60, 121), 0)).toBeNull();
  });

  it('filters by channel and device', () => {
    const ch = mapping({ trigger: { kind: 'noteOn' }, filters: { channel: 2 } });
    expect(matchMapping(ch, noteOn(60, 100, 1), 0)).toBeNull();
    expect(matchMapping(ch, noteOn(60, 100, 2), 0)).not.toBeNull();

    const dev = mapping({ trigger: { kind: 'noteOn' }, filters: { device: 'Pads' } });
    expect(matchMapping(dev, noteOn(60), 0)).toBeNull();
    expect(
      matchMapping(dev, msg({ type: 'noteOn', channel: 1, note: 60, velocity: 9 }, 'Pads'), 0),
    ).not.toBeNull();
  });
});

describe('scope priority', () => {
  const global = mapping({ id: 'g', trigger: { kind: 'noteOn' }, action: { type: 'nav.next' } });
  const local = mapping({
    id: 's',
    trigger: { kind: 'noteOn' },
    filters: { noteFrom: 60, noteTo: 60 },
    action: { type: 'show.blackToggle' },
  });

  it('per-slide mappings win over global ones for the same message', () => {
    const matches = resolveMappings(noteOn(60), 0, [local], [global]);
    expect(matches.map((m) => m.mapping.id)).toEqual(['s']);
    expect(matches[0]?.scope).toBe('slide');
  });

  it('falls back to global when no per-slide mapping matches', () => {
    const matches = resolveMappings(noteOn(61), 0, [local], [global]);
    expect(matches.map((m) => m.mapping.id)).toEqual(['g']);
  });

  it('returns nothing when nothing matches', () => {
    expect(resolveMappings(cc(1, 1), 0, [local], [global])).toEqual([]);
  });
});

describe('curves and value-carrying actions', () => {
  it('all curves are anchored at 0 and 1 and stay in range', () => {
    for (const curve of ['linear', 'exponential', 'logarithmic'] as const) {
      expect(applyCurve(curve, 0)).toBeCloseTo(0);
      expect(applyCurve(curve, 1)).toBeCloseTo(1);
      expect(applyCurve(curve, 2)).toBeCloseTo(1);
      expect(applyCurve(curve, -1)).toBeCloseTo(0);
    }
    expect(applyCurve('exponential', 0.5)).toBeLessThan(0.5);
    expect(applyCurve('logarithmic', 0.5)).toBeGreaterThan(0.5);
  });

  it('scales into the output range', () => {
    expect(scaleValue('linear', 0.5, 100, 200)).toBe(150);
  });

  it('feeds velocity into anim.trigger and CC into anim.setParam', () => {
    const trig = mapping({
      trigger: { kind: 'noteOn' },
      action: { type: 'anim.trigger', elementId: 'e' },
    });
    expect(actionFor({ mapping: trig, value: 0.5, scope: 'global' })).toEqual({
      type: 'anim.trigger',
      elementId: 'e',
      value: 0.5,
    });

    const param = mapping({
      trigger: { kind: 'ccValue', controller: 1 },
      action: { type: 'anim.setParam', elementId: 'e', param: 'speed', value: 0 },
      min: 2,
      max: 10,
    });
    expect(actionFor({ mapping: param, value: 1, scope: 'global' })).toMatchObject({ value: 10 });
  });

  it('feeds a knob into the sound sensitivity, kept inside 0..1', () => {
    const knob = mapping({
      trigger: { kind: 'ccValue', controller: 70 },
      action: { type: 'audio.setSensitivity', value: 0.5 },
    });
    expect(actionFor({ mapping: knob, value: 0, scope: 'global' })).toEqual({
      type: 'audio.setSensitivity',
      value: 0,
    });
    expect(actionFor({ mapping: knob, value: 1, scope: 'global' })).toMatchObject({ value: 1 });
    const wide = mapping({ ...knob, min: -2, max: 5 });
    expect(actionFor({ mapping: wide, value: 1, scope: 'global' })).toMatchObject({ value: 1 });
    expect(actionFor({ mapping: wide, value: 0, scope: 'global' })).toMatchObject({ value: 0 });
    expect(
      learnFromMessage(cc(70, 5), { type: 'audio.setSensitivity', value: 0.5 })?.trigger,
    ).toEqual({ kind: 'ccValue', controller: 70 });
  });

  it('leaves a fixed value alone for triggers that carry no value', () => {
    const m = mapping({
      trigger: { kind: 'sustainDown' },
      action: { type: 'anim.setParam', elementId: 'e', param: 'p', value: 7 },
    });
    expect(actionFor({ mapping: m, value: 1, scope: 'global' })).toMatchObject({ value: 7 });
  });
});

describe('MIDI Learn', () => {
  it('learns a single note from a key press', () => {
    expect(learnFromMessage(noteOn(64), { type: 'nav.next' })).toEqual({
      trigger: { kind: 'noteOn' },
      filters: { noteFrom: 64, noteTo: 64 },
    });
  });

  it('learns a knob as continuous for parameters and as a threshold otherwise', () => {
    expect(
      learnFromMessage(cc(21, 5), { type: 'anim.setParam', elementId: 'e', param: 'p', value: 0 })
        ?.trigger,
    ).toEqual({ kind: 'ccValue', controller: 21 });
    expect(learnFromMessage(cc(21, 5), { type: 'nav.next' })?.trigger).toEqual({
      kind: 'ccAbove',
      controller: 21,
      threshold: 64,
    });
  });

  it('learns the sustain pedal and ignores note off', () => {
    expect(learnFromMessage(cc(64, 127), { type: 'nav.next' })?.trigger).toEqual({
      kind: 'sustainDown',
    });
    expect(learnFromMessage(noteOff(60), { type: 'nav.next' })).toBeNull();
  });
});

describe('mapping engine', () => {
  it('dispatches matched actions and marks the message consumed', () => {
    const bus = new MidiBus();
    const dispatch = vi.fn(() => true);
    const global = [
      mapping({ trigger: { kind: 'noteOn' }, filters: { noteFrom: 60, noteTo: 60 } }),
    ];
    startMappingEngine({ bus, dispatch, getMappings: () => ({ slide: [], global }) });

    const hit = bus.emit({ type: 'noteOn', channel: 1, note: 60, velocity: 90 }, 'Keys', 0, 0);
    const miss = bus.emit({ type: 'noteOn', channel: 1, note: 61, velocity: 90 }, 'Keys', 0, 0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'nav.next' }, 'midi');
    expect(hit.consumed).toBe(true);
    expect(miss.consumed).toBe(false);
  });

  it('while learning, captures the message instead of dispatching', () => {
    const bus = new MidiBus();
    const dispatch = vi.fn(() => true);
    const learn = new LearnSession();
    const done = vi.fn();
    const global = [mapping({ trigger: { kind: 'noteOn' } })];
    startMappingEngine({ bus, dispatch, learn, getMappings: () => ({ slide: [], global }) });

    learn.start('m', { type: 'nav.next' }, done);
    bus.emit({ type: 'noteOn', channel: 1, note: 72, velocity: 90 }, 'Keys', 0, 0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(learn.activeId).toBeNull();

    bus.emit({ type: 'noteOn', channel: 1, note: 72, velocity: 90 }, 'Keys', 0, 0);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', () => {
    const bus = new MidiBus();
    const dispatch = vi.fn(() => true);
    const global = [mapping({ trigger: { kind: 'noteOn' } })];
    startMappingEngine({
      bus,
      dispatch,
      getMappings: () => ({ slide: [], global }),
      isActive: () => false,
    });
    bus.emit({ type: 'noteOn', channel: 1, note: 60, velocity: 90 }, 'Keys', 0, 0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('mapping files', () => {
  it('round-trips mappings and zones, assigning fresh ids', () => {
    const m = mapping({ id: 'orig', trigger: { kind: 'noteOn' } });
    const zone = { id: 'z', name: 'navigation', colour: '#ff0000', fromNote: 36, toNote: 47 };
    const parsed = parseMappingFile(serialiseMappings([m], [zone]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.mappings).toHaveLength(1);
    expect(parsed.mappings[0]?.id).not.toBe('orig');
    expect(parsed.mappings[0]?.trigger).toEqual({ kind: 'noteOn' });
    expect(parsed.zones[0]).toMatchObject({ name: 'navigation', fromNote: 36 });
  });

  it('rejects bad JSON and files of the wrong kind', () => {
    expect(parseMappingFile('{nope')).toMatchObject({ ok: false });
    expect(parseMappingFile('{"format":"something-else"}')).toMatchObject({ ok: false });
  });
});
