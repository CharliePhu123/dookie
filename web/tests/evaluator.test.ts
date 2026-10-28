import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/evaluator.json";
import { cards } from "@/engine/cards";
import { CATEGORY_NAMES, Evaluator } from "@/engine/evaluator";
import { PRESETS } from "@/engine/variant";

const H = new Evaluator(PRESETS.holdem);
const S = new Evaluator(PRESETS.shortdeck);
const O = new Evaluator(PRESETS.omaha);
const cat = (ev: Evaluator, hole: string, board: string) =>
  CATEGORY_NAMES[ev.category(ev.rank(cards(hole), cards(board)))];

describe("evaluator", () => {
  it("finds every category", () => {
    expect(cat(H, "AhKh", "QhJhTh2c3d")).toBe("straight flush");
    expect(cat(H, "Ah2h", "3h4h5h9c9d")).toBe("straight flush");
    expect(cat(H, "AhAd", "AsAc5h9c9d")).toBe("quads");
    expect(cat(H, "AhAd", "As9c9d9h3h")).toBe("full house");
    expect(cat(H, "2h7h", "Jh9hKh2c3d")).toBe("flush");
    expect(cat(H, "Ac2d", "3h4s5c9c9d")).toBe("straight");
    expect(cat(H, "AcAd", "Ah7s5c9c2d")).toBe("trips");
    expect(cat(H, "AcAd", "Kh7sKc9c2d")).toBe("two pair");
    expect(cat(H, "AcQd", "Ah7s5c9c2d")).toBe("pair");
    expect(cat(H, "AcQd", "Jh7s5c9c2d")).toBe("high card");
  });

  it("handles short deck and Omaha rules", () => {
    expect(cat(S, "Ah6d", "7c8s9h2c3d")).toBe("straight");
    expect(S.rank(cards("AhKh"), cards("Th9h6h6c7d"))).toBeGreaterThan(S.rank(cards("6sTc"), cards("Th9h6h6c7d")));
    expect(cat(O, "AhKsQd2c", "3h5h7h9hJc")).not.toBe("flush");
    expect(cat(O, "AhKhQd2c", "3h5h7h9cJc")).toBe("flush");
  });

  for (const [name, rows] of Object.entries(fixtures as unknown as Record<string, [number[], number[], number][]>)) {
    it(`matches Python exactly on ${rows.length} ${name} hands`, () => {
      const ev = new Evaluator(PRESETS[name]);
      for (const [hole, board, want] of rows) expect(ev.rank(hole, board)).toBe(want);
    });
  }
});
