import {
  addElements,
  cloneElements,
  deleteElements,
  getSelectedElements,
  type SlideElement,
} from '../deck';

/** In-app clipboard for slide elements. Each paste lands a little further along. */
let clip: SlideElement[] = [];
let pasteCount = 0;

export function copySelection(): boolean {
  const selected = getSelectedElements();
  if (selected.length === 0) return false;
  clip = selected.map((el) => structuredClone(el));
  pasteCount = 0;
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteElements(clip.map((el) => el.id));
}

export function pasteClipboard(): void {
  if (clip.length === 0) return;
  pasteCount += 1;
  addElements(cloneElements(clip, 24 * pasteCount), 'Paste');
}
