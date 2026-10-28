// AdaptiveBot (the Seer): range-aware equity + pot odds + exploitative adjustments, with a
// look-ahead after the flop. Port of pokerbot/bot.py; see there and README.md for the why.
// Every threshold is "relative equity" (equity x players in the pot), so the same numbers
// work heads-up, eight-handed and in any variant.
import { EquityEngine, anyRange, type OppRange } from "@/engine/equity";
import type { HandEvent } from "@/engine/events";
import {
  CALL, CHECK, FOLD, canCheck, canRaise, liveOpponents, raise, raiseTo,
  type Action, type GameState,
} from "@/engine/game";
import { Rng } from "@/engine/rng";
import { numStreets, type Variant } from "@/engine/variant";
import { SHORT_SHOVE, choose, type Bot, type BotOptions, type Mood } from "./bot";
import { OpponentModel } from "./opponents";

export const ADAPTIVE_DEFAULTS = {
  bet_rel: 1.08,      // bet when equity x players >= this (vs an average folder)
  raise_gap: 0.22,    // raise needs bet_rel + this
  margin: 0.0,        // extra equity required over pot odds to call
  mw_margin: 0.0,     // extra again in multiway pots before the river
  bluff_scale: 1.0,   // multiplies all bluff frequencies
  use_ranges: 1,      // 0 = treat every opponent as a random hand
  // --- anti-exploitation ---
  balance: 1,         // bet sizes independent of hand strength, baseline bluffs
  trap: 0.35,         // max slow-play rate, scaled by how often they bet into checks
  base_bluff: 0.22,   // heads-up bluff rate with air vs an average folder
  defend: 1,          // call wider vs players we fold to too often
  safety_bb: 60,      // lost this many bb to someone over 40+ pots -> guard mode vs them
  // --- look-ahead (postflop) ---
  lookahead: 1,       // 0 = threshold rules after the flop
  mix: 0.04,          // randomise between options whose EVs are within ~mix x pot
};
export type AdaptiveParams = typeof ADAPTIVE_DEFAULTS;

const LOOK_SIZES = [0.33, 0.66, 1.0];
const SIZES = [0.33, 0.66, 1.0];
const SIZE_WEIGHTS = [0.3, 0.45, 0.25];
const STATION_SIZES = [0.66, 1.0, 1.3];   // vs players who rarely fold: bigger, still mixed
const STATION_WEIGHTS = [0.3, 0.45, 0.25];

const clamp = (x: number, lo = 0.02, hi = 0.95) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const now = () => performance.now();

/** What the last decision was based on, for the odds overlay and "Lessons from the Seer". */
export interface Thought {
  equity: number;
  options?: { action: Action; ev: number }[];
}

export class AdaptiveBot implements Bot {
  /** current knobs: the base params, adjusted by mood */
  p: AdaptiveParams;
  private base: AdaptiveParams;
  private mood: Mood | null = null;
  readonly rng: Rng;
  readonly eq: EquityEngine;
  readonly model = new OpponentModel();
  iters: number;
  /** ms per equity call */
  timeLimit: number;
  lastThought: Thought | null = null;

  constructor(readonly v: Variant, o: BotOptions = {}) {
    this.p = this.base = { ...ADAPTIVE_DEFAULTS, ...(o.params ?? {}) };
    this.rng = o.rng ?? new Rng();
    this.eq = new EquityEngine(v, undefined, this.rng);
    this.iters = o.iters ?? 300;
    this.timeLimit = o.timeLimit ?? 50;
  }

  observe(e: HandEvent) {
    this.model.observe(e);
  }

  /** Tilted: looser and bluffier. On a heater: bolder. Wary: calls wider. Short: shoves or folds preflop. */
  setMood(m: Mood | null) {
    this.mood = m;
    const b = this.base;
    this.p = m === "tilted" ? { ...b, bet_rel: b.bet_rel - 0.1, bluff_scale: b.bluff_scale * 1.5, margin: b.margin - 0.04 }
      : m === "heater" ? { ...b, bet_rel: b.bet_rel - 0.05, bluff_scale: b.bluff_scale * 1.25 }
      : m === "wary" ? { ...b, margin: b.margin - 0.05, defend: 1 }
      : b;
  }

  act(s: GameState): Action {
    try {
      return this.decide(s);
    } catch (err) {
      console.error(err);
      return canCheck(s) ? CHECK : FOLD;   // never crash the table
    }
  }

