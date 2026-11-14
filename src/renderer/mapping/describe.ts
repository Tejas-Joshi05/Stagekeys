import { ACTION_LABELS, type Action } from '../actions';

/** How to name the things an action points at. Supplied by whoever holds the deck. */
export interface ActionNames {
  /** Name of the animation element with this id, or null if it no longer exists. */
  animation: (elementId: string) => string | null;
  /** Position and name of the slide with this id, or null if it no longer exists. */
  slide: (slideId: string) => { index: number; name: string } | null;
}

/** What a mapped action does, as a short plain sentence: "Next slide", "Play ASCII garden". */
export function describeAction(action: Action, names: ActionNames): string {
  switch (action.type) {
    case 'nav.goto':
      return `Go to slide ${action.index + 1}`;
    case 'nav.gotoNamed': {
      const slide = names.slide(action.slideId);
      return slide
        ? `Go to “${slide.name || `slide ${slide.index + 1}`}”`
        : 'Go to a missing slide';
    }
    case 'anim.trigger':
      return `Play ${names.animation(action.elementId) ?? 'a missing animation'}`;
    case 'anim.setParam':
      return `Change ${action.param} of ${names.animation(action.elementId) ?? 'a missing animation'}`;
    default:
      return (ACTION_LABELS as Record<string, string>)[action.type] ?? action.type;
  }
}
