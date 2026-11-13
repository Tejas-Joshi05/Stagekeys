import { bloom } from './builtin/bloom';
import { pulse } from './builtin/pulse';
import { ripple } from './builtin/ripple';
import { stepSequence } from './builtin/stepSequence';
import { textReveal } from './builtin/textReveal';
import type { RegisteredAnimation } from './define';

/**
 * Every animation the app knows about. To add one: create a file in
 * ./builtin that exports a `defineAnimation(...)` result and add it to this
 * list. Nothing else needs to change. See docs/ADDING_ANIMATIONS.md.
 */
const ALL: readonly RegisteredAnimation[] = [bloom, pulse, ripple, textReveal, stepSequence];

const byId = new Map<string, RegisteredAnimation>();
for (const animation of ALL) {
  if (byId.has(animation.id)) throw new Error(`Duplicate animation id: ${animation.id}`);
  byId.set(animation.id, animation);
}

export function listAnimations(): readonly RegisteredAnimation[] {
  return ALL;
}

export function getAnimation(id: string): RegisteredAnimation | undefined {
  return byId.get(id);
}