  private decide(s: GameState): Action {
    this.model.me = s.me;
    if (this.mood === "short" && s.street === 0 && canRaise(s) && this.eq.percentile(s.hole) >= SHORT_SHOVE) {
      this.lastThought = null;
      return raiseTo(s, s.maxRaiseTo);
    }
    const opps = liveOpponents(s).map((pv) => pv.id);
    const p = this.p;
    const ranges: OppRange[] = p.use_ranges
      ? opps.map((o) => this.model.rangeFor(o, this.eq))
      : opps.map(anyRange);
    const eq = this.eq.equity(s.hole, s.board, ranges, this.iters, now() + this.timeLimit);
    this.lastThought = { equity: eq };
    const n = opps.length + 1;
    const rel = eq * n;
    const final = s.street === numStreets(s.variant) - 1;
    const preflop = s.street === 0;
    const stats = opps.map((o) => this.model.stats(o));
    const foldRate = stats.reduce((a, st) => a + st.foldRate, 0) / stats.length;
    const stabRate = Math.max(...stats.map((st) => st.stabRate));
    const spr = s.myStack / Math.max(s.pot, 1);
    let aggressor: string | null = null;
    for (let i = s.history.length - 1; i >= 0; i--) {
      const e = s.history[i];
      if (e.type === "action" && e.street === s.street && e.action === "raise") { aggressor = e.player; break; }
    }

    let bluffRate = 0.3;
    if (aggressor && aggressor !== s.me) {
      const st = this.model.stats(aggressor);
      const facingRaise = s.history.some((e) => e.type === "action" && e.street === s.street &&
        e.player === s.me && e.action === "raise");
      bluffRate = facingRaise ? st.raiseBluffRate : st.stabBluffRate;
    }

    // guard mode: someone is beating us, so assume they've read us. Slow-play and defend
    // more against them so our checks and folds stop being free money.
    const guard = opps.some((o) => this.model.vs(o).hands >= 40 &&
      this.model.vs(o).net < -p.safety_bb * s.variant.bigBlind);

    if (p.lookahead && !preflop) return this.lookahead(s, opps, ranges, eq, aggressor, guard);

    // thin value vs stations, tighter vs folders; call wider vs bluffers
    const betRel = Math.min(p.bet_rel + 0.2, Math.max(p.bet_rel - 0.1, p.bet_rel + 0.5 * (foldRate - 0.45)));
    const raiseRel = betRel + p.raise_gap;
    const thrEq = betRel / n;
    const strength = Math.min(1, Math.max(0, (eq - thrEq) / Math.max(1e-6, 1 - thrEq)));

    const committed = (target: number) => target > 0.55 * (s.myStreetBet + s.myStack);
    const balancedSize = () => {
      // size depends on who we're betting into, never on our own hand
      let frac: number;
      if (preflop) frac = 0.8;
      else if (foldRate < 0.35) frac = choose(this.rng, STATION_SIZES, STATION_WEIGHTS);
      else frac = choose(this.rng, SIZES, SIZE_WEIGHTS);
      const target = s.myStreetBet + s.toCall + frac * (s.pot + s.toCall);
      return raiseTo(s, committed(target) ? s.maxRaiseTo : target);
    };
    const valueSize = () => {
      if (p.balance) {
        if (strength > 0.6 && spr < 1.5) return raiseTo(s, s.maxRaiseTo);
        return balancedSize();
      }
      const frac = preflop ? 0.8 : 0.5 + 0.5 * strength + (foldRate < 0.35 ? 0.25 : 0);
      let target = s.myStreetBet + s.toCall + frac * (s.pot + s.toCall);
      if (strength > 0.6 && (spr < 2.5 || committed(target))) target = s.maxRaiseTo;
      return raiseTo(s, target);
    };
    const bluffSize = () => p.balance ? balancedSize() : raiseTo(s, s.myStreetBet + s.toCall + 0.6 * (s.pot + s.toCall));

    let bluffP = 0;
    if (n === 2 && !preflop) {
      const exploit = Math.max(0, (foldRate - 0.4) * 2);
      if (p.balance) {
        // baseline bluffs only pay vs players who fold; vs stations they burn chips
        const base = p.base_bluff * Math.min(1, Math.max(0, (foldRate - 0.25) / 0.2));
        const weak = eq < 0.35 || (!final && eq < 0.5);
        // vs a heavy folder, betting beats checking even with showdown value
        bluffP = weak || foldRate > 0.55 ? base + exploit : 0;
      } else {
        bluffP = exploit;
      }
      if (!final && eq > 0.3) bluffP += 0.15;   // semi-bluff with equity
      bluffP = Math.min(0.65, bluffP) * p.bluff_scale;
    } else if (n === 3 && !preflop && p.balance && eq < 0.25) {
      bluffP = 0.06 * p.bluff_scale;
    }

    if (s.toCall > 0) {
      const odds = s.toCall / (s.pot + s.toCall);
      let margin = p.margin - 0.1 * (bluffRate - 0.3) + (n > 2 && !final ? p.mw_margin : 0);
      if (p.defend && aggressor && !preflop) {
        const v = this.model.vs(aggressor);
        margin -= Math.min(0.12, Math.max(0, (v.foldRate - 0.5) * 0.6));
        if (guard) margin -= 0.03;
      }
      if (canRaise(s) && rel >= raiseRel) return valueSize();
      if (eq >= odds + margin) return CALL;
      if (canRaise(s) && spr > 3 && this.rng.random() < bluffP * 0.35) return bluffSize();
      return FOLD;
    }
    // slow-playing only pays vs players who bet when checked to
    let trap = p.trap * Math.min(1, Math.max(0, (stabRate - 0.25) / 0.35)) * (final ? 0.6 : 1);
    if (guard) trap = Math.max(trap, 0.2);
    if (canRaise(s) && rel >= betRel && !preflop && strength > 0.5 && this.rng.random() < trap) {
      return CHECK;   // slow-play: our checking range now contains monsters
    }
    if (canRaise(s) && rel >= betRel) return valueSize();
    if (canRaise(s) && this.rng.random() < bluffP) return bluffSize();
    return CHECK;
  }

