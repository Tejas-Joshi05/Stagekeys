import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { initLog, log } from './log';
import { buildMenu } from './menu';
import { createControlWindow, getControlWindow } from './windows';

// Tests point the app at a throwaway profile so they never touch real decks or drafts.
const userDataOverride = process.env.STAGEKEYS_USER_DATA;
if (userDataOverride) app.setPath('userData', userDataOverride);

// Never let Electron's default handler put up an error dialog (it would steal focus mid-show).
process.on('uncaughtException', (error) => {
  log('error', 'main', 'Uncaught exception', { message: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  log('error', 'main', 'Unhandled rejection', String(reason));
});

// The piano must sound on the first key press, without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Chromium asks for `midiSysex` even for plain Web MIDI access, so both are needed for MIDI to work.
const ALLOWED_PERMISSIONS = new Set(['midi', 'midiSysex', 'local-fonts']);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getControlWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    initLog(userDataOverride ? path.join(userDataOverride, 'logs') : app.getPath('logs'));
    log('info', 'main', `Stagekeys ${app.getVersion()} starting`, {
      electron: process.versions.electron,
      platform: process.platform,
    });

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      // Sound input (for audio-reactive animations) is the only media allowed: never the camera.
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      const audioOnly =
        permission === 'media' && types.length > 0 && types.every((type) => type === 'audio');
      const allowed = ALLOWED_PERMISSIONS.has(permission) || audioOnly;
      if (!allowed) log('warn', 'main', `Denied permission request: ${permission}`);
      callback(allowed);
    });
    session.defaultSession.setPermissionCheckHandler(
      (_wc, permission, _origin, details) =>
        ALLOWED_PERMISSIONS.has(permission) ||
        (permission === 'media' && details.mediaType === 'audio'),
    );

    registerIpc();
    buildMenu();
    createControlWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
