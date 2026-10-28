// The message log, in the game's voice. Each creature has its own way of folding, calling and
// shoving; lines are picked with a seeded Rng so a replay reads the same. Output is log markup:
// "{{R|the gnashback}} shoves {{W|9,550}}" renders each {{X|...}} in palette colour X.
import { RANKS, type Card } from "@/engine/cards";
import { Evaluator } from "@/engine/evaluator";
import type { HandEvent } from "@/engine/events";
import type { Rng } from "@/engine/rng";
import type { Variant } from "@/engine/variant";
import { fmt } from "./commands";

type Kind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

interface Voice {
  /** palette letter for this creature's name */
  color: string;
  /** how the log refers to it mid-sentence */
  name: string;
  lines: Record<Kind, string[]>;
}

// {W} = the creature, {A} = the amount
const VOICES: Record<string, Voice> = {
  you: {
    color: "Y", name: "you",
    lines: {
      fold: ["{W} fold."], check: ["{W} check."], call: ["{W} call {A}."], bet: ["{W} bet {A}."],
      raise: ["{W} raise to {A}."], allin: ["{W} push all {A} in."],
    },
  },
  adaptive: {
    color: "M", name: "the Seer",
    lines: {
      fold: ["{W} folds. Its eyes stay on you.", "{W} lets the hand go."],
      check: ["{W} checks, watching.", "{W} taps the stone once."],
      call: ["{W} calls {A}.", "{W} calls {A}, unblinking."],
      bet: ["{W} bets {A}.", "{W} slides {A} forward without looking down."],
      raise: ["{W} raises to {A}.", "{W} raises to {A}. Its many eyes narrow."],
      allin: ["{W} moves all in for {A}. The lamp gutters."],
    },
  },
  simple: {
    color: "C", name: "the Reckoner",
    lines: {
      fold: ["{W} folds after a quick sum.", "{W} folds."],
      check: ["{W} checks."],
      call: ["{W} calls {A}; the odds allow it.", "{W} calls {A}."],
      bet: ["{W} bets {A}, by the numbers."],
      raise: ["{W} raises to {A}."],
      allin: ["{W} pushes {A} in. The arithmetic is certain."],
    },
  },
  maniac: {
    color: "R", name: "the gnashback",
    lines: {
      fold: ["{W} folds, snarling."],
      check: ["{W} checks, which surprises everyone."],
      call: ["{W} calls {A}, gnashing.", "{W} calls {A}."],
      bet: ["{W} hurls {A} at the pot."],
      raise: ["{W} raises to {A}, frothing.", "{W} raises to {A} and bares its teeth."],
      allin: ["{W} shoves {A} chips across the felt, frothing."],
    },
  },
  nit: {
    color: "w", name: "the tortoise",
    lines: {
      fold: ["{W} folds, clutching its chips.", "{W} withdraws into its shell."],
      check: ["{W} checks."],
      call: ["{W} calls {A}, very slowly."],
      bet: ["{W} bets {A}. Beware."],
      raise: ["{W} raises to {A}. It has something."],
      allin: ["{W} pushes everything in. It has been waiting for this."],
    },
  },
  station: {
    color: "y", name: "the idol",
    lines: {
      fold: ["{W} folds. A first."],
      check: ["{W} checks."],
      call: ["{W} calls. It always calls.", "{W} calls {A}, gleaming."],
      bet: ["{W} bets {A}."],
      raise: ["{W} raises to {A}, gleaming."],
      allin: ["{W} calls it all: {A}. Of course."],
    },
  },
  exploiter: {
    color: "O", name: "the mimic",
    lines: {
      fold: ["{W} folds, studying how you did it."],
      check: ["{W} checks."],
      call: ["{W} calls {A}."],
      bet: ["{W} bets {A}, the way you would."],
      raise: ["{W} raises to {A}."],
      allin: ["{W} copies your nerve: all in for {A}."],
    },
  },
  random: {
    color: "G", name: "the glitch",
    lines: {
      fold: ["{W} folds. Or flickers."],
      check: ["{W} checks, f-f-flickering."],
      call: ["{W} calls {A}."],
      bet: ["{W} bets {A} for no reason at all."],
      raise: ["{W} raises to {A}?"],
      allin: ["{W} glitches all {A} into the pot."],
    },
  },
};

// asides when you act and the Seer is watching; s(true) is its name capitalised
const SEER_NOTES: ((s: (start?: boolean) => string) => string)[] = [
  (s) => `${s(true)} notes it.`,
  (s) => `Something in ${s()}'s eyes shifts.`,
  (s) => `${s(true)}'s gaze settles on you.`,
];