  /**
   * Score every legal option by expected chips, predicting how each opponent responds from
   * what we've learned about them, then pick (with a little mixing). EVs are "chips we end
   * up taking from the pot, minus chips we add from now on", so check-through = eq * pot and
   * fold = 0. Horizon: this street plus the opponent's most likely response on the next one.
   */
  private lookahead(s: GameState, opps: string[], ranges: OppRange[], eq: number,
    aggressor: string | null, guard: boolean): Action {
    const P = s.pot, C = s.toCall;
    const final = s.street === numStreets(s.variant) - 1;
    const stats = new Map(opps.map((o) => [o, this.model.stats(o)]));
    const views = new Map(s.players.map((pv) => [pv.id, pv]));
    const rangeOf = new Map(opps.map((o, i) => [o, ranges[i]]));
    const sub = Math.max(120, Math.floor(this.iters * 2 / 3));
    const eqVs = (rs: OppRange[]) => this.eq.equity(s.hole, s.board, rs, sub, now() + this.timeLimit);

    /** Opponent o's current range, cut to the top `keep` fraction by board strength. */
    const narrowed = (o: string, keep: number, leak = 0.05): OppRange => {
      const r = rangeOf.get(o)!;
      keep = Math.min(1, Math.max(0.03, keep));
      return { minScore: r.minScore, strict: round2(1 - (1 - r.strict) * keep), leak: round2(leak) };
    };

    // How likely each opponent is to fold / re-raise depends on what they've already done
    // this hand: someone who just bet or raised only folds their bluffs.
    const fold = new Map<string, number>(), reraise = new Map<string, number>();
    for (const o of opps) {
      const st = stats.get(o)!;
      const mine = s.history.filter((e) => e.type === "action" && e.street === s.street &&
        e.player === o && e.action === "raise");
      if (mine.length) {
        let bluff = 1;
        for (const e of mine) if (e.type === "action") bluff *= e.toCall > 0 ? st.raiseBluffRate : st.stabBluffRate;
        fold.set(o, clamp(bluff));
        reraise.set(o, clamp(0.45 * (1 - bluff), 0.05, 0.6));
      } else {
        const calls = this.model.hand.get(o)?.postCalls ?? 0;
        fold.set(o, clamp(st.foldRate * 0.75 ** calls));
        reraise.set(o, clamp(st.raiseRate, 0.01, 0.6));
      }
    }
    if (guard) for (const [o, f] of fold) fold.set(o, clamp(f - 0.1));   // the people beating us fold less
    const options: { action: Action; ev: number }[] = [];

    // ---- passive option ---------------------------------------------------------------
    if (C === 0) {
      const acted = new Set(s.history.filter((e) => e.type === "action" && e.street === s.street)
        .map((e) => (e.type === "action" ? e.player : "")));
      const toAct = opps.filter((o) => !acted.has(o) && !views.get(o)!.allIn);
      if (toAct.length) {
        let pNoStab = 1;
        for (const o of toAct) pNoStab *= 1 - stats.get(o)!.stabRate;
        const pStab = 1 - pNoStab;
        const x = 0.6 * P;
        const eqS = eqVs(opps.map((o) => toAct.includes(o)
          ? narrowed(o, stats.get(o)!.stabRate, stats.get(o)!.stabBluffRate) : rangeOf.get(o)!));
        options.push({ action: CHECK, ev: (1 - pStab) * eq * P + pStab * Math.max(0, eqS * (P + 2 * x) - x) });
      } else {
        options.push({ action: CHECK, ev: eq * P });
      }
    } else {
      options.push({ action: FOLD, ev: 0 });
      const P1 = P + C;
      if (final || !aggressor || !stats.has(aggressor)) {
        options.push({ action: CALL, ev: eq * P1 - C });
      } else {
        // they keep betting next street with roughly their stab frequency
        const a = stats.get(aggressor)!;
        const q = clamp(a.stabRate, 0.05, 0.9);
        const x = 0.66 * P1;
        const eq2 = eqVs(opps.map((o) => o === aggressor ? narrowed(o, q, a.stabBluffRate) : rangeOf.get(o)!));
        options.push({ action: CALL, ev: -C + (1 - q) * eq * P1 + q * Math.max(0, eq2 * (P1 + 2 * x) - x) });
      }
    }

    // ---- aggressive options -----------------------------------------------------------
    if (canRaise(s)) {
      const eqCalled = eqVs(opps.map((o) => narrowed(o, 1 - fold.get(o)!)));
      const eqRr = eqVs(opps.map((o) => narrowed(o, reraise.get(o)!, 0.03)));
      const targets = new Set(LOOK_SIZES.map((f) => Math.round(s.myStreetBet + C + f * (P + C))));
      if (s.myStack < 4 * P) targets.add(s.maxRaiseTo);
      const seen = new Set<number>();
      for (let target of [...targets].sort((a, b) => a - b)) {
        target = Math.min(s.maxRaiseTo, Math.max(s.minRaiseTo, target));
        if (target > 0.55 * (s.myStreetBet + s.myStack)) target = s.maxRaiseTo;   // don't leave a silly amount behind
        if (seen.has(target)) continue;
        seen.add(target);
        const add = target - s.myStreetBet;
        const size = (target - s.currentBet) / Math.max(1, P + C);
        let pAllFold = 1, pNoRr = 1, callChips = 0;
        for (const o of opps) {
          const f = clamp(fold.get(o)! + 0.15 * Math.min(0.6, size - 0.66));
          pAllFold *= f;
          pNoRr *= 1 - reraise.get(o)!;
          const pv = views.get(o)!;
          callChips += (1 - f) * Math.min(target - pv.streetBet, pv.stack);
        }
        const pRr = Math.min(1 - pAllFold, 1 - pNoRr);
        const pCall = Math.max(0, 1 - pAllFold - pRr);
        const cont = Math.max(1e-9, 1 - pAllFold);
        const evCalled = eqCalled * (P + add + callChips / cont) - add;
        // re-raised: to ~3x, then we call it off or fold, whichever is better
        const rrTo = Math.min(3 * target, s.myStreetBet + s.myStack);
        const extra = rrTo - target;
        const evRr = Math.max(-add, eqRr * (P + add + rrTo - s.currentBet + extra) - add - extra);
        options.push({ action: raise(target), ev: pAllFold * P + pCall * evCalled + pRr * evRr });
      }
    }

    // ---- choose: best EV, mixing between near-equal options --------------------------
    this.lastThought = { equity: eq, options };
    const best = Math.max(...options.map((o) => o.ev));
    const temp = this.p.mix * this.p.balance * Math.max(P, 1);
    if (temp <= 0) return options.find((o) => o.ev === best)!.action;
    return choose(this.rng, options.map((o) => o.action), options.map((o) => Math.exp((o.ev - best) / temp)));
  }

  /** The model of everyone, to persist between sessions. */
  save() {
    return this.model.toJSON();
  }
}
