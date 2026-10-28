import { describe, expect, it } from "vitest";
import { parseAmount, parseCommand, short } from "@/game/commands";
import { Game, type GameSave } from "@/game/game";
import { LedgerBuilder, streetNames } from "@/game/ledger";
import { Narrator } from "@/game/narrator";
import { CALL, CHECK, FOLD, raise } from "@/engine/game";
import { Rng } from "@/engine/rng";
import { apply, decision, shuffledDeck, startHand, type HandState } from "@/engine/table";
import { PRESETS } from "@/engine/variant";
import { BotClient } from "@/worker/client";

const H = PRESETS.holdem;

/** A decision where `who` faces a bet (seat A raised to 300 preflop, B to act). */
function facingRaise() {
  let { state } = startHand({ variant: H, seats: ["A", "B", "C"], stacks: { A: 1000, B: 1000, C: 1000 }, deck: shuffledDeck(H, new Rng(1)) });
  state = apply(state, raise(300)).state;
  return decision(state)!;
}

describe("typed commands", () => {
  it("parses amounts like play.py, plus k suffixes", () => {
    expect(parseAmount("740")).toBe(740);
    expect(parseAmount("1,200")).toBe(1200);
    expect(parseAmount("1.5k")).toBe(1500);
    expect(Number.isNaN(parseAmount("lots"))).toBe(true);
  });

  it("turns letters into legal actions and explains mistakes", () => {
    const g = facingRaise();
    expect(parseCommand("f", g)).toEqual({ kind: "action", action: FOLD });
    expect(parseCommand(" C ", g)).toEqual({ kind: "action", action: CALL });
    expect(parseCommand("x", g)).toMatchObject({ kind: "error", message: expect.stringMatching(/can't check/) });
    expect(parseCommand("r 700", g)).toEqual({ kind: "action", action: raise(700) });
    expect(parseCommand("700", g)).toEqual({ kind: "action", action: raise(700) });
    expect(parseCommand("r 301", g)).toMatchObject({ kind: "error", message: "raise must be 598–1,000" });
    expect(parseCommand("r", g)).toMatchObject({ kind: "error", message: expect.stringMatching(/e\.g\. r 598/) });
    expect(parseCommand("a", g)).toEqual({ kind: "action", action: raise(1000) });
    expect(parseCommand("p", g).kind).toBe("action");
    expect(parseCommand("?", g)).toEqual({ kind: "odds" });
    expect(parseCommand("", g)).toEqual({ kind: "none" });
    expect(parseCommand("dance", g).kind).toBe("error");
  });

  it("formats short amounts like play.py", () => {
    expect([short(420), short(1000), short(1250), short(12500)]).toEqual(["420", "1k", "1.3k", "13k"]);
  });
});

/** Play a hand with fixed actions, feeding every event to `observe`. */
function scripted(observe: (e: HandState["history"][number]) => void) {
  let step = startHand({ variant: H, seats: ["A", "B", "C"], stacks: { A: 1000, B: 1000, C: 1000 }, deck: shuffledDeck(H, new Rng(2)) });
  step.events.forEach(observe);
  for (const a of [CALL, CALL, CHECK, CHECK, raise(100), FOLD, CALL, CHECK, CHECK, CHECK, CHECK]) {
    if (step.state.done) break;
    step = apply(step.state, a);
    step.events.forEach(observe);
  }
  return step.state;
}

describe("ledger and narrator", () => {
  it("records each street's actions in play.py's codes", () => {
    const L = new LedgerBuilder();
    const s = scripted((e) => L.observe(e));
    expect(L.ledger.streets).toEqual(["PRE", "FLOP", "TURN", "RIVER", "SHOW"]);
    expect(L.ledger.codes.A[0]).toEqual(["C"]);
    expect(L.ledger.codes.B[0]).toEqual(["b", "C"]);
    expect(L.ledger.codes.C[0]).toEqual(["b", "X"]);
    expect(L.ledger.codes.B[1]).toEqual(["X", "C"]);
    expect(L.ledger.codes.C[1]).toEqual(["B100", "X"].slice(0, 1));
    expect(L.ledger.codes.A[1]).toEqual(["F"]);
    const winners = Object.entries(s.history.at(-1)!.type === "hand_end" ? (s.history.at(-1) as { deltas: Record<string, number> }).deltas : {}).filter(([, d]) => d > 0);
    for (const [w] of winners) expect(L.ledger.codes[w][4][0]).toMatch(/^W\+/);
    expect(streetNames(5)).toEqual(["PRE", "FLOP", "TURN", "4TH", "RIVER", "SHOW"]);
  });

  it("writes well-formed lines in each creature's voice", () => {
    const n = new Narrator(H, { A: "maniac", B: "you", C: "adaptive" }, "B", new Rng(3));
    const lines: string[] = [];
    scripted((e) => lines.push(...n.lines([e])));
    expect(lines[0]).toMatch(/Hand 1\./);
    expect(lines.some((l) => l.includes("gnashback"))).toBe(true);
    expect(lines.some((l) => l.startsWith("{{Y|You}} call"))).toBe(true);
    expect(lines.some((l) => /The flop: /.test(l))).toBe(true);
    expect(lines.some((l) => / takes? \{\{W\|/.test(l))).toBe(true);
    for (const l of lines) expect(l.replace(/\{\{[A-Za-z]\|[^}]*\}\}/g, "")).not.toMatch(/[{}]/);
  });
});

/** Drive a game with typed commands the way a player would: one keystroke at a time, then Enter. */
function autoplay(game: Game, rng: Rng) {
  const commands = ["c", "c", "c", "x", "f", "r 300", "h", "p", "a", "?", "zz", "r 1"];
  let pending = false;
  const drive = () => {
    if (pending || game.view.prompt.mode !== "act") return;
    pending = true;
    setTimeout(() => {
      if (game.view.prompt.mode === "act") {
        for (const ch of rng.pick(commands)) game.key(ch);
        game.key("Enter");
      }
      pending = false;
      drive();   // still our turn after a typo or "?": go again
    }, 0);
  };
  return drive;
}

describe("game", () => {
  it("plays hands end to end from typed commands, conserving chips through rebuys", async () => {
    let saved: GameSave | null = null;
    const rng = new Rng(4);
    let drive = () => {};
    const game = new Game({
      config: { seed: "test", stack: 2000 }, bots: BotClient.create({ inline: true }), speed: 0,
      onChange: () => drive(), persist: (s) => { saved = s; },
    });
    drive = autoplay(game, rng);
    for (let i = 0; i < 25; i++) await game.playOne();
    const s = game.session;
    expect(s.handNo).toBe(25);
    const total = Object.values(s.bank).reduce((a, b) => a + b, 0);
    const buyins = Object.values(s.buyins).reduce((a, b) => a + b, 0);
    expect(total).toBe(2000 * buyins);
    for (const seat of game.view.seats) expect(seat.stack).toBe(s.bank[seat.id]);
    expect(game.view.log.length).toBeGreaterThan(25);
    expect(game.view.read?.hands).toBeGreaterThan(5);
    expect(saved).not.toBeNull();
    game.stop();

    // a reload picks up where we left off, and the Seer still knows us
    const again = new Game({ save: saved, bots: BotClient.create({ inline: true }), speed: 0 });
    expect(again.session.handNo).toBe(25);
    expect(again.session.bank).toEqual(s.bank);
    expect(again.view.read?.hands).toBeCloseTo(game.view.read!.hands, 6);
    again.stop();
  }, 60_000);

  it("explains a bad command without acting", async () => {
    const game = new Game({ config: { seed: "t2", opponents: ["station"] }, bots: BotClient.create({ inline: true }), speed: 0 });
    const hand = game.playOne();
    await new Promise((r) => setTimeout(r, 20));
    // heads-up you're the button and act first preflop
    expect(game.view.prompt.mode).toBe("act");
    for (const ch of "r 1") game.key(ch);
    game.key("Enter");
    expect(game.view.prompt.feedback).toMatch(/raise must be/);
    expect(game.view.prompt.mode).toBe("act");
    expect(game.view.prompt.input).toBe("");   // a fresh line after a mistake
    for (const ch of "zz") game.key(ch);
    game.key("Escape");
    expect(game.view.prompt.input).toBe("");
    game.key("?");
    game.key("Enter");
    expect(game.view.prompt.feedback).toMatch(/equity vs 1 random hand/);
    game.key("f");
    game.key("Enter");
    await hand;
    expect(game.view.log.some((l) => l.includes("You}} fold"))).toBe(true);
    game.stop();
  });
});
