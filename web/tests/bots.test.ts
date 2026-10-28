import { describe, expect, it } from "vitest";
import { AdaptiveBot, BOT_KINDS, makeBot } from "@/bots/index";
import { runMatch } from "@/bots/match";
import { OpponentModel } from "@/bots/opponents";
import { canCheck, type GameState } from "@/engine/game";
import { Rng } from "@/engine/rng";
import { decision, legal, shuffledDeck, startHand } from "@/engine/table";
import { PRESETS } from "@/engine/variant";
import { BotClient } from "@/worker/client";

const H = PRESETS.holdem;
const deterministic = { timeLimit: Infinity };   // no wall-clock cutoffs, so seeds reproduce exactly

describe("bots", () => {
  it("builds bots from run_match.py-style specs", () => {
    const b = makeBot("adaptive:bet_rel=1.2;mix=0", H) as AdaptiveBot;
    expect(b).toBeInstanceOf(AdaptiveBot);
    expect(b.p.bet_rel).toBe(1.2);
    expect(b.p.mix).toBe(0);
    expect(b.p.trap).toBe(0.35);
    expect(() => makeBot("wizard", H)).toThrow(/unknown bot/);
  });

  for (const v of ["holdem", "shortdeck", "omaha", "plo", "3card", "royal", "bigboard"]) {
    it(`every bot plays ${v} without illegal or crashed actions`, () => {
      const kinds = Object.keys(BOT_KINDS);
      const r = runMatch({
        variant: PRESETS[v], players: kinds, hands: v === "omaha" || v === "plo" ? 40 : 120,
        tableSize: 6, seed: v, bot: { iters: 120 },
      });
      for (const k of kinds) expect(r.illegal[k], k).toBe(0);
      expect(r.rows.reduce((a, row) => a + row.bbPer100 * row.hands, 0)).toBeCloseTo(0, 6);   // zero-sum
    }, 60_000);
  }

  it("reproduces a match exactly from its seed", () => {
    const run = () => runMatch({ variant: H, players: ["adaptive", "simple", "maniac"], hands: 60, tableSize: 3, seed: 5, bot: deterministic });
    expect(run().rows).toEqual(run().rows);
  });

  it("decides within budget", () => {
    const r = runMatch({ variant: H, players: ["adaptive", "simple", "nit", "maniac", "station", "exploiter"], hands: 150, seed: 2 });
    expect(r.slowest.adaptive).toBeLessThan(400);
  }, 60_000);

  it("learns who calls and who raises", () => {
    const r = runMatch({ variant: H, players: ["adaptive", "station", "maniac", "nit"], hands: 400, tableSize: 4, seed: 3, bot: { iters: 100 } });
    const m = (r.bots.adaptive as AdaptiveBot).model;
    expect(m.stats("station").foldRate).toBeLessThan(0.15);
    expect(m.stats("maniac").pfrRate).toBeGreaterThan(0.35);
    expect(m.stats("nit").vpipRate).toBeLessThan(0.25);
  }, 60_000);

  it("saves and restores what it has learned", () => {
    const r = runMatch({ variant: H, players: ["adaptive", "maniac"], hands: 100, tableSize: 2, seed: 4, bot: { iters: 80 } });
    const saved = JSON.parse(JSON.stringify((r.bots.adaptive as AdaptiveBot).save()));
    const m = new OpponentModel();
    m.load(saved);
    expect(m.stats("maniac").pfrRate).toBe((r.bots.adaptive as AdaptiveBot).model.stats("maniac").pfrRate);
    expect(m.vs("maniac").net).toBe((r.bots.adaptive as AdaptiveBot).model.vs("maniac").net);
  });

  it("falls back to check/fold if its strategy throws", () => {
    const b = new AdaptiveBot(H, { rng: new Rng(1) });
    const { state } = startHand({ variant: H, seats: ["a", "b"], deck: shuffledDeck(H, new Rng(1)) });
    const g = decision(state)!;
    const broken = { ...g, players: null } as unknown as GameState;
    const err = console.error;
    console.error = () => {};
    try {
      expect(b.act(broken).kind).toBe(canCheck(g) ? "check" : "fold");
    } finally {
      console.error = err;
    }
  });
});

describe("bot client", () => {
  it("runs bots behind the worker protocol and saves their models", async () => {
    const bots = BotClient.create({ inline: true });
    bots.init(H, [{ id: "seer", spec: "adaptive", seed: 1 }, { id: "rock", spec: "nit", seed: 2 }]);
    const { state, events } = startHand({ variant: H, seats: ["seer", "rock"], deck: shuffledDeck(H, new Rng(9)) });
    bots.observe(events);
    bots.deal("seer", state.hole.seer);
    const reply = await bots.act(decision(state)!);
    const l = legal(state);
    expect(["fold", "call", "raise"]).toContain(reply.action.kind);
    if (reply.action.kind === "raise") {
      expect(reply.action.amount).toBeGreaterThanOrEqual(l.minRaiseTo);
      expect(reply.action.amount).toBeLessThanOrEqual(l.maxRaiseTo);
    }
    expect(reply.thought?.equity).toBeGreaterThan(0);
    const models = await bots.save();
    expect(Object.keys(models)).toEqual(["seer"]);
    expect(models.seer.stats.rock.hands).toBe(1);
    bots.close();
  });

  it("restores a saved model on init", async () => {
    const bots = BotClient.create({ inline: true });
    bots.init(H, [{ id: "seer", spec: "adaptive", seed: 1, model: { stats: { you: { hands: 50, vpip: 40 } }, vs: {} } }]);
    expect((await bots.save()).seer.stats.you).toMatchObject({ hands: 50, vpip: 40 });
    bots.close();
  });
});
