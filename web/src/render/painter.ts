// Paints a World onto two stacked canvases.
//
// The background light is a tiny canvas, one pixel per cell, that CSS scales up by an exact
// whole number of device pixels per cell with nearest-neighbour sampling: each cell gets a
// crisp block of colour, and updating it is a single putImageData. The glyphs go on a
// transparent canvas above it, at device resolution, every glyph on whole device pixels. Glyphs come from an atlas (each glyph x colour pair is drawn once with
// fillText, then copied with drawImage), and only cells whose glyph or colour changed since
// the last step are cleared and redrawn.
import type { World } from "./world";

const SPACE = 32;

class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<number, number>();
  private readonly perRow = 64;
  private readonly cap = 64 * 96;
  resets = 0;

  constructor(private cw: number, private ch: number, private font: string) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.perRow * cw;
    this.canvas.height = Math.ceil(this.cap / this.perRow) * ch;
    this.ctx = this.canvas.getContext("2d")!;
    this.reset();
  }

  get size() { return this.slots.size; }

  private reset() {
    this.resets++;
    this.slots.clear();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.font = this.font;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
  }

  /** Slot for a glyph in a 12-bit colour, drawing it on first use. Returns -1 after a reset. */
  slot(code: number, c12: number): number {
    const key = code * 4096 + c12;
    let s = this.slots.get(key);
    if (s !== undefined) return s;
    if (this.slots.size >= this.cap) this.reset();
    s = this.slots.size;
    this.slots.set(key, s);
    const x = (s % this.perRow) * this.cw, y = Math.floor(s / this.perRow) * this.ch;
    const r = (c12 >> 8) & 15, g = (c12 >> 4) & 15, b = c12 & 15;
    this.ctx.fillStyle = `rgb(${r * 17},${g * 17},${b * 17})`;
    this.ctx.fillText(String.fromCodePoint(code), x + this.cw / 2, y + this.ch / 2 + 0.5, this.cw);
    return s;
  }

  draw(ctx: CanvasRenderingContext2D, s: number, dx: number, dy: number) {
    ctx.drawImage(this.canvas, (s % this.perRow) * this.cw, Math.floor(s / this.perRow) * this.ch,
      this.cw, this.ch, dx, dy, this.cw, this.ch);
  }
}

export class WorldPainter {
  private atlas: GlyphAtlas;
  private glowCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private prevGlyph: Uint32Array;
  private prevColor: Uint16Array;
  private cw: number;
  private ch: number;
  /** cells redrawn by the last paint, for timing */
  lastCells = 0;

  /**
   * @param glow a canvas sized cols x rows; the caller stretches it over the window with CSS
   * @param glyphs a transparent canvas at device resolution
   */
  constructor(glow: HTMLCanvasElement, private ctx: CanvasRenderingContext2D, private world: World,
    fontFamily: string, dpr: number, fontSize: number) {
    const { L } = world;
    this.cw = Math.round(L.cell.w * dpr);
    this.ch = Math.round(L.cell.h * dpr);
    this.atlas = new GlyphAtlas(this.cw, this.ch, `${fontSize * dpr}px ${fontFamily}`);
    glow.width = world.cols;
    glow.height = world.rows;
    this.glowCtx = glow.getContext("2d")!;
    this.image = new ImageData(world.cols, world.rows);
    this.prevGlyph = new Uint32Array(world.n).fill(0xffffffff);
    this.prevColor = new Uint16Array(world.n);
  }

  get atlasInfo() { return { size: this.atlas.size, resets: this.atlas.resets }; }

  paint() {
    const { ctx, world, cw, ch, atlas, prevGlyph, prevColor } = this;
    const { glyph, color, cols } = world;
    this.image.data.set(world.bg);
    this.glowCtx.putImageData(this.image, 0, 0);
    let cells = 0;
    for (let k = 0; k < glyph.length; k++) {
      const c = glyph[k], col = color[k];
      if (c === prevGlyph[k] && (col === prevColor[k] || c === SPACE)) continue;
      const x = (k % cols) * cw, y = ((k / cols) | 0) * ch;
      if (prevGlyph[k] !== SPACE) ctx.clearRect(x, y, cw, ch);
      prevGlyph[k] = c; prevColor[k] = col;
      if (c !== SPACE) atlas.draw(ctx, atlas.slot(c, col), x, y);
      cells++;
    }
    this.lastCells = cells;
  }
}
