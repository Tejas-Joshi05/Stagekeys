import { create } from 'zustand';

export type NoticeLevel = 'info' | 'warn' | 'error';

export interface Notice {
  id: number;
  level: NoticeLevel;
  message: string;
  /** Sticky notices stay until dismissed; others fade after a few seconds. */
  sticky: boolean;
}

interface NoticeState {
  notices: Notice[];
}

/** Non-blocking notices. These never open a dialog and never take focus. */
export const useNotices = create<NoticeState>(() => ({ notices: [] }));

let nextId = 1;

export function notify(level: NoticeLevel, message: string, sticky = level === 'error'): number {
  const id = nextId++;
  useNotices.setState((s) => ({
    notices: [
      ...s.notices.filter((n) => n.message !== message),
      { id, level, message, sticky },
    ].slice(-6),
  }));
  if (!sticky && typeof setTimeout !== 'undefined') {
    setTimeout(() => dismissNotice(id), level === 'info' ? 3500 : 7000);
  }
  return id;
}

export function dismissNotice(id: number): void {
  useNotices.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}
