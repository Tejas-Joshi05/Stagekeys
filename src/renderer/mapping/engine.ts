import type { Action, ActionSource } from '../actions';
import type { MidiBus } from '../midi';
import { ChordTracker } from './chords';
import type { ControlPicker } from './controls';
import type { LearnSession } from './learn';
import { actionFor, resolveMappings } from './match';
import type { Mapping } from './types';

export interface MappingEngineOptions {
  bus: MidiBus;
  dispatch: (action: Action, source: ActionSource) => boolean;
  /** Called per message, so it must be cheap: return the current arrays, do not build new ones. */
  getMappings: () => { slide: readonly Mapping[]; global: readonly Mapping[] };
  learn?: LearnSession;
  /** While picking by pressing, controls select themselves in the editor instead of acting. */
  picker?: ControlPicker;
  /** Return false to ignore MIDI entirely (e.g. while this window is not driving the show). */
  isActive?: () => boolean;
}

/**
 * One-off actions that must not fire twice for what was one press: a second
 * "next slide" skips a slide, a second toggle undoes the first. Keyboards that
 * send a press twice, a bouncing pad, and two mappings that both match are all
 * caught here.
 */
const ONCE_PER_PRESS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'nav.next',
  'nav.prev',
  'nav.goto',
  'nav.gotoNamed',
  'show.blackToggle',
  'show.panic',
  'audio.togglePiano',
  'audio.toggleInput',
  'view.toggleKeys',
]);
/** Longer than any echo or bounce, shorter than anyone presses twice on purpose. */
export const REPEAT_GUARD_MS = 140;

/**
 * Connects the MIDI bus to the action system. Runs synchronously on message
 * arrival so navigation feels instant, and marks messages it used as consumed
 * so animations do not also react to navigation keys.
 */
export function startMappingEngine(options: MappingEngineOptions): () => void {
  const chords = new ChordTracker();
  const lastFired = new Map<Action['type'], number>();
  return options.bus.subscribe((message, previousCc) => {
    // Always, even while idle or learning, so the keys held are never out of date.
    chords.track(message);
    if (options.isActive && !options.isActive()) return;
    if (options.learn?.offer(message) || options.picker?.offer(message)) {
      message.consumed = true;
      return;
    }
    const { slide, global } = options.getMappings();
    const matches = resolveMappings(message, previousCc, slide, global, chords);
    if (matches.length === 0) return;
    message.consumed = true;
    for (const match of matches) {
      const action = actionFor(match);
      if (ONCE_PER_PRESS.has(action.type)) {
        const last = lastFired.get(action.type);
        if (last !== undefined && Math.abs(message.time - last) < REPEAT_GUARD_MS) continue;
        lastFired.set(action.type, message.time);
      }
      options.dispatch(action, 'midi');
    }
  });
}
