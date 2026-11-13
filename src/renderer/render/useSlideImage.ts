import { useEffect, useState } from 'react';
import type { Deck, Slide } from '../deck';
import { getDeckResources } from './resources';

const cache = new WeakMap<Slide, Map<number, string>>();

/**
 * A rendered picture of a slide as a data URL, for thumbnails and the
 * presenter view. Cached per slide object: an edited slide is a new object
 * (the deck is immutable), so stale pictures are never shown for long.
 */
export function useSlideImage(
  slide: Slide | undefined,
  deck: Deck | null,
  path: string | null,
  width: number,
  delayMs = 200,
): string | null {
  const [image, setImage] = useState<{ slide: Slide; url: string } | null>(null);

  useEffect(() => {
    if (!slide || !deck || !path) return;
    const cached = cache.get(slide)?.get(width);
    if (cached) {
      setImage({ slide, url: cached });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getDeckResources(path)
        .offscreen.render(slide, deck, width)
        .then((canvas) => {
          const url = canvas.toDataURL('image/png');
          let perWidth = cache.get(slide);
          if (!perWidth) {
            perWidth = new Map();
            cache.set(slide, perWidth);
          }
          perWidth.set(width, url);
          if (!cancelled) setImage({ slide, url });
        })
        .catch(() => undefined);
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slide, deck, path, width, delayMs]);

  // Keep showing the previous picture while the new one renders, to avoid flicker.
  return image?.url ?? null;
}
