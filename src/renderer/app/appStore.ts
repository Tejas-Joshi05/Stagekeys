import { create } from 'zustand';
import type { AppInfo, BackupInfo } from '../../ipc/contract';

export interface ConfirmRequest {
  title: string;
  detail: string;
  /** The button that goes ahead, e.g. "Delete draft". */
  action: string;
  onConfirm: () => void;
}

interface AppState {
  info: AppInfo | null;
  /** A deck that failed to open, with any backups that could be restored instead. */
  openError: { error: string; path: string | null; backups: BackupInfo[] } | null;
  busy: boolean;
  /** The built-in help is open. */
  help: boolean;
  /** A question waiting for a yes or no, shown over the app. */
  confirm: ConfirmRequest | null;
}

export const useAppStore = create<AppState>(() => ({
  info: null,
  openError: null,
  busy: false,
  help: false,
  confirm: null,
}));
