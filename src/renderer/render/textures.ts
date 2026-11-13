import { Texture } from 'pixi.js';

export interface TextureSource {
  file: string;
  mime: string;
}

/**
 * Longest side a deck image is kept at. A slide is 1920 wide and the stage
 * backing is at most 3840, so anything bigger only costs memory and upload time.
 */
export const MAX_TEXTURE_SIDE = 3840;

export type AssetLoader = (file: string) => Promise<Uint8Array | null>;

interface Entry {
  texture: Texture | null;
  failed: boolean;
  waiting: Set<(texture: Texture) => void>;
}

/** Loads deck images into GPU textures, once each, and hands them to whoever asks. */
export class AssetTextures {
  private readonly entries = new Map<string, Entry>();
  private pending = 0;
  private idleWaiters: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly load: AssetLoader,
    private readonly onError: (file: string, error: unknown) => void = () => undefined,
  ) {}

  /**
   * Returns the texture if it is ready. Otherwise starts loading and calls
   * `onReady` when it arrives. Returns a function that cancels the callback.
   */
  request(
    source: TextureSource,
    onReady: (texture: Texture) => void,
  ): { texture: Texture | null; cancel: () => void } {
    let entry = this.entries.get(source.file);
    if (!entry) {
      entry = { texture: null, failed: false, waiting: new Set() };
      this.entries.set(source.file, entry);
      void this.fetch(source, entry);
    }
    if (entry.texture) return { texture: entry.texture, cancel: () => undefined };
    const waiting = entry.waiting;
    if (!entry.failed) waiting.add(onReady);
    return { texture: null, cancel: () => void waiting.delete(onReady) };
  }

  private async fetch(source: TextureSource, entry: Entry): Promise<void> {
    this.pending++;
    let url: string | null = null;
    try {
      const bytes = await this.load(source.file);
      if (!bytes) throw new Error('Image file could not be read');
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: source.mime }));
      const image = new Image();
      image.src = url;
      await image.decode();
      if (this.destroyed) return;
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      if (longest > MAX_TEXTURE_SIDE && typeof createImageBitmap === 'function') {
        const k = MAX_TEXTURE_SIDE / longest;
        const bitmap = await createImageBitmap(image, {
          resizeWidth: Math.round(image.naturalWidth * k),
          resizeHeight: Math.round(image.naturalHeight * k),
          resizeQuality: 'high',
        });
        if (this.destroyed) {
          bitmap.close();
          return;
        }
        entry.texture = Texture.from(bitmap);
      } else {
        entry.texture = Texture.from(image);
      }
      for (const ready of entry.waiting) ready(entry.texture);
    } catch (e) {
      entry.failed = true;
      this.onError(source.file, e);
    } finally {
      entry.waiting.clear();
      if (url) URL.revokeObjectURL(url);
      this.pending--;
      if (this.pending === 0) {
        for (const done of this.idleWaiters.splice(0)) done();
      }
    }
  }

  /** Starts loading every given image and resolves when all have arrived (or failed). */
  preload(sources: readonly TextureSource[]): Promise<void> {
    for (const source of sources) this.request(source, () => undefined);
    return this.settled();
  }

  /** Resolves once nothing is loading (used before thumbnails and export). */
  settled(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  destroy(): void {
    this.destroyed = true;
    for (const entry of this.entries.values()) {
      entry.waiting.clear();
      entry.texture?.destroy(true);
    }
    this.entries.clear();
  }
}
