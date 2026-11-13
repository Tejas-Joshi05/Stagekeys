import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CHANNELS } from '../ipc/contract';
import {
  mergeSettings,
  parseSettings,
  type AppSettings,
  type SettingsPatch,
} from '../ipc/settings';
import { atomicWrite, serialised } from './deckFiles';
import { log } from './log';

let current: AppSettings | null = null;

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');

export async function getSettings(): Promise<AppSettings> {
  if (current) return current;
  const text = await fs.readFile(settingsFile(), 'utf8').catch(() => null);
  current = parseSettings(text);
  return current;
}

/** Merges, saves atomically, and tells every window. A failed write is logged; the change still applies for this session. */
export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const next = mergeSettings(await getSettings(), patch);
  current = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.settingsChanged, next);
  }
  await serialised('settings', () =>
    atomicWrite(settingsFile(), JSON.stringify(next, null, 2)),
  ).catch((e: unknown) =>
    log('error', 'settings', 'Could not save settings', e instanceof Error ? e.message : String(e)),
  );
  return next;
}
