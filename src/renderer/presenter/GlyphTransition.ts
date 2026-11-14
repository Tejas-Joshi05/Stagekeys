import {
  Container,
  Particle,
  ParticleContainer,
  Rectangle,
  RenderTexture,
  Texture,
  type Renderer,
} from 'pixi.js';
import { ATLAS_FONT_PX, sharedGlyphAtlas, type GlyphAtlas } from '../animations';
import { isDarkColour } from '../shared/util';
import {
  cellDelay,
  cellProgress,
  glyphAlpha,
  glyphGrid,
  glyphIndex,
  tileAlpha,
  TRANSITION_GLYPHS,
  type GlyphTransitionKind,
  type TransitionGlyphs,
} from './transitions';

/*
 * The ASCII transitions. The old slide is photographed once into a texture
 * and cut into character cells; each cell is a GPU particle showing its piece
 * of the photograph. The cells then turn over one after another (the order is
 * the transition), each flickering through a few glyphs as its piece of the
 * old slide fades and the live new slide shows through.
 *
 * Everything is pooled: after the first transition nothing is allocated, and
 * a cell that is not turning this frame is not touched.
 */

export interface GlyphTransitionOptions {
  kind: GlyphTransitionKind;
  direction: 1 | -1;
  cell: number;
  glyphs: TransitionGlyphs;
  /** Background colours of the two slides, to pick inks that show on each. */
  outgoingBackground: string;
  incomingBackground: string;
}

const LIGHT_INK = 0xefe6d8;
const DARK_INK = 0x2b2a22;
const ACCENT_ON_DARK = 0xd8a4af;
const ACCENT_ON_LIGHT = 0xb97f8c;
/** One cell in this many is printed in the second ink. */
const ACCENT_SHARE = 0.14;

interface Pool {
  key: string;
  cols: number;
  rows: number;
  snapshot: RenderTexture;
  pieces: Texture[];
  tiles: ParticleContainer<Particle>;
  tileCells: Particle[];
  ink: ParticleContainer<Particle>;
  inkCells: Particle[];
  delay: Float32Array;
  /** 0 not started, 1 turning, 2 done: lets settled cells be skipped. */
  state: Uint8Array;
  accent: Uint8Array;
  shown: Int16Array;
}

