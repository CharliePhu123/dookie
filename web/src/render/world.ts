// The world layer: the cave drawn as an ASCII shader on a fine grid.
//
// Every cell has a material (rock, floor, felt, stone rim, rug, water, sky...), an albedo
// and a base colour, fixed when the room is built. Each step, light from the hanging lamp,
// the braziers, glowing fungus and the daylight down the passage is summed per cell,
// darkened by the vignette, hazed by drifting fog, tone-mapped, and turned into a glyph from
// the material's density ramp (dithered) and a quantised colour. Things that move (dust in
// the lamplight, flames and heat shimmer, embers, ripples, the watchers in the dark) are
// drawn on top of that field. The output is three arrays the painter turns into pixels.
//
// The game state reaches the world only through Mood, so the engine can drive tension.
import type { Layout } from "./layout";
import { tableEdge } from "./layout";
import { fbm, flicker, hash } from "./noise";

export interface Mood {
  /** 0..1: how big the pot is against the stacks still in the hand */
  tension: number;
  allIn: boolean;
  yourTurn: boolean;
  /** seat index whose turn it is (glows), and its colour */
  acting: number | null;
  actingColor: number;
}

export const CALM: Mood = { tension: 0, allIn: false, yourTurn: false, acting: null, actingColor: 0 };

const ROCK = 0, FLOOR = 1, FELT = 2, RIM = 3, RUG = 4, WATER = 5, SKY = 6, FIXED = 7;

const ramp = (s: string) => Array.from(s, (c) => c.codePointAt(0)!);
const RAMPS: number[][] = [
  ramp(" .,:;=+*#%@"),    // rock
  ramp(" ..,,:;"),        // floor
  ramp(" .,::;;"),        // felt
  ramp(" .:=+*#%"),       // stone rim
  ramp(" .,:;+x%"),       // rug
  ramp(" .-~~≈"),         // water
  ramp(" .-~=≈"),         // sky / dunes
];
// how strongly each material's brightness drives glyph density
const EXPOSE = [2.3, 2.6, 1.35, 1.9, 2.1, 2.0, 1, 2];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const SPACE = 32;
const C = (s: string) => s.codePointAt(0)!;

interface LightMap { idx: Int32Array; w: Float32Array }
interface Brazier { x: number; y: number; i: number; j: number; map: LightMap; seed: number }
interface Watcher { hx: number; hy: number; mask: string[]; eye: [number, number, number]; seed: number }

