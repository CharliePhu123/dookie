import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cards, type Card } from "@/engine/cards";
import { CALL, CHECK, FOLD, raise, type Action, type GameState } from "@/engine/game";
import { Rng } from "@/engine/rng";
import {
  PYTHON_RULES, STANDARD_RULES, apply, decision, legal, shuffledDeck, startHand,
  type HandState, type Rules,
} from "@/engine/table";
import { PRESETS, boardSize, deck as variantDeck, type Variant } from "@/engine/variant";

/** A random player that also tries illegal and out-of-range things. */
function randomAction(g: GameState, r: Rng): Action {
  const x = r.random();
  if (x < 0.15) return FOLD;
  if (x < 0.45) return CALL;
  if (x < 0.55) return CHECK;
  const pick = r.random();
  if (pick < 0.3) return raise(g.minRaiseTo);
  if (pick < 0.55) return raise(g.myStreetBet + g.toCall + g.pot + g.toCall);
  if (pick < 0.75) return raise(g.maxRaiseTo);
  return raise(r.randint(0, g.maxRaiseTo + 50));
}

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

/** Plays one hand to the end, checking invariants at every step. Returns the final state. */
function checkedHand(v: Variant, n: number, stacks: number[], seed: number, rules: Rules): HandState {
  const r = new Rng(seed);
  const seats = Array.from({ length: n }, (_, i) => `p${i}`);
  const st = Object.fromEntries(seats.map((p, i) => [p, stacks[i]]));
  let step = startHand({ variant: v, seats, stacks: st, deck: shuffledDeck(v, r), rules });
  const chips = total(st);
  for (let guard = 0; !step.state.done; guard++) {
    expect(guard).toBeLessThan(1000);
    const s = step.state;
    const p = s.toAct!;
    expect(s.folded[p] || s.allIn[p]).toBe(false);
    const l = legal(s);
    expect(l.toCall).toBeGreaterThanOrEqual(0);
    expect(l.toCall).toBeLessThanOrEqual(s.stacks[p]);
    if (l.canRaise) {
      expect(l.minRaiseTo).toBeGreaterThan(s.current);
      expect(l.minRaiseTo).toBeLessThanOrEqual(l.maxRaiseTo);
      expect(l.maxRaiseTo).toBeLessThanOrEqual(s.streetBet[p] + s.stacks[p]);
    }
    const before = JSON.stringify(s);
    step = apply(s, randomAction(decision(s)!, r));
    expect(JSON.stringify(s)).toBe(before);   // apply never mutates its input
    const ns = step.state;
    expect(total(ns.stacks) + total(ns.totalIn) - (ns.done ? total(ns.totalIn) : 0)).toBe(chips);
    for (const q of seats) expect(ns.stacks[q]).toBeGreaterThanOrEqual(0);
    for (const e of step.events) {
      if (e.type === "action") {
        expect(e.potAfter - e.pot).toBe(e.action === "call" ? e.toCall : e.action === "raise" ? e.potAfter - e.pot : 0);
        if (e.action === "raise") expect(e.amount).toBe(e.bets[e.player]);
      }
    }
  }
  const s = step.state;
  const end = s.history[s.history.length - 1];
  if (end.type !== "hand_end") throw new Error("hand did not end");
  expect(total(end.deltas)).toBe(0);
  expect(total(s.stacks)).toBe(chips);
  for (const q of seats) expect(s.stacks[q]).toBe(st[q] + end.deltas[q]);
  expect(total(Object.fromEntries(end.pots.map((pt, i) => [i, pt.amount])))).toBe(total(s.totalIn));
  for (const pt of end.pots) expect(total(pt.won)).toBe(pt.amount);
  for (const w of end.winners) expect(s.folded[w]).toBe(false);
  const shown = s.history.find((e) => e.type === "showdown");
  if (shown) expect(s.board.length).toBe(boardSize(v));
  return s;
}

const VARIANTS = Object.values(PRESETS);

describe("table engine invariants", () => {
  for (const rules of [STANDARD_RULES, PYTHON_RULES]) {
    const label = rules === STANDARD_RULES ? "standard rules" : "Python rules";
    it(`conserves chips and stays legal over 10,000 random hands (${label})`, () => {
      const r = new Rng(label);
      for (let i = 0; i < 10_000; i++) {
        const v = r.pick(VARIANTS);
        let n = r.randint(2, 8);
        while (n * v.holeCards + boardSize(v) > variantDeck(v).length) n--;
        const stacks = Array.from({ length: n }, () => r.pick([v.startingStack, r.randint(1, 60), r.randint(1, 400), 1, 3]));
        checkedHand(v, n, stacks, r.next(), rules);
      }
    }, 120_000);
  }

  it("holds for arbitrary tables (property)", () => {
    fc.assert(fc.property(
      fc.constantFrom(...VARIANTS),
      fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 2, maxLength: 8 }),
      fc.integer(),
      fc.boolean(),
      (v, stacks, seed, std) => {
        let n = stacks.length;
        while (n * v.holeCards + boardSize(v) > variantDeck(v).length) n--;
        checkedHand(v, n, stacks, seed, std ? STANDARD_RULES : PYTHON_RULES);
      },
    ), { numRuns: 500 });
  }, 60_000);
});

