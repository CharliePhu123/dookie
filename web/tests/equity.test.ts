import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/equity.json";
import { cards } from "@/engine/cards";
import { EquityEngine, anyRange, oppRange } from "@/engine/equity";
import { Rng } from "@/engine/rng";
import { PRESETS } from "@/engine/variant";

interface Case {
  variant: string;
  hole: number[];
  board: number[];
  opps: { top: number | null; strict: number; leak: number }[];
  iters: number;
  /** averaged over this many calls of iters / runs each */
  runs: number;
  equity: number;
}

const engines = new Map<string, EquityEngine>();
const engine = (name: string) => {
  if (!engines.has(name)) engines.set(name, new EquityEngine(PRESETS[name], undefined, new Rng(name)));
  return engines.get(name)!;
};

describe("equity engine", () => {
  const { scores, cases } = fixtures as unknown as { scores: Record<string, [number[], number][]>; cases: Case[] };

  for (const [name, rows] of Object.entries(scores)) {
    it(`scores ${rows.length} ${name} starting hands exactly like Python`, () => {
      const ee = engine(name);
      for (const [hole, want] of rows) expect(ee.handScore(hole)).toBeCloseTo(want, 12);
    });
  }

  it(`matches Python's equity within Monte Carlo noise on ${cases.length} spots`, () => {
    for (const c of cases) {
      const ee = engine(c.variant);
      const opps = c.opps.map((o) => oppRange({
        minScore: o.top ? ee.threshold(o.top) : -Infinity, strict: o.strict, leak: o.leak,
      }));
      let got = 0;
      for (let i = 0; i < c.runs; i++) got += ee.equity(c.hole, c.board, opps, Math.floor(c.iters / c.runs)) / c.runs;
      // two independent estimates, each with sd <= 0.5/sqrt(iters), plus the noise from sampled
      // range thresholds and strictness cutoffs
      const tol = 4.5 * Math.SQRT2 * 0.5 / Math.sqrt(c.iters) + 0.02;
      expect(Math.abs(got - c.equity), JSON.stringify(c)).toBeLessThan(tol);
    }
  });

  it("knows the classics", () => {
    const ee = engine("holdem");
    const vsAny = (h: string, b = "") => ee.equity(cards(h), cards(b), [anyRange()], 6000);
    expect(vsAny("AsAh")).toBeGreaterThan(0.82);
    expect(vsAny("7c2d")).toBeLessThan(0.38);
    expect(vsAny("AsKs", "QsJsTs")).toBe(1);   // royal flush, nothing beats it
  });

  it("orders starting hands sensibly", () => {
    const ee = engine("holdem");
    expect(ee.percentile(cards("AsAh"))).toBeGreaterThan(0.99);
    expect(ee.percentile(cards("AsKs"))).toBeGreaterThan(ee.percentile(cards("AsKd")));
    expect(ee.percentile(cards("7c2d"))).toBeLessThan(0.1);
    expect(ee.threshold(1)).toBe(-Infinity);
  });

  it("caches preflop equities and respects deadlines", () => {
    const ee = engine("holdem");
    const a = ee.equity(cards("KhKd"), [], [anyRange()], 500);
    expect(ee.equity(cards("KsKc"), [], [anyRange()], 500)).toBe(a);   // suit-isomorphic cache hit
    const t0 = performance.now();
    ee.equity(cards("QhJh"), cards("2c7d9s"), [anyRange(), anyRange()], 10_000_000, t0 + 30);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
