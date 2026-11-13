import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  atomicWrite,
  copyBundle,
  createDraft,
  deleteDraft,
  importAsset,
  listBackups,
  listDrafts,
  MAX_BACKUPS,
  readAsset,
  readBackup,
  readDeck,
  writeDeck,
} from './deckFiles';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stagekeys-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bundle = (name = 'talk') => path.join(dir, `${name}.stagekeys`);

describe('atomic writes', () => {
  it('writes the file and leaves no temp files behind', async () => {
    const file = path.join(dir, 'a.json');
    await atomicWrite(file, '{"a":1}');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the previous file intact when the write fails', async () => {
    const file = path.join(dir, 'a.json');
    await atomicWrite(file, 'good');
    await expect(atomicWrite(path.join(dir, 'missing-folder', 'a.json'), 'x')).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('good');
  });
});

describe('saving and reopening a deck bundle', () => {
  it('saves, then reads back the same content', async () => {
    expect(await writeDeck(bundle(), '{"schemaVersion":1}', false)).toEqual({
      ok: true,
      value: null,
    });
    expect(await readDeck(bundle())).toEqual({ ok: true, value: '{"schemaVersion":1}' });
    expect(await readdir(bundle())).toContain('assets');
  });

  it('refuses to overwrite deck.json with invalid JSON', async () => {
    await writeDeck(bundle(), '{"ok":true}', false);
    const result = await writeDeck(bundle(), '{broken', false);
    expect(result.ok).toBe(false);
    expect(await readDeck(bundle())).toEqual({ ok: true, value: '{"ok":true}' });
  });

  it('rejects paths that are not deck bundles', async () => {
    expect((await writeDeck(path.join(dir, 'plain-folder'), '{}', false)).ok).toBe(false);
    expect((await readDeck('relative.stagekeys')).ok).toBe(false);
  });

  it('reports a missing deck as an error result, not an exception', async () => {
    expect((await readDeck(bundle('nope'))).ok).toBe(false);
  });

  it('keeps concurrent saves in order so the last one wins', async () => {
    const writes = Array.from({ length: 20 }, (_, i) => writeDeck(bundle(), `{"n":${i}}`, false));
    const results = await Promise.all(writes);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await readDeck(bundle())).toEqual({ ok: true, value: '{"n":19}' });
  });
});

describe('backups and recovery', () => {
  it('writes timestamped backups and keeps only the newest N', async () => {
    let t = Date.UTC(2026, 10, 13);
    const total = MAX_BACKUPS + 5;
    for (let i = 0; i < total; i++) {
      t += 60_000;
      await writeDeck(bundle(), `{"n":${i}}`, true, () => new Date(t));
    }
    const backups = await listBackups(bundle());
    expect(backups).toHaveLength(MAX_BACKUPS);
    const newest = backups[0];
    if (!newest) throw new Error('no backups');
    expect(await readBackup(bundle(), newest.name)).toEqual({
      ok: true,
      value: `{"n":${total - 1}}`,
    });
  });

  it('can recover from a backup when deck.json is damaged', async () => {
    await writeDeck(bundle(), '{"good":true}', true);
    await writeFile(path.join(bundle(), 'deck.json'), '{"trunc');
    const backups = await listBackups(bundle());
    const newest = backups[0];
    if (!newest) throw new Error('no backups');
    expect(await readBackup(bundle(), newest.name)).toEqual({ ok: true, value: '{"good":true}' });
  });

  it('readBackup cannot escape the backups folder', async () => {
    await writeDeck(bundle(), '{"secret":1}', false);
    expect((await readBackup(bundle(), '../deck.json')).ok).toBe(false);
  });
});

describe('drafts', () => {
  it('creates, lists and deletes drafts', async () => {
    const drafts = path.join(dir, 'drafts');
    const created = await createDraft(drafts, '{"meta":{"title":"My Talk"}}');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const listed = await listDrafts(drafts);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ path: created.value, title: 'My Talk' });

    expect((await deleteDraft(drafts, created.value)).ok).toBe(true);
    expect(await listDrafts(drafts)).toEqual([]);
  });

  it('refuses to delete anything outside the drafts folder', async () => {
    await writeDeck(bundle('precious'), '{}', false);
    const result = await deleteDraft(path.join(dir, 'drafts'), bundle('precious'));
    expect(result.ok).toBe(false);
    expect((await readDeck(bundle('precious'))).ok).toBe(true);
  });
});

describe('save as and assets', () => {
  it('copies the whole bundle including assets', async () => {
    await writeDeck(bundle('a'), '{"n":1}', false);
    const image = path.join(dir, 'pic.png');
    await writeFile(image, Buffer.from([1, 2, 3, 4]));
    const asset = await importAsset(bundle('a'), image);
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;

    expect((await copyBundle(bundle('a'), bundle('b'))).ok).toBe(true);
    expect(await readDeck(bundle('b'))).toEqual({ ok: true, value: '{"n":1}' });
    const bytes = await readAsset(bundle('b'), asset.value.file);
    expect(bytes.ok && [...bytes.value]).toEqual([1, 2, 3, 4]);
  });

  it('names assets by content hash so the same image is stored once', async () => {
    await writeDeck(bundle(), '{}', false);
    const one = path.join(dir, 'one.png');
    const two = path.join(dir, 'two.png');
    await writeFile(one, Buffer.from([9, 9, 9]));
    await writeFile(two, Buffer.from([9, 9, 9]));
    const a = await importAsset(bundle(), one);
    const b = await importAsset(bundle(), two);
    expect(a.ok && b.ok && a.value.file === b.value.file).toBe(true);
    expect(await readdir(path.join(bundle(), 'assets'))).toHaveLength(1);
  });

  it('rejects unsupported file types', async () => {
    const file = path.join(dir, 'notes.txt');
    await writeFile(file, 'hi');
    expect((await importAsset(bundle(), file)).ok).toBe(false);
  });
});