export class GlyphTransition {
  readonly root = new Container();
  private pool: Pool | null = null;
  private atlas: GlyphAtlas | null = null;
  private inkOut = LIGHT_INK;
  private inkIn = LIGHT_INK;
  private accentOut = ACCENT_ON_DARK;
  private accentIn = ACCENT_ON_DARK;
  private running = false;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.root.visible = false;
  }

  get active(): boolean {
    return this.running;
  }

  /**
   * Photographs `outgoing` (which must not be attached to anything) and gets
   * the cells ready. Returns false if it could not, in which case the caller
   * should simply cut.
   */
  start(renderer: Renderer, outgoing: Container, options: GlyphTransitionOptions): boolean {
    try {
      const chars = TRANSITION_GLYPHS[options.glyphs];
      const atlas = sharedGlyphAtlas(chars, 'IBM Plex Mono');
      if (!atlas || atlas.glyphs.length < 2) return false;
      const resolution = Math.min(2, Math.max(1, renderer.resolution));
      const pool = this.poolFor(atlas, chars, options.cell, resolution);
      renderer.render({ container: outgoing, target: pool.snapshot, clear: true });

      const { cols, rows } = pool;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          pool.delay[r * cols + c] = cellDelay(options.kind, c, r, cols, rows, options.direction);
        }
      }
      pool.state.fill(0);
      pool.shown.fill(-1);
      for (const tile of pool.tileCells) tile.alpha = 1;
      for (const glyph of pool.inkCells) glyph.alpha = 0;

      const outDark = isDarkColour(options.outgoingBackground);
      const inDark = isDarkColour(options.incomingBackground);
      this.inkOut = outDark ? LIGHT_INK : DARK_INK;
      this.inkIn = inDark ? LIGHT_INK : DARK_INK;
      this.accentOut = outDark ? ACCENT_ON_DARK : ACCENT_ON_LIGHT;
      this.accentIn = inDark ? ACCENT_ON_DARK : ACCENT_ON_LIGHT;

      this.root.visible = true;
      this.running = true;
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  /** Draws the transition at progress t (0..1). */
  update(t: number): void {
    const pool = this.pool;
    const atlas = this.atlas;
    if (!pool || !atlas || !this.running) return;
    const glyphs = atlas.glyphs;
    const count = pool.delay.length;
    for (let i = 0; i < count; i++) {
      const u = cellProgress(t, pool.delay[i] ?? 0);
      const tile = pool.tileCells[i];
      const glyph = pool.inkCells[i];
      if (!tile || !glyph) continue;
      if (u <= 0) continue; // Still showing the old slide, as set up by start().
      if (u >= 1) {
        if (pool.state[i] !== 2) {
          pool.state[i] = 2;
          tile.alpha = 0;
          glyph.alpha = 0;
        }
        continue;
      }
      pool.state[i] = 1;
      tile.alpha = tileAlpha(u);
      glyph.alpha = glyphAlpha(u);
      const ix = glyphIndex(u, i, glyphs.length);
      if (ix !== pool.shown[i]) {
        pool.shown[i] = ix;
        const texture = glyphs[ix];
        if (texture) glyph.texture = texture;
      }
      // The ink that shows on the old slide first, then the one for the new.
      const late = u > 0.45;
      glyph.tint =
        pool.accent[i] === 1
          ? late
            ? this.accentIn
            : this.accentOut
          : late
            ? this.inkIn
            : this.inkOut;
    }
  }

  /** Hides the layer. The pool is kept for the next transition. */
  stop(): void {
    this.running = false;
    this.root.visible = false;
  }

  private poolFor(atlas: GlyphAtlas, chars: string, cell: number, resolution: number): Pool {
    const grid = glyphGrid(this.width, this.height, cell);
    const key = `${grid.cols}x${grid.rows}@${resolution}|${chars}`;
    if (this.pool && this.pool.key === key) return this.pool;
    this.dropPool();
    this.atlas = atlas;

    const { cols, rows } = grid;
    const size = grid.cell;
    const W = this.width;
    const H = this.height;
    const snapshot = RenderTexture.create({ width: W, height: H, resolution });
    const bounds = new Rectangle(0, 0, W, H);
    const tiles = new ParticleContainer<Particle>({
      texture: snapshot,
      dynamicProperties: {
        position: false,
        uvs: false,
        color: true,
        vertex: false,
        rotation: false,
      },
    });
    const ink = new ParticleContainer<Particle>({
      texture: atlas.sheet,
      dynamicProperties: {
        position: false,
        uvs: true,
        color: true,
        vertex: false,
        rotation: false,
      },
    });
    tiles.boundsArea = bounds;
    ink.boundsArea = bounds;

    const empty = atlas.glyphs[0] as Texture;
    const scale = (size * 1.04) / ATLAS_FONT_PX;
    const pieces: Texture[] = [];
    const tileCells: Particle[] = [];
    const inkCells: Particle[] = [];
    const accent = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * size;
        const y = r * size;
        const piece = new Texture({
          source: snapshot.source,
          frame: new Rectangle(x, y, Math.min(size, W - x), Math.min(size, H - y)),
        });
        pieces.push(piece);
        tileCells.push(tiles.addParticle(new Particle({ texture: piece, x, y, alpha: 1 })));
        inkCells.push(
          ink.addParticle(
            new Particle({
              texture: empty,
              x: x + size / 2,
              y: y + size / 2,
              scaleX: scale,
              scaleY: scale,
              anchorX: 0.5,
              anchorY: 0.5,
              alpha: 0,
            }),
          ),
        );
        // A fixed scatter, so the second ink does not jump about between transitions.
        const n = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
        accent[r * cols + c] = n - Math.floor(n) < ACCENT_SHARE ? 1 : 0;
      }
    }
    this.root.addChild(tiles, ink);
    this.pool = {
      key,
      cols,
      rows,
      snapshot,
      pieces,
      tiles,
      tileCells,
      ink,
      inkCells,
      delay: new Float32Array(cols * rows),
      state: new Uint8Array(cols * rows),
      accent,
      shown: new Int16Array(cols * rows).fill(-1),
    };
    return this.pool;
  }

  private dropPool(): void {
    const pool = this.pool;
    this.pool = null;
    if (!pool) return;
    this.root.removeChild(pool.tiles, pool.ink);
    pool.tiles.destroy();
    pool.ink.destroy();
    for (const piece of pool.pieces) piece.destroy(false);
    pool.snapshot.destroy(true);
  }

  /** The glyph atlas is shared and stays; everything else goes. */
  destroy(): void {
    this.stop();
    this.dropPool();
    this.atlas = null;
    this.root.destroy({ children: true });
  }
}
