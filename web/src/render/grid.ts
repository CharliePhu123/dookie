// A character grid: every cell has a glyph (code point), a foreground and a background
// colour, in flat typed arrays so a full-window grid can be redrawn every frame cheaply.
// Scenes draw into a grid; the canvas renderer paints it.
import { BG, Q, type ColorCode } from "./palette";

export type Seg = { text: string; fg: number };

export interface Rect { x: number; y: number; w: number; h: number }

const SPACE = 32;

export class Grid {
  readonly ch: Uint32Array;
  readonly fg: Uint32Array;
  readonly bg: Uint32Array;

  constructor(readonly cols: number, readonly rows: number) {
    const n = cols * rows;
    this.ch = new Uint32Array(n).fill(SPACE);
    this.fg = new Uint32Array(n).fill(Q.y);
    this.bg = new Uint32Array(n).fill(BG);
  }

  clear() {
    this.ch.fill(SPACE);
    this.fg.fill(Q.y);
    this.bg.fill(BG);
  }

  idx(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.cols || y >= this.rows ? -1 : y * this.cols + x;
  }

  glyph(x: number, y: number): number {
    const i = this.idx(x, y);
    return i < 0 ? 0 : this.ch[i];
  }

  set(x: number, y: number, ch: string | number, fg: number, bg?: number) {
    const i = this.idx(x, y);
    if (i < 0) return;
    this.ch[i] = typeof ch === "number" ? ch : ch.codePointAt(0)!;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
  }

  text(x: number, y: number, s: string, fg: number, bg?: number) {
    let col = x;
    for (const ch of s) this.set(col++, y, ch, fg, bg);
    return col;
  }

  centered(cx: number, y: number, s: string, fg: number, bg?: number) {
    return this.text(cx - Math.floor(len(s) / 2), y, s, fg, bg);
  }

  segs(x: number, y: number, segs: Seg[], maxWidth = Infinity, bg?: number) {
    let col = x;
    for (const { text, fg } of segs) {
      for (const ch of text) {
        if (col - x >= maxWidth) return col;
        this.set(col++, y, ch, fg, bg);
      }
    }
    return col;
  }

  fill(r: Rect, ch: string, fg: number, bg: number) {
    const code = ch.codePointAt(0)!;
    for (let y = Math.max(0, r.y); y < Math.min(this.rows, r.y + r.h); y++) {
      const row = y * this.cols;
      for (let x = Math.max(0, r.x); x < Math.min(this.cols, r.x + r.w); x++) {
        this.ch[row + x] = code;
        this.fg[row + x] = fg;
        this.bg[row + x] = bg;
      }
    }
  }

  /** A framed panel: double-line border, filled background, optional title. */
  panel(r: Rect, fg: number, bg: number, title?: string, titleFg: number = Q.W) {
    this.fill(r, " ", fg, bg);
    const { x, y, w, h } = r;
    this.set(x, y, "╔", fg); this.set(x + w - 1, y, "╗", fg);
    this.set(x, y + h - 1, "╚", fg); this.set(x + w - 1, y + h - 1, "╝", fg);
    for (let i = x + 1; i < x + w - 1; i++) { this.set(i, y, "═", fg); this.set(i, y + h - 1, "═", fg); }
    for (let j = y + 1; j < y + h - 1; j++) { this.set(x, j, "║", fg); this.set(x + w - 1, j, "║", fg); }
    if (title) this.text(x + 2, y, ` ${title} `, titleFg);
  }
}

export const len = (s: string) => [...s].length;

// As text on the dark background, the two darkest palette entries are lifted so they read.
const TEXT: Partial<Record<ColorCode, number>> = { k: 0x3a625f, K: 0x5f8580 };

/** Qud-style markup: "You fold. {{M|The Seer}} notes it." -> coloured segments. */
export function markup(s: string, base: number = Q.y): Seg[] {
  const out: Seg[] = [];
  const re = /\{\{([A-Za-z])\|([^}]*)\}\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), fg: base });
    const code = m[1] as ColorCode;
    out.push({ text: m[2], fg: TEXT[code] ?? Q[code] ?? base });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), fg: base });
  return out;
}

export const segsLength = (segs: Seg[]) => segs.reduce((n, s) => n + len(s.text), 0);