// ---- hand-built spots -------------------------------------------------------------------

/** A deck that deals the given cards in order (holes seat by seat, then the board). */
function rigged(v: Variant, dealt: string): Card[] {
  const want = cards(dealt);
  const rest = variantDeck(v).filter((c) => !want.includes(c));
  return [...rest, ...want.reverse()];
}

function play(s: HandState, ...actions: [string, Action][]): HandState {
  for (const [who, a] of actions) {
    expect(s.toAct).toBe(who);
    s = apply(s, a).state;
  }
  return s;
}

const H = PRESETS.holdem;

describe("betting rules", () => {
  const shortAllIn = (rules: Rules) => {
    const { state } = startHand({ variant: H, seats: ["A", "B", "C"], stacks: { A: 200, B: 200, C: 30 }, deck: shuffledDeck(H, new Rng(1)), rules });
    return play(state,
      ["A", CALL], ["B", CALL], ["C", CHECK],      // preflop
      ["B", raise(20)], ["C", raise(28)],          // C's all-in is only 8 more: not a full raise
      ["A", CALL]);
  };

  it("a short all-in doesn't reopen the betting (real rule)", () => {
    const s = shortAllIn(STANDARD_RULES);
    expect(s.toAct).toBe("B");
    expect(legal(s).canRaise).toBe(false);
    expect(apply(s, raise(200)).events[0]).toMatchObject({ action: "call", amount: 8 });
  });

  it("a short all-in does reopen the betting under Python's rules", () => {
    expect(legal(shortAllIn(PYTHON_RULES)).canRaise).toBe(true);
  });

  it("short all-ins that add up to a full raise reopen the betting", () => {
    const { state } = startHand({ variant: H, seats: ["A", "B", "C", "D"], stacks: { A: 200, B: 200, C: 30, D: 43 }, deck: shuffledDeck(H, new Rng(2)) });
    const s = play(state,
      ["D", CALL], ["A", CALL], ["B", CALL], ["C", CHECK],
      ["B", raise(20)], ["C", raise(28)], ["D", raise(41)], ["A", CALL]);
    expect(s.toAct).toBe("B");
    expect(legal(s).canRaise).toBe(true);   // 41 - 20 = 21 >= a full raise of 20
  });

  it("caps pot-limit raises at the pot", () => {
    const v = { ...H, potLimit: true };
    const { state } = startHand({ variant: v, seats: ["A", "B", "C"], deck: shuffledDeck(v, new Rng(3)) });
    expect(legal(state)).toMatchObject({ toCall: 2, minRaiseTo: 4, maxRaiseTo: 7 });
  });

  it("doesn't deal the next street once everyone else has folded", () => {
    const { state } = startHand({ variant: H, seats: ["A", "B"], deck: shuffledDeck(H, new Rng(4)) });
    const s = play(state, ["A", CALL], ["B", CHECK], ["B", raise(10)], ["A", FOLD]);
    expect(s.done).toBe(true);
    expect(s.board.length).toBe(3);
    expect(s.history.filter((e) => e.type === "street").length).toBe(1);
  });

  it("gives the odd chip to the first winner left of the button", () => {
    // A and C both play the board's royal flush; B folds the small blind, so the pot is 5
    const deck = rigged(H, "2c3d 4c5d 2d3c AsKsQs Js Ts");
    const run = (rules: Rules) => {
      const { state } = startHand({ variant: H, seats: ["A", "B", "C"], deck, rules });
      const s = play(state, ["A", CALL], ["B", FOLD], ["C", CHECK], ["C", CHECK], ["A", CHECK], ["C", CHECK], ["A", CHECK], ["C", CHECK], ["A", CHECK]);
      const end = s.history[s.history.length - 1];
      return end.type === "hand_end" ? end.pots[0].won : null;
    };
    expect(run(STANDARD_RULES)).toEqual({ C: 3, A: 2 });
    expect(run(PYTHON_RULES)).toEqual({ A: 3, C: 2 });
  });

  it("returns an uncalled all-in excess and splits side pots", () => {
    // B (short) has the best hand; A beats C for the side pot
    const deck = rigged(H, "KhKd AhAd 2c7d 3s8s9cJh4d");
    const { state } = startHand({ variant: H, seats: ["A", "B", "C"], stacks: { A: 100, B: 20, C: 300 }, deck });
    const s = play(state, ["A", raise(100)], ["B", CALL], ["C", raise(300)]);   // everyone's all-in
    const end = s.history[s.history.length - 1];
    if (end.type !== "hand_end") throw new Error("not over");
    expect(end.pots.map((p) => [p.amount, p.eligible, p.won])).toEqual([
      [60, ["A", "B", "C"], { B: 60 }],
      [160, ["A", "C"], { A: 160 }],
      [200, ["C"], { C: 200 }],
    ]);
    expect(end.deltas).toEqual({ A: 60, B: 40, C: -100 });
  });
});
