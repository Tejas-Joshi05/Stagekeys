import type { Result } from '../../ipc/contract';

export interface AutosaveSnapshot {
  path: string | null;
  revision: number;
  /** Serialises the deck. Called only when a write is actually going to happen. */
  serialise: () => string;
}

export interface AutosaveDeps {
  snapshot: () => AutosaveSnapshot;
  write: (path: string, json: string, backup: boolean) => Promise<Result<null>>;
  onSaved: (revision: number, at: number) => void;
  onError: (message: string) => void;
  now?: () => number;
}

export interface AutosaveOptions {
  intervalMs?: number;
  backupEveryMs?: number;
}

/**
 * Saves the deck every few seconds when it has changed, and writes a
 * timestamped backup every couple of minutes. A failed save is reported and
 * retried on the next tick; it is never dropped silently.
 */
export class Autosave {
  private readonly deps: AutosaveDeps;
  private readonly intervalMs: number;
  private readonly backupEveryMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<string | null> | null = null;
  private savedRevision = -1;
  private savedPath: string | null = null;
  private lastBackupAt = 0;

  constructor(deps: AutosaveDeps, options: AutosaveOptions = {}) {
    this.deps = deps;
    this.intervalMs = options.intervalMs ?? 5000;
    this.backupEveryMs = options.backupEveryMs ?? 120_000;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tells the autosaver what is already on disk (after open, new, or save as). */
  markSaved(path: string | null, revision: number): void {
    this.savedPath = path;
    this.savedRevision = revision;
    this.lastBackupAt = 0;
  }

  /** Saves if needed. Resolves to an error message, or null when the deck is safely on disk. */
  tick(forceBackup = false): Promise<string | null> {
    if (this.inFlight) return this.inFlight;
    const run = this.save(forceBackup).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** Waits for any save in progress, then saves whatever is still unsaved. */
  async flush(forceBackup = false): Promise<string | null> {
    if (this.inFlight) await this.inFlight;
    return this.tick(forceBackup);
  }

  private async save(forceBackup: boolean): Promise<string | null> {
    const now = this.deps.now ?? (() => Date.now());
    const snap = this.deps.snapshot();
    if (!snap.path) return null;
    const dirty = snap.revision !== this.savedRevision || snap.path !== this.savedPath;
    if (!dirty && !forceBackup) return null;

    const backup = forceBackup || now() - this.lastBackupAt >= this.backupEveryMs;
    let result: Result<null>;
    try {
      result = await this.deps.write(snap.path, snap.serialise(), backup);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!result.ok) {
      this.deps.onError(result.error);
      return result.error;
    }
    this.savedRevision = snap.revision;
    this.savedPath = snap.path;
    if (backup) this.lastBackupAt = now();
    this.deps.onSaved(snap.revision, now());
    return null;
  }
}
