import type { ControllerProfile } from '../../ipc/settings';
import { controlsFor, getAnimation } from '../animations';
import type { AnimationElement, Binding, Deck } from '../deck';
import { describeAction, describeInput, type ActionNames } from '../mapping';
import { MOD_CC } from '../midi';
import { noteName } from '../shared/util';

/** One line of "what does what" for the slide on screen. */
export interface CheatLine {
  /** The control: "Pad 1", "Knob 3", "Keys", "Sound: bass". */
  input: string;
  /** What it does: "Next slide", "Wind of ASCII garden". */
  does: string;
  /** True for things that only apply on this slide; false for whole-deck mappings. */
  here: boolean;
}

const SOUND_NAMES: Partial<Record<Binding['source'], string>> = {
  audioLevel: 'Sound: loudness',
  audioBass: 'Sound: bass',
  audioMid: 'Sound: middle',
  audioTreble: 'Sound: treble',
  audioBeat: 'Sound: beats',
};

function bindingInput(binding: Binding, profile: ControllerProfile): string {
  switch (binding.source) {
    case 'velocity':
      return 'How hard you play';
    case 'note':
      return 'Which key you play';
    case 'pitchBend':
      return 'Pitch wheel';
    case 'cc': {
      if (binding.controller === MOD_CC) return 'Mod wheel';
      const knob = profile.knobCCs.indexOf(binding.controller);
      return knob >= 0 ? `Knob ${knob + 1}` : `CC ${binding.controller}`;
    }
    default:
      return SOUND_NAMES[binding.source] ?? 'Sound';
  }
}

const animationName = (el: AnimationElement): string =>
  el.name || getAnimation(el.animationId)?.name || 'animation';

function keysInput(el: AnimationElement, deck: Deck): string | null {
  const listen = el.listen;
  switch (listen.mode) {
    case 'none':
      return null;
    case 'all':
      return 'Keys';
    case 'range':
      return `Keys ${noteName(Math.min(listen.from, listen.to))}–${noteName(Math.max(listen.from, listen.to))}`;
    case 'zone': {
      const zone = deck.zones.find((z) => z.id === listen.zoneId);
      return zone ? `Keys in “${zone.name}”` : null;
    }
  }
}

/**
 * Everything the controller does on one slide, in plain words, for the
 * presenter view: this slide's mappings first, then what its animations react
 * to, then the mappings that work on every slide.
 */
export function cheatSheet(
  deck: Deck,
  slideIndex: number,
  profile: ControllerProfile,
): CheatLine[] {
  const slide = deck.slides[slideIndex];
  if (!slide) return [];
  const names: ActionNames = {
    animation: (id) => {
      for (const s of deck.slides) {
        const el = s.elements.find((e) => e.id === id);
        if (el?.type === 'animation') return animationName(el);
      }
      return null;
    },
    slide: (id) => {
      const index = deck.slides.findIndex((s) => s.id === id);
      return index < 0 ? null : { index, name: deck.slides[index]?.name ?? '' };
    },
  };
  const lines: CheatLine[] = [];
  for (const m of slide.mappings) {
    if (m.enabled)
      lines.push({
        input: describeInput(m, profile),
        does: describeAction(m.action, names),
        here: true,
      });
  }
  for (const el of slide.elements) {
    if (el.type !== 'animation' || el.hidden) continue;
    const def = getAnimation(el.animationId);
    if (!def) continue;
    const name = animationName(el);
    const keys = keysInput(el, deck);
    if (keys) lines.push({ input: keys, does: `Play ${name}`, here: true });
    const labels = controlsFor(def);
    for (const binding of el.bindings) {
      const label = labels.find((c) => c.key === binding.param)?.label ?? binding.param;
      lines.push({
        input: bindingInput(binding, profile),
        does: `${label} of ${name}`,
        here: true,
      });
    }
  }
  for (const m of deck.mappings) {
    if (m.enabled)
      lines.push({
        input: describeInput(m, profile),
        does: describeAction(m.action, names),
        here: false,
      });
  }
  return lines;
}
