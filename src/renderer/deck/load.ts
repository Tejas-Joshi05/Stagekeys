import { DeckVersionError, migrateDeck } from './migrations';
import { DeckSchema, type Deck } from './schema';

export type DeckLoadResult =
  | { ok: true; deck: Deck; migratedFrom: number | null }
  | { ok: false; error: string; kind: 'json' | 'newer' | 'invalid' };

/** Parse → migrate → validate. Never throws; every failure comes back as a readable message. */
export function parseDeck(text: string): DeckLoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'json', error: 'The deck file is damaged (it is not valid JSON).' };
  }
  let migrated;
  try {
    migrated = migrateDeck(raw);
  } catch (e) {
    if (e instanceof DeckVersionError) {
      return { ok: false, kind: e.kind === 'newer' ? 'newer' : 'invalid', error: e.message };
    }
    return { ok: false, kind: 'invalid', error: e instanceof Error ? e.message : String(e) };
  }
  const parsed = DeckSchema.safeParse(migrated.deck);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? ` (${first.path.join('.') || 'deck'}: ${first.message})` : '';
    return {
      ok: false,
      kind: 'invalid',
      error: `The deck file does not match the expected format${where}.`,
    };
  }
  return {
    ok: true,
    deck: parsed.data,
    migratedFrom: migrated.from === migrated.to ? null : migrated.from,
  };
}

export function serialiseDeck(deck: Deck, now: Date = new Date()): string {
  const out: Deck = { ...deck, meta: { ...deck.meta, updated: now.toISOString() } };
  return JSON.stringify(out, null, 2);
}
