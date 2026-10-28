// Draws the whole screen for one frame from a TableView. Pure apart from the reusable
// lighting buffers: same view + layout + time = same picture.
//
// Order: the cave (base colours) -> things that move in it -> lighting -> things that emit
// light (flames, embers, spores) -> the game itself (cards, chips, seats, panels), unlit so
// it always reads clearly.
import { RANKS, rankOf, suitOf, type Card } from "@/engine/cards";
import type { Creature } from "@/game/creatures";
import { FLOOR, FUNGUS } from "./cave";
import { Grid, len, markup, segsLength, type Rect, type Seg } from "./grid";
import type { Layout } from "./layout";
import { Lighting, type DynLight } from "./light";
import { flicker, hash } from "./noise";
import { BG, Q, mix } from "./palette";

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
  place: string;
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
  handName?: string;   // your best hand so far, in words
}

export interface Scene {
  layout: Layout;
  lighting: Lighting;
}

export function createScene(layout: Layout): Scene {
  return { layout, lighting: new Lighting(layout.cave) };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const SUIT = "♣♦♥♠";
const CARD_FACE = 0xd6d0b9, INK = 0x0c1b1a, RED_INK = 0xb8360c, CARD_BACK = 0x17495a;
const BAR_BG = mix(BG, Q.k, 0.55);
const PANEL_BG = mix(BG, Q.k, 0.3);
const DIM = mix(Q.y, BG, 0.45);
const STEPS: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 0], [0, 0]];

const rgb = (c: number, s = 1): [number, number, number] =>
  [((c >> 16) & 255) / 255 * s, ((c >> 8) & 255) / 255 * s, (c & 255) / 255 * s];

export function drawScene(g: Grid, v: TableView, t: number, scene: Scene) {
  const L = scene.layout;
  const cave = L.cave;
  const { x: wx, y: wy, w: W, h: H } = cave.rect;

  // ---- the room ------------------------------------------------------------------------
  for (let j = 0; j < H; j++) {
    const dst = (wy + j) * g.cols + wx;
    g.ch.set(cave.ch.subarray(j * W, (j + 1) * W), dst);
    g.fg.set(cave.fg.subarray(j * W, (j + 1) * W), dst);
    g.bg.set(cave.bg.subarray(j * W, (j + 1) * W), dst);
  }
  animateRoom(g, L, t);

  const dyn: DynLight[] = [];
  v.seats.forEach((s, i) => {
    const slot = L.seats[i];
    if (!slot) return;
    if (s.acting) dyn.push({ x: slot.rect.x + Math.floor(slot.rect.w / 2), y: slot.rect.y,
      color: rgb(s.creature.color, 0.9), radius: 9, intensity: 0.55 + 0.35 * Math.sin(t * 4) });
    if (s.allIn) dyn.push({ x: slot.bet.x, y: slot.bet.y, color: [1.2, 0.25, 0.05], radius: 8,
      intensity: 0.45 + 0.35 * Math.sin(t * 8) });
  });
  scene.lighting.compute(t, dyn);
  scene.lighting.apply(g);
  drawEmitters(g, L, scene.lighting, t);

  // ---- the game -------------------------------------------------------------------------
  if (L.croupier) g.set(L.croupier.x, L.croupier.y, "ж", Q.W);
  drawBoard(g, L, v);
  v.seats.forEach((s, i) => L.seats[i] && drawSeat(g, L, s, i, t));

  drawHeader(g, L, v);
  if (L.panel) drawPanel(g, L.panel, v);
  if (L.read) drawReadStrip(g, L.read, v);
  drawLog(g, L.log, v);
  drawPrompt(g, L, v);
}

// ---- room life ----------------------------------------------------------------------------

