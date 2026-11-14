import { useEffect, useRef } from 'react';
import type { AudioLevels } from './levels';

interface Props {
  /** Called about 20 times a second. Return the levels to draw. */
  read: () => AudioLevels;
  width?: number;
  height?: number;
}

const BARS: readonly { key: 'level' | 'bass' | 'mid' | 'treble'; label: string }[] = [
  { key: 'level', label: 'ALL' },
  { key: 'bass', label: 'LOW' },
  { key: 'mid', label: 'MID' },
  { key: 'treble', label: 'HIGH' },
];

/**
 * A small level meter: overall loudness, three bands and a beat lamp. It
 * draws itself on a timer, so React renders it once however lively the sound.
 */
export function AudioMeter({ read, width = 296, height = 74 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  }, [read]);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const styles = getComputedStyle(el);
    const leaf = styles.getPropertyValue('--leaf').trim() || '#c1bc77';
    const rose = styles.getPropertyValue('--rose').trim() || '#d8a4af';
    const dim = 'rgba(239, 230, 216, 0.14)';
    const text = 'rgba(239, 230, 216, 0.6)';
    let lastKey = '';

    const draw = (): void => {
      let levels: AudioLevels;
      try {
        levels = reader.current();
      } catch {
        return;
      }
      // Skip the redraw when nothing visible moved.
      const key = `${levels.active ? 1 : 0}|${BARS.map((b) => Math.round(levels[b.key] * 100)).join(',')}|${Math.round(levels.beat * 10)}`;
      if (key === lastKey) return;
      lastKey = key;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      g.font = '500 9px "IBM Plex Mono", monospace';
      g.textBaseline = 'middle';
      const labelW = 34;
      const lampW = 22;
      const barW = width - labelW - lampW;
      const rowH = height / BARS.length;
      BARS.forEach((bar, i) => {
        const y = i * rowH + rowH / 2;
        g.fillStyle = text;
        g.fillText(bar.label, 0, y);
        g.fillStyle = dim;
        g.fillRect(labelW, y - 3, barW, 6);
        const value = Math.min(1, Math.max(0, levels[bar.key]));
        if (value > 0) {
          g.fillStyle = levels.active ? (i === 0 ? rose : leaf) : text;
          g.fillRect(labelW, y - 3, barW * value, 6);
        }
      });
      // The beat lamp.
      g.beginPath();
      g.arc(width - 8, height / 2, 5, 0, Math.PI * 2);
      g.fillStyle = dim;
      g.fill();
      if (levels.beat > 0.02) {
        g.globalAlpha = Math.min(1, levels.beat);
        g.fillStyle = rose;
        g.fill();
        g.globalAlpha = 1;
      }
    };
    draw();
    const timer = setInterval(draw, 50);
    return () => clearInterval(timer);
  }, [width, height]);

  return (
    <canvas
      ref={canvas}
      className="audio-meter"
      style={{ width, height }}
      data-testid="audio-meter"
      aria-label="Sound input level"
    />
  );
}
