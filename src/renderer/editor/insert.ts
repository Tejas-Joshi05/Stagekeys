import { getAnimation } from '../animations';
import {
  addElements,
  createAnimation,
  createImage,
  createShape,
  createText,
  exec,
  getCurrentSlide,
  setSelection,
  useDeckStore,
  type Asset,
  type SlideElement,
} from '../deck';
import { api } from '../shared/api';
import { notify } from '../shared/notify';
import { isDarkColour, newId } from '../shared/util';

type InsertKind = 'text' | 'rect' | 'ellipse' | 'line' | 'image' | 'animation';

function centred<T extends SlideElement>(el: T): T {
  const canvas = useDeckStore.getState().deck?.meta.canvas;
  if (!canvas) return el;
  // Nudge each new element so repeated inserts do not stack exactly.
  const count =
    useDeckStore
      .getState()
      .deck?.slides.find((s) => s.id === useDeckStore.getState().currentSlideId)?.elements.length ??
    0;
  const offset = (count % 8) * 16;
  el.x = Math.round((canvas.width - el.width) / 2 + offset);
  el.y = Math.round((canvas.height - el.height) / 2 + offset);
  return el;
}

async function imageSize(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth || 400, height: image.naturalHeight || 300 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function insertImages(): Promise<void> {
  const { deck, path, currentSlideId } = useDeckStore.getState();
  if (!deck || !path || !currentSlideId) return;
  const imported = await api().importImages(path);
  if (!imported.ok) {
    notify('error', `Could not add the image: ${imported.error}`);
    return;
  }
  const canvas = deck.meta.canvas;
  const newAssets: Asset[] = [];
  const elements: SlideElement[] = [];
  for (const item of imported.value) {
    let asset = Object.values(deck.assets).find((a) => a.file === item.file);
    if (!asset) {
      const bytes = await api().readAsset(path, item.file);
      if (!bytes.ok) {
        notify('error', `Could not read ${item.originalName}: ${bytes.error}`);
        continue;
      }
      let size: { width: number; height: number };
      try {
        size = await imageSize(bytes.value, item.mime);
      } catch {
        notify('error', `${item.originalName} is not an image Stagekeys can display.`);
        continue;
      }
      asset = {
        id: newId('asset'),
        file: item.file,
        mime: item.mime,
        name: item.originalName,
        ...size,
      };
      newAssets.push(asset);
    }
    const fit = Math.min(
      1,
      (canvas.width * 0.6) / asset.width,
      (canvas.height * 0.6) / asset.height,
    );
    const width = Math.round(asset.width * fit);
    const height = Math.round(asset.height * fit);
    elements.push(centred(createImage(asset.id, asset.name, 0, 0, width, height)));
  }
  if (elements.length === 0) return;
  exec('Add image', (d) => {
    for (const asset of newAssets) d.assets[asset.id] = asset;
    d.slides.find((s) => s.id === currentSlideId)?.elements.push(...elements);
  });
  setSelection(elements.map((e) => e.id));
}

/** Adds a new element of the given kind to the current slide. */
export async function insertElement(kind: InsertKind, animationId?: string): Promise<void> {
  switch (kind) {
    case 'text':
      addElements([centred(createText(0, 0))], 'Add text');
      return;
    case 'rect':
    case 'ellipse':
    case 'line':
      addElements([centred(createShape(kind, 0, 0))], 'Add shape');
      return;
    case 'image':
      await insertImages();
      return;
    case 'animation': {
      const def = getAnimation(animationId ?? 'bloom');
      if (!def) return;
      const el = createAnimation(
        def.id,
        def.name,
        0,
        0,
        def.defaultSize.width,
        def.defaultSize.height,
      );
      const slide = getCurrentSlide(useDeckStore.getState());
      el.params = def.paramsFor({ dark: isDarkColour(slide?.background.color ?? '#000000') });
      el.bindings = def.defaultBindings.map((b) => ({
        param: b.param,
        source: b.source,
        controller: b.controller ?? 1,
        curve: 'linear',
        min: b.min,
        max: b.max,
      }));
      addElements([centred(el)], `Add ${def.name}`);
      return;
    }
  }
}