function animateRoom(g: Grid, L: Layout, t: number) {
  const cave = L.cave;
  const { x: wx, y: wy, w: W } = cave.rect;
  const at = (k: number) => (wy + ((k / W) | 0)) * g.cols + wx + (k % W);

  // water ripples
  const tick = Math.floor(t * 1.3);
  for (let n = 0; n < cave.water.length; n++) {
    const k = cave.water[n];
    const r = hash(k, tick + (k % 3), L.seed);
    const gi = at(k);
    g.ch[gi] = r < 0.45 ? 0x7e : r < 0.6 ? 0x2248 : 32;   // ~ ≈ space
    g.fg[gi] = mix(Q.c, Q.C, flicker(t * 0.8 + k * 0.37, L.seed));
  }
  // a glint now and then on the stone rim
  const gt = Math.floor(t * 5);
  for (let n = 0; n < cave.rim.length; n++) {
    const k = cave.rim[n];
    if (hash(k, gt, L.seed + 3) < 0.004) {
      const gi = at(k);
      g.ch[gi] = 0x2219;   // ∙
      g.fg[gi] = Q.Y;
    }
  }
  // the crowd shuffles about
  cave.crowd.forEach((c, i) => {
    const step = Math.floor((t + c.phase) / c.period);
    const [dx, dy] = STEPS[Math.floor(hash(step, i, L.seed) * STEPS.length)];
    let x = c.x + dx, y = c.y + dy;
    const k = (y - wy) * W + (x - wx);
    if (cave.kind[k] !== FLOOR && cave.kind[k] !== FUNGUS) { x = c.x; y = c.y; }
    g.set(x, y, c.ch, c.fg);
  });
}

function drawEmitters(g: Grid, L: Layout, lighting: Lighting, t: number) {
  const cave = L.cave;
  const inWorld = (x: number, y: number) =>
    x >= cave.rect.x && y >= cave.rect.y && x < cave.rect.x + cave.rect.w && y < cave.rect.y + cave.rect.h;
  cave.braziers.forEach((b, bi) => {
    const heat = Math.max(0, Math.min(1, (lighting.level(b.light, t) - 0.6) * 1.6));
    g.set(b.x, b.y, "☼", mix(Q.W, Q.Y, heat * 0.6), mix(Q.r, Q.o, heat * 0.7));
    for (let e = 0; e < 6; e++) {
      const speed = 0.25 + hash(e, bi, 5) * 0.3;
      const phase = (t * speed + hash(e, bi, 9)) % 1;
      const y = b.y - 1 - Math.floor(phase * 5);
      const x = b.x + Math.round(Math.sin(phase * 7 + e * 2.1) * 1.6 * phase);
      if (!inWorld(x, y) || (x === b.x && y === b.y)) continue;
      g.set(x, y, phase < 0.35 ? "∙" : "·", mix(mix(Q.W, Q.R, phase), BG, phase * phase * 0.8));
    }
  });
  cave.glows.forEach((gl, gi) => {
    g.set(gl.x, gl.y, "♣", mix(gl.color, Q.Y, 0.3 * flicker(t * 0.7, gi + 17)));
    for (let e = 0; e < 3; e++) {
      const phase = (t * (0.08 + hash(e, gi, 2) * 0.06) + hash(e, gi, 4)) % 1;
      const x = gl.x + Math.round(Math.sin(phase * 4 + e) * 2 + phase * 2);
      const y = gl.y - Math.round(phase * 4);
      if (!inWorld(x, y) || (x === gl.x && y === gl.y)) continue;
      g.set(x, y, "·", mix(gl.color, BG, phase * 0.85));
    }
  });
}

// ---- cards, chips, seats --------------------------------------------------------------------

function darken(g: Grid, x: number, y: number, amt = 0.7) {
  const i = g.idx(x, y);
  if (i >= 0) g.bg[i] = mix(g.bg[i], BG, amt);
}

/** Text over the world: darkens the cells behind it so it reads on any floor. */
function hud(g: Grid, x: number, y: number, segs: Seg[]) {
  let col = x;
  for (const { text, fg } of segs) for (const ch of text) { darken(g, col, y); g.set(col++, y, ch, fg); }
  return col;
}

function hudCentered(g: Grid, cx: number, y: number, segs: Seg[]) {
  return hud(g, cx - Math.floor(segsLength(segs) / 2), y, segs);
}

function drawCard(g: Grid, x: number, y: number, c: Card | null | undefined, w: number, h: number, empty = false) {
  if (empty) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      darken(g, x + i, y + j, 0.45);
      g.set(x + i, y + j, " ", Q.g);
    }
    return;
  }
  if (c === null || c === undefined) {
    g.fill({ x, y, w, h }, " ", Q.C, CARD_BACK);
    const midY = y + Math.floor((h - 1) / 2);
    for (let i = 1; i < w - 1; i++) g.set(x + i, midY, "◊", mix(Q.C, CARD_BACK, 0.25));
    if (h > 2) { g.set(x, y, "·", Q.c); g.set(x + w - 1, y + h - 1, "·", Q.c); }
    return;
  }
  const red = suitOf(c) === 1 || suitOf(c) === 2;
  const ink = red ? RED_INK : INK;
  const rank = rankOf(c) === 8 && w > 2 ? "10" : RANKS[rankOf(c)];
  const s = SUIT[suitOf(c)];
  g.fill({ x, y, w, h }, " ", ink, CARD_FACE);
  g.text(x, y, rank + s, ink);
  if (h >= 3) g.text(x + w - len(rank + s), y + h - 1, rank + s, ink);
  else g.set(x + w - 1, y + h - 1, s, ink);
}

