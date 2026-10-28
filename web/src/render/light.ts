// Per-cell lighting for the world area: a cool ambient, warm braziers and table lamp,
// glowing fungi, plus any dynamic lights for the frame, all darkened by a vignette and
// multiplied into each cell's colours. Light also spills a little of its own colour onto
// the ground, so pools of light show even on a dark floor, and rock never drops below a
// floor level, so the shape of the cave always reads. Light levels are quantised so cells
// far from a flickering source don't change every frame (the painter only redraws changed
// cells).
import { FACE, WALL, type Cave } from "./cave";
import { ASPECT } from "./geom";
import type { Grid } from "./grid";
import { light } from "./palette";
import { flicker } from "./noise";

export interface DynLight { x: number; y: number; color: [number, number, number]; radius: number; intensity: number }

const AMBIENT: [number, number, number] = [0.24, 0.27, 0.32];
const Q_STEPS = 24;
const SPILL = 20;   // how much light colour (0..255 per unit of light) tints the ground
const MAX = 1.3;    // brightest a cell gets, so the lamp never bleaches the stone

export class Lighting {
  private lr: Float32Array;
  private lg: Float32Array;
  private lb: Float32Array;
  private floor: Float32Array;

  constructor(private cave: Cave) {
    const n = cave.rect.w * cave.rect.h;
    this.lr = new Float32Array(n);
    this.lg = new Float32Array(n);
    this.lb = new Float32Array(n);
    this.floor = new Float32Array(n);
    for (let k = 0; k < n; k++) this.floor[k] = cave.kind[k] === FACE ? 0.8 : cave.kind[k] === WALL ? 0.6 : 0;
  }

  /** Intensity of static light `i` at time t, with flicker. */
  level(i: number, t: number): number {
    const L = this.cave.lights[i];
    const f = flicker(t * 7 + i * 3.1, L.seed) * 0.7 + flicker(t * 19, L.seed + 1) * 0.3;
    return Math.round(L.intensity * (1 - L.flick + 2 * L.flick * f) * 32) / 32;
  }

  compute(t: number, dyn: DynLight[]) {
    const { lr, lg, lb, cave } = this;
    lr.fill(AMBIENT[0]); lg.fill(AMBIENT[1]); lb.fill(AMBIENT[2]);
    for (let li = 0; li < cave.lights.length; li++) {
      const L = cave.lights[li];
      const I = this.level(li, t);
      const r = I * L.color[0], g = I * L.color[1], b = I * L.color[2];
      const { cells, weights } = L;
      for (let n = 0; n < cells.length; n++) {
        const k = cells[n], w = weights[n];
        lr[k] += r * w; lg[k] += g * w; lb[k] += b * w;
      }
    }
    const { x: wx, y: wy, w: W, h: H } = cave.rect;
    for (const d of dyn) {
      const ry = Math.ceil(d.radius / ASPECT);
      for (let j = Math.max(0, d.y - wy - ry); j <= Math.min(H - 1, d.y - wy + ry); j++) {
        for (let i = Math.max(0, Math.floor(d.x - wx - d.radius)); i <= Math.min(W - 1, Math.ceil(d.x - wx + d.radius)); i++) {
          const q = Math.hypot(wx + i - d.x, (wy + j - d.y) * ASPECT) / d.radius;
          if (q >= 1) continue;
          const w = (1 - q * q) * (1 - q * q) * d.intensity, k = j * W + i;
          lr[k] += d.color[0] * w; lg[k] += d.color[1] * w; lb[k] += d.color[2] * w;
        }
      }
    }
  }

  apply(g: Grid) {
    const { lr, lg, lb, cave, floor } = this;
    const { x: wx, y: wy, w: W, h: H } = cave.rect;
    const vig = cave.vignette;
    for (let j = 0; j < H; j++) {
      const row = (wy + j) * g.cols + wx;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, gi = row + i, v = vig[k], f = floor[k] * (0.6 + 0.4 * v);
        const r = Math.round(Math.min(MAX, Math.max(lr[k] * v, f)) * Q_STEPS) / Q_STEPS;
        const gg = Math.round(Math.min(MAX, Math.max(lg[k] * v, f)) * Q_STEPS) / Q_STEPS;
        const b = Math.round(Math.min(MAX, Math.max(lb[k] * v, f)) * Q_STEPS) / Q_STEPS;
        g.fg[gi] = light(g.fg[gi], r, gg, b);
        const c = light(g.bg[gi], r, gg, b);
        const sr = Math.max(0, r - AMBIENT[0]) * SPILL, sg = Math.max(0, gg - AMBIENT[1]) * SPILL,
          sb = Math.max(0, b - AMBIENT[2]) * SPILL;
        g.bg[gi] = (Math.min(255, ((c >> 16) & 255) + sr) << 16) | (Math.min(255, ((c >> 8) & 255) + sg) << 8) |
          Math.min(255, (c & 255) + sb);
      }
    }
  }
}
