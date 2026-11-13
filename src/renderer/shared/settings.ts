import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type AppSettings,
  type SettingsPatch,
} from '../../ipc/settings';
import { api, hasApi } from './api';
import { logger } from './log';

/** App settings for this window. Main owns the file and sends every change to both windows. */
export const useSettings = create<AppSettings>(() => DEFAULT_SETTINGS);

let started = false;

/** Loads settings and follows changes made in either window. Safe to call more than once. */
export async function initSettings(): Promise<void> {
  if (started || !hasApi()) return;
  started = true;
  api().onSettingsChanged((settings) => useSettings.setState(settings, true));
  try {
    useSettings.setState(await api().getSettings(), true);
  } catch (e) {
    logger.warn('Could not read settings; using defaults', String(e));
  }
}

/** Applies a change here at once, then saves it through main (which tells the other window). */
export function updateSettings(patch: SettingsPatch): void {
  useSettings.setState(mergeSettings(useSettings.getState(), patch), true);
  if (!hasApi()) return;
  api()
    .updateSettings(patch)
    .catch((e: unknown) => logger.warn('Could not save settings', String(e)));
}
