// What every bot implements. The engine (or the Worker) calls act() for decisions and
// observe() for every event of every hand, in order.
import type { Card } from "@/engine/cards";
import type { HandEvent } from "@/engine/events";
import type { Action, GameState } from "@/engine/game";
import type { Rng } from "@/engine/rng";

export interface Bot {
  act(s: GameState): Action;
  observe?(e: HandEvent): void;
  onDeal?(hole: readonly Card[]): void;
}

export interface BotOptions {
  /** randomness for this bot; pass a fork of the session Rng for reproducible games */
  rng?: Rng;
  /** Monte Carlo iterations per equity estimate */
  iters?: number;
  /** compute budget per decision, in milliseconds */
  timeLimit?: number;
  /** strategy knobs (AdaptiveBot only) */
  params?: Record<string, number>;
}

/** Weighted random choice, like Python's random.choices(xs, weights)[0]. */
export function choose<T>(rng: Rng, xs: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = rng.random() * total;
  for (let i = 0; i < xs.length; i++) {
    x -= weights[i];
    if (x < 0) return xs[i];
  }
  return xs[xs.length - 1];
}
