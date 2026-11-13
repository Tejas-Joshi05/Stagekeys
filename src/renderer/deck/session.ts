import type { BackupInfo } from '../../ipc/contract';
import { api } from '../shared/api';
import { errorMessage, logger } from '../shared/log';
import { notify } from '../shared/notify';
import { Autosave } from './autosave';
import { createEmptyDeck } from './factory';
import { parseDeck, serialiseDeck } from './load';
import { closeSession, exec, openSession, useDeckStore } from './store';

/**
 * File-level operations for the open deck: new, open, save, save as, recovery.
 * Every deck lives in a bundle from the moment it is created (new decks start
 * as drafts in the app data folder), so there is always somewhere to autosave.
 */

export const autosave = new Autosave({
  snapshot: () => {
    const s = useDeckStore.getState();
    const deck = s.deck;
    return {
      path: deck ? s.path : null,
      revision: s.revision,
      serialise: () => (deck ? serialiseDeck(deck) : ''),
    };
  },
  write: (path, json, backup) => api().writeDeck(path, json, backup),
  onSaved: (revision, at) => {
    const hadError = useDeckStore.getState().saveError !== null;
    useDeckStore.setState({ savedRevision: revision, savedAt: at, saveError: null });
    if (hadError) notify('info', 'Saving is working again. Your deck is saved.');
  },
  onError: (message) => {
    if (useDeckStore.getState().saveError === null) {
      notify('error', `Could not save your deck: ${message}. Stagekeys will keep trying.`);
    }
    useDeckStore.setState({ saveError: message });
    logger.error('Deck save failed', message);
  },
});

export type OpenResult =
  { ok: true } | { ok: false; error: string; path: string | null; backups: BackupInfo[] };

/** Saves anything pending for the current deck. Resolves to an error message or null. */
export async function flushSaves(): Promise<string | null> {
  if (!useDeckStore.getState().deck) return null;
  return autosave.flush();
}

/**
 * A draft that was never edited is just clutter in the recovery list, so it
 * is removed when the user moves on. Edited drafts are always kept.
 */
export async function discardPristineDraft(): Promise<void> {
  const s = useDeckStore.getState();
  if (!s.deck || !s.path || !s.isDraft || s.revision !== 0) return;
  const removed = await api().deleteDraft(s.path);
  if (!removed.ok) logger.warn('Could not remove unused draft', removed.error);
}

async function leaveCurrentDeck(): Promise<void> {
  await flushSaves();
  await discardPristineDraft();
}

export async function newDeck(): Promise<OpenResult> {
  await leaveCurrentDeck();
  const deck = createEmptyDeck();
  const created = await api().createDraft(serialiseDeck(deck));
  if (!created.ok) {
    return {
      ok: false,
      error: `Could not create a new deck: ${created.error}`,
      path: null,
      backups: [],
    };
  }
  openSession(deck, created.value, true);
  autosave.markSaved(created.value, 0);
  return { ok: true };
}

async function loadText(path: string, text: string, isDraft: boolean): Promise<OpenResult> {
  const parsed = parseDeck(text);
  if (!parsed.ok) {
    const backups = parsed.kind === 'newer' ? [] : await api().listBackups(path);
    return { ok: false, error: parsed.error, path, backups };
  }
  // Keep a pristine copy of what was on disk before this session touches it.
  const backedUp = await api().writeDeck(path, text, true);
  if (!backedUp.ok) logger.warn('Could not write the on-open backup', backedUp.error);

  openSession(parsed.deck, path, isDraft);
  if (parsed.migratedFrom !== null) {
    // Force the migrated deck to be written on the next autosave tick.
    autosave.markSaved(path, -1);
    notify(
      'info',
      `This deck was upgraded from an older format (v${parsed.migratedFrom}). A backup of the original was kept.`,
    );
  } else {
    autosave.markSaved(path, 0);
  }
  return { ok: true };
}

export async function openDeckAt(path: string): Promise<OpenResult> {
  if (useDeckStore.getState().path !== path) await leaveCurrentDeck();
  const file = await api().readDeck(path);
  if (!file.ok) {
    return {
      ok: false,
      error: `Could not read the deck: ${file.error}`,
      path,
      backups: await api().listBackups(path),
    };
  }
  return loadText(file.value.path, file.value.json, file.value.isDraft);
}

/** Shows the open dialog. Resolves null if the user cancelled. */
export async function openDeckWithDialog(): Promise<OpenResult | null> {
  await flushSaves();
  const file = await api().openDeckDialog();
  if (!file.ok) return { ok: false, error: file.error, path: null, backups: [] };
  if (!file.value) return null;
  if (useDeckStore.getState().path !== file.value.path) await discardPristineDraft();
  return loadText(file.value.path, file.value.json, file.value.isDraft);
}

export async function restoreBackup(path: string, name: string): Promise<OpenResult> {
  const text = await api().readBackup(path, name);
  if (!text.ok)
    return { ok: false, error: text.error, path, backups: await api().listBackups(path) };
  const parsed = parseDeck(text.value);
  if (!parsed.ok)
    return { ok: false, error: parsed.error, path, backups: await api().listBackups(path) };
  const drafts = await api().listDrafts();
  openSession(
    parsed.deck,
    path,
    drafts.some((d) => d.path === path),
  );
  // The restored content is not yet what deck.json holds, so make it save.
  autosave.markSaved(path, -1);
  const failed = await autosave.flush(true);
  if (!failed) notify('info', 'Restored from backup.');
  return { ok: true };
}

/** Save As. Resolves true if the deck now lives at a user-chosen location. */
export async function saveDeckAs(): Promise<boolean> {
  const state = useDeckStore.getState();
  if (!state.deck || !state.path) return false;
  const failed = await autosave.flush();
  if (failed) {
    notify('error', `Could not save before copying: ${failed}`);
    return false;
  }
  const from = state.path;
  const wasDraft = state.isDraft;
  const result = await api().saveDeckAs(from, state.deck.meta.title);
  if (!result.ok) {
    notify('error', `Save As failed: ${result.error}`);
    return false;
  }
  const target = result.value;
  if (!target) return false;

  useDeckStore.setState({ path: target, isDraft: false });
  if (useDeckStore.getState().deck?.meta.title === 'Untitled') {
    const base = target
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.stagekeys$/, '');
    if (base)
      exec('Rename deck', (d) => {
        d.meta.title = base;
      });
  }
  autosave.markSaved(target, -1);
  const error = await autosave.flush(true);
  if (error) return false;
  if (wasDraft && from !== target) {
    const removed = await api().deleteDraft(from);
    if (!removed.ok) logger.warn('Could not remove draft after Save As', removed.error);
  }
  notify('info', 'Deck saved.');
  return true;
}

export async function saveDeck(): Promise<boolean> {
  const state = useDeckStore.getState();
  if (!state.deck) return false;
  if (state.isDraft) return saveDeckAs();
  try {
    const error = await autosave.flush(true);
    if (!error) notify('info', 'Deck saved.');
    return error === null;
  } catch (e) {
    notify('error', `Could not save: ${errorMessage(e)}`);
    return false;
  }
}

export async function closeDeck(): Promise<void> {
  await leaveCurrentDeck();
  closeSession();
}
