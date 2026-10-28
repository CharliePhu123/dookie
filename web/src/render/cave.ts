// The room the table sits in, generated once per layout from a seed: rock walls, a floor of
// grit and salt crust, puddles, fungus, braziers, a passage out to the flats, the carved
// stone table itself, and the creatures who came to watch. Stored as base colours;
// lighting is applied per frame.
import type { Rect } from "./grid";
import { ASPECT, tableDist, type TableGeom } from "./geom";
import { fbm, hash } from "./noise";
import { BG, Q, mix } from "./palette";

export const FLOOR = 0, WALL = 1, FACE = 2, FELT = 3, RIM = 4, WATER = 5, FUNGUS = 6, DOOR = 7, PROP = 8;

export interface Light {
  x: number;
  y: number;
  color: [number, number, number];
  intensity: number;
  flick: number;       // flicker amplitude, 0..1
  seed: number;
  cells: Int32Array;   // world-local cell indices it reaches
  weights: Float32Array;
}

export interface Watcher { x: number; y: number; ch: string; fg: number; period: number; phase: number }

export interface Cave {
  rect: Rect;
  ch: Uint32Array;
  fg: Uint32Array;
  bg: Uint32Array;
  kind: Uint8Array;
  vignette: Float32Array;
  lights: Light[];
  braziers: { x: number; y: number; light: number }[];
  glows: { x: number; y: number; color: number; light: number }[];
  water: Int32Array;
  rim: Int32Array;
  crowd: Watcher[];
}

const code = (s: string) => s.codePointAt(0)!;

// materials
const FLOOR_LO = 0x161712, FLOOR_HI = 0x25221a, SALT = 0x32312a;
const STONE_FG = 0x8f846c, STONE_FG2 = 0x5e5749, FACE_BG = 0x2b261e;
const ROCK_FG = 0x3a352c, ROCK_BG = 0x221f1a;
const RUG = 0x3a1611, RUG_EDGE = 0x9a7a3a;
const GOODS: [string, number][] = [
  ["■", 0x8a6a3a], ["■", 0x6f5530], ["Θ", 0x7a5a30], ["≡", Q.r], ["ö", Q.c], ["§", 0xa08a5a],
];

const CROWD: [string, number][] = [
  ["r", Q.w], ["b", Q.m], ["h", Q.O], ["k", Q.c], ["q", Q.G], ["ä", Q.y], ["f", Q.r], ["j", Q.W], ["x", Q.B],
];

/** Signed distance (in cell widths) from the table's edge: negative inside. */
export function tableEdge(t: TableGeom, x: number, y: number): number {
  const px = x - t.cx, py = (y - t.cy) * ASPECT;
  const a = t.rx, b = t.ry * ASPECT;
  const d = Math.hypot(px / a, py / b);
  if (d < 1e-6) return -Math.min(a, b);
  const grad = Math.hypot(px / (a * a), py / (b * b)) / d;
  return (d - 1) / grad;
}

