import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MidiInputState, type MidiMessage } from '../midi';
import { splitUnits } from './builtin/textReveal';
import { bindableParams, controlsFor } from './controls';
import { defineAnimation, param, type Trigger } from './define';
import { AnimationInstance, type AnimationConfig } from './host';
import { getAnimation, listAnimations } from './registry';

const config = (partial: Partial<AnimationConfig> = {}): AnimationConfig => ({
  id: 'el',
  width: 400,
  height: 300,
  params: {},
  bindings: [],
  listen: { mode: 'all', from: 0, to: 127 },
  ...partial,
});

const noteOn = (note: number, velocity = 127, consumed = false): MidiMessage => ({
  type: 'noteOn',
  channel: 1,
  note,
  velocity,
  device: 'Keys',
  time: 0,
  seq: 1,
  consumed,
});

/** A probe animation that records what the host hands it. */
function probe() {
  const seen: { triggers: Trigger[]; size: number }[] = [];
  const calls = { setup: 0, teardown: 0 };
  const owned = { destroy: vi.fn() };
  const def = defineAnimation({
    id: 'probe',
    name: 'Probe',
    description: '',
    inputs: ['trigger'],
    params: z.object({ size: param.number('Size', 0.5, 0, 1), label: param.text('Label', 'hi') }),
    setup(ctx) {
      calls.setup++;
      ctx.root.addChild(new Container());
      ctx.own(owned);
      return {};
    },
    update(_state, _frame, inputs) {
      seen.push({ triggers: [...inputs.triggers], size: inputs.params.size });
    },
    teardown() {
      calls.teardown++;
    },
  });
  return { def, seen, calls, owned };
}

describe('animation registry', () => {
  it('contains the five starter animations with unique ids', () => {
    const ids = listAnimations().map((a) => a.id);
    expect(ids).toEqual(['bloom', 'pulse', 'ripple', 'text-reveal', 'step-sequence']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getAnimation('bloom')?.name).toBe('Bloom');
    expect(getAnimation('missing')).toBeUndefined();
  });

  it('every animation has defaults for all parameters and at least one control', () => {
    for (const animation of listAnimations()) {
      const defaults = animation.parseParams({});
      const controls = controlsFor(animation);
      expect(controls.length, animation.id).toBeGreaterThan(0);
      for (const control of controls) expect(defaults).toHaveProperty(control.key);
    }
  });
});

describe('parameter controls generated from the schema', () => {
  it('derives control kinds, labels, ranges and defaults', () => {
    const bloom = getAnimation('bloom');
    if (!bloom) throw new Error('bloom missing');
    const controls = controlsFor(bloom);
    expect(controls.find((c) => c.key === 'size')).toMatchObject({
      kind: 'number',
      label: 'Size',
      min: 0.05,
      max: 1,
      default: 0.8,
    });
    expect(controls.find((c) => c.key === 'colour')).toMatchObject({
      kind: 'colour',
      default: '#ff5fa2',
    });
    expect(controls.find((c) => c.key === 'shape')).toMatchObject({
      kind: 'choice',
      options: ['circle', 'ring', 'petals'],
    });
    const reveal = getAnimation('text-reveal');
    if (!reveal) throw new Error('text-reveal missing');
    expect(controlsFor(reveal).find((c) => c.key === 'text')).toMatchObject({
      kind: 'text',
      multiline: true,
    });
    expect(controlsFor(reveal).find((c) => c.key === 'loop')).toMatchObject({ kind: 'boolean' });
    expect(controlsFor(reveal).find((c) => c.key === 'fontFamily')).toMatchObject({ kind: 'font' });
  });

  it('lists only numeric parameters as bindable', () => {
    const bloom = getAnimation('bloom');
    if (!bloom) throw new Error('bloom missing');
    expect(bindableParams(bloom).map((c) => c.key)).toEqual(['size', 'duration', 'startOpacity']);
  });

  it('keeps valid stored values and replaces only the invalid ones', () => {
    const bloom = getAnimation('bloom');
    if (!bloom) throw new Error('bloom missing');
    const parsed = bloom.parseParams({ size: 0.3, colour: 'not-a-colour', shape: 'ring' });
    expect(parsed).toMatchObject({ size: 0.3, colour: '#ff5fa2', shape: 'ring' });
    expect(bloom.parseParams(null)).toMatchObject({ size: 0.8 });
  });
});

