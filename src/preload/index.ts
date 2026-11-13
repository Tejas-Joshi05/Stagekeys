import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type StagekeysApi } from '../ipc/contract';
import type { AppSettings } from '../ipc/settings';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: StagekeysApi = {
  getInfo: () => ipcRenderer.invoke(CHANNELS.getInfo),
  createDraft: (json) => ipcRenderer.invoke(CHANNELS.createDraft, json),
  listDrafts: () => ipcRenderer.invoke(CHANNELS.listDrafts),
  deleteDraft: (path) => ipcRenderer.invoke(CHANNELS.deleteDraft, path),
  openDeckDialog: () => ipcRenderer.invoke(CHANNELS.openDeckDialog),
  readDeck: (path) => ipcRenderer.invoke(CHANNELS.readDeck, path),
  writeDeck: (path, json, backup) => ipcRenderer.invoke(CHANNELS.writeDeck, path, json, backup),
  saveDeckAs: (fromPath, suggestedName) =>
    ipcRenderer.invoke(CHANNELS.saveDeckAs, fromPath, suggestedName),
  listBackups: (path) => ipcRenderer.invoke(CHANNELS.listBackups, path),
  readBackup: (path, name) => ipcRenderer.invoke(CHANNELS.readBackup, path, name),
  importImages: (deckPath) => ipcRenderer.invoke(CHANNELS.importImages, deckPath),
  readAsset: (deckPath, file) => ipcRenderer.invoke(CHANNELS.readAsset, deckPath, file),
  saveTextFile: (options) => ipcRenderer.invoke(CHANNELS.saveTextFile, options),
  openTextFile: (options) => ipcRenderer.invoke(CHANNELS.openTextFile, options),
  chooseExportFolder: () => ipcRenderer.invoke(CHANNELS.chooseExportFolder),
  writeExportFile: (dir, name, bytes) =>
    ipcRenderer.invoke(CHANNELS.writeExportFile, dir, name, bytes),
  listDisplays: () => ipcRenderer.invoke(CHANNELS.listDisplays),
  startShow: (start) => ipcRenderer.invoke(CHANNELS.startShow, start),
  endShow: () => ipcRenderer.invoke(CHANNELS.endShow),
  getShowInit: () => ipcRenderer.invoke(CHANNELS.getShowInit),
  sendShowMessage: (message) => ipcRenderer.send(CHANNELS.showMessage, message),
  onShowMessage: (callback) => subscribe(CHANNELS.showMessage, callback),
  onShowEnded: (callback) => subscribe<undefined>(CHANNELS.showEnded, () => callback()),
  onMenuAction: (callback) => subscribe(CHANNELS.menuAction, callback),
  onFlushRequest: (callback) => subscribe<undefined>(CHANNELS.flushRequest, () => callback()),
  flushDone: (error) => ipcRenderer.send(CHANNELS.flushDone, error),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(CHANNELS.updateSettings, patch),
  onSettingsChanged: (callback) => subscribe<AppSettings>(CHANNELS.settingsChanged, callback),
  log: (level, message, data) => ipcRenderer.send(CHANNELS.log, level, message, data),
  openLogFolder: () => ipcRenderer.invoke(CHANNELS.openLogFolder),
};

contextBridge.exposeInMainWorld('stagekeys', api);
