import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MidiInputState, type MidiMessage } from '../midi';
import { audioInput } from '../audio';
import { rimPoint, shapeDistance, VIGNETTE_SHAPES } from './builtin/asciiVignette';
import { burstOrigin } from './builtin/glyphBurst';
import { asciiBar, readoutLines } from './builtin/midiReadout';
import { barSpan, mixColour } from './builtin/noteTrails';
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
  it('contains the built-in animations with unique ids', () => {
    const ids = listAnimations().map((a) => a.id);
    expect(ids).toEqual([
      'ascii-garden',
      'ascii-vignette',
      'pressed-bloom',
      'bloom',
      'pulse',
      'ripple',
      'text-reveal',
      'step-sequence',
      'midi-readout',
      'note-trails',
      'glyph-burst',
    ]);
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

describe('live parameter changes', () => {
  const live = (rebuildOn?: readonly ('size' | 'label')[]) => {
    const seen: number[] = [];
    let setups = 0;
    const def = defineAnimation({
      id: 'live',
      name: 'Live',
      description: '',
      inputs: [],
      rebuildOn,
      params: z.object({ size: param.number('Size', 0.5, 0, 1), label: param.text('Label', 'a') }),
      setup() {
        setups++;
        return {};
      },
      update(_s, _f, inputs) {
        seen.push(inputs.params.size);
      },
      teardown() {},
    });
    return { def, seen, setups: () => setups };
  };

  it('applies a live parameter without a restart', () => {
    const { def, seen, setups } = live(['label']);
    const instance = new AnimationInstance(def, config({ params: { size: 0.2 } }), vi.fn());
    const next = config({ params: { size: 0.9 } });
    expect(instance.canReconfigure(next)).toBe(true);
    instance.reconfigure(next);
    instance.update(0.016, new MidiInputState());
    expect(seen.at(-1)).toBe(0.9);
    expect(setups()).toBe(1);
  });

  it('asks for a rebuild when a layout parameter changes, or when it declares nothing', () => {
    const { def } = live(['label']);
    const instance = new AnimationInstance(def, config({ params: { label: 'a' } }), vi.fn());
    expect(instance.canReconfigure(config({ params: { label: 'b' } }))).toBe(false);
    const legacy = new AnimationInstance(live().def, config({ params: { size: 0.2 } }), vi.fn());
    expect(legacy.canReconfigure(config({ params: { size: 0.3 } }))).toBe(false);
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

describe('sound input in animations', () => {
  const options = { requestAccess: () => Promise.resolve(false), mock: true, onProblem: () => {} };

  it('hands every animation the sound levels and binds parameters to them', () => {
    const seen: { size: number; level: number; active: boolean }[] = [];
    const def = defineAnimation({
      id: 'listener',
      name: 'Listener',
      description: '',
      inputs: ['audio'],
      params: z.object({ size: param.number('Size', 0.5, 0, 1) }),
      setup: () => ({}),
      update(_s, _f, inputs) {
        seen.push({
          size: inputs.params.size,
          level: inputs.audio.level,
          active: inputs.audio.active,
        });
      },
      teardown() {},
    });
    const instance = new AnimationInstance(
      def,
      config({
        bindings: [
          {
            param: 'size',
            source: 'audioBass',
            controller: 1,
            curve: 'linear',
            min: 0.2,
            max: 0.8,
          },
        ],
      }),
      vi.fn(),
    );
    const input = new MidiInputState();

    // Sound input off: silent levels, the binding sits at its lowest value.
    instance.update(1 / 60, input);
    expect(seen.at(-1)).toEqual({ size: 0.2, level: 0, active: false });

    try {
      audioInput.start(options);
      audioInput.configure({ enabled: true, sensitivity: 1, deviceId: '' });
      audioInput.inject({ level: 0.5, bass: 0.5, mid: 0, treble: 0 });
      audioInput.read(performance.now() + 50);
      audioInput.read(performance.now() + 100);
      instance.update(1 / 60, input);
      expect(seen.at(-1)).toEqual({ size: 0.8, level: 1, active: true });
    } finally {
      audioInput.inject(null);
      audioInput.dispose();
      audioInput.configure({ enabled: false, sensitivity: 0.5, deviceId: '' });
    }
    instance.destroy();
  });
});

describe('ASCII vignette shapes', () => {
  it('every shape is 0 or small at the centre and grows towards a corner', () => {
    for (const shape of VIGNETTE_SHAPES) {
      for (const aspect of [16 / 9, 1, 0.5]) {
        const centre = shapeDistance(shape, 0, 0.001, aspect);
        const corner = shapeDistance(shape, 0.98, 0.98, aspect);
        expect(Number.isFinite(centre), `${shape} centre`).toBe(true);
        expect(Number.isFinite(corner), `${shape} corner`).toBe(true);
        expect(centre, `${shape} centre`).toBeLessThan(0.5);
        expect(corner, `${shape} corner`).toBeGreaterThan(centre);
      }
    }
  });

  it('measures the simple shapes as expected', () => {
    expect(shapeDistance('oval', 1, 0, 16 / 9)).toBeCloseTo(1);
    expect(shapeDistance('oval', 0, 1, 16 / 9)).toBeCloseTo(1);
    // A circle is not stretched by a wide box: it touches top and bottom, not the sides.
    expect(shapeDistance('circle', 0, 1, 16 / 9)).toBeCloseTo(1);
    expect(shapeDistance('circle', 1, 0, 16 / 9)).toBeCloseTo(16 / 9);
    expect(shapeDistance('letterbox', 0.9, 0.5, 2)).toBeCloseTo(0.5);
    expect(shapeDistance('curtains', 0.9, 0.5, 2)).toBeCloseTo(0.9);
    expect(shapeDistance('corners', 1, 0, 2)).toBe(0);
    expect(shapeDistance('corners', 1, 1, 2)).toBeCloseTo(1);
    expect(shapeDistance('diamond', 0.5, 0.5, 1)).toBeCloseTo(1);
  });

  it('places keys along the chosen edge, low notes first', () => {
    expect(rimPoint(36, 'bottom')).toEqual({ x: -1, y: 1 });
    expect(rimPoint(84, 'bottom')).toEqual({ x: 1, y: 1 });
    expect(rimPoint(60, 'top')).toEqual({ x: 0, y: -1 });
    expect(rimPoint(0, 'bottom').x).toBe(-1);
    expect(rimPoint(127, 'bottom').x).toBe(1);
    expect(rimPoint(36, 'left')).toEqual({ x: -1, y: 1 });
    for (const note of [36, 48, 60, 72, 84]) {
      const at = rimPoint(note, 'all around');
      expect(Math.max(Math.abs(at.x), Math.abs(at.y))).toBeCloseTo(1);
    }
  });

  it('sets up, runs and shows its final state without a GPU', () => {
    const def = getAnimation('ascii-vignette');
    if (!def) throw new Error('missing');
    const onError = vi.fn();
    const instance = new AnimationInstance(def, config({ width: 1920, height: 1080 }), onError);
    const input = new MidiInputState();
    instance.offer(noteOn(60), []);
    for (let i = 0; i < 10; i++) instance.update(1 / 60, input);
    instance.showFinal();
    instance.destroy();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('MIDI readout', () => {
  const p = {
    show: 'both numbers',
    bars: true,
    noteNames: true,
    keyLabel: 'which key',
    velocityLabel: 'how hard',
  } as const;

  it('draws bars in proportion', () => {
    expect(asciiBar(0, 127, 8)).toBe('[--------]');
    expect(asciiBar(127, 127, 8)).toBe('[########]');
    expect(asciiBar(64, 127, 8)).toBe('[####----]');
    expect(asciiBar(999, 127, 8)).toBe('[########]');
    expect(asciiBar(-5, 127, 8)).toBe('[--------]');
  });

  it('shows the two numbers a key sends', () => {
    const lines = readoutLines(60, 97, { ...p, bars: false });
    expect(lines.labels).toBe('which key\nhow hard');
    expect(lines.values).toBe(' 60  C4\n 97');
    expect(readoutLines(60, 97, p).values.split('\n')).toHaveLength(4);
  });

  it('shows dashes before anything is played, and the raw bytes when asked', () => {
    expect(readoutLines(-1, 0, { ...p, bars: false }).values).toBe(' --\n --');
    const rawLines = readoutLines(60, 97, { ...p, show: 'raw message' });
    expect(rawLines.values).toBe('90 3C 61\nnote on, key 60, velocity 97');
    expect(readoutLines(60, 97, { ...p, show: 'key only', bars: false }).labels).toBe('which key');
  });
});

describe('reveal progress', () => {
  it('reports how many key-press steps are done, for the presenter view', () => {
    const def = getAnimation('step-sequence');
    if (!def) throw new Error('missing');
    const instance = new AnimationInstance(
      def,
      config({ params: { steps: 'one\ntwo\nthree' } }),
      vi.fn(),
    );
    const input = new MidiInputState();
    expect(instance.progress()).toEqual({ done: 0, total: 3 });
    instance.trigger(1);
    instance.trigger(1);
    instance.update(1 / 60, input);
    expect(instance.progress()).toEqual({ done: 2, total: 3 });
    instance.reset();
    expect(instance.progress()).toEqual({ done: 0, total: 3 });
    instance.destroy();
    expect(instance.progress()).toBeNull();
  });

  it('is null for animations that are not stepped through, and never throws', () => {
    const { def } = probe();
    const plain = new AnimationInstance(def, config(), vi.fn());
    expect(plain.progress()).toBeNull();
    const broken = defineAnimation({
      id: 'broken-progress',
      name: 'Broken',
      description: '',
      inputs: [],
      params: z.object({ size: param.number('Size', 0.5, 0, 1) }),
      setup: () => ({}),
      update() {},
      teardown() {},
      progress() {
        throw new Error('boom');
      },
    });
    expect(new AnimationInstance(broken, config(), vi.fn()).progress()).toBeNull();
  });
});

describe('note trails', () => {
  it('mixes the low and high colours', () => {
    expect(mixColour(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColour(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColour(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
    expect(mixColour(0x102030, 0x405060, -4)).toBe(0x102030);
    expect(mixColour(0x102030, 0x405060, 9)).toBe(0x405060);
  });

  it('grows a bar while the key is held and lets it drift off after release', () => {
    // Held for half a second at half a height per second: a quarter of the box, from the bottom.
    expect(barSpan(0.5, -1, 0.5, 1000, 'up')).toEqual({ y: 750, h: 250 });
    expect(barSpan(0.5, -1, 0.5, 1000, 'down')).toEqual({ y: 0, h: 250 });
    // Held for a long time: it fills the box and stops there.
    expect(barSpan(60, -1, 0.5, 1000, 'up')).toEqual({ y: 0, h: 1000 });
    // Released: the tail follows the head.
    expect(barSpan(1, 0.5, 0.5, 1000, 'up')).toEqual({ y: 500, h: 250 });
    expect(barSpan(1, 0.5, 0.5, 1000, 'down')).toEqual({ y: 250, h: 250 });
    // Gone once the tail has crossed the box.
    expect(barSpan(5, 2, 0.5, 1000, 'up')).toBeNull();
  });

  it('runs through presses, releases and its final state without a GPU', () => {
    const def = getAnimation('note-trails');
    if (!def) throw new Error('missing');
    const onError = vi.fn();
    const instance = new AnimationInstance(def, config({ width: 1920, height: 1080 }), onError);
    const input = new MidiInputState();
    for (const note of [10, 48, 60, 72, 120]) {
      const on = noteOn(note);
      input.apply(on);
      instance.offer(on, []);
    }
    for (let i = 0; i < 20; i++) instance.update(1 / 60, input);
    input.releaseAll(); // as panic does: no note-off arrives
    for (let i = 0; i < 400; i++) instance.update(1 / 60, input);
    instance.showFinal();
    instance.destroy();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('glyph burst', () => {
  it('starts where the key is, or where it is told to', () => {
    expect(burstOrigin('where the key is', 36, 1000, 500, 0.5)).toEqual({ x: 0, y: 500 });
    expect(burstOrigin('where the key is', 84, 1000, 500, 0.5)).toEqual({ x: 1000, y: 500 });
    expect(burstOrigin('where the key is', 200, 1000, 500, 0.5).x).toBe(1000);
    expect(burstOrigin('centre', 60, 1000, 500, 0.5)).toEqual({ x: 500, y: 250 });
    expect(burstOrigin('bottom centre', null, 1000, 500, 0.5)).toEqual({ x: 500, y: 500 });
    for (const roll of [0, 0.3, 0.999]) {
      const at = burstOrigin('anywhere', null, 1000, 500, roll);
      expect(at.x).toBeGreaterThanOrEqual(100);
      expect(at.x).toBeLessThanOrEqual(900);
      expect(at.y).toBeGreaterThanOrEqual(150);
      expect(at.y).toBeLessThanOrEqual(400);
      // A mapped trigger has no key, so it lands somewhere along the bottom.
      expect(burstOrigin('where the key is', null, 1000, 500, roll).y).toBe(500);
    }
  });

  it('sets up, runs and shows its final state without a GPU', () => {
    const def = getAnimation('glyph-burst');
    if (!def) throw new Error('missing');
    const onError = vi.fn();
    const instance = new AnimationInstance(def, config({ width: 1920, height: 1080 }), onError);
    const input = new MidiInputState();
    instance.offer(noteOn(60), []);
    instance.trigger(1);
    for (let i = 0; i < 10; i++) instance.update(1 / 60, input);
    instance.showFinal();
    instance.destroy();
    expect(onError).not.toHaveBeenCalled();
    expect(def.listensToSound(def.parseParams({}))).toBe(false);
    expect(def.listensToSound(def.parseParams({ soundBeats: true }))).toBe(true);
  });
});
