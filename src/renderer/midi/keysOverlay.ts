import type { ControllerProfile } from '../../ipc/settings';
import { noteName } from '../shared/util';
import { keyLayout, keysWindow, MOD_CC, padFor } from './controller';
import type { MidiInputState } from './inputState';

/** Drawing size in canvas units; the element is scaled to any width. */
export const OVERLAY_W = 300;
export const OVERLAY_H = 118;

const INK = {
  body: 'rgba(30, 24, 21, 0.9)',
  edge: 'rgba(243, 237, 228, 0.14)',
  white: '#f3ede4',
  whiteEdge: '#b9aca2',
  black: '#2b2320',
  held: '#d8a4af',
  heldDeep: '#b97f8c',
  pad: '#3a302c',
  padLit: '#c1bc77',
  knob: '#3a302c',
  mark: '#f3ede4',
  wheel: '#14100e',
  label: '#8a736b',
};

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * Draws a small MPK mini IV with what is being played: held keys, hit pads,
 * knob positions, both wheels and the sustain pedal. Plain canvas, no React,
 * and it only redraws when the MIDI state actually changed.
 */
export class KeysOverlay {
  private raf = 0;
  private drawn = -1;
  private profileDrawn: ControllerProfile | null = null;
  private cssWidth = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: MidiInputState,
    private readonly profile: () => ControllerProfile,
  ) {}

  /** Sets the on-screen width in CSS pixels. */
  setWidth(cssWidth: number, dpr = globalThis.devicePixelRatio || 1): void {
    if (cssWidth === this.cssWidth && dpr === this.dpr) return;
    this.cssWidth = cssWidth;
    this.dpr = dpr;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${(cssWidth * OVERLAY_H) / OVERLAY_W}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(((cssWidth * OVERLAY_H) / OVERLAY_W) * dpr);
    this.drawn = -1;
  }

  start(): void {
    if (this.raf) return;
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      const profile = this.profile();
      if (this.input.version === this.drawn && profile === this.profileDrawn) return;
      this.drawn = this.input.version;
      this.profileDrawn = profile;
      try {
        this.draw(profile);
      } catch {
        // A drawing problem must never affect the show.
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(profile: ControllerProfile): void {
    const g = this.canvas.getContext('2d');
    if (!g || this.canvas.width === 0) return;
    const input = this.input;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.canvas.width / OVERLAY_W;
    g.setTransform(s, 0, 0, s, 0, 0);

    roundRect(g, 0.5, 0.5, OVERLAY_W - 1, OVERLAY_H - 1, 10);
    g.fillStyle = INK.body;
    g.fill();
    g.strokeStyle = INK.edge;
    g.lineWidth = 1;
    g.stroke();

    // Wheels: pitch (centre mark moves) and mod (fills up).
    const wheelY = 9;
    const wheelH = 40;
    for (const [i, x] of [10, 23].entries()) {
      roundRect(g, x, wheelY, 9, wheelH, 3);
      g.fillStyle = INK.wheel;
      g.fill();
      if (i === 0) {
        const y = wheelY + wheelH / 2 - input.pitchBend * (wheelH / 2 - 3);
        g.fillStyle = input.pitchBend !== 0 ? INK.held : INK.mark;
        g.fillRect(x + 1, y - 1.5, 7, 3);
      } else {
        const v = (input.cc[MOD_CC] ?? 0) / 127;
        g.fillStyle = INK.padLit;
        g.globalAlpha = 0.85;
        g.fillRect(x + 1, wheelY + wheelH - 1 - v * (wheelH - 2), 7, v * (wheelH - 2));
        g.globalAlpha = 1;
      }
    }
    // Sustain pedal.
    g.beginPath();
    g.arc(21, 54, 2.4, 0, Math.PI * 2);
    g.fillStyle = input.sustain ? INK.held : INK.knob;
    g.fill();

    // Pads: bottom row 1-4, top row 5-8, lit by velocity.
    const lit = new Map<number, number>();
    for (const [note, velocity] of input.held) {
      if (input.heldChannel.get(note) === profile.padChannel) {
        lit.set(padFor(note, profile).index, velocity);
      }
    }
    for (let i = 0; i < 8; i++) {
      const col = i % 4;
      const row = i < 4 ? 1 : 0;
      const x = 42 + col * 30;
      const y = 8 + row * 22;
      roundRect(g, x, y, 27, 19, 3);
      const v = lit.get(i);
      g.fillStyle = INK.pad;
      g.fill();
      if (v !== undefined) {
        g.globalAlpha = 0.45 + 0.55 * (v / 127);
        g.fillStyle = INK.padLit;
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // Knobs: two rows of four, indicator from -135° to +135°.
    for (let i = 0; i < 8; i++) {
      const cx = 180 + (i % 4) * 29;
      const cy = 17 + Math.floor(i / 4) * 22;
      g.beginPath();
      g.arc(cx, cy, 8.5, 0, Math.PI * 2);
      g.fillStyle = INK.knob;
      g.fill();
      const cc = profile.knobCCs[i] ?? -1;
      const v = cc >= 0 ? (input.cc[cc] ?? 0) / 127 : 0;
      const a = (-135 + 270 * v - 90) * (Math.PI / 180);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      g.strokeStyle = v > 0 ? INK.held : INK.mark;
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.stroke();
    }

    // Keys: 25, following the octave being played.
    const keyHeld = [...input.held.keys()].filter(
      (n) => input.heldChannel.get(n) !== profile.padChannel,
    );
    const low = keysWindow(profile.keysLow, keyHeld);
    const { whites, blacks } = keyLayout(low);
    const kx = 8;
    const ky = 60;
    const kw = (OVERLAY_W - 16) / whites.length;
    const kh = 50;
    whites.forEach((note, i) => {
      const held = input.held.has(note) && input.heldChannel.get(note) !== profile.padChannel;
      g.fillStyle = held ? INK.held : INK.white;
      g.fillRect(kx + i * kw + 0.5, ky, kw - 1, kh);
      if (!held) {
        g.fillStyle = INK.whiteEdge;
        g.fillRect(kx + i * kw + 0.5, ky + kh - 2, kw - 1, 2);
      }
    });
    for (const b of blacks) {
      const held = input.held.has(b.note) && input.heldChannel.get(b.note) !== profile.padChannel;
      const x = kx + b.afterWhite * kw - kw * 0.3;
      g.fillStyle = held ? INK.heldDeep : INK.black;
      g.fillRect(x, ky, kw * 0.6, kh * 0.6);
    }
    g.fillStyle = INK.label;
    g.font = '500 7px "IBM Plex Mono", monospace';
    g.textBaseline = 'alphabetic';
    g.fillText(noteName(low), kx + 2, ky + kh - 5);
  }
}
