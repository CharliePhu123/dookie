import { describe, expect, it } from "vitest";
import { tableDist } from "@/render/geom";
import { Grid } from "@/render/grid";
import { makeLayout } from "@/render/layout";

const SIZES: [number, number][] = [[130, 40], [141, 44], [174, 45], [142, 37], [46, 54], [120, 34], [60, 40]];

describe("layout", () => {
  for (const [cols, rows] of SIZES) {
    for (const n of [2, 6, 8]) {
      it(`places ${n} seats cleanly on a ${cols}x${rows} grid`, () => {
        const L = makeLayout(cols, rows, n);
        const { world, table, seats } = L;
        for (const s of seats) {
          const r = s.rect;
          expect(r.x).toBeGreaterThanOrEqual(world.x);
          expect(r.y).toBeGreaterThanOrEqual(world.y);
          expect(r.x + r.w).toBeLessThanOrEqual(world.x + world.w);
          expect(r.y + r.h).toBeLessThanOrEqual(world.y + world.h);
          for (let y = r.y; y < r.y + r.h; y++)
            for (let x = r.x; x < r.x + r.w; x++) expect(tableDist(table, x, y)).toBeGreaterThan(1.0);
          // bets sit on the felt
          expect(tableDist(table, s.bet.x, s.bet.y)).toBeLessThan(0.85);
        }
        for (let i = 0; i < seats.length; i++)
          for (let j = i + 1; j < seats.length; j++) {
            const a = seats[i].rect, b = seats[j].rect;
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            expect(apart).toBe(true);
          }
        // the board fits on the felt
        const boardW = 5 * (L.cardW + 1) - 1;
        expect(tableDist(table, table.cx - boardW / 2, table.cy)).toBeLessThan(0.9);
        expect(L.cave.braziers.length).toBeGreaterThanOrEqual(2);
        expect(L.cave.crowd.length).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("is deterministic for a seed", () => {
    const a = makeLayout(141, 44, 6, 3).cave, b = makeLayout(141, 44, 6, 3).cave;
    expect(Buffer.from(a.ch.buffer).equals(Buffer.from(b.ch.buffer))).toBe(true);
    expect(Buffer.from(a.bg.buffer).equals(Buffer.from(b.bg.buffer))).toBe(true);
  });
});

describe("grid", () => {
  it("writes code points and ignores out-of-range cells", () => {
    const g = new Grid(4, 2);
    g.text(2, 1, "Ω♠x", 0xffffff);
    expect(String.fromCodePoint(g.ch[1 * 4 + 2])).toBe("Ω");
    expect(String.fromCodePoint(g.ch[1 * 4 + 3])).toBe("♠");
    g.set(-1, 0, "x", 0);
    g.set(9, 9, "x", 0);
  });
});
