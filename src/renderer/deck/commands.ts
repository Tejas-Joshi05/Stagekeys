import type { Mapping, Zone } from '../mapping';
import { newId } from '../shared/util';
import { createSlide } from './factory';
import type { Asset, Deck, Slide, SlideElement, Transition } from './schema';
import { exec, getCurrentSlide, setCurrentSlide, setSelection, useDeckStore } from './store';

/**
 * Deck edit commands. Each one is a single undoable step run through `exec`.
 * UI code and action handlers call these; nothing else mutates the deck.
 */

const slideIn = (deck: Deck, id: string): Slide | undefined => deck.slides.find((s) => s.id === id);

export type MappingScope = { kind: 'global' } | { kind: 'slide'; slideId: string };

const mappingList = (deck: Deck, scope: MappingScope): Mapping[] | undefined =>
  scope.kind === 'global' ? deck.mappings : slideIn(deck, scope.slideId)?.mappings;

// ── Deck ────────────────────────────────────────────────────────────────────

export function setTitle(title: string): void {
  exec(
    'Rename deck',
    (d) => {
      d.meta.title = title;
    },
    { coalesceKey: 'title' },
  );
}

// ── Slides ──────────────────────────────────────────────────────────────────

export function addSlide(): void {
  const { currentSlideId } = useDeckStore.getState();
  const slide = createSlide();
  const current = getCurrentSlide();
  if (current) slide.background = { ...current.background };
  exec('Add slide', (d) => {
    const index = d.slides.findIndex((s) => s.id === currentSlideId);
    d.slides.splice(index + 1, 0, slide);
  });
  setCurrentSlide(slide.id);
}

/** Deep-copies a slide with fresh ids, re-pointing its mappings at the copied elements. */
export function cloneSlide(source: Slide): Slide {
  const idMap = new Map<string, string>();
  const elements = source.elements.map((el) => {
    const id = newId('el');
    idMap.set(el.id, id);
    return { ...structuredClone(el), id };
  });
  const mappings = source.mappings.map((m) => {
    const copy = structuredClone(m);
    copy.id = newId('map');
    if (copy.action.type === 'anim.trigger' || copy.action.type === 'anim.setParam') {
      copy.action.elementId = idMap.get(copy.action.elementId) ?? copy.action.elementId;
    }
    return copy;
  });
  return {
    ...structuredClone(source),
    id: newId('slide'),
    name: source.name ? `${source.name} copy` : '',
    elements,
    mappings,
  };
}

export function duplicateSlide(id: string): void {
  const source = useDeckStore.getState().deck?.slides.find((s) => s.id === id);
  if (!source) return;
  const copy = cloneSlide(source);
  exec('Duplicate slide', (d) => {
    const index = d.slides.findIndex((s) => s.id === id);
    d.slides.splice(index + 1, 0, copy);
  });
  setCurrentSlide(copy.id);
}

/** Deletes a slide. A deck always keeps at least one slide. */
export function deleteSlide(id: string): void {
  const deck = useDeckStore.getState().deck;
  if (!deck || deck.slides.length <= 1) return;
  const index = deck.slides.findIndex((s) => s.id === id);
  if (index < 0) return;
  const neighbour = deck.slides[index + 1] ?? deck.slides[index - 1];
  if (neighbour && useDeckStore.getState().currentSlideId === id) setCurrentSlide(neighbour.id);
  exec('Delete slide', (d) => {
    d.slides.splice(index, 1);
  });
}

export function moveSlide(id: string, toIndex: number): void {
  exec('Reorder slides', (d) => {
    const from = d.slides.findIndex((s) => s.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(d.slides.length - 1, toIndex));
    if (target === from) return;
    const [slide] = d.slides.splice(from, 1);
    if (slide) d.slides.splice(target, 0, slide);
  });
}

export function renameSlide(id: string, name: string): void {
  exec(
    'Rename slide',
    (d) => {
      const slide = slideIn(d, id);
      if (slide) slide.name = name;
    },
    { coalesceKey: `slide-name:${id}` },
  );
}

export function setSlideNotes(id: string, notes: string): void {
  exec(
    'Edit notes',
    (d) => {
      const slide = slideIn(d, id);
      if (slide) slide.notes = notes;
    },
    { coalesceKey: `notes:${id}` },
  );
}

export function setSlideBackground(id: string, color: string): void {
  exec(
    'Change background',
    (d) => {
      const slide = slideIn(d, id);
      if (slide) slide.background.color = color;
    },
    { coalesceKey: `bg:${id}` },
  );
}

export function setSlideTransition(id: string, transition: Partial<Transition>): void {
  exec(
    'Change transition',
    (d) => {
      const slide = slideIn(d, id);
      if (slide) Object.assign(slide.transition, transition);
    },
    { coalesceKey: `transition:${id}` },
  );
}

// ── Elements ────────────────────────────────────────────────────────────────

export function addElements(elements: SlideElement[], label = 'Add element'): void {
  const slideId = useDeckStore.getState().currentSlideId;
  if (!slideId || elements.length === 0) return;
  exec(label, (d) => {
    slideIn(d, slideId)?.elements.push(...elements);
  });
  setSelection(elements.map((e) => e.id));
}

export interface UpdateOptions {
  label?: string;
  /** Edits sharing a key merge into one undo step (drags, typing, sliders). */
  coalesceKey?: string;
  /** Pointer gestures pass Infinity so a pause mid-drag does not split the undo step. */
  coalesceWindowMs?: number;
}

