// Where everything goes, in CSS pixels, for a window size and seat count. Pure.
//
// Two layers share it: the world (a fine ASCII-shader grid on a canvas) converts these
// positions to cells; the readable layer (DOM) positions seats, cards, chips and the HUD
// at them directly. The table is the hero: it takes the middle of the screen, and the
// seats walk outward along their rays until they clear it with room to spare.

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export interface SeatSlot {
  anchor: Pt;      // centre of the seat's label block
  box: Box;        // the block itself
  bet: Pt;         // where its chips sit on the felt
  angle: number;
}

export interface Layout {
  W: number;
  H: number;
  phone: boolean;
  /** outer edge of the stone rim: centre and half-axes */
  table: { cx: number; cy: number; a: number; b: number };
  rimWidth: number;
  seats: SeatSlot[];
  board: Pt;          // centre of the board cards
  pot: Pt;
  card: { w: number; h: number };      // opponents' and board cards
  bigCard: { w: number; h: number };   // your cards
  /** bottom-centre prompt block, and whether the ledger floats top-right */
  prompt: Box;
  ledgerFloats: boolean;
  /** world grid: cell size in CSS px and grid size */
  cell: { w: number; h: number };
  cols: number;
  rows: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** World font size in CSS px: smaller cells read as a shader, not as tiles. */
export function worldFontSize(W: number): number {
  return W < 700 ? 12 : 11.5;
}

export const SEAT = {
  desk: { w: 184, h: 104, youW: 240, youH: 118, gap: 30 },
  phone: { w: 104, h: 74, youW: 200, youH: 100, gap: 14 },
};

export function makeLayout(W: number, H: number, nSeats: number, dpr = 1): Layout {
  const phone = W < 700;
  const S = phone ? { ...SEAT.phone, w: nSeats > 6 ? 88 : SEAT.phone.w } : SEAT.desk;
  const card = phone ? { w: 24, h: 34 } : { w: 34, h: 48 };
  const bigCard = phone ? { w: 30, h: 42 } : { w: 42, h: 58 };
  const hudTop = phone ? 52 : 36;            // phone also shows the latest message up top
  const promptH = phone ? 150 : 100;
  const promptW = Math.min(W - 24, phone ? W : 660);
  const prompt = { x: (W - promptW) / 2, y: H - promptH - (phone ? 6 : 12), w: promptW, h: promptH };

  // vertical band the table and its top and bottom seats share
  const top = hudTop + S.h + S.gap;
  const bottom = prompt.y - 8 - S.youH - S.gap;
  let b = Math.max(phone ? 120 : 90, (bottom - top) / 2);
  const cy = (top + bottom) / 2;
  const cx = W / 2;
  let a: number;
  if (phone) {
    a = clamp(W * 0.27, 80, 140);
    b = Math.min(b, a * 2.3);
  } else {
    a = Math.min(W * 0.28, (W - 2 * (S.w + S.gap) - 40) / 2, 540, b * 2.6);
    b = Math.min(b, a * 0.48);
  }
  const rimWidth = phone ? 9 : 13;

  // seats: walk out along each ray until the block clears the table and the others;
  // if the room is too small for that, shrink the table and try again
  const minA = (5 * card.w + 24) / 2 + rimWidth + 10;   // the board must still fit on the felt
  let table = { cx, cy, a, b };
  let seats: SeatSlot[] = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    table = { cx, cy, a, b };
    const placed = placeSeats(table, nSeats, S, W, hudTop, prompt.y);
    seats = placed.seats;
    if (placed.ok) break;
    a = Math.max(minA, a * 0.95);
    b *= 0.96;
  }

  // board and pot in the middle; chips between each seat and the board, clear of both
  const boardW = 5 * card.w + 4 * 6;
  const board = { x: cx, y: cy - 8 };
  const pot = { x: cx, y: board.y + card.h / 2 + 18 };
  for (const s of seats) {
    const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
    let x = cx + dx * a * 0.62, y = cy + dy * b * 0.6;
    if (Math.abs(dx) < 0.45) {
      x = cx;
      y = dy < 0 ? Math.min(y, board.y - card.h / 2 - 20) : Math.max(y, pot.y + 26);
    } else if (!phone) {
      x = cx + Math.sign(dx) * Math.max(Math.abs(x - cx), boardW / 2 + 70);
    } else {
      y = dy < 0 ? Math.min(y, board.y - card.h / 2 - 20) : Math.max(y, pot.y + 24);
    }
    s.bet = { x, y };
  }

  // the ledger floats top-right when the seats leave it room
  const ledgerH = (nSeats + 3) * 16 + 16;
  const ledgerBox = { x: W - 360, y: 40, w: 344, h: ledgerH };
  const ledgerFloats = !phone && W >= 1100 && seats.every((s) => !overlaps(s.box, ledgerBox, 12));

  const fs = worldFontSize(W);
  const cw = Math.max(1, Math.round(fs * 0.6 * dpr)) / dpr;
  const ch = Math.max(1, Math.round(fs * 1.1 * dpr)) / dpr;
  return {
    W, H, phone, table, rimWidth, seats, board, pot, card, bigCard, prompt, ledgerFloats,
    cell: { w: cw, h: ch }, cols: Math.ceil(W / cw), rows: Math.ceil(H / ch),
  };
}

/** Signed distance (px) from the table's outer edge: negative inside. */
export function tableEdge(t: Layout["table"], x: number, y: number): number {
  const px = x - t.cx, py = y - t.cy;
  const d = Math.hypot(px / t.a, py / t.b);
  if (d < 1e-6) return -Math.min(t.a, t.b);
  const grad = Math.hypot(px / (t.a * t.a), py / (t.b * t.b)) / d;
  return (d - 1) / grad;
}

function placeSeats(table: Layout["table"], n: number, S: typeof SEAT.desk, W: number, top: number, bottom: number) {
  const { cx, cy, a, b } = table;
  const seats: SeatSlot[] = [];
  let ok = true;
  for (let i = 0; i < n; i++) {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / n;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const w = i === 0 ? S.youW : S.w, h = i === 0 ? S.youH : S.h;
    let box: Box = { x: 0, y: 0, w, h };
    let clear = false;
    for (let f = 1; f < 3 && !clear; f += 0.02) {
      const ax = cx + dx * (a + S.gap) * f, ay = cy + dy * (b + S.gap) * f;
      box = {
        x: clamp(ax - w / 2, 6, W - w - 6),
        y: clamp(ay - h / 2, top, bottom - h - 4),
        w, h,
      };
      clear = clearOfTable(table, box, S.gap * 0.6) && seats.every((s) => !overlaps(s.box, box, 10));
    }
    ok &&= clear;
    seats.push({ angle, box, anchor: { x: box.x + w / 2, y: box.y + h / 2 }, bet: { x: 0, y: 0 } });
  }
  return { seats, ok };
}

function clearOfTable(t: Layout["table"], r: Box, margin: number) {
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) {
    if (tableEdge(t, r.x + (r.w * i) / 8, r.y + (r.h * j) / 4) < margin) return false;
  }
  return true;
}

export function overlaps(a: Box, b: Box, pad = 0) {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}
