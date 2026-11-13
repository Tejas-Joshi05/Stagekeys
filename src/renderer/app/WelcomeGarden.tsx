import { useEffect, useRef } from 'react';
import { asciiHash, inkToGlyph, PLANTS, plantImage, RAMP, RAMP_MAX } from '../animations';

const CELL = 11;
const SS = 2;
const HOLD = 9;
const TRANS = 1.4;

/**
 * The welcome screen's plant: the website's ASCII herbarium drawn with a 2D
 * canvas, cream ink over a rose underprint, changing plant every few seconds.
 * About 15 frames a second, and a single still frame for reduced motion.
 */
export function WelcomeGarden() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const off = document.createElement('canvas');
    const og = off.getContext('2d', { willReadFrequently: true });
    if (!og) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0;
    let rows = 0;
    let cur = new Uint8Array(0);
    let prev = new Uint8Array(0);
    let plant = 0;
    let prevPlant = 0;
    let switched = -1;
    let lastSwitch = 0;
    let raf = 0;
    let lastDraw = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const size = (): void => {
      const box = el.getBoundingClientRect();
      el.width = Math.round(box.width * dpr);
      el.height = Math.round(box.height * dpr);
      cols = Math.floor(box.width / CELL);
      rows = Math.floor(box.height / CELL);
      off.width = cols * SS;
      off.height = rows * SS;
      cur = new Uint8Array(cols * rows);
      prev = new Uint8Array(cols * rows);
    };

    const sample = (index: number, t: number, out: Uint8Array): void => {
      out.fill(0);
      const name = PLANTS[index];
      const im = name ? plantImage(name) : null;
      if (!im) return;
      const W = cols * CELL;
      const H = rows * CELL;
      og.setTransform(1, 0, 0, 1, 0, 0);
      og.fillStyle = '#fff';
      og.fillRect(0, 0, off.width, off.height);
      const s = Math.min((W * 0.9) / im.naturalWidth, (H * 0.86) / im.naturalHeight);
      const w = im.naturalWidth * s;
      const h = im.naturalHeight * s;
      const k = SS / CELL;
      og.setTransform(k, 0, 0, k, 0, 0);
      og.translate(W / 2, H / 2 + h / 2);
      og.rotate(reduce ? 0 : 0.02 * Math.sin(t * 0.5) + 0.01 * Math.sin(t * 1.3));
      og.drawImage(im, -w / 2, -h, w, h);
      const data = og.getImageData(0, 0, off.width, off.height).data;
      const step = Math.floor(t * 8);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0;
          for (let yy = 0; yy < SS; yy++) {
            const o = ((r * SS + yy) * off.width + c * SS) * 4;
            for (let xx = 0; xx < SS; xx++) sum += data[o + xx * 4] ?? 255;
          }
          out[r * cols + c] = inkToGlyph(1 - sum / (SS * SS * 255), asciiHash(c, r, step + 7));
        }
      }
    };

    const draw = (t: number): void => {
      sample(plant, t, cur);
      const p = switched < 0 ? 1 : Math.min(1, (t - switched) / TRANS);
      if (switched >= 0) sample(prevPlant, t, prev);
      const step = Math.floor(t * 8);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, el.width, el.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = `500 ${CELL * 1.04}px "IBM Plex Mono", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const glyphs: [string, number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          let ix = cur[k] ?? 0;
          if (switched >= 0) {
            const a = prev[k] ?? 0;
            const rr = Math.hypot((c - cols / 2) / (cols / 2), (r - rows / 2) / (rows / 2)) / 1.42;
            const q = (p - 0.62 * (rr * 0.78 + asciiHash(c, r, 3) * 0.22)) / 0.26;
            ix =
              q <= 0
                ? a
                : q >= 1
                  ? ix
                  : a || ix
                    ? 1 + Math.floor(asciiHash(c, r, step * 3 + 1) * RAMP_MAX)
                    : 0;
          }
          if (ix) glyphs.push([RAMP[ix] ?? ' ', (c + 0.5) * CELL, (r + 0.5) * CELL]);
        }
      }
      g.fillStyle = 'rgba(216, 164, 175, 0.55)';
      for (const [ch, x, y] of glyphs) g.fillText(ch, x + 1.4, y + 1.1);
      g.fillStyle = '#efe6d8';
      for (const [ch, x, y] of glyphs) g.fillText(ch, x, y);
      if (p >= 1) switched = -1;
    };

    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - lastDraw < 66) return;
      lastDraw = now;
      const t = now / 1000;
      if (!lastSwitch) lastSwitch = t;
      if (switched < 0 && t - lastSwitch > HOLD) {
        const next = (plant + 1) % PLANTS.length;
        const name = PLANTS[next];
        if (name && plantImage(name)) {
          prevPlant = plant;
          plant = next;
          switched = t;
          lastSwitch = t;
        }
      }
      draw(t);
    };

    size();
    const observer = new ResizeObserver(() => {
      size();
      if (reduce) draw(0);
    });
    observer.observe(el);
    if (reduce) draw(0);
    else raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className="welcome-garden" aria-hidden />;
}