function drawBoard(g: Grid, L: Layout, v: TableView) {
  const { cx, cy } = L.table;
  const { cardW, cardH } = L;
  const w = v.boardSize * (cardW + 1) - 1;
  const y0 = cy - cardH + 1;
  for (let i = 0; i < v.boardSize; i++) {
    const x = cx - Math.floor(w / 2) + i * (cardW + 1);
    if (i < v.board.length) drawCard(g, x, y0, v.board[i], cardW, cardH);
    else drawCard(g, x, y0, null, cardW, cardH, true);
  }
  hudCentered(g, cx, cy + 2, [{ text: "POT ", fg: mix(Q.W, BG, 0.3) }, { text: "◘ ", fg: Q.O }, { text: fmt(v.pot), fg: Q.W }]);
}

function drawSeat(g: Grid, L: Layout, s: SeatView, i: number, t: number) {
  const slot = L.seats[i];
  const { rect } = slot;
  const cx = rect.x + Math.floor(rect.w / 2);
  const cr = s.creature;
  const inHand = s.cards !== null;
  let y = rect.y;

  // name line: glyph, name, dealer stone, thinking dots
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  const glyphFg = s.acting ? mix(cr.color, Q.Y, 0.35 * pulse) : inHand ? cr.color : mix(cr.color, BG, 0.4);
  const name: Seg[] = [{ text: cr.glyph, fg: glyphFg }, { text: " " + cr.name, fg: inHand ? Q.Y : DIM }];
  if (s.dealer) name.push({ text: " ◉", fg: Q.W });
  const dots = s.acting ? "···".slice(0, 1 + (Math.floor(t * 3) % 3)).padEnd(3) : "";
  const nameW = segsLength(name) + (s.acting ? 4 : 0);
  const nx = cx - Math.floor(nameW / 2);
  hud(g, nx, y, name);
  if (s.acting) {
    hud(g, nx + nameW - 3, y, [{ text: dots, fg: cr.color }]);
    for (let k = nx - 1; k <= nx + nameW; k++) {
      const gi = g.idx(k, y);
      if (gi >= 0) g.bg[gi] = mix(BG, cr.color, 0.18 + 0.12 * pulse);
    }
  }
  y++;
  if (!L.compact) { hudCentered(g, cx, y, [{ text: cr.title, fg: DIM }]); y++; }
  hudCentered(g, cx, y, [{ text: "◘ ", fg: s.stack > 0 ? Q.O : DIM }, { text: fmt(s.stack), fg: s.stack > 0 ? Q.W : DIM }]);
  y++;
  if (s.cards) {
    const n = s.cards.length;
    const w = n * (L.cardW + 1) - 1;
    s.cards.forEach((c, k) => drawCard(g, cx - Math.floor(w / 2) + k * (L.cardW + 1), y, c, L.cardW, L.cardH));
  } else {
    hudCentered(g, cx, y + Math.floor(L.cardH / 2), [{ text: "folded", fg: DIM }]);
  }

  // chips on the felt in front of the seat
  const { x: bx, y: by } = slot.bet;
  if (s.allIn) {
    const on = Math.sin(t * 8) > 0;
    const segs: Seg[] = [{ text: "ALL-IN", fg: on ? Q.R : Q.o }];
    if (s.bet) segs.push({ text: " ◘ ", fg: Q.O }, { text: fmt(s.bet), fg: Q.W });
    hudCentered(g, bx, by, segs);
  } else if (s.bet) {
    hudCentered(g, bx, by, [{ text: "• ", fg: Q.O }, { text: fmt(s.bet), fg: Q.W }]);
  }
}

// ---- panels -------------------------------------------------------------------------------

