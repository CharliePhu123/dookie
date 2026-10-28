// Draws the whole screen for one frame from a TableView. Pure: same view + time = same picture.
import { RANKS, rankOf, suitOf, type Card } from "@/engine/cards";
import type { Creature } from "@/game/creatures";
import { Grid, markup } from "./grid";
import { BG, Q, mix } from "./palette";

export const COLS = 100;
export const ROWS = 40;

export interface SeatView {
  creature: Creature;
  stack: number;
  bet: number;
  /** null = folded; card values or null entries for face-down cards */
  cards: (Card | null)[] | null;
  dealer: boolean;
  acting: boolean;
  allIn: boolean;
}

export interface ReadView {
  vpip: number;
  pfr: number;
  foldToBet: number;
  stab: number;
  bluff: number;
}

export interface TableView {
  handNo: number;
  blinds: [number, number];
  street: string;
  board: Card[];
  boardSize: number;
  pot: number;
  seats: SeatView[];   // seat 0 is you, at the bottom
  log: string[];       // markup strings, newest last
  read: ReadView | null;
  session: number;
  prompt: string;      // markup for the footer
}

const TABLE = { cx: 37, cy: 16, rx: 22, ry: 7 };
const fmt = (n: number) => n.toLocaleString("en-US");

// cheap deterministic hash -> [0, 1)
function hash(a: number, b: number, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawTable(g: Grid, t: number) {
  const { cx, cy, rx, ry } = TABLE;
  const tick = Math.floor(t * 3);
  for (let y = cy - ry - 2; y <= cy + ry + 2; y++) {
    for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d < 0.8) {
        const speck = hash(x, y) < 0.06;
        g.set(x, y, speck ? "·" : "░", speck ? mix(Q.g, BG, 0.5) : Q.g);
      } else if (d < 0.88) {
        g.set(x, y, "▒", mix(Q.w, BG, 0.35));
      } else if (d < 1.0) {
        const glint = hash(x, y, tick) < 0.015;
        g.set(x, y, "▓", glint ? Q.W : mix(Q.w, Q.K, 0.35 + 0.2 * hash(x, y)));
      } else if (d < 1.07) {
        g.set(x, y, "░", Q.K);
      }
    }
  }
}

function drawEmbers(g: Grid, t: number) {
  const { cx, cy, rx, ry } = TABLE;
  for (let i = 0; i < 14; i++) {
    const phase = (t * (0.12 + hash(i, 7) * 0.1) + hash(i, 3)) % 1;
    const ang = hash(i, 11) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(ang) * rx * 1.02 + Math.sin(phase * 6 + i) * 1.5);
    const y = Math.round(cy + Math.sin(ang) * ry * 1.02 - phase * 6);
    const c = g.get(x, y);
    if (c && c.ch === " ") g.set(x, y, phase < 0.5 ? "∙" : "·", mix(Q.O, BG, phase));
  }
}

function drawCard(g: Grid, x: number, y: number, c: Card | null | undefined, empty = false) {
  if (empty) {
    g.text(x, y, "┌──┐", Q.K); g.text(x, y + 1, "│  │", Q.K); g.text(x, y + 2, "└──┘", Q.K);
    return;
  }
  if (c === null || c === undefined) {
    g.text(x, y, "┌──┐", Q.c); g.text(x, y + 2, "└──┘", Q.c);
    g.set(x, y + 1, "│", Q.c); g.set(x + 1, y + 1, "▒", Q.c); g.set(x + 2, y + 1, "▒", Q.c); g.set(x + 3, y + 1, "│", Q.c);
    return;
  }
  const red = suitOf(c) === 1 || suitOf(c) === 2;
  const face = mix(BG, Q.y, 0.14);
  g.text(x, y, "┌──┐", Q.y); g.text(x, y + 2, "└──┘", Q.y);
  g.set(x, y + 1, "│", Q.y); g.set(x + 3, y + 1, "│", Q.y);
  g.set(x + 1, y + 1, RANKS[rankOf(c)], red ? Q.R : Q.Y, face);
  g.set(x + 2, y + 1, "♣♦♥♠"[suitOf(c)], red ? Q.R : Q.Y, face);
}

function seatAnchor(i: number, n: number) {
  const ang = Math.PI / 2 + (2 * Math.PI * i) / n;
  return {
    x: Math.round(TABLE.cx + 31 * Math.cos(ang)),
    y: Math.round(TABLE.cy + 11 * Math.sin(ang) - 3),
  };
}

