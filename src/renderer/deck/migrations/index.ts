/**
 * Deck migrations.
 *
 * `migrations[n]` upgrades a deck from schema version n to n + 1. Each one is
 * a pure function over plain JSON, lives in its own numbered file, and has a
 * test with a fixture deck so old decks keep opening in new versions.
 *
 * To add one: create `NNN-short-name.ts` exporting a Migration, register it
 * below under the version it upgrades FROM, bump CURRENT_SCHEMA_VERSION in
 * ../schema.ts, and add a fixture plus a test.
 */
import { CURRENT_SCHEMA_VERSION } from '../schema';
import { audioBindings } from './001-audio-bindings';

export type Migration = (deck: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being upgraded FROM. Version 1 is the first released schema. */
export const migrations: Readonly<Record<number, Migration>> = { 1: audioBindings };

export class DeckVersionError extends Error {
  constructor(
    message: string,
    readonly kind: 'newer' | 'invalid' | 'missing-migration',
  ) {
    super(message);
    this.name = 'DeckVersionError';
  }
}

export interface MigrationResult {
  deck: Record<string, unknown>;
  from: number;
  to: number;
}

/**
 * Brings raw deck JSON up to the target version. Never mutates its input.
 * Throws DeckVersionError for decks from a newer app, decks without a usable
 * version, and gaps in the migration chain.
 */
export function migrateDeck(
  raw: unknown,
  target: number = CURRENT_SCHEMA_VERSION,
  table: Readonly<Record<number, Migration>> = migrations,
): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DeckVersionError('The deck file does not contain a deck.', 'invalid');
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DeckVersionError('The deck file has no valid schema version.', 'invalid');
  }
  if (version > target) {
    throw new DeckVersionError(
      `This deck was saved by a newer version of Stagekeys (deck format ${version}, this app reads up to ${target}). Update Stagekeys to open it. The deck has not been changed.`,
      'newer',
    );
  }
  let deck = structuredClone(raw) as Record<string, unknown>;
  for (let v = version; v < target; v++) {
    const step = table[v];
    if (!step) {
      throw new DeckVersionError(
        `No migration is registered from deck format ${v} to ${v + 1}.`,
        'missing-migration',
      );
    }
    deck = { ...step(deck), schemaVersion: v + 1 };
  }
  return { deck, from: version, to: target };
}
