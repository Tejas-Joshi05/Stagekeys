import type { Action, ActionOf, ActionSource, ActionType } from './types';

type AnyHandler = (action: Action, source: ActionSource) => void;
type ErrorSink = (action: Action, error: unknown) => void;

/** A menu accelerator and a keydown for the same shortcut can both arrive; only act once. */
const DUPLICATE_WINDOW_MS = 60;

export class ActionDispatcher {
  private readonly handlers = new Map<ActionType, Set<AnyHandler>>();
  private readonly observers = new Set<AnyHandler>();
  private last: { type: ActionType; source: ActionSource; at: number } | null = null;
  private onError: ErrorSink = () => undefined;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  setErrorSink(sink: ErrorSink): void {
    this.onError = sink;
  }

  /** Registers a handler for one action type. Returns a function that removes it. */
  register<T extends ActionType>(
    type: T,
    handler: (action: ActionOf<T>, source: ActionSource) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped: AnyHandler = (action, source) => handler(action as ActionOf<T>, source);
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  /** Observers see every dispatched action (used by logging and tests). */
  observe(observer: AnyHandler): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * The single entry point for behaviour. Never throws: a failing handler is
   * reported to the error sink and the remaining handlers still run.
   * Returns true if at least one handler ran.
   */
  dispatch(action: Action, source: ActionSource): boolean {
    const at = this.now();
    const last = this.last;
    const pairedSources =
      (source === 'menu' && last?.source === 'keyboard') ||
      (source === 'keyboard' && last?.source === 'menu');
    if (last && pairedSources && last.type === action.type && at - last.at < DUPLICATE_WINDOW_MS) {
      return false;
    }
    this.last = { type: action.type, source, at };

    for (const observer of this.observers) {
      try {
        observer(action, source);
      } catch (e) {
        this.onError(action, e);
      }
    }
    const set = this.handlers.get(action.type);
    if (!set || set.size === 0) return false;
    for (const handler of [...set]) {
      try {
        handler(action, source);
      } catch (e) {
        this.onError(action, e);
      }
    }
    return true;
  }
}

/** The app-wide dispatcher for this window. */
export const actions = new ActionDispatcher();
export const dispatch = (action: Action, source: ActionSource): boolean =>
  actions.dispatch(action, source);
