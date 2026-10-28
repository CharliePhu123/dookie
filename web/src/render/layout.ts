// Where everything goes for a given grid size. Pure: same cols, rows, seat count and seed
// give the same layout. Wide screens dock the side panel right and the log bottom-left;
// narrow (phone) screens stack the world, a compact read strip and the log.
import type { Rect } from "./grid";
import { buildCave, type Cave } from "./cave";
import { ASPECT, tableDist, type TableGeom } from "./geom";

export interface SeatSlot {
  rect: Rect;          // the label block: glyph + name, title, stack, cards
  bet: { x: number; y: number };   // where this seat's chips sit on the felt
  angle: number;
}

export interface Layout {
  cols: number;
  rows: number;
  seed: number;
  narrow: boolean;
  compact: boolean;    // small cards, no titles
  cardW: number;
  cardH: number;
  world: Rect;
  panel: Rect | null;  // wide: the docked side panel
  read: Rect | null;   // narrow: a compact read strip
  log: Rect;
  promptRows: number;
  table: TableGeom;
  seats: SeatSlot[];
  croupier: { x: number; y: number } | null;
  cave: Cave;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function overlaps(a: Rect, b: Rect, pad = 0) {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}

export function makeLayout(cols: number, rows: number, nSeats: number, seed = 7): Layout {
  const narrow = cols < 100;
  const promptRows = narrow ? 2 : 1;
  let panel: Rect | null = null, read: Rect | null = null, log: Rect, world: Rect;
  if (!narrow) {
    const panelW = cols >= 170 ? 36 : cols >= 130 ? 32 : 28;
    const logH = rows >= 46 ? 10 : rows >= 40 ? 9 : 7;
    panel = { x: cols - panelW, y: 1, w: panelW, h: rows - 1 - promptRows };
    log = { x: 0, y: rows - promptRows - logH, w: cols - panelW, h: logH };
    world = { x: 0, y: 1, w: cols - panelW, h: rows - 1 - promptRows - logH };
  } else {
    const logH = rows >= 50 ? 8 : 7;
    const readH = 5;
    log = { x: 0, y: rows - promptRows - logH, w: cols, h: logH };
    read = { x: 0, y: log.y - readH, w: cols, h: readH };
    world = { x: 0, y: 1, w: cols, h: read.y - 1 };
  }

  const compact = world.w < 90 || world.h < 26;
  const tiny = world.w < 56;
  const cardW = tiny ? 2 : compact ? 3 : 4, cardH = compact ? 2 : 3;
  const seatW = tiny ? 12 : compact ? 13 : 22;
  const seatH = (compact ? 2 : 3) + cardH;
  const boardW = 5 * (cardW + 1) - 1;

  // table size: as big as the room allows, about 2:1 wide on screen
  const cx = world.x + Math.floor(world.w / 2);
  const cy = world.y + Math.floor(world.h / 2);
  let ry = clamp(Math.floor((world.h - 2 * seatH - 4) / 2), 4, 13);
  const rxRoom = Math.floor((world.w - 2 * seatW - 4) / 2);
  let rx = Math.min(rxRoom, Math.round(ry * ASPECT * 1.9));
  rx = Math.max(rx, Math.ceil(boardW / 2 / 0.72));
  if (narrow) ry = clamp(ry, 5, Math.floor((world.h - 2 * seatH - 2) / 2));
  const minRx = Math.ceil(boardW / 2 / 0.8);

  // seats: walk outward along each seat's ray until the block clears the rim and the others;
  // if the room is too small for that, shrink the table and try again
  let table: TableGeom = { cx, cy, rx, ry };
  let seats: SeatSlot[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    table = { cx, cy, rx, ry };
    const placed = placeSeats(table, world, nSeats, seatW, seatH, cardH);
    seats = placed.seats;
    if (placed.ok) break;
    if (rx > minRx) rx -= 2;
    if (ry > 4 && (attempt % 2 === 1 || rx <= minRx)) ry -= 1;
  }

  // the croupier stands at whichever end of the table is free
  let croupier: { x: number; y: number } | null = null;
  for (const side of [1, -1]) {
    const p = { x: cx + side * (rx + 2), y: cy };
    if (seats.every((s) => !overlaps(s.rect, { x: p.x, y: p.y, w: 1, h: 1 }, 1))) { croupier = p; break; }
  }

  const cave = buildCave(world, table, seats.map((s) => s.rect), seed);
  return { cols, rows, seed, narrow, compact, cardW, cardH, world, panel, read, log, promptRows,
    table, seats, croupier, cave };
}

function placeSeats(t: TableGeom, world: Rect, n: number, seatW: number, seatH: number, cardH: number) {
  const { cx, cy, rx, ry } = t;
  const seats: SeatSlot[] = [];
  let ok = true;
  for (let i = 0; i < n; i++) {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / n;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let rect: Rect = { x: 0, y: 0, w: seatW, h: seatH };
    let clear = false;
    for (let f = 0.9; f < 4 && !clear; f += 0.04) {
      const bx = Math.round(cx + dx * rx * f), by = Math.round(cy + dy * ry * f);
      rect = {
        x: clamp(bx - Math.floor(seatW / 2), world.x, world.x + world.w - seatW),
        y: clamp(by - Math.floor(seatH / 2), world.y + 1, world.y + world.h - seatH),
        w: seatW, h: seatH,
      };
      clear = clearOfTable(t, rect) && seats.every((s) => !overlaps(s.rect, rect, 1));
    }
    ok &&= clear;
    // chips sit on the felt in front of the seat, on rows clear of the board and the pot line
    let bx: number, by: number;
    if (Math.abs(dx) < 0.45) {
      bx = cx;
      by = Math.round(cy + dy * ry * 0.5);
      by = dy < 0 ? Math.min(by, cy - cardH) : Math.max(by, cy + 3);
    } else if (Math.abs(dy) < 0.2) {
      bx = Math.round(cx + dx * rx * 0.76);
      by = cy - Math.floor(cardH / 2);
    } else {
      bx = Math.round(cx + dx * rx * 0.6);
      // on a tall (phone) table spread them along its length
      const spread = Math.round(cy + dy * ry * 0.55);
      by = dy < 0 ? Math.min(cy - cardH, spread) : Math.max(cy + 3, spread);
    }
    seats.push({ rect, angle, bet: { x: bx, y: by } });
  }
  return { seats, ok };
}

function clearOfTable(t: TableGeom, r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++)
      if (tableDist(t, x, y) < 1.08) return false;
  return true;
}
