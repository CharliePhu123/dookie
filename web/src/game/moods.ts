// Tells and moods: the parts of a creature you can read.
//
// A tell is a small idle animation that leaks hand strength, honestly but unreliably: the
// worker reports how strong each creature's hand really is, and the tell shows with that
// creature's reliability (and sometimes as a false alarm). The idol never tells; the Seer's
// stare means nothing at all.
//
// A mood is how a creature feels after recent hands, and it changes how it plays (see
// bots/bot.ts LOOSENESS and AdaptiveBot.setMood): tilted after a big loss, on a heater after
// a run of wins, wary after you show down a bluff, short-stacked when it's nearly out.
import type { Mood } from "@/bots/bot";
import { Evaluator } from "@/engine/evaluator";
import type { Rng } from "@/engine/rng";
import type { HandState } from "@/engine/table";
import { YOU } from "./session";

export type { Mood };

export interface TellDef {
  /** what the screen animates */
  tell: string;
  /** shows on strong hands, weak hands, or regardless */
  when: "strong" | "weak" | "any";
  /** strength (0..1) at which a hand counts as strong; below it, weak */
  at: number;
  /** chance the tell shows when the hand matches `when` */
  reliability: number;
  /** chance it shows anyway when it doesn't */
  falseAlarm: number;
}

export const TELLS: Record<string, TellDef | null> = {
  maniac: { tell: "drool", when: "strong", at: 0.7, reliability: 0.7, falseAlarm: 0.12 },
  nit: { tell: "shell", when: "weak", at: 0.45, reliability: 0.75, falseAlarm: 0.1 },
  simple: { tell: "tap", when: "strong", at: 0.7, reliability: 0.55, falseAlarm: 0.15 },
  exploiter: { tell: "shimmer", when: "weak", at: 0.45, reliability: 0.5, falseAlarm: 0.2 },
  random: { tell: "flicker", when: "any", at: 0, reliability: 0.5, falseAlarm: 0.5 },
  adaptive: { tell: "stare", when: "any", at: 0, reliability: 0.35, falseAlarm: 0.35 },
  station: null,
};

/** Whether a creature's tell shows, given its true hand strength. */
export function tellShows(def: TellDef, strength: number, rng: Rng): boolean {
  const matches = def.when === "any" || (def.when === "strong" ? strength >= def.at : strength < def.at);
  return rng.random() < (matches ? def.reliability : def.falseAlarm);
}

const MOOD_HANDS: Record<Mood, number> = { tilted: 8, heater: 5, wary: 6, short: 0 };
const PRIORITY: Mood[] = ["tilted", "heater", "wary", "short"];

interface Feeling {
  mood: Mood | null;
  /** hands left before it wears off (0 = holds while the condition does) */
  left: number;
  /** the last few results: +1 won, -1 lost */
  recent: number[];
}

export interface MoodChange {
  id: string;
  mood: Mood | null;
  was: Mood | null;
}

export class MoodTracker {
  feel: Record<string, Feeling> = {};

  constructor(ids: string[], private ev: Evaluator) {
    for (const id of ids) if (id !== YOU) this.feel[id] = { mood: null, left: 0, recent: [] };
  }

  /** After a hand: who changed mood. `bank` is chips after the hand; `bb` the big blind. */
  update(h: HandState, bank: Record<string, number>, bb: number): MoodChange[] {
    const end = h.history[h.history.length - 1];
    if (end.type !== "hand_end") return [];
    const show = h.history.find((e) => e.type === "showdown");
    const last = h.variant.streets.length - 1;
    const youBluffed = !!show && show.type === "showdown" && show.hands[YOU] !== undefined &&
      h.history.some((e) => e.type === "action" && e.player === YOU && e.action === "raise" && e.street === last) &&
      this.ev.category(this.ev.rank(show.hands[YOU], show.board)) <= 1;
    const changes: MoodChange[] = [];
    for (const [id, f] of Object.entries(this.feel)) {
      if (!(id in end.deltas)) continue;
      const was = f.mood;
      const d = end.deltas[id];
      // only real pots count toward a streak, not blinds picked up
      const big = Math.abs(d) >= 5 * bb;
      if (big) f.recent = [...f.recent, Math.sign(d)].slice(-4);
      // timed moods wear off; "short" lasts exactly as long as the stack is short
      if (f.mood === "short" || (f.left > 0 && --f.left === 0)) f.mood = null;
      const candidates = new Set<Mood>();
      if (f.mood) candidates.add(f.mood);
      if (d <= -Math.max(30 * bb, 0.35 * h.startStacks[id])) candidates.add("tilted");
      if (big && d > 0 && f.recent.filter((x) => x > 0).length >= 3) candidates.add("heater");
      if (youBluffed && show?.type === "showdown" && show.hands[id]) candidates.add("wary");
      if (bank[id] >= bb && bank[id] < 15 * bb) candidates.add("short");
      const next = PRIORITY.find((m) => candidates.has(m)) ?? null;
      if (next !== f.mood) f.left = next ? MOOD_HANDS[next] : 0;   // a new mood starts its clock
      f.mood = next;
      if (f.mood !== was) changes.push({ id, mood: f.mood, was });
    }
    return changes;
  }
}

/** The log line for a mood change. */
export function moodLine(who: string, c: MoodChange): string | null {
  switch (c.mood) {
    case "tilted": return `${who} is on tilt. {{K|It will play loose for a while.}}`;
    case "heater": return `${who} is running hot.`;
    case "wary": return `${who} eyes you warily now.`;
    case "short": return `${who} is short-stacked and desperate.`;
    default: return c.was === "short" ? null : `${who} settles down.`;
  }
}

