import { Container } from 'pixi.js';
import { applyCurve } from '../mapping';
import type { MidiInputState, MidiMessage } from '../midi';
import type { AnimationInputs, ParamValues, RegisteredAnimation, Trigger } from './define';

/** The parts of an animation element the host needs. Structural, so it does not depend on the deck schema. */
export interface AnimationConfig {
  id: string;
  width: number;
  height: number;
  params: Record<string, unknown>;
  bindings: readonly {
    param: string;
    source: 'velocity' | 'cc' | 'pitchBend' | 'note';
    controller: number;
    curve: 'linear' | 'exponential' | 'logarithmic';
    min: number;
    max: number;
  }[];
  listen: { mode: 'all' | 'zone' | 'range' | 'none'; zoneId?: string; from: number; to: number };
}

export interface NoteZone {
  id: string;
  fromNote: number;
  toNote: number;
}

export type AnimationErrorHandler = (
  elementId: string,
  phase: 'setup' | 'update' | 'teardown',
  error: unknown,
) => void;

const MAX_DT = 0.1;
const NO_TRIGGERS: readonly Trigger[] = [];
const NO_RELEASES: readonly number[] = [];

/**
 * Runs one animation element. It owns the element's root container and makes
 * two guarantees whatever the animation's own code does:
 *   - an error in setup/update/teardown is caught, reported once, and the
 *     instance is switched off, so the show carries on;
 *   - everything under the root, and everything registered with `own`, is
 *     destroyed when the instance goes away.
 */
export class AnimationInstance {
  readonly root = new Container();
  private state: unknown = undefined;
  private alive = false;
  private failed = false;
  private readonly owned: { destroy(): void }[] = [];
  private baseParams: ParamValues;
  private readonly overrides = new Map<string, number>();
  private triggers: Trigger[] = [];
  private releases: number[] = [];
  private time = 0;
  private frame = 0;

  constructor(
    private readonly def: RegisteredAnimation,
    private config: AnimationConfig,
    private readonly onError: AnimationErrorHandler,
  ) {
    this.baseParams = def.parseParams(config.params);
    this.setup();
  }

  get hasFailed(): boolean {
    return this.failed;
  }

  private setup(): void {
    try {
      this.state = this.def.setup({
        root: this.root,
        width: this.config.width,
        height: this.config.height,
        params: this.baseParams,
        own: (resource) => {
          this.owned.push(resource);
          return resource;
        },
      });
      this.alive = true;
    } catch (e) {
      this.fail('setup', e);
    }
  }

  private fail(phase: 'setup' | 'update' | 'teardown', error: unknown): void {
    this.alive = false;
    this.root.visible = false;
    if (!this.failed) {
      this.failed = true;
      this.onError(this.config.id, phase, error);
    }
  }

  private teardown(): void {
    if (this.alive) {
      try {
        this.def.teardown(this.state);
      } catch (e) {
        this.fail('teardown', e);
      }
    }
    this.alive = false;
    this.state = undefined;
    for (const resource of this.owned.splice(0)) {
      try {
        resource.destroy();
      } catch {
        // Already destroyed or broken; nothing more to do.
      }
    }
    for (const child of this.root.removeChildren()) {
      try {
        child.destroy({ children: true });
      } catch {
        // Ignore: we are cleaning up after possibly broken code.
      }
    }
  }

  /** True if the change can be absorbed without rebuilding the instance. */
  canReconfigure(next: AnimationConfig): boolean {
    return (
      next.params === this.config.params &&
      next.width === this.config.width &&
      next.height === this.config.height
    );
  }

  /** Picks up changes to bindings and the note filter without restarting the animation. */
  reconfigure(next: AnimationConfig): void {
    this.config = next;
  }

  /** A key press or release from the bus. Mapped (consumed) messages are ignored here. */
  offer(message: MidiMessage, zones: readonly NoteZone[]): void {
    if (message.consumed) return;
    if (message.type === 'noteOn') {
      if (this.listens(message.note, zones)) {
        this.triggers.push({ value: message.velocity / 127, note: message.note });
      }
    } else if (message.type === 'noteOff') {
      if (this.listens(message.note, zones)) this.releases.push(message.note);
    }
  }

  private listens(note: number, zones: readonly NoteZone[]): boolean {
    const listen = this.config.listen;
    switch (listen.mode) {
      case 'all':
        return true;
      case 'none':
        return false;
      case 'range':
        return note >= Math.min(listen.from, listen.to) && note <= Math.max(listen.from, listen.to);
      case 'zone': {
        const zone = zones.find((z) => z.id === listen.zoneId);
        if (!zone) return false;
        return (
          note >= Math.min(zone.fromNote, zone.toNote) &&
          note <= Math.max(zone.fromNote, zone.toNote)
        );
      }
    }
  }

  /** From an `anim.trigger` action. */
  trigger(value: number): void {
    this.triggers.push({ value, note: null });
  }

  /** From an `anim.setParam` action. Stays in force until the instance is reset. */
  setParam(name: string, value: number): void {
    if (typeof this.baseParams[name] === 'number' && Number.isFinite(value)) {
      this.overrides.set(name, value);
    }
  }

  private resolveParams(input: MidiInputState): ParamValues {
    const bindings = this.config.bindings;
    if (bindings.length === 0 && this.overrides.size === 0) return this.baseParams;
    const out: ParamValues = { ...this.baseParams };
    for (const [name, value] of this.overrides) out[name] = value;
    for (const b of bindings) {
      if (typeof out[b.param] !== 'number') continue;
      let t: number;
      switch (b.source) {
        case 'velocity':
          t = input.lastVelocity / 127;
          break;
        case 'cc':
          t = (input.cc[b.controller] ?? 0) / 127;
          break;
        case 'pitchBend':
          t = (input.pitchBend + 1) / 2;
          break;
        case 'note':
          t = Math.max(0, input.lastNote) / 127;
          break;
      }
      out[b.param] = b.min + (b.max - b.min) * applyCurve(b.curve, t);
    }
    return out;
  }

  update(dt: number, input: MidiInputState): void {
    const triggers = this.triggers.length > 0 ? this.triggers : NO_TRIGGERS;
    const releases = this.releases.length > 0 ? this.releases : NO_RELEASES;
    if (this.triggers.length > 0) this.triggers = [];
    if (this.releases.length > 0) this.releases = [];
    if (!this.alive) return;

    const step = Math.min(Math.max(dt, 0), MAX_DT);
    this.time += step;
    this.frame += 1;
    const inputs: AnimationInputs<ParamValues> = {
      params: this.resolveParams(input),
      triggers,
      releases,
      held: input.held,
      cc: (controller) => (input.cc[controller] ?? 0) / 127,
      pitchBend: input.pitchBend,
      sustain: input.sustain,
    };
    try {
      this.def.update(this.state, { time: this.time, dt: step, frame: this.frame }, inputs);
    } catch (e) {
      this.fail('update', e);
    }
  }

  /** Draws the finished state (thumbnails, export). Does nothing for animations without one. */
  showFinal(): void {
    if (!this.alive || !this.def.showFinal) return;
    try {
      this.def.showFinal(this.state, this.baseParams);
    } catch (e) {
      this.fail('update', e);
    }
  }

  /** Back to the freshly set-up state. Used by panic and when re-entering a slide. */
  reset(): void {
    this.teardown();
    this.overrides.clear();
    this.triggers = [];
    this.releases = [];
    this.time = 0;
    this.frame = 0;
    this.failed = false;
    this.root.visible = true;
    this.setup();
  }

  destroy(): void {
    this.teardown();
    this.root.destroy({ children: true });
  }
}
