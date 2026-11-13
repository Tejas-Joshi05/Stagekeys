/**
 * Deck bundle file operations. Deliberately free of Electron imports so it can
 * be unit-tested under plain Node.
 *
 * A bundle is a folder:  <name>.stagekeys/{deck.json, assets/, backups/}
 */
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DECK_EXTENSION,
  err,
  ok,
  type BackupInfo,
  type DraftInfo,
  type ImportedAsset,
  type Result,
} from '../ipc/contract';

export const DECK_JSON = 'deck.json';
export const ASSETS_DIR = 'assets';
export const BACKUPS_DIR = 'backups';
export const MAX_BACKUPS = 20;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
export const IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT).map((e) => e.slice(1));

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function isBundlePath(p: string): boolean {
  return path.isAbsolute(p) && p.endsWith(DECK_EXTENSION);
}

/** Write to a temp file in the same folder, flush it to disk, then rename over the target. */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
  } catch (e) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/** Serialises operations per key so two writes to one deck can never interleave. */
const queues = new Map<string, Promise<unknown>>();
export function serialised<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tail = next.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

export function backupName(date: Date): string {
  return `deck-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

export async function pruneBackups(bundle: string, keep = MAX_BACKUPS): Promise<void> {
  const dir = path.join(bundle, BACKUPS_DIR);
  const names = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.startsWith('deck-') && n.endsWith('.json'))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    await fs.unlink(path.join(dir, name)).catch(() => undefined);
  }
}

export function writeDeck(
  bundle: string,
  json: string,
  backup: boolean,
  now: () => Date = () => new Date(),
): Promise<Result<null>> {
  return serialised(bundle, async () => {
    try {
      if (!isBundlePath(bundle)) return err(`Not a deck bundle path: ${bundle}`);
      // Refuse to persist something that is not valid JSON; a broken deck.json is worse than a stale one.
      JSON.parse(json);
      await fs.mkdir(path.join(bundle, ASSETS_DIR), { recursive: true });
      await atomicWrite(path.join(bundle, DECK_JSON), json);
      if (backup) {
        await fs.mkdir(path.join(bundle, BACKUPS_DIR), { recursive: true });
        await atomicWrite(path.join(bundle, BACKUPS_DIR, backupName(now())), json);
        await pruneBackups(bundle);
      }
      return ok(null);
    } catch (e) {
      return err(message(e));
    }
  });
}

export async function readDeck(bundle: string): Promise<Result<string>> {
  try {
    if (!isBundlePath(bundle)) return err(`Not a deck bundle path: ${bundle}`);
    return ok(await fs.readFile(path.join(bundle, DECK_JSON), 'utf8'));
  } catch (e) {
    return err(message(e));
  }
}

export async function listBackups(bundle: string): Promise<BackupInfo[]> {
  const dir = path.join(bundle, BACKUPS_DIR);
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(
    (n) => n.startsWith('deck-') && n.endsWith('.json'),
  );
  const out: BackupInfo[] = [];
  for (const name of names) {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat) out.push({ name, modified: stat.mtimeMs });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export async function readBackup(bundle: string, name: string): Promise<Result<string>> {
  try {
    return ok(await fs.readFile(path.join(bundle, BACKUPS_DIR, path.basename(name)), 'utf8'));
  } catch (e) {
    return err(message(e));
  }
}

export async function createDraft(draftsDir: string, json: string): Promise<Result<string>> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundle = path.join(
    draftsDir,
    `Untitled-${stamp}-${randomBytes(2).toString('hex')}${DECK_EXTENSION}`,
  );
  const written = await writeDeck(bundle, json, false);
  return written.ok ? ok(bundle) : err(written.error);
}

export async function listDrafts(draftsDir: string): Promise<DraftInfo[]> {
  const names = await fs.readdir(draftsDir).catch(() => [] as string[]);
  const out: DraftInfo[] = [];
  for (const name of names) {
    if (!name.endsWith(DECK_EXTENSION)) continue;
    const bundle = path.join(draftsDir, name);
    const file = path.join(bundle, DECK_JSON);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) continue;
    let title = 'Untitled';
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'meta' in parsed) {
        const meta = (parsed as { meta?: { title?: unknown } }).meta;
        if (typeof meta?.title === 'string') title = meta.title;
      }
    } catch {
      title = 'Unreadable draft';
    }
    out.push({ path: bundle, title, modified: stat.mtimeMs });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export async function deleteDraft(draftsDir: string, bundle: string): Promise<Result<null>> {
  try {
    const resolved = path.resolve(bundle);
    if (!resolved.startsWith(path.resolve(draftsDir) + path.sep) || !isBundlePath(resolved)) {
      return err('Refusing to delete a folder outside the drafts directory.');
    }
    await fs.rm(resolved, { recursive: true, force: true });
    return ok(null);
  } catch (e) {
    return err(message(e));
  }
}

export function copyBundle(from: string, to: string): Promise<Result<null>> {
  return serialised(from, async () => {
    try {
      if (!isBundlePath(from) || !isBundlePath(to)) return err('Not a deck bundle path.');
      if (path.resolve(from) === path.resolve(to)) return ok(null);
      await fs.mkdir(to, { recursive: true });
      await fs.cp(from, to, { recursive: true, force: true });
      return ok(null);
    } catch (e) {
      return err(message(e));
    }
  });
}

export async function importAsset(bundle: string, source: string): Promise<Result<ImportedAsset>> {
  try {
    const ext = path.extname(source).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return err(`Unsupported image type: ${ext || 'unknown'}`);
    const bytes = await fs.readFile(source);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const file = `${hash}${ext}`;
    const dir = path.join(bundle, ASSETS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, file);
    const exists = await fs.stat(target).catch(() => null);
    if (!exists) await atomicWrite(target, bytes);
    return ok({ file, mime, originalName: path.basename(source) });
  } catch (e) {
    return err(message(e));
  }
}

export async function readAsset(bundle: string, file: string): Promise<Result<Uint8Array>> {
  try {
    if (!isBundlePath(bundle)) return err('Not a deck bundle path.');
    const bytes = await fs.readFile(path.join(bundle, ASSETS_DIR, path.basename(file)));
    return ok(new Uint8Array(bytes));
  } catch (e) {
    return err(message(e));
  }
}
