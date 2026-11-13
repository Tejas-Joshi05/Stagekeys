// Artwork shared by the riso animations. Imported inline (as data URLs) so that
// reading pixels back from a canvas is always allowed, even from file:// in the
// packaged app, where a normal image URL would taint the canvas.
import branch from './assets/ascii/branch.jpg?inline';
import ficus from './assets/ascii/ficus.jpg?inline';
import lilyMap from './assets/ascii/lily.jpg?inline';
import maple from './assets/ascii/maple.jpg?inline';
import rowan from './assets/ascii/rowan.jpg?inline';
import squill from './assets/ascii/squill.jpg?inline';
import tulip from './assets/ascii/tulip.jpg?inline';
import aster from './assets/flowers/aster.png?inline';
import daisy from './assets/flowers/daisy.png?inline';
import lily from './assets/flowers/lily.png?inline';
import mum from './assets/flowers/mum.png?inline';
import sprig from './assets/flowers/sprig.png?inline';
import star from './assets/flowers/star.png?inline';
import zinnia from './assets/flowers/zinnia.png?inline';

/** Ink-density maps for the ASCII plants: black is full ink. Same order as on tejasjoshi.vercel.app. */
export const PLANTS = ['tulip', 'maple', 'lily', 'branch', 'squill', 'ficus', 'rowan'] as const;
export type PlantName = (typeof PLANTS)[number];

const PLANT_URLS: Record<PlantName, string> = {
  tulip,
  maple,
  lily: lilyMap,
  branch,
  squill,
  ficus,
  rowan,
};

/** Tejas's pressed flowers, already tinted in riso inks. */
export const FLOWERS = ['lily', 'daisy', 'sprig', 'aster', 'star', 'mum', 'zinnia'] as const;
export type FlowerName = (typeof FLOWERS)[number];

const FLOWER_URLS: Record<FlowerName, string> = { lily, daisy, sprig, aster, star, mum, zinnia };

const images = new Map<string, HTMLImageElement>();

function load(key: string, url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null; // Unit tests run without a DOM.
  let image = images.get(key);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = url;
    images.set(key, image);
  }
  return image;
}

const ready = (image: HTMLImageElement | null): image is HTMLImageElement =>
  image !== null && image.complete && image.naturalWidth > 0;

/** The plant's density map, or null until it has decoded. */
export function plantImage(name: PlantName): HTMLImageElement | null {
  const image = load(`plant:${name}`, PLANT_URLS[name]);
  return ready(image) ? image : null;
}

/** The flower image, or null until it has decoded. */
export function flowerImage(name: FlowerName): HTMLImageElement | null {
  const image = load(`flower:${name}`, FLOWER_URLS[name]);
  return ready(image) ? image : null;
}

/**
 * Decodes every piece of art up front, so the first frame on stage, thumbnails
 * and exports never draw an empty animation. Never rejects.
 */
export async function preloadArt(): Promise<void> {
  const all = [
    ...PLANTS.map((p) => load(`plant:${p}`, PLANT_URLS[p])),
    ...FLOWERS.map((f) => load(`flower:${f}`, FLOWER_URLS[f])),
  ];
  await Promise.allSettled(all.map((image) => image?.decode()));
}
