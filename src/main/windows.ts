import { BrowserWindow, dialog, powerSaveBlocker, screen } from 'electron';
import path from 'node:path';
import { CHANNELS, type ShowInit, type ShowStart } from '../ipc/contract';
import { log } from './log';

export const isE2E = process.env.STAGEKEYS_E2E === '1';

interface ShowState {
  init: ShowInit;
  displayId: number | null;
  blockerId: number | null;
  restarts: number;
}

let controlWindow: BrowserWindow | null = null;
let stageWindow: BrowserWindow | null = null;
let show: ShowState | null = null;
let controlClosing = false;
let flushTimer: NodeJS.Timeout | null = null;

export const getControlWindow = (): BrowserWindow | null => controlWindow;
export const getStageWindow = (): BrowserWindow | null => stageWindow;
export const isShowActive = (): boolean => show !== null;
export const getShowInit = (): ShowInit | null => show?.init ?? null;

function webPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    backgroundThrottling: false,
  };
}

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function loadView(win: BrowserWindow, view: 'control' | 'stage'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const loading = devUrl
    ? win.loadURL(`${devUrl}#${view}`)
    : win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: view });
  loading.catch((e: unknown) => log('error', 'main', `Failed to load ${view} view`, String(e)));
}

export function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#15161a',
    title: 'Stagekeys',
    show: false,
    webPreferences: webPreferences(),
  });
  controlWindow = win;
  controlClosing = false;
  harden(win);
  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (controlClosing || win.webContents.isDestroyed() || win.webContents.isCrashed()) return;
    // Ask the renderer to flush pending saves first, so closing never loses work.
    event.preventDefault();
    win.webContents.send(CHANNELS.flushRequest);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => finishControlClose('The editor did not respond in time.'), 5000);
  });
  win.on('closed', () => {
    controlWindow = null;
    endShow();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log('error', 'main', 'Control window renderer gone', details);
    // The stage keeps running on its own. Reload the control view so it can re-attach.
    if (!win.isDestroyed()) loadView(win, 'control');
  });

  loadView(win, 'control');
  return win;
}

/** Called when the renderer reports its final save result (or the wait timed out). */
export function finishControlClose(error: string | null): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const win = controlWindow;
  if (!win || win.isDestroyed()) return;
  if (error && !isE2E) {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: 'Your latest changes could not be saved.',
      detail: `${error}\n\nIf you close now, changes since the last successful save will be lost.`,
      buttons: ['Keep Editing', 'Close Anyway'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) return;
  }
  controlClosing = true;
  win.close();
}

function targetDisplay(displayId: number | null): Electron.Display {
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

function createStageWindow(state: ShowState): BrowserWindow {
  const display = targetDisplay(state.displayId);
  const bounds = isE2E
    ? { x: display.bounds.x + 40, y: display.bounds.y + 40, width: 960, height: 540 }
    : display.bounds;
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    backgroundColor: '#000000',
    title: 'Stagekeys Stage',
    show: false,
    fullscreenable: true,
    webPreferences: webPreferences(),
  });
  stageWindow = win;
  harden(win);
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    if (!isE2E) {
      if (process.platform === 'darwin') win.setSimpleFullScreen(true);
      else win.setFullScreen(true);
    }
    win.show();
  });
  win.on('closed', () => {
    if (stageWindow === win) {
      stageWindow = null;
      // Closed by the OS or the user rather than through endShow: treat as end of show.
      if (show === state) endShow();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log('error', 'main', 'Stage renderer gone during show', details);
    if (show !== state || win.isDestroyed()) return;
    state.restarts += 1;
    if (state.restarts > 5) {
      log('error', 'main', 'Stage renderer failed repeatedly; ending show');
      endShow();
      return;
    }
    // Bring the stage back at the slide the audience was looking at.
    loadView(win, 'stage');
  });
  loadView(win, 'stage');
  return win;
}

export function startShow(start: ShowStart): void {
  if (show) endShow();
  const state: ShowState = {
    init: {
      deckJson: start.deckJson,
      deckPath: start.deckPath,
      slideIndex: start.slideIndex,
      rehearsal: start.rehearsal,
    },
    displayId: start.displayId,
    blockerId: null,
    restarts: 0,
  };
  show = state;
  try {
    state.blockerId = powerSaveBlocker.start('prevent-display-sleep');
  } catch (e) {
    log('warn', 'main', 'Could not start power save blocker', String(e));
  }
  createStageWindow(state);
  log('info', 'main', 'Show started', { rehearsal: start.rehearsal, display: start.displayId });
}

export function endShow(): void {
  const state = show;
  if (!state) return;
  show = null;
  if (state.blockerId !== null && powerSaveBlocker.isStarted(state.blockerId)) {
    powerSaveBlocker.stop(state.blockerId);
  }
  const stage = stageWindow;
  stageWindow = null;
  if (stage && !stage.isDestroyed()) stage.destroy();
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send(CHANNELS.showEnded);
    controlWindow.focus();
  }
  log('info', 'main', 'Show ended');
}

/** Remember where the show is so a restarted stage window resumes on the same slide. */
export function noteSlideIndex(index: number): void {
  if (show) show.init = { ...show.init, slideIndex: index };
}

export function relayShowMessage(sender: Electron.WebContents, message: unknown): void {
  const control = controlWindow?.webContents;
  const stage = stageWindow?.webContents;
  if (stage && sender === stage) {
    if (typeof message === 'object' && message !== null && 'slideIndex' in message) {
      const index = (message as { slideIndex: unknown }).slideIndex;
      if (typeof index === 'number' && Number.isInteger(index)) noteSlideIndex(index);
    }
    if (control && !control.isDestroyed()) control.send(CHANNELS.showMessage, message);
  } else if (control && sender === control) {
    if (stage && !stage.isDestroyed()) stage.send(CHANNELS.showMessage, message);
  }
}
