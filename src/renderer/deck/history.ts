import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Entries with the same key that arrive close together merge into one undo step. */
  coalesceKey: string | null;
  at: number;
  /** Free-form context restored on undo/redo (e.g. which slide was showing). */
  context: string | null;
}

export interface ExecOptions {
  coalesceKey?: string;
  /** How long after the previous matching edit a merge is still allowed. Gestures pass Infinity. */
  coalesceWindowMs?: number;
  context?: string;
}

const COALESCE_WINDOW_MS = 1200;
const MAX_ENTRIES = 500;

/**
 * Undo/redo as a command history. Each command is recorded as Immer patches
 * and their inverses, never as a copy of the whole document.
 */
export class History<T extends object> {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  get size(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Stops the next command from merging into the previous one (call at the end of a gesture). */
  seal(): void {
    const last = this.undoStack.at(-1);
    if (last) last.coalesceKey = null;
  }

  /** Runs a command. Returns the new document, or the same one if the command changed nothing. */
  exec(doc: T, label: string, recipe: (draft: T) => void, options: ExecOptions = {}): T {
    const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
      recipe(draft as T);
    });
    if (patches.length === 0) return doc;

    const at = this.now();
    const key = options.coalesceKey ?? null;
    const last = this.undoStack.at(-1);
    if (
      last &&
      key !== null &&
      last.coalesceKey === key &&
      at - last.at < (options.coalesceWindowMs ?? COALESCE_WINDOW_MS)
    ) {
      last.patches = [...last.patches, ...patches];
      last.inverse = [...inverse, ...last.inverse];
      last.at = at;
    } else {
      this.undoStack.push({
        label,
        patches,
        inverse,
        coalesceKey: key,
        at,
        context: options.context ?? null,
      });
      if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    }
    this.redoStack = [];
    return next as T;
  }

  undo(doc: T): { doc: T; entry: HistoryEntry } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    entry.coalesceKey = null;
    this.redoStack.push(entry);
    return { doc: applyPatches(doc, entry.inverse), entry };
  }

  redo(doc: T): { doc: T; entry: HistoryEntry } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { doc: applyPatches(doc, entry.patches), entry };
  }
}
