import type { Action } from './types';

export type ShortcutContext = 'editor' | 'show';

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Keyboard shortcut tables. Pure: maps a key event to an Action or null.
 * The show table is the fallback that must keep working if MIDI fails.
 */
export function actionForKey(e: KeyLike, context: ShortcutContext): Action | null {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && e.shiftKey && key === 'f') return { type: 'view.toggleFps' };
  if (mod && e.shiftKey && key === 'k') return { type: 'view.toggleKeys' };
  if (mod && e.shiftKey && key === 'p') return { type: 'audio.togglePiano' };

  if (context === 'show') {
    if (mod || e.altKey) return null;
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Enter':
        return { type: 'nav.next' };
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
        return { type: 'nav.prev' };
      case 'Home':
        return { type: 'nav.goto', index: 0 };
      case 'Escape':
        return { type: 'show.end' };
      case 'b':
      case '.':
        return { type: 'show.blackToggle' };
      case 'h':
        return { type: 'show.panic' };
      case 'k':
        return { type: 'view.toggleKeys' };
      case 'p':
        return { type: 'audio.togglePiano' };
      default:
        return null;
    }
  }

  if (mod) {
    switch (key) {
      case 'z':
        return { type: e.shiftKey ? 'edit.redo' : 'edit.undo' };
      case 'y':
        return { type: 'edit.redo' };
      case 'd':
        return { type: 'edit.duplicate' };
      case 'a':
        return { type: 'edit.selectAll' };
      case 's':
        return { type: e.shiftKey ? 'file.saveAs' : 'file.save' };
      case ']':
      case '}':
        return { type: 'edit.order', to: e.shiftKey ? 'front' : 'forward' };
      case '[':
      case '{':
        return { type: 'edit.order', to: e.shiftKey ? 'back' : 'backward' };
      default:
        return null;
    }
  }

  const step = e.shiftKey ? 10 : 1;
  switch (key) {
    case 'Delete':
    case 'Backspace':
      return { type: 'edit.delete' };
    case 'Escape':
      return { type: 'edit.deselect' };
    case 'ArrowLeft':
      return { type: 'edit.nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { type: 'edit.nudge', dx: step, dy: 0 };
    case 'ArrowUp':
      return { type: 'edit.nudge', dx: 0, dy: -step };
    case 'ArrowDown':
      return { type: 'edit.nudge', dx: 0, dy: step };
    case 'PageDown':
      return { type: 'nav.next' };
    case 'PageUp':
      return { type: 'nav.prev' };
    default:
      return null;
  }
}
