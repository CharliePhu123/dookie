// Headless matches between bots: the TS twin of run_match.py. Used by `npm run sim` and tests.
import type { HandEvent } from "@/engine/events";
import { Rng } from "@/engine/rng";
import { STANDARD_RULES, apply, decision, shuffledDeck, startHand, type Rules } from "@/engine/table";
import type { Variant } from "@/engine/variant";
import { AdaptiveBot } from "./adaptive";
import type { Bot, BotOptions } from "./bot";
import { makeBot } from "./index";

export interface MatchOptions {
  variant: Variant;
  /** bot specs, e.g. ["adaptive", "simple", "adaptive:bet_rel=1.0"] */
  players: string[];
  hands: number;
  tableSize?: number;
  seed?: number | string;
  rules?: Rules;
  bot?: BotOptions;
  /** called every `every` hands with the number played */
  progress?: (done: number) => void;
}

export interface MatchRow {
  player: string;
  bbPer100: number;
  /** half-width of the 95% confidence interval, in bb/100 */
  ci95: number;
  hands: number;
}

export interface MatchResult {
  rows: MatchRow[];
  bots: Record<string, Bot>;
  illegal: Record<string, number>;
  /** slowest single decision per player, in ms */
  slowest: Record<string, number>;
  ms: number;
}

export function runMatch(o: MatchOptions): MatchResult {
  const rng = new Rng(o.seed ?? 1);
  const v = o.variant;
  const ids: string[] = [];
  const bots: Record<string, Bot> = {};
  o.players.forEach((spec, i) => {
    const id = o.players.filter((x) => x === spec).length > 1 ? `${spec}#${i}` : spec;
    bots[id] = makeBot(spec, v, { ...o.bot, rng: rng.fork(`bot${i}`) });
    ids.push(id);
  });
  const deckRng = rng.fork("deck");
  const results: Record<string, number[]> = Object.fromEntries(ids.map((p) => [p, []]));
  const illegal: Record<string, number> = Object.fromEntries(ids.map((p) => [p, 0]));
  const slowest: Record<string, number> = Object.fromEntries(ids.map((p) => [p, 0]));
  const broadcast = (events: HandEvent[]) => {
    for (const e of events) for (const b of Object.values(bots)) b.observe?.(e);
  };
  const t0 = performance.now();
  const size = Math.min(o.tableSize ?? 6, ids.length);
  for (let h = 0; h < o.hands; h++) {
    const seats = rng.sample(ids, size);   // random seats every hand
    let step = startHand({ variant: v, seats, deck: shuffledDeck(v, deckRng), handId: h, rules: o.rules ?? STANDARD_RULES });
    for (const p of seats) bots[p].onDeal?.(step.state.hole[p]);
    broadcast(step.events);
    while (!step.state.done) {
      const g = decision(step.state)!;
      const t = performance.now();
      let a;
      try {
        a = bots[g.me].act(g);
      } catch {
        a = null;
        illegal[g.me]++;
      }
      slowest[g.me] = Math.max(slowest[g.me], performance.now() - t);
      const before = step.state.illegal[g.me];
      step = apply(step.state, a);
      illegal[g.me] += step.state.illegal[g.me] - before;
      broadcast(step.events);
    }
    const end = step.state.history[step.state.history.length - 1];
    if (end.type === "hand_end") for (const [p, d] of Object.entries(end.deltas)) results[p].push(d);
    if (o.progress && (h + 1) % Math.max(1, Math.floor(o.hands / 10)) === 0) o.progress(h + 1);
  }
  const bb = v.bigBlind;
  const rows = ids.map((p) => {
    const ds = results[p];
    const m = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
    const sd = Math.sqrt(ds.reduce((a, d) => a + (d - m) ** 2, 0) / Math.max(1, ds.length - 1));
    return { player: p, bbPer100: (100 * m) / bb, ci95: (196 * sd) / bb / Math.sqrt(Math.max(1, ds.length)), hands: ds.length };
  }).sort((a, b) => b.bbPer100 - a.bbPer100);
  return { rows, bots, illegal, slowest, ms: performance.now() - t0 };
}

export function formatMatch(r: MatchResult, title: string): string {
  const lines = [title, `${"bot".padEnd(28)}${"bb/100".padStart(9)}${"±95%".padStart(9)}${"hands".padStart(8)}${"max ms".padStart(8)}`];
  for (const row of r.rows) {
    lines.push(row.player.padEnd(28) + row.bbPer100.toFixed(1).padStart(9) + row.ci95.toFixed(1).padStart(9) +
      String(row.hands).padStart(8) + r.slowest[row.player].toFixed(0).padStart(8));
  }
  for (const [p, c] of Object.entries(r.illegal)) if (c) lines.push(`  ! ${p}: ${c} illegal/crashed actions`);
  const seer = Object.entries(r.bots).find(([, b]) => b instanceof AdaptiveBot);
  if (seer) {
    lines.push("", `what ${seer[0]} learned:`);
    for (const [p, b] of Object.entries(r.bots)) {
      const m = (seer[1] as AdaptiveBot).model;
      if (!(b instanceof AdaptiveBot) && m.has(p)) lines.push(`  ${p.padEnd(26)}${m.stats(p).summary()}`);
    }
  }
  return lines.join("\n");
}