/** Applies `change` to each listed element on the current slide. */
export function updateElements(
  ids: readonly string[],
  change: (element: SlideElement) => void,
  options: UpdateOptions = {},
): void {
  const slideId = useDeckStore.getState().currentSlideId;
  if (!slideId || ids.length === 0) return;
  const wanted = new Set(ids);
  exec(
    options.label ?? 'Edit element',
    (d) => {
      for (const el of slideIn(d, slideId)?.elements ?? []) {
        if (wanted.has(el.id)) change(el);
      }
    },
    { coalesceKey: options.coalesceKey, coalesceWindowMs: options.coalesceWindowMs },
  );
}

export function deleteElements(ids: readonly string[]): void {
  const slideId = useDeckStore.getState().currentSlideId;
  if (!slideId || ids.length === 0) return;
  const wanted = new Set(ids);
  exec('Delete', (d) => {
    const slide = slideIn(d, slideId);
    if (!slide) return;
    slide.elements = slide.elements.filter((e) => !wanted.has(e.id));
    // Mappings that pointed at a deleted animation would silently do nothing; remove them.
    const dangling = (m: Mapping): boolean =>
      (m.action.type === 'anim.trigger' || m.action.type === 'anim.setParam') &&
      wanted.has(m.action.elementId);
    slide.mappings = slide.mappings.filter((m) => !dangling(m));
    d.mappings = d.mappings.filter((m) => !dangling(m));
  });
}

/** Copies of the given elements with new ids, offset so they do not sit exactly on the originals. */
export function cloneElements(elements: readonly SlideElement[], offset = 24): SlideElement[] {
  return elements.map((el) => ({
    ...structuredClone(el),
    id: newId('el'),
    x: el.x + offset,
    y: el.y + offset,
  }));
}

export function duplicateElements(ids: readonly string[]): void {
  const slide = getCurrentSlide();
  if (!slide) return;
  const wanted = new Set(ids);
  addElements(cloneElements(slide.elements.filter((e) => wanted.has(e.id))), 'Duplicate');
}

export type OrderTarget = 'forward' | 'backward' | 'front' | 'back';

/** Pure z-order change. Later in the array means drawn on top. */
export function reorder<T extends { id: string }>(
  items: readonly T[],
  ids: ReadonlySet<string>,
  to: OrderTarget,
): T[] {
  const picked = items.filter((i) => ids.has(i.id));
  const rest = items.filter((i) => !ids.has(i.id));
  if (to === 'front') return [...rest, ...picked];
  if (to === 'back') return [...picked, ...rest];
  const out = [...items];
  if (to === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      const a = out[i];
      const b = out[i + 1];
      if (a && b && ids.has(a.id) && !ids.has(b.id)) {
        out[i] = b;
        out[i + 1] = a;
      }
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      const a = out[i];
      const b = out[i - 1];
      if (a && b && ids.has(a.id) && !ids.has(b.id)) {
        out[i] = b;
        out[i - 1] = a;
      }
    }
  }
  return out;
}

export function orderElements(ids: readonly string[], to: OrderTarget): void {
  const slideId = useDeckStore.getState().currentSlideId;
  if (!slideId || ids.length === 0) return;
  const wanted = new Set(ids);
  exec('Change order', (d) => {
    const slide = slideIn(d, slideId);
    if (!slide) return;
    const next = reorder(slide.elements, wanted, to);
    if (next.some((el, i) => el !== slide.elements[i])) slide.elements = next;
  });
}

// ── Assets ──────────────────────────────────────────────────────────────────

export function addAsset(asset: Asset): void {
  exec('Add image', (d) => {
    d.assets[asset.id] = asset;
  });
}

// ── Mappings and zones ──────────────────────────────────────────────────────

export function addMapping(scope: MappingScope, mapping: Mapping): void {
  exec('Add mapping', (d) => {
    mappingList(d, scope)?.push(mapping);
  });
}

export function updateMapping(
  scope: MappingScope,
  id: string,
  change: (mapping: Mapping) => void,
  coalesce = true,
): void {
  exec(
    'Edit mapping',
    (d) => {
      const mapping = mappingList(d, scope)?.find((m) => m.id === id);
      if (mapping) change(mapping);
    },
    { coalesceKey: coalesce ? `mapping:${id}` : undefined },
  );
}

export function deleteMapping(scope: MappingScope, id: string): void {
  exec('Delete mapping', (d) => {
    const list = mappingList(d, scope);
    const index = list?.findIndex((m) => m.id === id) ?? -1;
    if (list && index >= 0) list.splice(index, 1);
  });
}

export function importMappings(mappings: Mapping[], zones: Zone[]): void {
  exec('Import mappings', (d) => {
    d.mappings.push(...mappings);
    d.zones.push(...zones);
  });
}

export function addZone(zone: Zone): void {
  exec('Add zone', (d) => {
    d.zones.push(zone);
  });
}

export function updateZone(id: string, change: (zone: Zone) => void): void {
  exec(
    'Edit zone',
    (d) => {
      const zone = d.zones.find((z) => z.id === id);
      if (zone) change(zone);
    },
    { coalesceKey: `zone:${id}` },
  );
}

export function deleteZone(id: string): void {
  exec('Delete zone', (d) => {
    d.zones = d.zones.filter((z) => z.id !== id);
  });
}
