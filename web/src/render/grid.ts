// A character grid: every cell has a glyph, a foreground and a background colour.
// Scenes draw into a grid; the canvas renderer paints it.
import { BG, Q, type ColorCode } from "./palette";

export interface Cell {
  ch: string;
  fg: string;
  bg: string | null; // null = leave the background showing
}

export type Seg = { text: string; fg: string };

export class Grid {
  cells: Cell[];

  constructor(readonly cols: number, readonly rows: number) {
    this.cells = Array.from({ length: cols * rows }, () => ({ ch: " ", fg: Q.y, bg: null }));
  }

  clear() {
    for (const c of this.cells) { c.ch = " "; c.fg = Q.y; c.bg = null; }
  }

  get(x: number, y: number): Cell | undefined {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return undefined;
    return this.cells[y * this.cols + x];
  }

  set(x: number, y: number, ch: string, fg: string, bg: string | null = null) {
    const c = this.get(x, y);
    if (!c) return;
    c.ch = ch;
    c.fg = fg;
    if (bg !== null) c.bg = bg;
  }

  text(x: number, y: number, s: string, fg: string, bg: string | null = null) {
    [...s].forEach((ch, i) => this.set(x + i, y, ch, fg, bg));
    return x + [...s].length;
  }

  centered(cx: number, y: number, s: string, fg: string, bg: string | null = null) {
    return this.text(cx - Math.floor([...s].length / 2), y, s, fg, bg);
  }

  segs(x: number, y: number, segs: Seg[], maxWidth = Infinity) {
    let col = x;
    for (const { text, fg } of segs) {
      for (const ch of text) {
        if (col - x >= maxWidth) return col;
        this.set(col++, y, ch, fg);
      }
    }
    return col;
  }

  fillBg(x: number, y: number, w: number, h: number, bg: string) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const c = this.get(i, j);
      if (c) c.bg = bg;
    }
  }

  box(x: number, y: number, w: number, h: number, fg: string, title?: string) {
    const [tl, tr, bl, br, hz, vt] = ["╔", "╗", "╚", "╝", "═", "║"];
    this.set(x, y, tl, fg); this.set(x + w - 1, y, tr, fg);
    this.set(x, y + h - 1, bl, fg); this.set(x + w - 1, y + h - 1, br, fg);
    for (let i = x + 1; i < x + w - 1; i++) { this.set(i, y, hz, fg); this.set(i, y + h - 1, hz, fg); }
    for (let j = y + 1; j < y + h - 1; j++) { this.set(x, j, vt, fg); this.set(x + w - 1, j, vt, fg); }
    if (title) this.text(x + 2, y, ` ${title} `, Q.W);
  }
}

/** Qud-style markup: "You fold. {{M|The Seer}} notes it." -> coloured segments. */
export function markup(s: string, base: string = Q.y): Seg[] {
  const out: Seg[] = [];
  const re = /\{\{([A-Za-z])\|([^}]*)\}\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), fg: base });
    out.push({ text: m[2], fg: Q[m[1] as ColorCode] ?? base });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), fg: base });
  return out;
}

export { BG };