export function buildCave(world: Rect, table: TableGeom, seats: Rect[], seed: number): Cave {
  const { w, h } = world;
  const n = w * h;
  const ch = new Uint32Array(n), fg = new Uint32Array(n), bg = new Uint32Array(n);
  const kind = new Uint8Array(n), vignette = new Float32Array(n);
  const wcx = world.x + w / 2, wcy = world.y + h / 2;
  const inSeat = (x: number, y: number, pad: number) =>
    seats.some((r) => x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad);

  // ---- room shape -------------------------------------------------------------------
  const doorX = world.x + Math.floor(w * (0.2 + 0.1 * hash(seed, 1)));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = world.x + i, y = world.y + j, k = j * w + i;
      const u = (x - wcx) / (w / 2), v = (y - wcy) / (h / 2);
      const r = Math.pow(Math.pow(Math.abs(u), 2.4) + Math.pow(Math.abs(v), 2.4), 1 / 2.4);
      vignette[k] = Math.max(0.45, Math.min(1, 1.3 - r * 0.6));
      const edge = r + (fbm(x * 0.07, y * 0.15, seed) - 0.5) * 0.7;
      let wall = edge > 0.88;
      // a few rock pillars out in the room, away from the table and seats
      const td = tableDist(table, x, y);
      if (!wall && td > 1.5 && !inSeat(x, y, 2)) wall = fbm(x * 0.12, y * 0.25, seed + 99) > 0.72;
      if (td < 1.25 || inSeat(x, y, 1)) wall = false;
      // a passage north, out to the salt flats
      if (Math.abs(x - doorX) <= 1 && y < wcy) wall = false;
      kind[k] = wall ? WALL : FLOOR;
    }
  }
  // wall faces: rock within reach of the floor, two cells deep sideways and one up/down
  const face: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (kind[k] !== WALL) continue;
    outer: for (let dj = -1; dj <= 1; dj++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < w && jj < h && kind[jj * w + ii] === FLOOR) { face.push(k); break outer; }
    }
  }
  for (const k of face) kind[k] = FACE;

  // ---- materials --------------------------------------------------------------------
  const water: number[] = [];
  const fungi: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = world.x + i, y = world.y + j, k = j * w + i;
      const n1 = fbm(x * 0.18, y * 0.36, seed + 5, 2), r1 = hash(x, y, seed), r2 = hash(y, x, seed + 3);
      if (kind[k] === WALL) {
        ch[k] = code(n1 > 0.5 ? "▒" : "░");
        fg[k] = mix(ROCK_FG, STONE_FG2, 0.25 * n1);
        bg[k] = ROCK_BG;
        continue;
      }
      if (kind[k] === FACE) {
        // layered rock: colour bands run roughly horizontally
        const strata = fbm(x * 0.05, y * 0.55, seed + 61, 2);
        ch[k] = code(r1 < 0.55 ? "#" : r1 < 0.8 ? "%" : r1 < 0.92 ? "▓" : "&");
        fg[k] = mix(mix(STONE_FG, STONE_FG2, strata), r2 < 0.5 ? Q.w : Q.y, 0.15);
        bg[k] = mix(FACE_BG, mix(ROCK_BG, 0x3a2b20, strata), 0.5);
        continue;
      }
      const td = tableDist(table, x, y);
      // floor: dark grit with pale crusts of salt
      const salt = fbm(x * 0.07, y * 0.15, seed + 31);
      bg[k] = salt > 0.6 ? mix(FLOOR_HI, SALT, (salt - 0.6) * 2.5) : mix(FLOOR_LO, FLOOR_HI, n1);
      const wet = fbm(x * 0.1, y * 0.22, seed + 7) > 0.7 && td > 1.45 && !inSeat(x, y, 1);
      const moss = fbm(x * 0.09, y * 0.2, seed + 13) > 0.68 && td > 1.4 && !inSeat(x, y, 0);
      if (wet) {
        kind[k] = WATER;
        water.push(k);
        ch[k] = code(r1 < 0.5 ? "~" : " ");
        fg[k] = mix(Q.b, Q.c, 0.5 + 0.5 * r1);
        bg[k] = mix(BG, Q.b, 0.22);
      } else if (moss && r1 < 0.45) {
        kind[k] = FUNGUS;
        fungi.push(k);
        ch[k] = code(r2 < 0.3 ? "♣" : r2 < 0.55 ? "τ" : r2 < 0.85 ? "\"" : "♠");
        fg[k] = r2 < 0.3 ? Q.m : r2 < 0.55 ? Q.G : r2 < 0.85 ? Q.g : Q.M;
      } else {
        ch[k] = code(r1 < 0.74 ? " " : r1 < 0.86 ? "." : r1 < 0.92 ? "," : r1 < 0.96 ? "'" : "`");
        fg[k] = mix(bg[k], salt > 0.6 ? Q.Y : Q.y, 0.16 + 0.12 * r2);
      }
      if (Math.abs(x - doorX) <= 1 && j < 4 && kind[k] === FLOOR) {
        kind[k] = DOOR;
        ch[k] = code(r1 < 0.4 ? "." : " ");
        bg[k] = mix(SALT, Q.y, 0.15 * (4 - j) / 4);
        fg[k] = mix(bg[k], Q.Y, 0.3);
      }
    }
  }
  // rubble at the foot of the walls
  for (let k = 0; k < n; k++) {
    if (kind[k] !== FLOOR) continue;
    const i = k % w, j = (k / w) | 0;
    let nearWall = false;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < w && jj < h && kind[jj * w + ii] === FACE) nearWall = true;
    }
    const x = world.x + i, y = world.y + j;
    if (nearWall && hash(i, j, seed + 21) < 0.35) {
      ch[k] = code(hash(j, i, seed) < 0.6 ? "∙" : "•");
      fg[k] = mix(STONE_FG2, bg[k], 0.2);
    }
    // the caravans' goods, stacked against the walls
    if (nearWall && tableDist(table, x, y) > 1.6 && !inSeat(x, y, 1) && Math.abs(x - doorX) > 2 &&
      fbm(x * 0.2, y * 0.4, seed + 71) > 0.58 && hash(i, j, seed + 73) < 0.55) {
      const [g, c] = GOODS[Math.floor(hash(i, j, seed + 79) * GOODS.length)];
      kind[k] = PROP;
      ch[k] = code(g);
      fg[k] = c;
    }
  }

  // a woven rug around the table
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (kind[k] !== FLOOR) continue;
    const x = world.x + i, y = world.y + j;
    const e = tableEdge(table, x, y);
    if (e < 0 || e > 5.2) continue;
    bg[k] = mix(bg[k], RUG, 0.55);
    if (e > 4.2) {
      ch[k] = code(i % 2 ? "·" : " ");
      fg[k] = mix(RUG, RUG_EDGE, 0.8);
    } else {
      ch[k] = code(hash(i, j, seed + 83) < 0.08 ? "·" : " ");
      fg[k] = mix(RUG, RUG_EDGE, 0.4);
    }
  }

  const rim = carveTable(world, table, seed, ch, fg, bg, kind);

  // ---- lights -----------------------------------------------------------------------
  const lights: Light[] = [];
  const addLight = (x: number, y: number, color: [number, number, number], radius: number,
    intensity: number, flick: number) => {
    lights.push(makeLight(world, kind, x, y, color, radius, intensity, flick, seed + lights.length * 31));
    return lights.length - 1;
  };
  addLight(table.cx, table.cy, [1.12, 1.0, 0.8], Math.max(table.rx, table.ry * ASPECT) * 1.8, 0.85, 0.05);
  // pale daylight spilling down the passage
  addLight(doorX, world.y, [0.55, 0.75, 1.0], 12, 0.8, 0.0);

  // braziers: one near each corner of the table, wherever there's floor between the seats
  const braziers: Cave["braziers"] = [];
  for (const base of [0.2, 0.8, 1.2, 1.8]) {
    let placed = false;
    for (const off of [0, 0.06, -0.06, 0.12, -0.12, 0.18, -0.18]) {
      const a = Math.PI * (base + off);
      for (let f = 1.2; f < 3 && !placed; f += 0.05) {
        const x = Math.round(table.cx + Math.cos(a) * table.rx * f);
        const y = Math.round(table.cy + Math.sin(a) * table.ry * f);
        const i = x - world.x, j = y - world.y;
        if (i < 1 || j < 1 || i >= w - 1 || j >= h - 1) break;
        if (kind[j * w + i] !== FLOOR || inSeat(x, y, 0) || tableDist(table, x, y) < 1.15) continue;
        if (braziers.some((b) => Math.abs(b.x - x) < 8 && Math.abs(b.y - y) < 4)) continue;
        braziers.push({ x, y, light: addLight(x, y, [1.35, 0.78, 0.36], Math.max(13, table.rx * 0.75), 0.95, 0.3) });
        placed = true;
      }
      if (placed) break;
    }
  }

  // a few of the fungi glow
  const glows: Cave["glows"] = [];
  const order = fungi.slice().sort((a, b) => hash(a, 7, seed) - hash(b, 7, seed));
  for (const k of order) {
    if (glows.length >= 5) break;
    const x = world.x + (k % w), y = world.y + ((k / w) | 0);
    if (glows.some((g) => Math.abs(g.x - x) < 10 && Math.abs(g.y - y) < 5)) continue;
    const cyan = hash(k, 3, seed) < 0.5;
    const color = cyan ? Q.C : Q.M;
    ch[k] = code("♣");
    fg[k] = color;
    glows.push({ x, y, color, light: addLight(x, y, cyan ? [0.3, 0.85, 1.0] : [0.95, 0.4, 1.0], 8, 0.8, 0.2) });
  }

  // ---- the crowd ----------------------------------------------------------------------
  const crowd: Watcher[] = [];
  const want = Math.max(3, Math.min(9, Math.floor(w * h / 420)));
  for (let tries = 0; crowd.length < want && tries < 4000; tries++) {
    const i = Math.floor(hash(tries, 11, seed) * w), j = Math.floor(hash(tries, 13, seed) * h);
    const x = world.x + i, y = world.y + j, k = j * w + i;
    const td = tableDist(table, x, y);
    if (kind[k] !== FLOOR || td < 1.35 || td > 2.4 || inSeat(x, y, 2)) continue;
    if (braziers.some((b) => Math.abs(b.x - x) < 3 && Math.abs(b.y - y) < 2)) continue;
    if (crowd.some((c) => Math.abs(c.x - x) < 6 && Math.abs(c.y - y) < 3)) continue;
    const [g, color] = CROWD[Math.floor(hash(tries, 17, seed) * CROWD.length)];
    crowd.push({ x, y, ch: g, fg: color, period: 3 + hash(tries, 19, seed) * 6, phase: hash(tries, 23, seed) * 10 });
  }

  return { rect: world, ch, fg, bg, kind, vignette, lights, braziers, glows,
    water: Int32Array.from(water), rim: Int32Array.from(rim), crowd };
}

