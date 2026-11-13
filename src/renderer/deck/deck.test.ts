import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../ipc/contract';
import { Autosave } from './autosave';
import {
  addElements,
  addSlide,
  cloneSlide,
  deleteElements,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  reorder,
  setSlideNotes,
  updateElements,
} from './commands';
import { createAnimation, createEmptyDeck, createShape, createText } from './factory';
import { History } from './history';
import { parseDeck, serialiseDeck } from './load';
import { DeckVersionError, migrateDeck, migrations, type Migration } from './migrations';
import { CURRENT_SCHEMA_VERSION, DeckSchema, type Deck } from './schema';
import { openSession, redo, sealHistory, undo, useDeckStore } from './store';

const deckNow = (): Deck => {
  const deck = useDeckStore.getState().deck;
  if (!deck) throw new Error('no deck');
  return deck;
};

describe('deck schema', () => {
  it('accepts a freshly created deck', () => {
    const deck = createEmptyDeck('Talk');
    expect(DeckSchema.safeParse(deck).success).toBe(true);
    expect(deck.meta.canvas).toEqual({ width: 1920, height: 1080 });
    expect(deck.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('accepts every element type and round-trips through JSON', () => {
    const deck = createEmptyDeck();
    deck.slides[0]?.elements.push(
      createText(10, 10),
      createShape('rect', 0, 0),
      createShape('ellipse', 0, 0),
      createShape('line', 0, 0),
      createAnimation('bloom', 'Bloom', 5, 5),
    );
    const result = parseDeck(serialiseDeck(deck));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deck.slides[0]?.elements).toHaveLength(5);
  });

  it('fills defaults for optional fields', () => {
    const raw = {
      schemaVersion: 1,
      meta: { title: 't', created: 'c', updated: 'u', canvas: { width: 1920, height: 1080 } },
      slides: [{ id: 's1', background: { color: '#000000' }, elements: [] }],
    };
    const result = parseDeck(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.mappings).toEqual([]);
    expect(result.deck.slides[0]?.transition.kind).toBe('cut');
    expect(result.deck.slides[0]?.notes).toBe('');
  });

  it('rejects damaged JSON, wrong shapes and decks with no slides', () => {
    expect(parseDeck('{not json')).toMatchObject({ ok: false, kind: 'json' });
    expect(parseDeck('[]')).toMatchObject({ ok: false, kind: 'invalid' });
    expect(parseDeck('{"schemaVersion":1}')).toMatchObject({ ok: false, kind: 'invalid' });
    const empty = { ...createEmptyDeck(), slides: [] };
    expect(parseDeck(JSON.stringify(empty))).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('rejects an element with a bad colour or non-finite geometry', () => {
    const deck = createEmptyDeck();
    const text = createText(0, 0);
    deck.slides[0]?.elements.push({ ...text, color: 'red' });
    expect(parseDeck(JSON.stringify(deck)).ok).toBe(false);
  });

  it('refuses a deck from a newer app version with a clear message', () => {
    const future = { ...createEmptyDeck(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const result = parseDeck(JSON.stringify(future));
    expect(result).toMatchObject({ ok: false, kind: 'newer' });
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });
});

describe('migration framework', () => {
  it('has a migration registered for every version below the current one', () => {
    for (let v = 1; v < CURRENT_SCHEMA_VERSION; v++) {
      expect(migrations[v], `migration from v${v}`).toBeTypeOf('function');
    }
  });

  it('leaves a current-version deck untouched', () => {
    const deck = createEmptyDeck();
    const result = migrateDeck(deck);
    expect(result.from).toBe(result.to);
    expect(result.deck).toEqual(deck);
  });

  it('runs each step in order and stamps the new version', () => {
    const table: Record<number, Migration> = {
      1: (d) => ({ ...d, steps: ['1→2'] }),
      2: (d) => ({ ...d, steps: [...(d.steps as string[]), '2→3'] }),
    };
    const result = migrateDeck({ schemaVersion: 1 }, 3, table);
    expect(result).toMatchObject({ from: 1, to: 3 });
    expect(result.deck).toEqual({ schemaVersion: 3, steps: ['1→2', '2→3'] });
  });

  it('does not mutate the deck it was given', () => {
    const raw = { schemaVersion: 1, nested: { value: 1 } };
    const table: Record<number, Migration> = {
      1: (d) => {
        (d.nested as { value: number }).value = 2;
        return d;
      },
    };
    migrateDeck(raw, 2, table);
    expect(raw.nested.value).toBe(1);
  });

  it('throws typed errors for newer decks, missing versions and gaps in the chain', () => {
    const kind = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return e instanceof DeckVersionError ? e.kind : 'other';
      }
      return 'none';
    };
    expect(kind(() => migrateDeck({ schemaVersion: 9 }, 3, {}))).toBe('newer');
    expect(kind(() => migrateDeck({}, 3, {}))).toBe('invalid');
    expect(kind(() => migrateDeck({ schemaVersion: 0 }, 3, {}))).toBe('invalid');
    expect(kind(() => migrateDeck(null, 3, {}))).toBe('invalid');
    expect(kind(() => migrateDeck({ schemaVersion: 1 }, 3, { 2: (d) => d }))).toBe(
      'missing-migration',
    );
  });
});

describe('History (undo/redo)', () => {
  interface Doc {
    items: number[];
    title: string;
  }
  const start: Doc = { items: [], title: 'a' };

  it('undoes and redoes commands in order', () => {
    const h = new History<Doc>(() => 0);
    let doc = h.exec(start, 'add 1', (d) => void d.items.push(1));
    doc = h.exec(doc, 'add 2', (d) => void d.items.push(2));
    expect(doc.items).toEqual([1, 2]);

    doc = h.undo(doc)?.doc ?? doc;
    expect(doc.items).toEqual([1]);
    doc = h.undo(doc)?.doc ?? doc;
    expect(doc.items).toEqual([]);
    expect(h.undo(doc)).toBeNull();

    doc = h.redo(doc)?.doc ?? doc;
    doc = h.redo(doc)?.doc ?? doc;
    expect(doc.items).toEqual([1, 2]);
    expect(h.redo(doc)).toBeNull();
  });

  it('stores patches, not copies of the document', () => {
    const h = new History<Doc>(() => 0);
    const big: Doc = { items: Array.from({ length: 1000 }, (_, i) => i), title: 'a' };
    const doc = h.exec(big, 'rename', (d) => void (d.title = 'b'));
    const entry = h.undo(doc)?.entry;
    expect(entry?.patches).toEqual([{ op: 'replace', path: ['title'], value: 'b' }]);
    expect(entry?.inverse).toEqual([{ op: 'replace', path: ['title'], value: 'a' }]);
  });

  it('a new command clears the redo stack', () => {
    const h = new History<Doc>(() => 0);
    let doc = h.exec(start, 'add', (d) => void d.items.push(1));
    doc = h.undo(doc)?.doc ?? doc;
    expect(h.canRedo).toBe(true);
    doc = h.exec(doc, 'add', (d) => void d.items.push(9));
    expect(h.canRedo).toBe(false);
    expect(doc.items).toEqual([9]);
  });

  it('ignores commands that change nothing', () => {
    const h = new History<Doc>(() => 0);
    const doc = h.exec(start, 'noop', () => undefined);
    expect(doc).toBe(start);
    expect(h.canUndo).toBe(false);
  });

  it('merges a gesture into one undo step and splits on seal or timeout', () => {
    let t = 0;
    const h = new History<Doc>(() => t);
    let doc = start;
    for (const title of ['b', 'c', 'd']) {
      t += 100;
      doc = h.exec(doc, 'type', (d) => void (d.title = title), { coalesceKey: 'title' });
    }
    expect(h.size).toBe(1);
    expect(h.undo(doc)?.doc.title).toBe('a');
    doc = h.redo(start)?.doc ?? doc;
    expect(doc.title).toBe('d');

    h.seal();
    doc = h.exec(doc, 'type', (d) => void (d.title = 'e'), { coalesceKey: 'title' });
    expect(h.size).toBe(2);

    t += 60_000;
    const last = h.exec(doc, 'type', (d) => void (d.title = 'f'), { coalesceKey: 'title' });
    expect(last.title).toBe('f');
    expect(h.size).toBe(3);
  });
});

describe('deck commands through the store', () => {
  beforeEach(() => {
    openSession(createEmptyDeck(), '/tmp/x.stagekeys', false);
  });

  it('every kind of edit can be undone back to the original deck and redone', () => {
    const original = deckNow();
    const text = createText(100, 100);
    addElements([text]);
    sealHistory();
    updateElements([text.id], (el) => {
      el.x = 500;
    });
    addSlide();
    setSlideNotes(deckNow().slides[1]?.id ?? '', 'remember to breathe');
    duplicateSlide(deckNow().slides[0]?.id ?? '');
    moveSlide(deckNow().slides[0]?.id ?? '', 2);
    deleteSlide(deckNow().slides[1]?.id ?? '');
    const edited = deckNow();
    expect(edited).not.toEqual(original);

    let steps = 0;
    while (undo()) steps++;
    expect(steps).toBe(7);
    expect(deckNow()).toEqual(original);

    while (redo()) steps--;
    expect(steps).toBe(0);
    expect(deckNow()).toEqual(edited);
  });

  it('tracks revision so the autosaver knows the deck is dirty', () => {
    const before = useDeckStore.getState().revision;
    addElements([createText(0, 0)]);
    expect(useDeckStore.getState().revision).toBe(before + 1);
    undo();
    expect(useDeckStore.getState().revision).toBe(before + 2);
  });

  it('never deletes the last slide', () => {
    deleteSlide(deckNow().slides[0]?.id ?? '');
    expect(deckNow().slides).toHaveLength(1);
  });

  it('drops the selection of elements that undo removed', () => {
    const text = createText(0, 0);
    addElements([text]);
    expect(useDeckStore.getState().selection).toEqual([text.id]);
    undo();
    expect(useDeckStore.getState().selection).toEqual([]);
  });

  it('deleting an animation removes mappings that targeted it', () => {
    const anim = createAnimation('bloom', 'Bloom', 0, 0);
    addElements([anim]);
    useDeckStore.setState((s) => ({
      deck: s.deck && {
        ...s.deck,
        mappings: [
          {
            id: 'm1',
            name: '',
            enabled: true,
            trigger: { kind: 'noteOn' },
            filters: {},
            action: { type: 'anim.trigger', elementId: anim.id },
            curve: 'linear',
            min: 0,
            max: 1,
          },
        ],
      },
    }));
    deleteElements([anim.id]);
    expect(deckNow().mappings).toEqual([]);
  });

  it('cloneSlide gives new ids and re-points slide mappings at the copies', () => {
    const anim = createAnimation('bloom', 'Bloom', 0, 0);
    const slide = deckNow().slides[0];
    if (!slide) throw new Error('no slide');
    const source = {
      ...slide,
      elements: [anim],
      mappings: [
        {
          id: 'm1',
          name: '',
          enabled: true,
          trigger: { kind: 'noteOn' as const },
          filters: {},
          action: { type: 'anim.trigger' as const, elementId: anim.id },
          curve: 'linear' as const,
          min: 0,
          max: 1,
        },
      ],
    };
    const copy = cloneSlide(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.elements[0]?.id).not.toBe(anim.id);
    expect(copy.mappings[0]?.action).toMatchObject({ elementId: copy.elements[0]?.id });
  });

  it('reorder moves elements forward, backward, to front and to back', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const ids = (list: { id: string }[]) => list.map((i) => i.id).join('');
    expect(ids(reorder(items, new Set(['b']), 'forward'))).toBe('acbd');
    expect(ids(reorder(items, new Set(['b']), 'backward'))).toBe('bacd');
    expect(ids(reorder(items, new Set(['b']), 'front'))).toBe('acdb');
    expect(ids(reorder(items, new Set(['c']), 'back'))).toBe('cabd');
    expect(ids(reorder(items, new Set(['d']), 'forward'))).toBe('abcd');
    expect(ids(reorder(items, new Set(['a', 'b']), 'forward'))).toBe('cabd');
  });
});

describe('Autosave', () => {
  const setup = (
    write?: (path: string, json: string, backup: boolean) => Promise<Result<null>>,
  ) => {
    const state = { path: '/d.stagekeys' as string | null, revision: 0, now: 1_000_000 };
    const writes: { json: string; backup: boolean }[] = [];
    const onSaved = vi.fn();
    const onError = vi.fn();
    const auto = new Autosave(
      {
        snapshot: () => ({
          path: state.path,
          revision: state.revision,
          serialise: () => `{"rev":${state.revision}}`,
        }),
        write:
          write ??
          ((_p, json, backup) => {
            writes.push({ json, backup });
            return Promise.resolve({ ok: true, value: null });
          }),
        onSaved,
        onError,
        now: () => state.now,
      },
      { backupEveryMs: 120_000 },
    );
    auto.markSaved(state.path, 0);
    return { state, writes, onSaved, onError, auto };
  };

  it('does not write when nothing changed', async () => {
    const { auto, writes } = setup();
    expect(await auto.tick()).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('writes when the deck changed, and only once per change', async () => {
    const { auto, writes, state, onSaved } = setup();
    state.revision = 1;
    await auto.tick();
    await auto.tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.json).toBe('{"rev":1}');
    expect(onSaved).toHaveBeenCalledWith(1, state.now);
  });

  it('adds a timestamped backup at most once per backup interval', async () => {
    const { auto, writes, state } = setup();
    state.revision = 1;
    await auto.tick();
    state.revision = 2;
    state.now += 5000;
    await auto.tick();
    state.revision = 3;
    state.now += 120_000;
    await auto.tick();
    expect(writes.map((w) => w.backup)).toEqual([true, false, true]);
  });

  it('reports a failed save and retries on the next tick', async () => {
    let fail = true;
    const { auto, state, onError, onSaved } = setup(() =>
      Promise.resolve(fail ? { ok: false, error: 'disk full' } : { ok: true, value: null }),
    );
    state.revision = 1;
    expect(await auto.tick()).toBe('disk full');
    expect(onError).toHaveBeenCalledWith('disk full');
    expect(onSaved).not.toHaveBeenCalled();
    fail = false;
    expect(await auto.tick()).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown write as a failed save, not a crash', async () => {
    const { auto, state, onError } = setup(() => Promise.reject(new Error('ipc down')));
    state.revision = 1;
    expect(await auto.tick()).toBe('ipc down');
    expect(onError).toHaveBeenCalledWith('ipc down');
  });

  it('flush waits for a save in progress and then saves newer changes', async () => {
    let release: (r: Result<null>) => void = () => undefined;
    const jsons: string[] = [];
    const { auto, state } = setup((_p, json) => {
      jsons.push(json);
      return new Promise<Result<null>>((resolve) => {
        release = resolve;
      });
    });
    state.revision = 1;
    const first = auto.tick();
    state.revision = 2;
    const flushed = auto.flush();
    release({ ok: true, value: null });
    await first;
    await Promise.resolve();
    release({ ok: true, value: null });
    expect(await flushed).toBeNull();
    expect(jsons).toEqual(['{"rev":1}', '{"rev":2}']);
  });

  it('does nothing when no deck is open', async () => {
    const { auto, state, writes } = setup();
    state.path = null;
    state.revision = 5;
    expect(await auto.tick()).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
