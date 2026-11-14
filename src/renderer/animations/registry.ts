import { asciiGarden } from './builtin/asciiGarden';
import { asciiVignette } from './builtin/asciiVignette';
import { bloom } from './builtin/bloom';
import { glyphBurst } from './builtin/glyphBurst';
import { midiReadout } from './builtin/midiReadout';
import { noteTrails } from './builtin/noteTrails';
import { pressedBloom } from './builtin/pressedBloom';
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
const ALL: readonly RegisteredAnimation[] = [
  asciiGarden,
  asciiVignette,
  pressedBloom,
  bloom,
  pulse,
  ripple,
  textReveal,
  stepSequence,
  midiReadout,
  noteTrails,
  glyphBurst,
];

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
