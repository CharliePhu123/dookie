import { describe, expect, it } from "vitest";
import { makeLayout, overlaps, tableEdge } from "@/render/layout";
import { markup, moodFromView, type TableView } from "@/render/view";
import { CALM, World } from "@/render/world";
import { CREATURES } from "@/game/creatures";

const SIZES: [number, number][] = [[1440, 900], [1920, 1080], [1280, 720], [390, 844], [1024, 768], [430, 932]];

describe("layout", () => {
  for (const [W, H] of SIZES) {
    for (const n of [2, 6, 8]) {
      it(`gives ${n} seats room on a ${W}x${H} screen`, () => {
        const L = makeLayout(W, H, n);
        for (const s of L.seats) {
          const b = s.box;
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(W);
          expect(b.y + b.h).toBeLessThanOrEqual(L.prompt.y);
          // clear of the table's rim
          for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]])
            expect(tableEdge(L.table, b.x + b.w * fx, b.y + b.h * fy)).toBeGreaterThan(0);
          // chips sit on the felt
          expect(tableEdge(L.table, s.bet.x, s.bet.y)).toBeLessThan(-L.rimWidth);
        }
        for (let i = 0; i < L.seats.length; i++)
          for (let j = i + 1; j < L.seats.length; j++) expect(overlaps(L.seats[i].box, L.seats[j].box)).toBe(false);
        // the board fits on the felt
        const boardW = 5 * L.card.w + 24;
        expect(tableEdge(L.table, L.board.x - boardW / 2, L.board.y)).toBeLessThan(-L.rimWidth);
        expect(L.cols * L.cell.w).toBeGreaterThanOrEqual(W);
        expect(L.rows * L.cell.h).toBeGreaterThanOrEqual(H);
      });
    }
  }
});

describe("world", () => {
  it("renders a frame deterministically and lights the table", () => {
    const L = makeLayout(1440, 900, 6);
    const a = new World(L), b = new World(L);
    a.step(1.5, CALM); b.step(1.5, CALM);
    expect(Buffer.from(a.glyph.buffer).equals(Buffer.from(b.glyph.buffer))).toBe(true);
    const at = (x: number, y: number) => a.bg[(Math.floor(y / L.cell.h) * a.cols + Math.floor(x / L.cell.w)) * 4 + 1];
    // the felt under the lamp is brighter than the dark corner
    expect(at(L.table.cx, L.table.cy)).toBeGreaterThan(at(8, 8) + 10);
  });

  it("darkens the room on an all-in", () => {
    const L = makeLayout(1440, 900, 6);
    const calm = new World(L), tense = new World(L);
    calm.step(2, CALM); tense.step(2, { ...CALM, allIn: true });
    const sum = (w: World) => w.bg.reduce((n, v, i) => (i % 4 === 1 ? n + v : n), 0);
    expect(sum(tense)).toBeLessThan(sum(calm));
  });
});

describe("view", () => {
  it("parses markup", () => {
    const s = markup("You fold. {{M|The Seer}} notes it.");
    expect(s.map((x) => x.text).join("")).toBe("You fold. The Seer notes it.");
    expect(s[1].fg).toBe(0xda5bd6);
  });

  it("derives tension from the pot", () => {
    const seat = (stack: number, bet: number) => ({ creature: CREATURES.you, stack, bet, cards: [null, null], dealer: false, acting: false, allIn: false });
    const v = (pot: number): TableView => ({
      place: "", handNo: 1, blinds: [1, 2], street: "FLOP", board: [], boardSize: 5, pot, seats: [seat(1000, 0), seat(1000, 0)],
      log: [], read: null, session: 0, prompt: { info: "", options: "", input: "", feedback: null, active: false },
      ledger: { streets: [], rows: [] },
    });
    expect(moodFromView(v(800)).tension).toBeGreaterThan(moodFromView(v(50)).tension);
  });
});
