export * from './schema';
export * from './commands';
export {
  createAnimation,
  createEmptyDeck,
  createImage,
  createShape,
  createSlide,
  createText,
  DEFAULT_CANVAS,
  DEFAULT_FONT,
} from './factory';
export { parseDeck, serialiseDeck, type DeckLoadResult } from './load';
export { DeckVersionError, migrateDeck, migrations, type Migration } from './migrations';
export { History, type HistoryEntry } from './history';
export { Autosave, type AutosaveDeps } from './autosave';
export {
  closeSession,
  exec,
  getCurrentSlide,
  getCurrentSlideIndex,
  getSelectedElements,
  openSession,
  redo,
  sealHistory,
  setCurrentSlide,
  setSelection,
  undo,
  useDeckStore,
  type DeckSessionState,
} from './store';
export {
  autosave,
  closeDeck,
  discardPristineDraft,
  flushSaves,
  newDeck,
  openDeckAt,
  openDeckWithDialog,
  restoreBackup,
  saveDeck,
  saveDeckAs,
  type OpenResult,
} from './session';
