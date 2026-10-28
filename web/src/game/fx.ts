// Animation and sound cues. The director turns engine events into these, in order, timed to
// its own pacing; the screen animates them and the synth plays them. Seats are view indices
// (0 is you). Durations are already scaled by the speed setting; 0 means "jump to the end".
import type { Card } from "@/engine/cards";

export type Fx =
  /** a hole card flies from the croupier to a seat (k-th card of n) */
  | { kind: "deal"; seat: number; k: number; n: number }
  /** a board card is dealt face down and flips (▒ → ▌ → K♠) */
  | { kind: "board"; index: number; card: Card }
  /** chips slide from a seat's stack to its bet spot */
  | { kind: "bet"; seat: number; amount: number; allIn: boolean }
  | { kind: "check"; seat: number }
  /** the seat's cards slide toward the middle and fade */
  | { kind: "fold"; seat: number }
  /** a red pulse on the seat and a short screen shake */
  | { kind: "allIn"; seat: number }
  /** the street ends: every bet slides into the pot */
  | { kind: "collect" }
  /** showdown: a seat's cards flip face up */
  | { kind: "reveal"; seat: number }
  /**
   * the pot (or part of it) bursts toward a winner; their glyph flickers gold and the hand
   * name types out. `category` is the evaluator category (7 = quads, 8 = straight flush) for fanfares.
   */
  | { kind: "win"; seat: number; amount: number; hand: string | null; category: number | null }
  /** a creature busts: its glyph crumbles, then it buys back in */
  | { kind: "bust"; seat: number }
  /** a creature starts thinking */
  | { kind: "think"; seat: number }
  /** you typed a key, or a command was refused */
  | { kind: "key" }
  | { kind: "error" };

export interface FxEvent {
  id: number;
  /** performance.now() when it was issued */
  at: number;
  /** how long the animation should take, in ms (0 = no animation) */
  ms: number;
  /** wait this long after `at` before starting, in ms (staggered deals, flips, payouts) */
  delay: number;
  fx: Fx;
}

/** Base durations at 1x speed. The director's beats are at least this long. */
export const FX_MS: Record<Fx["kind"], number> = {
  deal: 260, board: 420, bet: 320, check: 200, fold: 360, allIn: 600, collect: 420,
  reveal: 380, win: 1200, bust: 900, think: 0, key: 0, error: 0,
};

/** Stagger between hole cards while dealing, at 1x. */
export const DEAL_STAGGER = 70;

/** Hand categories at or above this get a fanfare (quads, straight flush). */
export const FANFARE_CATEGORY = 7;
