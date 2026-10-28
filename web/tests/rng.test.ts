import { describe, expect, it } from "vitest";
import { Rng } from "@/engine/rng";

describe("Rng", () => {
  it("is deterministic per seed, including string seeds", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
    expect(new Rng("daily-2026-10-28").random()).toBe(new Rng("daily-2026-10-28").random());
  });

  it("forks independent, reproducible streams", () => {
    const root = new Rng(1);
    const deck = root.fork("deck").next();
    root.fork("flavor").next();
    root.next();
    expect(new Rng(1).fork("deck").next()).toBe(deck);
    expect(new Rng(1).fork("bots").next()).not.toBe(deck);
  });

  it("saves and restores its state", () => {
    const r = new Rng(9);
    r.next();
    const saved = r.state();
    const want = [r.next(), r.next()];
    expect([new Rng(0).restore(saved).next(), r.restore(saved).next()]).toEqual([want[0], want[0]]);
  });

  it("produces values in range and roughly uniform", () => {
    const r = new Rng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = r.random();
      expect(x >= 0 && x < 1).toBe(true);
      buckets[Math.floor(x * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
    for (let i = 0; i < 1000; i++) {
      const k = r.randint(3, 5);
      expect(k >= 3 && k <= 5).toBe(true);
    }
  });

  it("shuffles to a permutation and samples distinct elements", () => {
    const r = new Rng(3);
    const xs = Array.from({ length: 52 }, (_, i) => i);
    expect(r.shuffle(xs.slice()).sort((a, b) => a - b)).toEqual(xs);
    const s = r.sample(xs, 7);
    expect(new Set(s).size).toBe(7);
    expect(xs).toEqual(Array.from({ length: 52 }, (_, i) => i));   // sample leaves input alone
  });
});
