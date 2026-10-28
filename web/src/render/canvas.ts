// Paints a Grid onto a canvas. Shade blocks (░▒▓█) are drawn as alpha-filled rectangles,
// not font glyphs, so they tile seamlessly in any font.
import { BG } from "./palette";
import type { Grid } from "./grid";

const SHADE: Record<string, number> = { "░": 0.22, "▒": 0.45, "▓": 0.7, "█": 1 };

export interface Metrics {
  cellW: number;
  cellH: number;
  fontSize: number;
}

export function measure(ctx: CanvasRenderingContext2D, fontFamily: string, fontSize: number): Metrics {
  ctx.font = `${fontSize}px ${fontFamily}`;
  const cellW = Math.ceil(ctx.measureText("M").width);
  return { cellW, cellH: Math.ceil(fontSize * 1.45), fontSize };
}

export function paint(ctx: CanvasRenderingContext2D, grid: Grid, m: Metrics, fontFamily: string) {
  const { cellW, cellH, fontSize } = m;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, grid.cols * cellW, grid.rows * cellH);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const c = grid.cells[y * grid.cols + x];
      const px = x * cellW, py = y * cellH;
      if (c.bg) {
        ctx.fillStyle = c.bg;
        ctx.fillRect(px, py, cellW, cellH);
      }
      if (c.ch === " ") continue;
      const shade = SHADE[c.ch];
      if (shade !== undefined) {
        ctx.globalAlpha = shade;
        ctx.fillStyle = c.fg;
        ctx.fillRect(px, py, cellW, cellH);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = c.fg;
      ctx.fillText(c.ch, px + cellW / 2, py + cellH / 2 + 1);
    }
  }
}