describe('AnimationInstance', () => {
  it('turns key presses into triggers, once, and ignores mapped keys', () => {
    const { def, seen } = probe();
    const inst = new AnimationInstance(def, config(), vi.fn());
    const input = new MidiInputState();
    inst.offer(noteOn(60, 127), []);
    inst.offer(noteOn(61, 64, true), []);
    inst.update(0.016, input);
    inst.update(0.016, input);
    expect(seen[0]?.triggers).toEqual([{ value: 1, note: 60 }]);
    expect(seen[1]?.triggers).toEqual([]);
  });

  it('respects the note filter: range, zone and none', () => {
    const input = new MidiInputState();
    const run = (listen: AnimationConfig['listen'], note: number): number => {
      const { def, seen } = probe();
      const inst = new AnimationInstance(def, config({ listen }), vi.fn());
      inst.offer(noteOn(note), [{ id: 'z', fromNote: 72, toNote: 84 }]);
      inst.update(0.016, input);
      return seen[0]?.triggers.length ?? 0;
    };
    expect(run({ mode: 'range', from: 48, to: 59 }, 50)).toBe(1);
    expect(run({ mode: 'range', from: 48, to: 59 }, 60)).toBe(0);
    expect(run({ mode: 'zone', zoneId: 'z', from: 0, to: 127 }, 80)).toBe(1);
    expect(run({ mode: 'zone', zoneId: 'z', from: 0, to: 127 }, 60)).toBe(0);
    expect(run({ mode: 'zone', zoneId: 'gone', from: 0, to: 127 }, 80)).toBe(0);
    expect(run({ mode: 'none', from: 0, to: 127 }, 60)).toBe(0);
  });

  it('accepts triggers from the anim.trigger action', () => {
    const { def, seen } = probe();
    const inst = new AnimationInstance(
      def,
      config({ listen: { mode: 'none', from: 0, to: 127 } }),
      vi.fn(),
    );
    inst.trigger(0.4);
    inst.update(0.016, new MidiInputState());
    expect(seen[0]?.triggers).toEqual([{ value: 0.4, note: null }]);
  });

  it('binds velocity to a parameter through the curve and range', () => {
    const { def, seen } = probe();
    const inst = new AnimationInstance(
      def,
      config({
        bindings: [
          { param: 'size', source: 'velocity', controller: 1, curve: 'linear', min: 0.2, max: 1 },
        ],
      }),
      vi.fn(),
    );
    const input = new MidiInputState();
    inst.update(0.016, input);
    expect(seen[0]?.size).toBeCloseTo(0.2);
    input.apply({ type: 'noteOn', channel: 1, note: 60, velocity: 127 });
    inst.update(0.016, input);
    expect(seen[1]?.size).toBeCloseTo(1);
  });

  it('binds a CC to a parameter and applies anim.setParam overrides', () => {
    const { def, seen } = probe();
    const inst = new AnimationInstance(
      def,
      config({
        bindings: [
          { param: 'size', source: 'cc', controller: 7, curve: 'linear', min: 0, max: 10 },
        ],
      }),
      vi.fn(),
    );
    const input = new MidiInputState();
    input.apply({ type: 'cc', channel: 1, controller: 7, value: 127 });
    inst.update(0.016, input);
    expect(seen[0]?.size).toBeCloseTo(10);

    const plain = probe();
    const other = new AnimationInstance(plain.def, config(), vi.fn());
    other.setParam('size', 0.9);
    other.setParam('label', 3);
    other.setParam('nope', 3);
    other.update(0.016, input);
    expect(plain.seen[0]?.size).toBe(0.9);
  });

  it('cleans up after itself: teardown runs, owned resources and children are destroyed', () => {
    const { def, calls, owned } = probe();
    const inst = new AnimationInstance(def, config(), vi.fn());
    expect(inst.root.children.length).toBe(1);
    inst.destroy();
    expect(calls.teardown).toBe(1);
    expect(owned.destroy).toHaveBeenCalledTimes(1);
    expect(inst.root.destroyed).toBe(true);
  });

  it('reset tears down and sets up again without leaking children', () => {
    const { def, calls } = probe();
    const inst = new AnimationInstance(def, config(), vi.fn());
    inst.reset();
    inst.reset();
    expect(calls).toEqual({ setup: 3, teardown: 2 });
    expect(inst.root.children.length).toBe(1);
  });

  it.each(['setup', 'update', 'teardown'] as const)(
    'show-safe: an error in %s is caught, reported once, and the instance is switched off',
    (phase) => {
      const onError = vi.fn();
      const boom = (p: string) => {
        if (p === phase) throw new Error(`${p} failed`);
      };
      const def = defineAnimation({
        id: 'bad',
        name: 'Bad',
        description: '',
        inputs: [],
        params: z.object({}),
        setup: () => {
          boom('setup');
          return {};
        },
        update: () => boom('update'),
        teardown: () => boom('teardown'),
      });
      const inst = new AnimationInstance(def, config(), onError);
      const input = new MidiInputState();
      expect(() => {
        inst.update(0.016, input);
        inst.update(0.016, input);
        inst.destroy();
      }).not.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[1]).toBe(phase);
      expect(inst.hasFailed).toBe(true);
    },
  );

  it('caps the frame time so a stall does not make animations jump', () => {
    const frames: number[] = [];
    const def = defineAnimation({
      id: 'dt',
      name: 'dt',
      description: '',
      inputs: [],
      params: z.object({}),
      setup: () => ({}),
      update: (_s, frame) => void frames.push(frame.dt),
      teardown: () => undefined,
    });
    const inst = new AnimationInstance(def, config(), vi.fn());
    inst.update(5, new MidiInputState());
    expect(frames[0]).toBeLessThanOrEqual(0.1);
  });
});

describe('text reveal splitting', () => {
  it('splits by word keeping spaces with the word before', () => {
    expect(splitUnits('art over  optimisation', 'word')).toEqual([
      'art ',
      'over  ',
      'optimisation',
    ]);
  });
  it('splits by letter and by line', () => {
    expect(splitUnits('hey', 'letter')).toEqual(['h', 'e', 'y']);
    expect(splitUnits('one line', 'line')).toEqual(['one line']);
    expect(splitUnits('', 'line')).toEqual([]);
  });
});