function drawHeader(g: Grid, L: Layout, v: TableView) {
  g.fill({ x: 0, y: 0, w: g.cols, h: 1 }, " ", Q.y, BAR_BG);
  const [sb, bb] = v.blinds;
  let x = g.segs(1, 0, markup(`{{O|☼}} {{W|ASCII POKER}}`), Infinity);
  if (!L.narrow) x = g.segs(x + 2, 0, markup(`{{K|·}} {{C|${v.place}}}`));
  const right = L.narrow
    ? `{{y|#${v.handNo}}} {{K|·}} {{Y|${fmt(sb)}/${fmt(bb)}}} {{K|·}} {{C|${v.street}}}`
    : `{{K|hand}} {{Y|${String(v.handNo).padStart(6, "0")}}}  {{K|blinds}} {{Y|${fmt(sb)}/${fmt(bb)}}}  {{K|·}}  {{C|${v.street}}}`;
  const segs = markup(right);
  const rx = g.cols - 1 - segsLength(segs);
  if (rx > x + 1) g.segs(rx, 0, segs);
}

function bar(g: Grid, x: number, y: number, label: string, labelW: number, barW: number, value: number, color: number) {
  g.text(x, y, label, Q.y);
  const n = Math.round(value * barW);
  for (let i = 0; i < barW; i++) g.set(x + labelW + i, y, i < n ? "█" : "░", i < n ? color : Q.K);
  g.text(x + labelW + barW + 1, y, `${Math.round(value * 100)}%`.padStart(3), Q.Y);
}

const READ_ROWS: [string, keyof ReadView, number][] = [
  ["plays", "vpip", Q.M], ["raises", "pfr", Q.M], ["folds to bets", "foldToBet", Q.C],
  ["stabs", "stab", Q.O], ["bluffs", "bluff", Q.R],
];

function sep(g: Grid, r: Rect, y: number, title: string) {
  for (let x = r.x + 1; x < r.x + r.w - 1; x++) g.set(x, y, "─", mix(Q.K, BG, 0.2));
  g.text(r.x + 2, y, ` ${title} `, Q.W);
}

function drawPanel(g: Grid, r: Rect, v: TableView) {
  g.panel(r, Q.K, PANEL_BG, "THE SEER'S READ");
  const x = r.x + 2, inner = r.w - 4;
  let y = r.y + 2;
  const seer = v.seats.find((s) => s.creature.key === "adaptive");
  if (v.read) {
    const labelW = Math.max(...READ_ROWS.map(([l]) => l.length)) + 1;
    const barW = Math.max(4, inner - labelW - 5);
    for (const [label, key, color] of READ_ROWS) bar(g, x, y++, label, labelW, barW, v.read[key], color);
    y++;
    g.segs(x, y++, markup(`{{M|Ω}} {{K|It thinks you}} {{Y|${v.read.bluff > 0.25 ? "bluff" : "are honest"}}}{{K|.}}`), inner);
  } else {
    g.segs(x, y++, markup(`{{M|Ω}} {{K|It is watching you.}}`), inner);
  }
  if (seer?.acting) g.segs(x, y, markup(`{{M|Ω}} {{K|Its eyes are many.}}`), inner);
  y += 2;

  sep(g, r, y++, "CREATURES");
  y++;
  for (const s of v.seats) {
    const inHand = s.cards !== null;
    g.set(x, y, s.creature.glyph, inHand ? s.creature.color : mix(s.creature.color, BG, 0.45));
    g.text(x + 2, y, s.creature.name, inHand ? Q.y : DIM);
    const st = fmt(s.stack);
    g.text(x + inner - st.length, y, st, s.stack > 0 ? Q.W : DIM);
    const mood = s.allIn ? "{{R|all in}}" : s.acting ? "{{M|thinking}}" : !inHand ? "{{K|folded}}" : s.dealer ? "{{W|holds the stone}}" : "{{K|in the hand}}";
    g.segs(x + 2, y + 1, markup(mood), inner - 2);
    y += 2;
    if (y > r.y + r.h - 8) break;
  }
  y++;
  const you = v.seats[0];
  if (you?.cards && v.handName && y < r.y + r.h - 14) {
    sep(g, r, y++, "YOUR HAND");
    y++;
    let cx = x;
    for (const c of you.cards) {
      if (c === null) continue;
      const red = suitOf(c) === 1 || suitOf(c) === 2;
      cx = g.text(cx, y, RANKS[rankOf(c)] + SUIT[suitOf(c)], red ? Q.R : Q.Y) + 1;
    }
    g.text(cx + 1, y++, v.handName, Q.W);
    const toCall = Math.max(0, ...v.seats.map((s) => s.bet)) - you.bet;
    if (toCall > 0) {
      const odds = toCall / (v.pot + toCall);
      g.segs(x, y++, markup(`{{K|to call}} {{W|${fmt(toCall)}}}`), inner);
      g.segs(x, y++, markup(`{{K|need}} {{Y|${Math.round(odds * 100)}%}} {{K|equity to call}}`), inner);
    } else {
      g.segs(x, y++, markup(`{{K|nothing to call}}`), inner);
    }
    y++;
  }
  sep(g, r, y++, "SESSION");
  const sess = `${v.session >= 0 ? "+" : "−"}${fmt(Math.abs(v.session))}`;
  y++;
  g.text(x, y, "chips won", Q.y);
  g.text(x + inner - sess.length, y, sess, v.session >= 0 ? Q.G : Q.R);

  // keys, pinned to the bottom
  const keys = ["{{W|f}} fold    {{W|c}} call", "{{W|r}} raise   {{W|a}} all-in", "{{W|?}} odds    {{W|l}} look"];
  let ky = r.y + r.h - 2 - keys.length;
  if (ky > y + 2) {
    sep(g, r, ky - 1, "KEYS");
    for (const k of keys) g.segs(x, ky++, markup(k), inner);
  }
}

