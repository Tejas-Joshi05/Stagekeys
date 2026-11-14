import type { Migration } from './index';

/**
 * Version 3 → 4. Version 4 adds chord triggers to mappings and eight more
 * slide transitions, five of them drawn in character cells. A transition
 * gains two settings for those: `cell` (cell size) and `glyphs` (character
 * set). Older slides get the defaults; their kind and duration are untouched.
 * No version 3 mapping needs rewriting.
 */
export const chordsAndTransitions: Migration = (deck) => {
  if (!Array.isArray(deck.slides)) return deck;
  return {
    ...deck,
    slides: deck.slides.map((slide: unknown) => {
      if (typeof slide !== 'object' || slide === null || Array.isArray(slide)) return slide;
      const transition = (slide as Record<string, unknown>).transition;
      if (typeof transition !== 'object' || transition === null || Array.isArray(transition)) {
        return slide;
      }
      const t = transition as Record<string, unknown>;
      return {
        ...slide,
        transition: {
          ...t,
          cell: typeof t.cell === 'number' ? t.cell : 40,
          glyphs: typeof t.glyphs === 'string' ? t.glyphs : 'riso',
        },
      };
    }),
  };
};