/** The stone table: felt inside a carved rim of even width, edges smoothed with half blocks. */
function carveTable(world: Rect, t: TableGeom, seed: number, ch: Uint32Array, fg: Uint32Array,
  bg: Uint32Array, kind: Uint8Array): number[] {
  const { w, h } = world;
  const RIM_W = Math.max(2.4, Math.min(4, t.rx / 9));   // in cell widths
  const region = (x: number, y: number) => {
    const e = tableEdge(t, x, y);
    return e < -RIM_W ? 0 : e < 0 ? 1 : 2;
  };
  const felt = (x: number, y: number) => {
    const e = -tableEdge(t, x, y) / Math.min(t.rx, t.ry * ASPECT);   // 0 at edge, 1 at centre
    return mix(mix(BG, Q.g, 0.17), mix(BG, Q.g, 0.27), Math.min(1, e * 1.4) * (0.7 + 0.3 * fbm(x * 0.25, y * 0.5, seed + 41, 2)));
  };
  const stone = (x: number, y: number) => {
    const e = tableEdge(t, x, y);
    const base = mix(0x6f6756, 0x8c826c, hash(x, y, seed + 43) * 0.6 + fbm(x * 0.3, y * 0.6, seed + 44, 1) * 0.4);
    if (e < -RIM_W + 0.9) return mix(base, 0xc8c2ae, 0.3);   // polished inner lip
    if (e > -0.9) return mix(base, BG, 0.45);               // shadowed outer edge
    return base;
  };
  const colorOf = (reg: number, x: number, y: number, k: number) =>
    reg === 0 ? felt(x, y) : reg === 1 ? stone(x, y) : bg[k];

  const rim: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = world.x + i, y = world.y + j, k = j * w + i;
      if (tableDist(t, x, y) > 1.15) continue;
      const top = region(x, y - 0.25), bot = region(x, y + 0.25);
      const lef = region(x - 0.25, y), rig = region(x + 0.25, y);
      const mid = region(x, y);
      if (top === 2 && bot === 2 && lef === 2 && rig === 2) continue;
      if (top !== bot) {
        ch[k] = code("▀");
        fg[k] = colorOf(top, x, y - 0.25, k);
        bg[k] = colorOf(bot, x, y + 0.25, k);
        kind[k] = top === 0 || bot === 0 ? FELT : RIM;
      } else if (lef !== rig) {
        ch[k] = code("▌");
        fg[k] = colorOf(lef, x - 0.25, y, k);
        bg[k] = colorOf(rig, x + 0.25, y, k);
        kind[k] = lef === 0 || rig === 0 ? FELT : RIM;
      } else if (mid === 0) {
        kind[k] = FELT;
        bg[k] = felt(x, y);
        // a faint betting line and a little nap in the felt
        const e = tableEdge(t, x, y);
        if (Math.abs(e + RIM_W + 4.5) < 0.5 && (i + j) % 2 === 0) { ch[k] = code("·"); fg[k] = mix(bg[k], Q.G, 0.35); }
        else if (hash(x, y, seed + 47) < 0.04) { ch[k] = code("'"); fg[k] = mix(bg[k], Q.g, 0.4); }
        else { ch[k] = 32; fg[k] = Q.g; }
      } else if (mid === 1) {
        kind[k] = RIM;
        bg[k] = stone(x, y);
        if (hash(y, x, seed + 51) < 0.06) { ch[k] = code("·"); fg[k] = mix(bg[k], BG, 0.5); }
        else ch[k] = 32;
        rim.push(k);
      }
    }
  }
  return rim;
}

function makeLight(world: Rect, kind: Uint8Array, x: number, y: number, color: [number, number, number],
  radius: number, intensity: number, flick: number, seed: number): Light {
  const cells: number[] = [], weights: number[] = [];
  const ry = Math.ceil(radius / ASPECT);
  for (let j = Math.max(0, y - world.y - ry); j <= Math.min(world.h - 1, y - world.y + ry); j++) {
    for (let i = Math.max(0, Math.floor(x - world.x - radius)); i <= Math.min(world.w - 1, Math.ceil(x - world.x + radius)); i++) {
      const d = Math.hypot(world.x + i - x, (world.y + j - y) * ASPECT) / radius;
      if (d >= 1) continue;
      const k = j * world.w + i;
      let wgt = (1 - d * d) * (1 - d * d);
      if (kind[k] === WALL) wgt *= 0.35;
      cells.push(k);
      weights.push(wgt);
    }
  }
  return { x, y, color, intensity, flick, seed, cells: Int32Array.from(cells), weights: Float32Array.from(weights) };
}