function drawReadStrip(g: Grid, r: Rect, v: TableView) {
  const sess = `${v.session >= 0 ? "+" : "−"}${fmt(Math.abs(v.session))}`;
  g.panel(r, Q.K, PANEL_BG, "THE SEER'S READ");
  const colW = Math.floor((r.w - 4) / 2);
  const rows: [string, number, number][] = v.read
    ? [["plays", v.read.vpip, Q.M], ["folds", v.read.foldToBet, Q.C], ["stabs", v.read.stab, Q.O], ["bluffs", v.read.bluff, Q.R]]
    : [];
  rows.forEach(([label, value, color], i) => {
    const x = r.x + 2 + (i % 2) * colW, y = r.y + 1 + Math.floor(i / 2);
    bar(g, x, y, label, 7, Math.max(3, colW - 13), value, color);
  });
  g.segs(r.x + 2, r.y + 3, markup(`{{K|session}} ${v.session >= 0 ? "{{G|" : "{{R|"}${sess}}}`), r.w - 4);
}

/** Word-wraps coloured segments to a width. */
function wrap(segs: Seg[], width: number): Seg[][] {
  const lines: Seg[][] = [[]];
  let col = 0;
  for (const { text, fg } of segs) {
    const words = text.split(" ");
    words.forEach((word, i) => {
      const piece = i < words.length - 1 ? word + " " : word;
      if (col + len(word) > width && col > 0) { lines.push([]); col = 0; }
      const w = col === 0 ? piece.trimStart() : piece;
      lines[lines.length - 1].push({ text: w, fg });
      col += len(w);
    });
  }
  return lines;
}

function drawLog(g: Grid, r: Rect, v: TableView) {
  g.panel(r, Q.K, PANEL_BG, "MESSAGES");
  const n = r.h - 2, width = r.w - 4;
  const lines: { segs: Seg[]; age: number }[] = [];
  for (let m = v.log.length - 1; m >= 0 && lines.length < n; m--) {
    const age = v.log.length - 1 - m;
    const wrapped = wrap(markup(v.log[m]), width);
    for (let i = wrapped.length - 1; i >= 0 && lines.length < n; i--) lines.unshift({ segs: wrapped[i], age });
  }
  lines.forEach(({ segs, age }, i) => {
    const faded = segs.map((s) => ({ ...s, fg: age === 0 ? s.fg : mix(s.fg, BG, Math.min(0.55, age * 0.1)) }));
    g.segs(r.x + 2, r.y + 1 + (n - lines.length) + i, faded, width);
  });
}

function drawPrompt(g: Grid, L: Layout, v: TableView) {
  const y0 = g.rows - L.promptRows;
  g.fill({ x: 0, y: y0, w: g.cols, h: L.promptRows }, " ", Q.y, BAR_BG);
  // wrap onto the prompt rows if needed
  let x = 1, y = y0;
  for (const { text, fg } of markup(v.prompt)) {
    for (const ch of text) {
      if (x >= g.cols - 1) { x = 1; y++; if (y >= g.rows) return; }
      if (x === 1 && ch === " " && y > y0) continue;
      g.set(x++, y, ch, fg);
    }
  }
}
