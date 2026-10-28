// The archetypes the creatures play. Port of pokerbot/sparring.py. SimpleEquityBot is
// roughly what a strong team ships in an hour; the rest are the styles you meet in a field.
import { EquityEngine, anyRange, oppRange, type OppRange } from "@/engine/equity";
import { CALL, CHECK, FOLD, canCheck, canRaise, liveOpponents, raiseTo, type Action, type GameState } from "@/engine/game";
import { Rng } from "@/engine/rng";
import type { Variant } from "@/engine/variant";
import { LOOSENESS, SHORT_SHOVE, type Bot, type BotOptions, type Mood } from "./bot";

export class RandomBot implements Bot {
  private rng: Rng;
  constructor(_v: Variant, o: BotOptions = {}) { this.rng = o.rng ?? new Rng(); }

  act(s: GameState): Action {
    const r = this.rng.random();
    if (r < 0.25) return s.toCall ? FOLD : CHECK;
    if (r < 0.8) return s.toCall ? CALL : CHECK;
    return raiseTo(s, this.rng.randint(s.minRaiseTo, Math.max(s.minRaiseTo, s.maxRaiseTo)));
  }
}

export class CallingStation implements Bot {
  act(s: GameState): Action { return s.toCall ? CALL : CHECK; }
}

export class Maniac implements Bot {
  private rng: Rng;
  constructor(_v: Variant, o: BotOptions = {}) { this.rng = o.rng ?? new Rng(); }

  act(s: GameState): Action {
    const r = this.rng.random();
    if (r < 0.45) return raiseTo(s, s.myStreetBet + s.toCall + (s.pot + s.toCall));
    if (s.toCall && r > 0.92) return FOLD;
    return s.toCall ? CALL : CHECK;
  }
}

abstract class EquityBase implements Bot {
  iters = 250;
  protected rng: Rng;
  readonly eq: EquityEngine;
  /** how much a mood lowers this bot's thresholds */
  protected loose = 0;
  protected mood: Mood | null = null;

  setMood(m: Mood | null) {
    this.mood = m;
    this.loose = m ? LOOSENESS[m] : 0;
  }

  /** Short-stacked preflop: all in with a decent hand. */
  protected shortShove(s: GameState): Action | null {
    if (this.mood !== "short" || s.street !== 0 || !canRaise(s)) return null;
    return this.eq.percentile(s.hole) >= SHORT_SHOVE ? raiseTo(s, s.maxRaiseTo) : null;
  }

  constructor(v: Variant, o: BotOptions = {}) {
    this.rng = o.rng ?? new Rng();
    this.eq = new EquityEngine(v, undefined, this.rng);
    if (o.iters) this.iters = o.iters;
  }

  equity(s: GameState): number {
    return this.eq.equity(s.hole, s.board, liveOpponents(s).map(anyRange), this.iters);
  }

  abstract act(s: GameState): Action;
}

/** Plays the top 12% preflop, bets strong hands, folds to pressure without them. */
export class Nit extends EquityBase {
  act(s: GameState): Action {
    const shove = this.shortShove(s);
    if (shove) return shove;
    if (s.street === 0) {
      if (this.eq.percentile(s.hole) > 0.88 - 1.5 * this.loose) return raiseTo(s, s.currentBet * 3);
      return canCheck(s) ? CHECK : FOLD;
    }
    const e = this.equity(s) * (liveOpponents(s).length + 1);
    if (e > 1.5 - 2 * this.loose) return raiseTo(s, s.myStreetBet + s.toCall + 0.66 * (s.pot + s.toCall));
    if (s.toCall && e > 1.3 - 2 * this.loose) return CALL;
    return canCheck(s) ? CHECK : FOLD;
  }
}

/** Equity vs random hands + pot odds. No opponent model. */
export class SimpleEquityBot extends EquityBase {
  act(s: GameState): Action {
    return this.shortShove(s) ?? simpleAct(s, this.equity(s), this.loose);
  }
}

function simpleAct(s: GameState, e: number, loose = 0): Action {
  const rel = e * (liveOpponents(s).length + 1);
  if (s.toCall) {
    if (rel > 1.5 - 2 * loose) return raiseTo(s, s.myStreetBet + s.toCall + (s.pot + s.toCall));
    return e > s.toCall / (s.pot + s.toCall) - loose ? CALL : FOLD;
  }
  if (rel > 1.25 - 2 * loose) return raiseTo(s, s.myStreetBet + 0.66 * s.pot);
  return CHECK;
}

/**
 * Worst case: a bot written by someone who has read AdaptiveBot's code. Bets whenever
 * checked to, folds to our bets unless strong, and treats bigger bets as stronger.
 */
export class Exploiter extends EquityBase {
  private strong: OppRange;

  constructor(v: Variant, o: BotOptions = {}) {
    super(v, o);
    this.strong = oppRange({ minScore: this.eq.threshold(0.5), strict: 0.9 });
  }

  act(s: GameState): Action {
    if (s.street === 0) return this.shortShove(s) ?? simpleAct(s, this.equity(s), this.loose);
    const n = liveOpponents(s).length + 1;
    if (s.toCall) {
      const e = this.eq.equity(s.hole, s.board, new Array(n - 1).fill(this.strong), this.iters);
      const size = s.toCall / Math.max(1, s.pot - s.toCall);
      if (e * n > 1.6) return raiseTo(s, s.myStreetBet + s.toCall + (s.pot + s.toCall));
      if (e >= s.toCall / (s.pot + s.toCall) + 0.05 + 0.1 * size - this.loose) return CALL;
      return FOLD;
    }
    const e = this.equity(s);
    if (e * n > 1.25 || this.rng.random() < 0.85) return raiseTo(s, s.myStreetBet + 0.6 * s.pot);
    return CHECK;
  }
}
