import { describe, expect, it } from "vitest";
import { AdaptiveBot } from "@/bots/adaptive";
import { SimpleEquityBot } from "@/bots/sparring";
import { cards } from "@/engine/cards";
import { Evaluator } from "@/engine/evaluator";
import { CALL, FOLD, raise } from "@/engine/game";
import { Rng } from "@/engine/rng";
import { decision, playHand, shuffledDeck, startHand, type HandState } from "@/engine/table";
import { PRESETS, deck as variantDeck } from "@/engine/variant";
import { Game } from "@/game/game";
import { MoodTracker, TELLS, tellShows } from "@/game/moods";
import { DEFAULT_SETTINGS, parseSetting } from "@/game/settings";
import { BotHost } from "@/worker/host";
import { BotClient } from "@/worker/client";

const H = PRESETS.holdem;

describe("settings", () => {
  it("parses typed settings and leaves poker commands alone", () => {
    const s = DEFAULT_SETTINGS;
    expect(parseSetting("speed 2", s)).toMatchObject({ settings: { speed: 2 }, message: "speed 2x" });
    expect(parseSetting("speed instant", s)).toMatchObject({ settings: { speed: 0 } });
    expect(parseSetting("speed 3", s)).toMatchObject({ error: expect.any(String) });
    expect(parseSetting("sound off", s)).toMatchObject({ settings: { sound: false } });
    expect(parseSetting("mute", s)).toMatchObject({ settings: { sound: false } });
    expect(parseSetting("volume 40", s)).toMatchObject({ settings: { volume: 0.4 } });
    expect(parseSetting("crt", s)).toMatchObject({ settings: { crt: true } });
    expect(parseSetting("help", s)).toEqual({ help: true });
    for (const cmd of ["c", "f", "r 300", "a", "?", "x", "call"]) expect(parseSetting(cmd, s)).toBeNull();
  });

  it("applies settings typed at the prompt, at any time", async () => {
    const changed: unknown[] = [];
    const game = new Game({ config: { seed: "s", opponents: ["station"] }, bots: BotClient.create({ inline: true }), speed: 0, onSettings: (x) => changed.push(x) });
    const hand = game.playOne();
    await new Promise((r) => setTimeout(r, 20));
    for (const ch of "speed 4") game.key(ch);
    game.key("Enter");
    expect(game.director.speed).toBe(4);
    expect(game.view.prompt.feedback).toMatch(/speed 4x/);
    expect(game.view.prompt.mode).toBe("act");   // still our turn: a setting isn't a move
    for (const ch of "crt on") game.key(ch);
    game.key("Enter");
    expect(game.view.settings.crt).toBe(true);
    expect(changed).toHaveLength(2);
    game.director.speed = 0;
    game.key("f");
    game.key("Enter");
    await hand;
    game.stop();
  });
});

describe("animation cues", () => {
  it("deals, bets, collects and pays out with cues, instantly at speed 0", async () => {
    let drive = () => {};
    const game = new Game({ config: { seed: "fx" }, bots: BotClient.create({ inline: true }), speed: 0, onChange: () => drive() });
    drive = () => {
      if (game.view.prompt.mode === "act") queueMicrotask(() => { if (game.view.prompt.mode === "act") { game.key("c"); game.key("Enter"); } });
    };
    await game.playOne();
    const kinds = game.view.fx.map((e) => e.fx.kind);
    expect(kinds.filter((k) => k === "deal")).toHaveLength(2 * 6);
    expect(kinds).toContain("bet");
    expect(kinds).toContain("win");
    expect(game.view.fx.every((e) => e.ms === 0 && e.delay === 0)).toBe(true);
    const ids = game.view.fx.map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);   // in issue order
    game.stop();
  });

  it("scales durations with speed and drops them for reduced motion", () => {
    const game = new Game({ config: { seed: "fx2" }, bots: BotClient.create({ inline: true }), speed: 2 });
    const d = game.director;
    d.cue({ kind: "deal", seat: 1, k: 0, n: 2 }, 140);
    expect(d.view.fx.at(-1)).toMatchObject({ ms: 130, delay: 70 });
    d.reducedMotion = true;
    d.cue({ kind: "allIn", seat: 1 });
    expect(d.view.fx.at(-1)).toMatchObject({ ms: 0, delay: 0 });
    game.stop();
  });
});

