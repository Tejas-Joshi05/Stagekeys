import { create } from 'zustand';
import type { AppInfo, BackupInfo } from '../../ipc/contract';

interface AppState {
  info: AppInfo | null;
  /** A deck that failed to open, with any backups that could be restored instead. */
  openError: { error: string; path: string | null; backups: BackupInfo[] } | null;
  busy: boolean;
  /** The built-in help is open. */
  help: boolean;
}

export const useAppStore = create<AppState>(() => ({
  info: null,
  openError: null,
  busy: false,
  help: false,
}));