/** Hand categories as they read in a sentence: "takes 400 with two pair". */
const HAND_WORDS = ["high card", "a pair", "two pair", "three of a kind", "a straight", "a flush",
  "a full house", "four of a kind", "a straight flush"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One card in log markup, red for hearts and diamonds. */
export const cardMarkup = (c: Card) => `{{${(c & 3) === 1 || (c & 3) === 2 ? "R" : "Y"}|${RANKS[c >> 2]}${"♣♦♥♠"[c & 3]}}}`;
export const cardsMarkup = (cs: readonly Card[]) => cs.map(cardMarkup).join(" ");

export class Narrator {
  private ev: Evaluator;
  private board: Card[] = [];
  private streetHasBet = false;
  private street = 0;
  /** hands shown down this hand */
  private shown: Record<string, Card[]> = {};

  /** `kinds` maps player id -> creature key (a VOICES key); `human` is your id. */
  constructor(readonly v: Variant, private kinds: Record<string, string>, private human: string, private rng: Rng) {
    this.ev = new Evaluator(v);
  }

  /** "the Seer" in its colour; capitalised at the start of a sentence. */
  who(p: string, start = false): string {
    const voice = VOICES[this.kinds[p]] ?? VOICES.random;
    const name = p === this.human ? "you" : voice.name;
    return `{{${voice.color}|${start ? cap(name) : name}}}`;
  }

  private say(p: string, kind: Kind, amount: number): string {
    const voice = p === this.human ? VOICES.you : VOICES[this.kinds[p]] ?? VOICES.random;
    return this.rng.pick(voice.lines[kind]).replace("{W}", this.who(p, true)).replace("{A}", `{{W|${fmt(amount)}}}`);
  }

  /** Log lines for these engine events, in order. */
  lines(events: readonly HandEvent[]): string[] {
    const out: string[] = [];
    for (const e of events) {
      switch (e.type) {
        case "hand_start":
          this.board = [];
          this.street = 0;
          this.shown = {};
          out.push(e.button === this.human
            ? `{{K|Hand ${e.handId + 1}.}} The dealer's stone is yours.`
            : `{{K|Hand ${e.handId + 1}.}} ${this.who(e.button, true)} takes the dealer's stone.`);
          break;
        case "street": {
          const fresh = e.board.slice(this.board.length);
          this.board = e.board;
          this.street = e.street;
          this.streetHasBet = false;
          const name = e.street === 1 ? "The flop" : e.street === this.v.streets.length - 1 ? "The river" : e.street === 2 ? "The turn" : "Another card";
          out.push(`${name}: ${cardsMarkup(fresh)}.`);
          break;
        }
        case "action": {
          let kind: Kind;
          if (e.action === "raise") kind = e.allIn ? "allin" : this.street > 0 && !this.streetHasBet ? "bet" : "raise";
          else if (e.action === "call" && e.allIn) kind = "allin";
          else kind = e.action;
          if (e.action === "raise") this.streetHasBet = true;
          const amount = e.action === "raise" ? e.amount : e.action === "call" ? e.toCall : 0;
          let line = this.say(e.player, kind, kind === "allin" ? e.bets[e.player] : amount);
          const seer = Object.keys(this.kinds).find((p) => this.kinds[p] === "adaptive");
          if (e.player === this.human && seer && e.action !== "check" && this.rng.random() < 0.2) {
            line += " " + this.rng.pick(SEER_NOTES)((start) => this.who(seer, start));
          }
          out.push(line);
          break;
        }
        case "showdown":
          this.board = e.board;
          this.shown = e.hands;
          for (const [p, hole] of Object.entries(e.hands)) {
            out.push(`${this.who(p, true)} ${p === this.human ? "show" : "shows"} ${cardsMarkup(hole)}: ${this.handName(hole)}.`);
          }
          break;
        case "hand_end": {
          for (const pot of e.pots) {
            const ws = Object.keys(pot.won);
            if (pot.eligible.length === 1 && e.pots.length > 1) continue;   // an uncalled bet coming back
            const amt = `{{W|${fmt(pot.amount)}}}`;
            if (ws.length > 1) {
              out.push(`${ws.map((w, i) => this.who(w, i === 0)).join(" and ")} split ${amt}.`);
            } else {
              const w = ws[0];
              const takes = w === this.human ? "take" : "takes";
              const how = this.shown[w] && pot.eligible.length > 1 ? ` with ${this.handName(this.shown[w])}`
                : pot.eligible.length === 1 ? " uncontested" : "";
              out.push(`${this.who(w, true)} ${takes} ${amt}${how}.`);
            }
          }
          break;
        }
      }
    }
    return out;
  }

  /** Evaluator category (0 high card ... 8 straight flush) of the best hand these cards make. */
  category(hole: readonly Card[], board: readonly Card[] = this.board): number {
    return this.ev.category(this.ev.rank(hole, board));
  }

  /** "a flush", "two pair": the best hand these cards make on the current board. */
  handName(hole: readonly Card[], board: readonly Card[] = this.board): string {
    return HAND_WORDS[this.ev.category(this.ev.rank(hole, board))];
  }

  rebuy(p: string, stack: number, n: number): string {
    return p === this.human
      ? `You're bust. The croupier slides you a fresh stack of {{W|${fmt(stack)}}}. {{K|(buy-in ${n})}}`
      : `${this.who(p, true)} is bust, and buys back in for {{W|${fmt(stack)}}}.`;
  }
}
