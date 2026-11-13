/**
 * The IPC contract shared by main, preload and renderer.
 * Types only (plus channel names) so it is safe to import from any process.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });

import type { AppSettings, SettingsPatch } from './settings';

export const DECK_EXTENSION = '.stagekeys';

export interface AppInfo {
  version: string;
  platform: string;
  isDev: boolean;
  e2e: boolean;
  logDir: string;
}

export interface DeckFile {
  path: string;
  json: string;
  isDraft: boolean;
}

export interface DraftInfo {
  path: string;
  title: string;
  modified: number;
}

export interface BackupInfo {
  name: string;
  modified: number;
}

export interface ImportedAsset {
  /** File name inside the bundle's assets/ folder (content hash + extension). */
  file: string;
  mime: string;
  originalName: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface ShowStart {
  displayId: number | null;
  deckJson: string;
  deckPath: string;
  slideIndex: number;
  rehearsal: boolean;
}

export interface ShowInit {
  deckJson: string;
  deckPath: string;
  slideIndex: number;
  rehearsal: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TextFileSave {
  title: string;
  defaultName: string;
  extension: string;
  content: string;
}

export interface StagekeysApi {
  getInfo(): Promise<AppInfo>;

  createDraft(json: string): Promise<Result<string>>;
  listDrafts(): Promise<DraftInfo[]>;
  deleteDraft(path: string): Promise<Result<null>>;
  openDeckDialog(): Promise<Result<DeckFile | null>>;
  readDeck(path: string): Promise<Result<DeckFile>>;
  writeDeck(path: string, json: string, backup: boolean): Promise<Result<null>>;
  /** Copies the bundle to a user-chosen location. Resolves null if cancelled. */
  saveDeckAs(fromPath: string, suggestedName: string): Promise<Result<string | null>>;
  listBackups(path: string): Promise<BackupInfo[]>;
  readBackup(path: string, name: string): Promise<Result<string>>;

  importImages(deckPath: string): Promise<Result<ImportedAsset[]>>;
  readAsset(deckPath: string, file: string): Promise<Result<Uint8Array>>;

  saveTextFile(options: TextFileSave): Promise<Result<string | null>>;
  openTextFile(options: { title: string; extension: string }): Promise<Result<string | null>>;
  chooseExportFolder(): Promise<Result<string | null>>;
  writeExportFile(dir: string, name: string, bytes: Uint8Array): Promise<Result<string>>;

  listDisplays(): Promise<DisplayInfo[]>;
  startShow(start: ShowStart): Promise<Result<null>>;
  endShow(): Promise<void>;
  getShowInit(): Promise<ShowInit | null>;
  /** Relayed by main to the other window (control <-> stage). */
  sendShowMessage(message: unknown): void;
  onShowMessage(callback: (message: unknown) => void): () => void;
  onShowEnded(callback: () => void): () => void;

  onMenuAction(callback: (action: unknown) => void): () => void;
  /** Main asks the control window to flush pending saves before closing. */
  onFlushRequest(callback: () => void): () => void;
  flushDone(error: string | null): void;

  getSettings(): Promise<AppSettings>;
  /** Merges the patch, saves it, and sends the result to every window. */
  updateSettings(patch: SettingsPatch): Promise<AppSettings>;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;

  log(level: LogLevel, message: string, data?: unknown): void;
  openLogFolder(): Promise<void>;
}

export const CHANNELS = {
  getInfo: 'app:getInfo',
  createDraft: 'deck:createDraft',
  listDrafts: 'deck:listDrafts',
  deleteDraft: 'deck:deleteDraft',
  openDeckDialog: 'deck:openDialog',
  readDeck: 'deck:read',
  writeDeck: 'deck:write',
  saveDeckAs: 'deck:saveAs',
  listBackups: 'deck:listBackups',
  readBackup: 'deck:readBackup',
  importImages: 'asset:import',
  readAsset: 'asset:read',
  saveTextFile: 'file:saveText',
  openTextFile: 'file:openText',
  chooseExportFolder: 'export:chooseFolder',
  writeExportFile: 'export:write',
  listDisplays: 'display:list',
  startShow: 'show:start',
  endShow: 'show:end',
  getShowInit: 'show:getInit',
  showMessage: 'show:message',
  showEnded: 'show:ended',
  menuAction: 'menu:action',
  flushRequest: 'app:flushRequest',
  flushDone: 'app:flushDone',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  log: 'log:write',
  openLogFolder: 'log:openFolder',
} as const;
