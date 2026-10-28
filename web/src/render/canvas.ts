// Paints a Grid onto a canvas. Only cells that changed since the last frame are redrawn.
// Shade blocks (░▒▓█), half blocks (▀▄▌▐) and box-drawing lines are drawn as rectangles,
// not font glyphs, so they tile seamlessly in any font and borders never show gaps.
import { css, mix } from "./palette";
import type { Grid } from "./grid";

export interface Metrics {
  cellW: number;   // device pixels
  cellH: number;
  fontSize: number;
}

export const LINE_HEIGHT = 1.25;

export function measure(ctx: CanvasRenderingContext2D, fontFamily: string, fontSize: number): Metrics {
  ctx.font = `${fontSize}px ${fontFamily}`;
  const cellW = Math.max(1, Math.round(ctx.measureText("M").width));
  return { cellW, cellH: Math.round(fontSize * LINE_HEIGHT), fontSize };
}

const SHADE: Record<number, number> = { 0x2591: 0.22, 0x2592: 0.45, 0x2593: 0.7, 0x2588: 1 };
const HALF: Record<number, [number, number, number, number]> = {   // x, y, w, h in cell fractions
  0x2580: [0, 0, 1, 0.5], 0x2584: [0, 0.5, 1, 0.5], 0x258c: [0, 0, 0.5, 1], 0x2590: [0.5, 0, 0.5, 1],
};
// single-line box drawing: arms [up, down, left, right]
const BOX1: Record<number, [number, number, number, number]> = {
  0x2500: [0, 0, 1, 1], 0x2502: [1, 1, 0, 0], 0x250c: [0, 1, 0, 1], 0x2510: [0, 1, 1, 0],
  0x2514: [1, 0, 0, 1], 0x2518: [1, 0, 1, 0], 0x251c: [1, 1, 0, 1], 0x2524: [1, 1, 1, 0],
  0x252c: [0, 1, 1, 1], 0x2534: [1, 0, 1, 1], 0x253c: [1, 1, 1, 1],
};
// double-line straights and corners: [horizontal dir, vertical dir] (0 = straight)
const BOX2: Record<number, [number, number]> = {
  0x2550: [2, 0], 0x2551: [0, 2], 0x2554: [1, 1], 0x2557: [-1, 1], 0x255a: [1, -1], 0x255d: [-1, -1],
};

export class Painter {
  private prevCh = new Uint32Array(0);
  private prevFg = new Uint32Array(0);
  private prevBg = new Uint32Array(0);
  private glyphs = new Map<number, string>();
  private m: Metrics = { cellW: 8, cellH: 16, fontSize: 13 };

  constructor(private ctx: CanvasRenderingContext2D, private fontFamily: string) {}

  /** Call after the canvas is resized: forgets the previous frame so everything repaints. */
  reset(cols: number, rows: number, m: Metrics) {
    this.m = m;
    const n = cols * rows;
    this.prevCh = new Uint32Array(n).fill(0xffffffff);
    this.prevFg = new Uint32Array(n);
    this.prevBg = new Uint32Array(n);
    const ctx = this.ctx;
    ctx.font = `${m.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
  }

  paint(g: Grid) {
    const { ctx } = this;
    const { cellW, cellH } = this.m;
    const { ch, fg, bg, cols, rows } = g;
    const { prevCh, prevFg, prevBg } = this;
    if (prevCh.length !== ch.length) return;
    const lw = Math.max(1, Math.round(cellW / 9));
    const gap = Math.max(lw + 1, Math.round(cellW * 0.2));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const c = ch[i], f = fg[i], b = bg[i];
        if (c === prevCh[i] && f === prevFg[i] && b === prevBg[i]) continue;
        prevCh[i] = c; prevFg[i] = f; prevBg[i] = b;
        const px = x * cellW, py = y * cellH;
        const shade = SHADE[c];
        if (shade !== undefined) {
          ctx.fillStyle = css(mix(b, f, shade));
          ctx.fillRect(px, py, cellW, cellH);
          continue;
        }
        ctx.fillStyle = css(b);
        ctx.fillRect(px, py, cellW, cellH);
        if (c === 32) continue;
        ctx.fillStyle = css(f);
        const half = HALF[c];
        if (half) {
          const x0 = Math.round(px + half[0] * cellW), y0 = Math.round(py + half[1] * cellH);
          ctx.fillRect(x0, y0, Math.round(px + (half[0] + half[2]) * cellW) - x0,
            Math.round(py + (half[1] + half[3]) * cellH) - y0);
          continue;
        }
        const b1 = BOX1[c];
        if (b1) { this.box1(px, py, b1, lw); continue; }
        const b2 = BOX2[c];
        if (b2) { this.box2(px, py, b2, lw, gap); continue; }
        let s = this.glyphs.get(c);
        if (s === undefined) { s = String.fromCodePoint(c); this.glyphs.set(c, s); }
        ctx.fillText(s, px + cellW / 2, py + cellH / 2 + 1, cellW + 1);
      }
    }
  }

  private hline(x0: number, x1: number, y: number, lw: number) {
    const a = Math.round(Math.min(x0, x1)), b = Math.round(Math.max(x0, x1));
    this.ctx.fillRect(a, Math.round(y - lw / 2), b - a, lw);
  }

  private vline(y0: number, y1: number, x: number, lw: number) {
    const a = Math.round(Math.min(y0, y1)), b = Math.round(Math.max(y0, y1));
    this.ctx.fillRect(Math.round(x - lw / 2), a, lw, b - a);
  }

  private box1(px: number, py: number, [u, d, l, r]: number[], lw: number) {
    const { cellW, cellH } = this.m;
    const cx = px + Math.floor(cellW / 2), cy = py + Math.floor(cellH / 2);
    const h = lw / 2;
    if (l) this.hline(px, cx + h, cy, lw);
    if (r) this.hline(cx - h, px + cellW, cy, lw);
    if (u) this.vline(py, cy + h, cx, lw);
    if (d) this.vline(cy - h, py + cellH, cx, lw);
  }

  private box2(px: number, py: number, [sx, sy]: number[], lw: number, g: number) {
    const { cellW, cellH } = this.m;
    const cx = px + Math.floor(cellW / 2), cy = py + Math.floor(cellH / 2);
    const h = lw / 2;
    if (sy === 0) { this.hline(px, px + cellW, cy - g, lw); this.hline(px, px + cellW, cy + g, lw); return; }
    if (sx === 0) { this.vline(py, py + cellH, cx - g, lw); this.vline(py, py + cellH, cx + g, lw); return; }
    const ex = sx > 0 ? px + cellW : px, ey = sy > 0 ? py + cellH : py;
    // outer corner
    this.hline(cx - sx * (g + h), ex, cy - sy * g, lw);
    this.vline(cy - sy * (g + h), ey, cx - sx * g, lw);
    // inner corner
    this.hline(cx + sx * (g - h), ex, cy + sy * g, lw);
    this.vline(cy + sy * (g - h), ey, cx + sx * g, lw);
  }
}
