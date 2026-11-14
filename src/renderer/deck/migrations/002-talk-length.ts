import type { Migration } from './index';

/**
 * Version 2 → 3. Adds `meta.targetMinutes`, the planned length of the talk.
 * Older decks have no plan, which is 0: the presenter view only counts up.
 */
export const talkLength: Migration = (deck) => {
  const meta = deck.meta;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return deck;
  const existing = (meta as Record<string, unknown>).targetMinutes;
  return {
    ...deck,
    meta: { ...meta, targetMinutes: typeof existing === 'number' ? existing : 0 },
  };
};
