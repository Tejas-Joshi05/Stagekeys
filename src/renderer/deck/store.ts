import { create } from 'zustand';
import { History, type ExecOptions } from './history';
import type { Deck, Slide, SlideElement } from './schema';

export interface DeckSessionState {
  /** null when no deck is open (the welcome screen is showing). */
  deck: Deck | null;
  path: string | null;
  isDraft: boolean;
  /** Increments on every change to the deck, including undo and redo. */
  revision: number;
  savedRevision: number;
  savedAt: number | null;
  saveError: string | null;
  currentSlideId: string | null;
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

const EMPTY: DeckSessionState = {
  deck: null,
  path: null,
  isDraft: false,
  revision: 0,
  savedRevision: 0,
  savedAt: null,
  saveError: null,
  currentSlideId: null,
  selection: [],
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
};

export const useDeckStore = create<DeckSessionState>(() => ({ ...EMPTY }));

const history = new History<Deck>();

const historyFlags = () => ({
  canUndo: history.canUndo,
  canRedo: history.canRedo,
  undoLabel: history.undoLabel,
  redoLabel: history.redoLabel,
});

export function openSession(deck: Deck, path: string | null, isDraft: boolean): void {
  history.clear();
  useDeckStore.setState({
    ...EMPTY,
    deck,
    path,
    isDraft,
    currentSlideId: deck.slides[0]?.id ?? null,
  });
}

export function closeSession(): void {
  history.clear();
  useDeckStore.setState({ ...EMPTY });
}

/** Keeps the current slide and selection pointing at things that still exist. */
function reconcile(deck: Deck, preferredSlideId: string | null): Partial<DeckSessionState> {
  const state = useDeckStore.getState();
  const wanted = preferredSlideId ?? state.currentSlideId;
  const slide =
    deck.slides.find((s) => s.id === wanted) ??
    deck.slides.find((s) => s.id === state.currentSlideId) ??
    deck.slides[0];
  const ids = new Set(slide?.elements.map((e) => e.id) ?? []);
  return {
    currentSlideId: slide?.id ?? null,
    selection: state.selection.filter((id) => ids.has(id)),
  };
}

/**
 * Runs one undoable command against the deck. Every edit goes through here.
 * Returns true if the deck changed.
 */
export function exec(
  label: string,
  recipe: (deck: Deck) => void,
  options: ExecOptions = {},
): boolean {
  const state = useDeckStore.getState();
  if (!state.deck) return false;
  const next = history.exec(state.deck, label, recipe, {
    context: state.currentSlideId ?? undefined,
    ...options,
  });
  if (next === state.deck) return false;
  useDeckStore.setState({
    deck: next,
    revision: state.revision + 1,
    ...reconcile(next, null),
    ...historyFlags(),
  });
  return true;
}

export function undo(): boolean {
  const state = useDeckStore.getState();
  if (!state.deck) return false;
  const result = history.undo(state.deck);
  if (!result) return false;
  useDeckStore.setState({
    deck: result.doc,
    revision: state.revision + 1,
    ...reconcile(result.doc, result.entry.context),
    ...historyFlags(),
  });
  return true;
}

export function redo(): boolean {
  const state = useDeckStore.getState();
  if (!state.deck) return false;
  const result = history.redo(state.deck);
  if (!result) return false;
  useDeckStore.setState({
    deck: result.doc,
    revision: state.revision + 1,
    ...reconcile(result.doc, result.entry.context),
    ...historyFlags(),
  });
  return true;
}

/** Ends the current gesture so the next edit starts a new undo step. */
export function sealHistory(): void {
  history.seal();
}

export function setCurrentSlide(id: string): void {
  const { deck, currentSlideId } = useDeckStore.getState();
  if (!deck || id === currentSlideId || !deck.slides.some((s) => s.id === id)) return;
  history.seal();
  useDeckStore.setState({ currentSlideId: id, selection: [] });
}

export function setSelection(ids: string[]): void {
  const current = useDeckStore.getState().selection;
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
  useDeckStore.setState({ selection: ids });
}

export function getCurrentSlide(state: DeckSessionState = useDeckStore.getState()): Slide | null {
  return state.deck?.slides.find((s) => s.id === state.currentSlideId) ?? null;
}

export function getCurrentSlideIndex(state: DeckSessionState = useDeckStore.getState()): number {
  return Math.max(0, state.deck?.slides.findIndex((s) => s.id === state.currentSlideId) ?? 0);
}

export function getSelectedElements(
  state: DeckSessionState = useDeckStore.getState(),
): SlideElement[] {
  const slide = getCurrentSlide(state);
  if (!slide) return [];
  const ids = new Set(state.selection);
  return slide.elements.filter((e) => ids.has(e.id));
}
