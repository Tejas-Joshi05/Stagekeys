import { api } from '../shared/api';
import { logger } from '../shared/log';
import { OffscreenRenderer } from './offscreen';
import { AssetTextures } from './textures';

export interface DeckResources {
  path: string;
  textures: AssetTextures;
  offscreen: OffscreenRenderer;
}

let current: DeckResources | null = null;

/** Image textures and the off-screen renderer for the open deck. Rebuilt when the deck's folder changes. */
export function getDeckResources(path: string): DeckResources {
  if (current?.path === path) return current;
  current?.offscreen.destroy();
  current?.textures.destroy();
  const textures = new AssetTextures(
    async (file) => {
      const result = await api().readAsset(path, file);
      return result.ok ? result.value : null;
    },
    (file, error) => logger.warn(`Image ${file} could not be loaded`, String(error)),
  );
  current = { path, textures, offscreen: new OffscreenRenderer(textures) };
  return current;
}