const MASKS = [
  [".##.", "#ee#", "####", "####", "####", ".##."],
  [".###.", "#e#e#", "#####", "#####", ".#.#."],
  ["##", "ee", "##", "##"],
  [".##.", "#ee#", "####", "#..#"],
];
const EYES: [number, number, number][] = [[1, 0.72, 0.3], [0.6, 0.95, 0.45], [0.95, 0.35, 0.25], [0.7, 0.85, 1]];

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class World {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  // static
  private mat: Uint8Array;
  private alb: Float32Array;
  private base: Float32Array;     // rgb per cell
  private fixed: Uint32Array;     // glyph for FIXED cells
  private glow: Float32Array;     // how much of the lit colour shows as background
  private vig: Float32Array;
  private focus: Float32Array;
  private lamp: LightMap;
  private lampTight: LightMap;
  private hot: LightMap;
  private day: LightMap;
  private fungi: { map: LightMap; color: [number, number, number] }[] = [];
  private braziers: Brazier[] = [];
  private watchers: Watcher[] = [];
  private water: Int32Array;
  private motes: Float32Array;    // x, y, phase per mote
  // per step
  private lr: Float32Array;
  private lg: Float32Array;
  private lb: Float32Array;
  readonly glyph: Uint32Array;
  readonly color: Uint16Array;    // 4 bits per channel
  readonly bg: Uint8ClampedArray; // rgba per cell, painted smoothed as the glow under the glyphs
  private lean = 0;
  private lastT = 0;
  private fog: Float32Array;
  private fogTick = -1;
  private seatLights = new Map<number, LightMap>();

  constructor(readonly L: Layout, readonly seed = 7) {
    const { cols, rows } = L;
    this.cols = cols; this.rows = rows;
    const n = (this.n = cols * rows);
    this.mat = new Uint8Array(n);
    this.alb = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.fixed = new Uint32Array(n);
    this.glow = new Float32Array(n);
    this.vig = new Float32Array(n);
    this.focus = new Float32Array(n);
    this.lr = new Float32Array(n); this.lg = new Float32Array(n); this.lb = new Float32Array(n);
    this.glyph = new Uint32Array(n).fill(SPACE);
    this.color = new Uint16Array(n);
    this.bg = new Uint8ClampedArray(n * 4);
    this.fog = new Float32Array(((cols >> 2) + 3) * ((rows >> 1) + 3));
    const water: number[] = [];
    this.build(water);
    this.water = Int32Array.from(water);
    const t = L.table;
    this.lamp = this.ellipseLight(t.cx, t.cy, t.a * 1.9, t.b * 2.4);
    this.lampTight = this.ellipseLight(t.cx, t.cy, t.a * 1.1, t.b * 1.22);
    this.hot = this.ellipseLight(t.cx, t.cy - t.b * 0.1, t.a * 0.75, t.b * 0.85);
    this.day = this.pointLight(this.passageX(), 0, L.phone ? 160 : 260);
    // dust motes live in the lamplight
    const nm = L.phone ? 50 : 110;
    this.motes = new Float32Array(nm * 3);
    for (let i = 0; i < nm; i++) {
      const ang = hash(i, 1, seed) * Math.PI * 2, r = Math.sqrt(hash(i, 2, seed));
      this.motes[i * 3] = t.cx + Math.cos(ang) * r * t.a * 1.35;
      this.motes[i * 3 + 1] = t.cy + Math.sin(ang) * r * t.b * 1.5;
      this.motes[i * 3 + 2] = hash(i, 3, seed);
    }
  }

  private px(i: number) { return (i + 0.5) * this.L.cell.w; }
  private py(j: number) { return (j + 0.5) * this.L.cell.h; }
  private passageX() { return this.L.W * (this.L.phone ? 0.72 : 0.3); }

  // ---- building the room --------------------------------------------------------------

  private build(water: number[]) {
    const { L, seed, cols, rows } = this;
    const { W, H, table } = L;
    const scale = L.phone ? 0.75 : 1;
    const pX = this.passageX();
    const inSeat = (x: number, y: number, pad: number) => L.seats.some(({ box: b }) =>
      x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
    const p = L.prompt;
    const rug0 = 16 * scale, rug1 = 84 * scale;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i, x = this.px(i), y = this.py(j);
        const e = tableEdge(table, x, y);
        // vignettes: deep, centred on the table; and a focus one leaning toward your seat
        const vx = (x - table.cx) / (W * 0.62), vy = (y - table.cy) / (H * 0.66);
        const r2 = vx * vx + vy * vy;
        this.vig[k] = Math.max(0.16, Math.min(1, 1.2 - r2 * 1.0));
        const you = L.seats[0]?.anchor ?? { x: table.cx, y: table.cy };
        const fx = (x - table.cx) / (W * 0.5), fy = (y - (table.cy + you.y) / 2) / (H * 0.55);
        this.focus[k] = Math.max(0.08, Math.min(1, 1.15 - (fx * fx + fy * fy) * 1.5));

        // room shape: rock round the edges, a passage up to the daylight
        const u = (x - W / 2) / (W / 2), v = (y - H * 0.47) / (H * 0.53);
        const rr = Math.pow(Math.pow(Math.abs(u), 2.6) + Math.pow(Math.abs(v), 2.6), 1 / 2.6);
        let wall = rr + (fbm(x / 110, y / 80, seed) - 0.5) * 0.55 > 0.9;
        if (!wall && e > 120 && !inSeat(x, y, 60)) wall = fbm(x / 70, y / 55, seed + 99) > 0.74;
        const pw = pX + Math.sin(y / 45) * 12;
        if (y < H * 0.3 && Math.abs(x - pw) < 26 * scale) wall = false;
        if (e < 40 || inSeat(x, y, 24)) wall = false;

        const n1 = fbm(x / 22, y / 16, seed + 5, 2);
        let m = FLOOR, alb = 0.5, R = 0.5, G = 0.46, B = 0.38, glow = 0.34;
        if (wall) {
          m = ROCK;
          const strata = fbm(x / 140, y / 18, seed + 61, 2);
          // bumps lit from the table side
          const h0 = fbm(x / 26, y / 20, seed + 7, 2);
          const hx = fbm((x + 6) / 26, y / 20, seed + 7, 2) - h0, hy = fbm(x / 26, (y + 6) / 20, seed + 7, 2) - h0;
          const tx = table.cx - x, ty = table.cy - y, tl = Math.hypot(tx, ty) || 1;
          const shade = 0.75 + 6 * (-(hx * tx) - hy * ty) / tl;
          alb = Math.max(0.15, Math.min(1.2, (0.45 + 0.5 * strata) * shade));
          R = 0.62 + 0.1 * strata; G = 0.55; B = 0.46 - 0.06 * strata;
          glow = 0.3;
        } else if (e < 0) {
          if (e > -L.rimWidth) {
            // the stone rim: lit on its far side, a polished inner lip, shadowed outer edge
            m = RIM;
            const ny = (y - table.cy) / Math.max(1, Math.hypot(x - table.cx, y - table.cy));
            const lip = smoothstep(-L.rimWidth, -L.rimWidth + 4, e) * (1 - smoothstep(-L.rimWidth + 4, -L.rimWidth + 6, e));
            alb = (0.62 - 0.22 * ny + 0.12 * hash(i, j, seed + 43)) * (1 - 0.35 * smoothstep(-4, 0, e)) + 0.25 * (1 - lip);
            R = 0.8; G = 0.74; B = 0.62;
            glow = 0.55;
          } else {
            m = FELT;
            const inner = smoothstep(-L.rimWidth - 22, -L.rimWidth - 2, e);   // shade under the lip
            alb = (0.78 + 0.18 * fbm(x / 9, y / 7, seed + 41, 2)) * (1 - 0.4 * inner);
            R = 0.22; G = 0.58; B = 0.36;
            glow = 0.5;
          }
        } else {
          // floor: grit and salt; contact shadow round the table and under each seat
          const salt = fbm(x / 90, y / 60, seed + 31);
          alb = 0.42 + 0.3 * n1 + (salt > 0.62 ? (salt - 0.62) * 1.5 : 0);
          alb *= 0.45 + 0.55 * smoothstep(0, 46 * scale, e);
          if (inSeat(x, y, 10)) alb *= 0.55;
          // keep the ground quiet under the prompt and the log
          const under = Math.max(smoothstep(p.y - 40, p.y + 10, y) * (1 - smoothstep(p.x + p.w, p.x + p.w + 60, x)) * smoothstep(p.x - 60, p.x, x),
            L.phone ? 0 : smoothstep(H - 150, H - 100, y) * (1 - smoothstep(380, 480, x)));
          alb *= 1 - 0.65 * under;
          if (e > rug0 && e < rug1) {
            m = RUG;
            const band = e > rug1 - 12 * scale || e < rug0 + 5 * scale;
            R = band ? 0.66 : 0.58; G = band ? 0.48 : 0.24; B = band ? 0.24 : 0.17;
            alb = (band ? 0.7 : 0.55 + 0.25 * hash(i >> 1, j, seed + 83)) * (inSeat(x, y, 10) ? 0.6 : 1);
            glow = 0.38;
          } else if (fbm(x / 70, y / 40, seed + 17) > 0.69 && e > 90 && !inSeat(x, y, 30)) {
            m = WATER; water.push(k);
            alb = 0.7; R = 0.45; G = 0.62; B = 0.78; glow = 0.28;
          }
        }
        this.mat[k] = m; this.alb[k] = alb; this.glow[k] = glow;
        this.base[k * 3] = R; this.base[k * 3 + 1] = G; this.base[k * 3 + 2] = B;
      }
    }
    this.placeFungiAndGoods();
    this.placeBraziers();
    this.placeWatchers();
  }

  private placeFungiAndGoods() {
    const { cols, rows, seed, L } = this;
    let clusters = 0, goods = 0;
    for (let tries = 0; tries < 3000 && (clusters < 4 || goods < 5); tries++) {
      const i = 2 + Math.floor(hash(tries, 5, seed) * (cols - 4)), j = 2 + Math.floor(hash(tries, 6, seed) * (rows - 4));
      const k = j * cols + i;
      if (this.mat[k] !== FLOOR || tableEdge(L.table, this.px(i), this.py(j)) < 120 || this.busy(this.px(i), this.py(j))) continue;
      const nearRock = this.mat[k - 1] === ROCK || this.mat[k + 1] === ROCK || this.mat[k - cols] === ROCK || this.mat[k + cols] === ROCK;
      if (!nearRock) continue;
      if (clusters < 4 && hash(tries, 7, seed) < 0.5) {
        const cyan = clusters % 2 === 0;
        for (let d = 0; d < 7; d++) {
          const kk = k + Math.round((hash(d, tries, 1) - 0.5) * 6) + cols * Math.round((hash(d, tries, 2) - 0.5) * 3);
          if (kk < 0 || kk >= this.n || this.mat[kk] !== FLOOR) continue;
          this.mat[kk] = FIXED;
          this.fixed[kk] = C(d % 3 === 0 ? "♣" : d % 3 === 1 ? "τ" : "\"");
          this.alb[kk] = 1;
          this.base.set(cyan ? [0.45, 0.85, 0.9] : [0.85, 0.45, 0.88], kk * 3);
        }
        this.fungi.push({ map: this.pointLight(this.px(i), this.py(j), L.phone ? 40 : 60),
          color: cyan ? [0.25, 0.7, 0.8] : [0.7, 0.3, 0.75] });
        clusters++;
      } else if (goods < 5) {
        const pile = ["■■", "■Θ", "≡■", "Θ", "■"][goods];
        [...pile].forEach((g, d) => {
          const kk = k + d;
          if (this.mat[kk] !== FLOOR) return;
          this.mat[kk] = FIXED; this.fixed[kk] = C(g); this.alb[kk] = 0.9;
          this.base.set(g === "≡" ? [0.6, 0.3, 0.22] : [0.62, 0.48, 0.3], kk * 3);
        });
        goods++;
      }
    }
  }

  private placeBraziers() {
    const { L, cols, seed } = this;
    const n = L.seats.length;
    const t = L.table;
    // in the gaps between seats, nearest the diagonals
    const gaps = Array.from({ length: n }, (_, i) => Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n);
    const diag = [0.25, 0.75, 1.25, 1.75].map((d) => d * Math.PI);
    const chosen = new Set<number>();
    for (const d of diag) {
      let best = -1, bd = 9;
      gaps.forEach((g, gi) => {
        const dd = Math.abs(Math.atan2(Math.sin(g - d), Math.cos(g - d)));
        if (!chosen.has(gi) && dd < bd) { bd = dd; best = gi; }
      });
      if (best >= 0) chosen.add(best);
    }
    for (const gi of chosen) {
      const g = gaps[gi];
      for (let f = 1.25; f < 2.4; f += 0.03) {
        const x = t.cx + Math.cos(g) * (t.a + 60) * f, y = t.cy + Math.sin(g) * (t.b + 50) * f;
        if (x < 30 || y < 50 || x > L.W - 30 || this.busy(x, y)) break;
        const i = Math.floor(x / L.cell.w), j = Math.floor(y / L.cell.h);
        if (this.mat[j * cols + i] !== FLOOR) continue;
        if (L.seats.some(({ box: b }) => x > b.x - 30 && x < b.x + b.w + 30 && y > b.y - 40 && y < b.y + b.h + 30)) continue;
        this.braziers.push({ x, y, i, j, seed: seed + gi * 13,
          map: this.pointLight(x, y - 8, L.phone ? 110 : 170) });
        break;
      }
    }
  }

  private placeWatchers() {
    const { L, seed } = this;
    const t = L.table;
    const want = L.phone ? 4 : 8;
    for (let tries = 0; tries < 400 && this.watchers.length < want; tries++) {
      const ang = hash(tries, 31, seed) * Math.PI * 2;
      const f = 1 + 0.25 * hash(tries, 32, seed);
      const x = t.cx + Math.cos(ang) * (t.a + (L.phone ? 90 : 230)) * f;
      const y = t.cy + Math.sin(ang) * (t.b + (L.phone ? 110 : 150)) * f;
      if (x < 40 || x > L.W - 40 || y < 60 || this.busy(x, y)) continue;
      const i = Math.floor(x / L.cell.w), j = Math.floor(y / L.cell.h);
      const m = this.mat[j * this.cols + i];
      if (m !== FLOOR && m !== RUG) continue;
      if (L.seats.some(({ box: b }) => x > b.x - 40 && x < b.x + b.w + 40 && y > b.y - 40 && y < b.y + b.h + 40)) continue;
      if (this.braziers.some((b) => Math.hypot(b.x - x, b.y - y) < 70)) continue;
      if (this.watchers.some((w) => Math.hypot(w.hx - x, w.hy - y) < 90)) continue;
      this.watchers.push({ hx: x, hy: y, mask: MASKS[Math.floor(hash(tries, 33, seed) * MASKS.length)],
        eye: EYES[Math.floor(hash(tries, 34, seed) * EYES.length)], seed: seed + tries });
    }
  }

  /** Near the prompt, the log or the HUD, where the world should stay quiet. */
  private busy(x: number, y: number) {
    const { L } = this, p = L.prompt;
    if (y > p.y - 40) return true;
    if (!L.phone && y > L.H - 170 && x < 500) return true;
    return y < (L.phone ? 60 : 50);
  }

  private ellipseLight(cx: number, cy: number, rx: number, ry: number): LightMap {
    const idx: number[] = [], w: number[] = [];
    const { cols, rows } = this;
    for (let j = Math.max(0, Math.floor((cy - ry) / this.L.cell.h)); j < Math.min(rows, Math.ceil((cy + ry) / this.L.cell.h)); j++)
      for (let i = Math.max(0, Math.floor((cx - rx) / this.L.cell.w)); i < Math.min(cols, Math.ceil((cx + rx) / this.L.cell.w)); i++) {
        const d = Math.hypot((this.px(i) - cx) / rx, (this.py(j) - cy) / ry);
        if (d >= 1) continue;
        idx.push(j * cols + i);
        w.push((1 - d * d) * (1 - d * d) * (1 - 0.25 * d));
      }
    return { idx: Int32Array.from(idx), w: Float32Array.from(w) };
  }

  private pointLight(x: number, y: number, r: number) { return this.ellipseLight(x, y, r, r * 0.8); }

  // ---- each step ----------------------------------------------------------------------

  step(t: number, mood: Mood) {
    const dt = Math.min(0.25, Math.max(0, t - this.lastT));
    this.lastT = t;
    const target = mood.allIn ? 1 : Math.min(1, mood.tension * 0.8);
    this.lean += (target - this.lean) * Math.min(1, dt * 0.8);
    this.light(t, mood);
    this.shade(t, mood);
    this.animate(t);
  }

  private add(map: LightMap, r: number, g: number, b: number) {
    const { lr, lg, lb } = this;
    const { idx, w } = map;
    for (let n = 0; n < idx.length; n++) {
      const k = idx[n], q = w[n];
      lr[k] += r * q; lg[k] += g * q; lb[k] += b * q;
    }
  }

  private light(t: number, mood: Mood) {
    const { lr, lg, lb } = this;
    const all = mood.allIn ? 1 : 0;
    const amb = 0.075 * (1 - 0.5 * all);
    lr.fill(amb); lg.fill(amb * 1.1); lb.fill(amb * 1.4);
    // the hanging lamp: warmer and brighter as the pot grows; tight and pulsing on all-in
    const ten = Math.min(1, mood.tension);
    const pulse = all ? 1 + 0.16 * Math.sin(t * 2.4) : 1 + 0.02 * Math.sin(t * 0.7);
    const I = (1.0 + 0.35 * ten) * pulse;
    const lr0 = 1.1 + 0.2 * ten, lg0 = 0.98 - 0.05 * ten, lb0 = 0.8 - 0.22 * ten;
    this.add(this.lamp, lr0 * I * (1 - 0.85 * all), lg0 * I * (1 - 0.85 * all), lb0 * I * (1 - 0.85 * all));
    if (all) this.add(this.lampTight, lr0 * I * 1.2, lg0 * I * 1.05, lb0 * I * 0.9);
    this.add(this.hot, lr0 * I * 0.45, lg0 * I * 0.42, lb0 * I * 0.36);
    for (const b of this.braziers) {
      const f = 0.82 + 0.3 * (flicker(t * 5, b.seed) - 0.5) + 0.12 * (flicker(t * 13, b.seed + 1) - 0.5);
      const q = Math.round(f * 16) / 16 * (1 - 0.45 * all);
      this.add(b.map, 1.5 * q, 0.75 * q, 0.27 * q);
    }
    for (const f of this.fungi) {
      const q = 0.8 + 0.2 * flicker(t * 0.4, f.color[0] * 10);
      this.add(f.map, f.color[0] * q, f.color[1] * q, f.color[2] * q);
    }
    this.add(this.day, 0.62 * (1 - 0.4 * all), 0.7 * (1 - 0.4 * all), 0.85 * (1 - 0.4 * all));
    // whoever is thinking glows faintly in their own colour
    if (mood.acting !== null && this.L.seats[mood.acting]) {
      const s = this.L.seats[mood.acting].anchor;
      const c = mood.actingColor, p = 0.22 + 0.1 * Math.sin(t * 3);
      let map = this.seatLights.get(mood.acting);
      if (!map) {
        map = this.pointLight(s.x, s.y, this.L.phone ? 60 : 110);
        this.seatLights.set(mood.acting, map);
      }
      this.add(map, ((c >> 16) & 255) / 255 * p, ((c >> 8) & 255) / 255 * p, (c & 255) / 255 * p);
    }
  }

  private shade(t: number, mood: Mood) {
    const { cols, rows, mat, alb, base, glow, lr, lg, lb, glyph, color, bg, fixed } = this;
    const all = mood.allIn ? 1 : 0;
    const focusMix = mood.yourTurn ? 0.55 : 0;
    // the haze drifts slowly: its noise is sampled on a coarse grid a few times a second
    const tick = Math.floor(t * 5);
    const fcols = (cols >> 2) + 2, frows = (rows >> 1) + 2;
    if (tick !== this.fogTick) {
      this.fogTick = tick;
      const fogT = tick * 0.005;
      for (let j = 0; j < frows; j++) for (let i = 0; i < fcols; i++)
        this.fog[j * fcols + i] = Math.max(0, fbm(this.px(i * 4) / 260 + fogT, this.py(j * 2) / 140 - fogT * 0.6, 77, 2) - 0.45);
    }
    const fogAt = (i: number, j: number) => {
      const fi = i / 4, fj = j / 2, i0 = fi | 0, j0 = fj | 0, u = fi - i0, w = fj - j0;
      const f = this.fog, o = j0 * fcols + i0;
      return (f[o] * (1 - u) + f[o + 1] * u) * (1 - w) + (f[o + fcols] * (1 - u) + f[o + fcols + 1] * u) * w;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const m = mat[k];
        let v = this.vig[k];
        if (all) v *= v;
        if (focusMix) v = v * (1 - focusMix) + Math.min(v, this.focus[k]) * focusMix;
        const a = alb[k] * v;
        let r = base[k * 3] * a * lr[k], g = base[k * 3 + 1] * a * lg[k], b = base[k * 3 + 2] * a * lb[k];
        if (m === SKY) { r = base[k * 3] * 0.42; g = base[k * 3 + 1] * 0.4; b = base[k * 3 + 2] * 0.38; }
        // rock always shows its shape faintly, as if you'd seen it before
        if (m === ROCK) { const f = base[k * 3] * alb[k] * 0.16 * (0.5 + 0.5 * v); r = Math.max(r, f); g = Math.max(g, f * 0.95); b = Math.max(b, f * 0.9); }
        const x = this.px(i);
        // tone map
        r = r / (0.55 + r); g = g / (0.55 + g); b = b / (0.55 + b);
        let lum = 0.3 * r + 0.55 * g + 0.15 * b;
        // drifting haze, seen only in the dark: mostly a soft glow, a little texture
        const fog = fogAt(i, j) * 1.6 * (1.1 - v) * (1 - Math.min(1, lum * 3));
        lum += fog * 0.06;
        if (m === WATER) lum += 0.08 * Math.sin(x * 0.05 + t * 1.3 + j * 0.7);
        if (m === SKY) lum = 0.3 + 0.18 * Math.sin(x * 0.045 - t * 0.9 + j * 1.3);
        let code: number;
        if (m === FIXED) {
          code = lum > 0.04 ? fixed[k] : SPACE;
        } else {
          const rp = RAMPS[m];
          const d = BAYER[(j & 3) * 4 + (i & 3)] * (m === FELT ? 0.5 : 0.9);
          const q = Math.floor(Math.min(0.999, Math.max(0, lum * EXPOSE[m] + d / rp.length)) * rp.length);
          code = rp[q];
        }
        glyph[k] = code;
        const gain = (m === FELT ? 1.0 : 1.35) / Math.max(0.12, Math.max(r, g, b) * 0.6 + 0.4);
        color[k] = (Math.min(15, Math.round(r * gain * 15)) << 8) | (Math.min(15, Math.round(g * gain * 15)) << 4) |
          Math.min(15, Math.round(b * gain * 15));
        const gl = glow[k];
        bg[k * 4] = (r * gl + fog * 0.11) * 255; bg[k * 4 + 1] = (g * gl + fog * 0.14) * 255 + 3;
        bg[k * 4 + 2] = (b * gl + fog * 0.17) * 255 + 3; bg[k * 4 + 3] = 255;
      }
    }
  }

  /** Writes one cell, colour as 0..1 floats. */
  private put(i: number, j: number, ch: number, r: number, g: number, b: number) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    const k = j * this.cols + i;
    this.glyph[k] = ch;
    this.color[k] = (Math.min(15, Math.round(r * 15)) << 8) | (Math.min(15, Math.round(g * 15)) << 4) | Math.min(15, Math.round(b * 15));
  }

  private animate(t: number) {
    const { L, cols, rows } = this;
    const cw = L.cell.w, chh = L.cell.h;
    const lampAt = (i: number, j: number) => this.lr[j * cols + i];

    // dust in the lamplight
    const m = this.motes;
    for (let n = 0; n < m.length; n += 3) {
      const ph = m[n + 2];
      const x = m[n] + Math.sin(t * 0.09 + ph * 40) * 34 + Math.sin(t * 0.23 + ph * 7) * 8;
      const y = m[n + 1] + Math.cos(t * 0.07 + ph * 30) * 22 - ((t * (2 + 3 * ph)) % 60) + 30;
      const i = Math.floor(x / cw), j = Math.floor(y / chh);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const l = lampAt(i, j);
      if (l < 0.3) continue;
      const tw = 0.6 + 0.4 * Math.sin(t * (1 + ph * 2) + ph * 20);
      const s = Math.min(1, 0.35 + (l - 0.3) * 0.8) * tw;
      this.put(i, j, C(ph < 0.5 ? "·" : "."), 1 * s, 0.9 * s, 0.7 * s);
    }

    // braziers: bowl, flame, heat shimmer, rising embers, now and then a spark
    for (const b of this.braziers) {
      const { i, j } = b;
      const f = flicker(t * 6, b.seed);
      this.put(i - 1, j, C("\\"), 0.55, 0.38, 0.28);
      this.put(i, j, C("_"), 0.6, 0.35, 0.2);
      this.put(i + 1, j, C("/"), 0.55, 0.38, 0.28);
      const fl = "^*'^\"";
      for (let d = -1; d <= 1; d++) {
        const h = flicker(t * 9 + d * 3, b.seed + d);
        this.put(i + d, j - 1, C(fl[Math.floor(h * 5)]), 1, 0.55 + 0.35 * h, 0.15 + 0.2 * h);
      }
      for (let d = -1; d <= 1; d++) {
        const h = flicker(t * 7 + d * 5, b.seed + 9 + d);
        if (h > 0.4 - 0.25 * (d === 0 ? 1 : 0)) this.put(i + d, j - 2, C(h > 0.65 ? "'" : "^"), 1, 0.7 + 0.25 * h, 0.25);
      }
      if (f > 0.55) this.put(i + (f > 0.8 ? 1 : 0), j - 3, C("'"), 1, 0.85, 0.45);
      // shimmer: the air above copies its neighbours with a wobble
      for (let dj = 3; dj <= 9; dj++) {
        const jj = j - dj;
        if (jj < 0) break;
        const shift = Math.round((flicker(t * 4 + dj * 0.7, b.seed + 5) - 0.5) * 2.4);
        if (!shift) continue;
        for (let di = -2; di <= 2; di++) {
          const src = jj * cols + Math.min(cols - 1, Math.max(0, i + di + shift)), dst = jj * cols + i + di;
          if (dst >= 0 && dst < this.n) { this.glyph[dst] = this.glyph[src]; this.color[dst] = this.color[src]; }
        }
      }
      for (let e = 0; e < 3; e++) {
        const ph = (t * (0.18 + 0.07 * e) + hash(e, b.seed, 3)) % 1;
        const ex = i + Math.round(Math.sin(ph * 9 + e) * 1.5 * ph), ey = j - 2 - Math.floor(ph * 12);
        const s = 1 - ph;
        this.put(ex, ey, C(ph < 0.4 ? "·" : "."), 1 * s, 0.5 * s, 0.15 * s);
      }
      const win = Math.floor(t / 6.5), wp = (t / 6.5) % 1;
      if (hash(win, b.seed, 9) < 0.45 && wp < 0.12) {
        const p = wp / 0.12, dir = hash(win, b.seed, 11) < 0.5 ? -1 : 1;
        this.put(i + Math.round(dir * p * 6), j - 2 - Math.round(Math.sin(p * Math.PI) * 5), C("*"), 1, 0.85, 0.4);
      }
    }

    // drips in the puddles
    if (this.water.length) {
      const win = Math.floor(t / 4.7), p = (t / 4.7) % 1;
      if (p < 0.35) {
        const k0 = this.water[Math.floor(hash(win, 3, this.seed) * this.water.length)];
        const i0 = k0 % cols, j0 = (k0 / cols) | 0, rad = (p / 0.35) * 4.5;
        const asp = chh / cw;
        for (let dj = -3; dj <= 3; dj++) for (let di = -6; di <= 6; di++) {
          const k = (j0 + dj) * cols + i0 + di;
          if (k < 0 || k >= this.n || this.mat[k] !== WATER) continue;
          if (Math.abs(Math.hypot(di, dj * asp) - rad) < 0.6) {
            const s = 0.9 * (1 - p / 0.35);
            this.put(i0 + di, j0 + dj, C(rad < 1.5 ? "o" : "°"), 0.6 * s + 0.1, 0.8 * s + 0.1, 0.95 * s + 0.1);
          }
        }
      }
    }

    // the watchers: silhouettes in the dark, rim-lit, eyes that blink; they lean in when it matters
    const t2 = L.table;
    for (const w of this.watchers) {
      const tx = t2.cx - w.hx, ty = t2.cy - w.hy, tl = Math.hypot(tx, ty) || 1;
      const sway = Math.sin(t * 0.3 + w.seed) * 2;
      const x = w.hx + (tx / tl) * this.lean * 30 + sway, y = w.hy + (ty / tl) * this.lean * 18;
      const i0 = Math.floor(x / cw) - (w.mask[0].length >> 1), j0 = Math.floor(y / chh) - (w.mask.length >> 1);
      const sx = Math.sign(tx), sy = Math.sign(ty);
      const blink = hash(Math.floor(t * 1.7 + w.seed), w.seed, 5) < 0.07;
      w.mask.forEach((row, dj) => [...row].forEach((c, di) => {
        if (c === ".") return;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= cols || j >= rows) return;
        const k = j * cols + i;
        this.bg[k * 4] = 2; this.bg[k * 4 + 1] = 4; this.bg[k * 4 + 2] = 5;
        if (c === "e") {
          if (blink) this.put(i, j, SPACE, 0, 0, 0);
          else this.put(i, j, C("•"), w.eye[0] * 0.8, w.eye[1] * 0.8, w.eye[2] * 0.8);
          return;
        }
        // rim light on the side facing the table
        const ni = di + sx, nj = dj + (Math.abs(ty) > Math.abs(tx) * 0.6 ? sy : 0);
        const edge = nj < 0 || nj >= w.mask.length || ni < 0 || ni >= row.length || w.mask[nj][ni] === ".";
        const l = Math.min(1, this.lr[k] * 0.9);
        if (edge && l > 0.18 && dj > 0) this.put(i, j, C("·"), l * 0.7, l * 0.5, l * 0.35);
        else this.put(i, j, SPACE, 0, 0, 0);
      }));
    }
  }
}