describe("tells", () => {
  it("leak strength with each creature's reliability", () => {
    const rng = new Rng(1);
    const rate = (kind: string, strength: number) => {
      let n = 0;
      for (let i = 0; i < 4000; i++) n += +tellShows(TELLS[kind]!, strength, rng);
      return n / 4000;
    };
    expect(rate("maniac", 0.9)).toBeCloseTo(0.7, 1);   // drools with strong hands
    expect(rate("maniac", 0.3)).toBeCloseTo(0.12, 1);  // and sometimes for nothing
    expect(rate("nit", 0.2)).toBeCloseTo(0.75, 1);     // hides in its shell when weak
    expect(rate("adaptive", 0.9)).toBeCloseTo(rate("adaptive", 0.1), 1);   // the Seer's stare means nothing
    expect(TELLS.station).toBeNull();
  });

  it("are computed in the worker from real cards, never yours", () => {
    const host = new BotHost();
    host.handle({ type: "init", variant: H, seats: [{ id: "maniac", spec: "maniac", seed: 1 }] });
    const { state, events } = startHand({ variant: H, seats: ["you", "maniac"], deck: shuffledDeck(H, new Rng(2)) });
    host.handle({ type: "observe", events });
    host.handle({ type: "deal", id: "maniac", hole: state.hole.maniac });
    const r = host.handle({ type: "strength", reqId: 1 });
    expect(r?.type === "strength" && Object.keys(r.strength)).toEqual(["maniac"]);
  });
});

/** Play a heads-up hand where `loser` shoves and gets called with the worse hand. */
function bigLoss(loserHole: string, winnerHole: string, board: string): HandState {
  const want = cards(`${winnerHole} ${loserHole} ${board}`);   // seats: you (button) then maniac
  const deck = [...variantDeck(H).filter((c) => !want.includes(c)), ...want.reverse()];
  return playHand({ variant: H, seats: ["you", "maniac"], stacks: { you: 200, maniac: 200 }, deck }, (g) => g.toCall && g.me === "you" ? CALL : raise(g.maxRaiseTo));
}

describe("moods", () => {
  const ev = new Evaluator(H);

  it("tilt after a big loss, then wear off", () => {
    const m = new MoodTracker(["you", "maniac"], ev);
    const h = bigLoss("7c2d", "AsAh", "AdKs9h4c3s");
    expect(h.stacks.maniac).toBe(0);
    const changes = m.update(h, { you: 400, maniac: 0 }, 2);
    expect(changes).toEqual([{ id: "maniac", mood: "tilted", was: null }]);
    const fold = playHand({ variant: H, seats: ["you", "maniac"], deck: shuffledDeck(H, new Rng(3)) }, () => FOLD);
    for (let i = 0; i < 7; i++) m.update(fold, { you: 400, maniac: 200 }, 2);
    expect(m.feel.maniac.mood).toBe("tilted");
    m.update(fold, { you: 400, maniac: 200 }, 2);
    expect(m.feel.maniac.mood).toBeNull();
  });

  it("run hot only on real pots, not blinds", () => {
    const m = new MoodTracker(["you", "maniac"], ev);
    const fold = playHand({ variant: H, seats: ["you", "maniac"], deck: shuffledDeck(H, new Rng(5)) }, () => FOLD);
    for (let i = 0; i < 5; i++) m.update(fold, { you: 400, maniac: 200 }, 2);
    expect(m.feel.maniac.mood).toBeNull();
  });

  it("go short when the stack is under 15 big blinds", () => {
    const m = new MoodTracker(["you", "maniac"], ev);
    const fold = playHand({ variant: H, seats: ["you", "maniac"], deck: shuffledDeck(H, new Rng(4)) }, () => FOLD);
    expect(m.update(fold, { you: 400, maniac: 20 }, 2)[0]).toMatchObject({ mood: "short" });
    expect(m.update(fold, { you: 400, maniac: 300 }, 2)[0]).toMatchObject({ mood: null, was: "short" });
  });

  it("make bots play differently", () => {
    const seer = new AdaptiveBot(H, { rng: new Rng(1) });
    const base = seer.p.bet_rel;
    seer.setMood("tilted");
    expect(seer.p.bet_rel).toBeLessThan(base);
    expect(seer.p.bluff_scale).toBeGreaterThan(1);
    seer.setMood(null);
    expect(seer.p.bet_rel).toBe(base);

    // short-stacked with a strong hand: all in preflop
    const want = cards("AsAh 7c2d");
    const deck = [...variantDeck(H).filter((c) => !want.includes(c)), ...want.reverse()];
    const { state } = startHand({ variant: H, seats: ["simple", "b"], stacks: { simple: 20, b: 200 }, deck });
    const simple = new SimpleEquityBot(H, { rng: new Rng(2) });
    simple.setMood("short");
    expect(simple.act(decision(state)!)).toEqual(raise(20));
  });
});