function drawSeat(g: Grid, s: SeatView, x: number, y: number, t: number) {
  const cr = s.creature;
  let glyphColor = cr.color;
  if (s.acting) glyphColor = mix(cr.color, BG, 0.45 + 0.45 * Math.sin(t * 5));   // thinking pulse
  const name = `${cr.name}${s.dealer ? " (D)" : ""}`;
  const w = name.length + 2;
  g.set(x - Math.floor(w / 2), y, cr.glyph, glyphColor);
  g.text(x - Math.floor(w / 2) + 2, y, name, s.cards ? Q.Y : Q.K);
  g.centered(x, y + 1, cr.title, Q.K);
  g.centered(x, y + 2, `◘ ${fmt(s.stack)}`, s.stack > 0 ? Q.W : Q.K);
  if (s.cards) {
    s.cards.forEach((c, k) => drawCard(g, x - Math.floor((s.cards!.length * 5 - 1) / 2) + k * 5, y + 3, c));
  } else {
    g.centered(x, y + 4, "folded", Q.K);
  }
  if (s.allIn) g.centered(x, y + 6, "ALL-IN", Math.sin(t * 8) > 0 ? Q.R : Q.r);
  else if (s.bet) g.centered(x, y + 6, `• ${fmt(s.bet)}`, Q.O);
}

function drawBoard(g: Grid, v: TableView) {
  const { cx, cy } = TABLE;
  const w = v.boardSize * 5 - 1;
  for (let i = 0; i < v.boardSize; i++) {
    const x = cx - Math.floor(w / 2) + i * 5;
    if (i < v.board.length) drawCard(g, x, cy - 2, v.board[i]);
    else drawCard(g, x, cy - 2, null, true);
  }
  g.centered(cx, cy + 2, `POT ${fmt(v.pot)}`, Q.W);
}

function bar(g: Grid, x: number, y: number, label: string, value: number, color: string) {
  g.text(x, y, label.padEnd(12), Q.y);
  const n = Math.round(value * 8);
  for (let i = 0; i < 8; i++) g.set(x + 12 + i, y, i < n ? "█" : "░", i < n ? color : Q.K);
  g.text(x + 21, y, `${Math.round(value * 100)}%`.padStart(3), Q.Y);
}

function drawSidePanel(g: Grid, v: TableView) {
  const x0 = 75;
  g.box(x0, 1, 25, 30, Q.K, "THE SEER'S READ");
  if (v.read) {
    bar(g, x0 + 1, 3, "plays", v.read.vpip, Q.M);
    bar(g, x0 + 1, 4, "raises", v.read.pfr, Q.M);
    bar(g, x0 + 1, 5, "folds to bet", v.read.foldToBet, Q.C);
    bar(g, x0 + 1, 6, "stabs", v.read.stab, Q.O);
    bar(g, x0 + 1, 7, "bluffs", v.read.bluff, Q.R);
  } else {
    g.text(x0 + 2, 3, "It is watching you.", Q.K);
  }
  g.text(x0 + 2, 10, "CREATURES", Q.W);
  v.seats.forEach((s, i) => {
    const y = 12 + i * 2;
    g.set(x0 + 2, y, s.creature.glyph, s.creature.color);
    g.text(x0 + 4, y, s.creature.name, s.cards ? Q.y : Q.K);
    g.text(x0 + 23 - fmt(s.stack).length, y, fmt(s.stack), Q.W);
  });
  g.text(x0 + 2, 27, "SESSION", Q.W);
  const sess = `${v.session >= 0 ? "+" : "−"}${fmt(Math.abs(v.session))}`;
  g.text(x0 + 23 - sess.length, 27, sess, v.session >= 0 ? Q.G : Q.R);
}

function drawLog(g: Grid, v: TableView) {
  g.box(0, 31, COLS, 8, Q.K, "MESSAGES");
  const lines = v.log.slice(-6);
  lines.forEach((m, i) => {
    const age = lines.length - 1 - i;
    const segs = markup(m).map((s) => ({ ...s, fg: age === 0 ? s.fg : mix(s.fg, BG, Math.min(0.6, age * 0.12)) }));
    g.segs(2, 32 + i, segs, COLS - 4);
  });
}

export function drawScene(g: Grid, v: TableView, t: number) {
  g.clear();
  const [sb, bb] = v.blinds;
  g.segs(1, 0, markup(`{{W|ASCII POKER}}  hand {{Y|${String(v.handNo).padStart(6, "0")}}}  blinds {{Y|${fmt(sb)}/${fmt(bb)}}}`));
  g.text(73 - v.street.length, 0, v.street, Q.C);
  drawTable(g, t);
  drawEmbers(g, t);
  drawBoard(g, v);
  v.seats.forEach((s, i) => {
    const { x, y } = seatAnchor(i, v.seats.length);
    // keep the whole seat block inside the table area, left of the side panel
    const half = Math.ceil(Math.max(s.creature.title.length, s.creature.name.length + 6) / 2);
    drawSeat(g, s, Math.min(73 - half, Math.max(half, x)), y, t);
  });
  drawSidePanel(g, v);
  drawLog(g, v);
  g.segs(1, 39, markup(v.prompt), COLS - 2);
}
