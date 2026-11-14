import { getAnimation } from '../animations';
import type { Deck } from '../deck';
import { formatDuration } from '../shared/util';

export interface PreflightFacts {
  midiConnected: boolean;
  soundEnabled: boolean;
  /** True when sound input is switched on but cannot be heard (blocked, or no device). */
  soundBroken: boolean;
}

/**
 * Things worth knowing the moment a show starts, while there is still time to
 * fix them. Returned as plain sentences; the caller shows them as quiet notices.
 * Nothing here ever stops a show.
 */
export function preflight(deck: Deck, facts: PreflightFacts): string[] {
  const warnings: string[] = [];
  if (!facts.midiConnected) {
    warnings.push(
      'No MIDI keyboard is connected. The computer keyboard still works: → next, ← back, B black, Esc end.',
    );
  }

  const elementIds = new Set<string>();
  let unknown = 0;
  let wantsSound = false;
  for (const slide of deck.slides) {
    for (const el of slide.elements) {
      if (el.type !== 'animation') continue;
      elementIds.add(el.id);
      const def = getAnimation(el.animationId);
      if (!def) {
        unknown += 1;
        continue;
      }
      if (el.hidden) continue;
      if (el.bindings.some((b) => b.source.startsWith('audio'))) wantsSound = true;
      else if (def.listensToSound(def.parseParams(el.params))) wantsSound = true;
    }
  }
  if (facts.soundBroken) {
    warnings.push(
      'Sound input is on but cannot hear anything (blocked, or no input device). Slides that react to sound will stay still.',
    );
  } else if (wantsSound && !facts.soundEnabled) {
    warnings.push('Some slides react to sound, but sound input is off. Press L to switch it on.');
  }
  if (unknown > 0) {
    warnings.push(
      `${unknown} animation${unknown === 1 ? '' : 's'} in this deck ${unknown === 1 ? 'is' : 'are'} not in this version of Stagekeys and will be skipped.`,
    );
  }

  let orphaned = 0;
  for (const m of [...deck.mappings, ...deck.slides.flatMap((s) => s.mappings)]) {
    if (!m.enabled) continue;
    const a = m.action;
    if ((a.type === 'anim.trigger' || a.type === 'anim.setParam') && !elementIds.has(a.elementId))
      orphaned += 1;
    if (a.type === 'nav.gotoNamed' && !deck.slides.some((s) => s.id === a.slideId)) orphaned += 1;
  }
  if (orphaned > 0) {
    warnings.push(
      `${orphaned} mapping${orphaned === 1 ? ' points' : 's point'} at something that no longer exists and will do nothing.`,
    );
  }
  return warnings;
}

export interface TalkClock {
  /** "12:34 left", "00:42 over", or an empty string when the talk has no planned length. */
  text: string;
  state: 'none' | 'ok' | 'soon' | 'over';
}

/** The countdown against the planned talk length. "Soon" is the last tenth, or the last minute if longer. */
export function talkClock(elapsedMs: number, targetMinutes: number): TalkClock {
  if (!(targetMinutes > 0)) return { text: '', state: 'none' };
  const targetMs = targetMinutes * 60_000;
  const remaining = targetMs - Math.max(0, elapsedMs);
  if (remaining < 0) return { text: `${formatDuration(-remaining)} over`, state: 'over' };
  const soon = remaining <= Math.max(60_000, targetMs * 0.1);
  return { text: `${formatDuration(remaining)} left`, state: soon ? 'soon' : 'ok' };
}
