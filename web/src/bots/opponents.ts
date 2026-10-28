// Opponent modelling: running stats per player with Bayesian priors, plus per-hand action
// tracking that turns into an OppRange for the equity engine. Port of pokerbot/opponents.py;
// see there for the reasoning. Stats decay (memory ~200 hands), so a player who changes
// style is re-learned, and they serialise to JSON so the Seer remembers you between visits.
import type { EquityEngine, OppRange } from "@/engine/equity";
import type { HandEvent } from "@/engine/events";

const PRIORS = {   // [prior rate, weight in pseudo-hands]
  vpip: [0.40, 10],
  pfr: [0.20, 10],
  foldToBet: [0.45, 8],
  aggr: [0.35, 8],
  bluff: [0.30, 5],
  stab: [0.40, 8],
  raise: [0.12, 8],
} as const;
const DECAY = 0.995;   // per hand seen

const rate = (name: keyof typeof PRIORS, num: number, den: number) => {
  const [p, w] = PRIORS[name];
  return (num + p * w) / (den + w);
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

const STAT_FIELDS = ["hands", "vpip", "pfr", "facedBet", "foldedToBet", "postAggr", "postPassive",
  "sdAggr", "sdAggrLost", "checkedTo", "stabs", "raisedVsBet"] as const;
type StatField = (typeof STAT_FIELDS)[number];

export class Stats {
  hands = 0;
  vpip = 0;
  pfr = 0;
  facedBet = 0;
  foldedToBet = 0;
  postAggr = 0;
  postPassive = 0;
  sdAggr = 0;
  sdAggrLost = 0;
  checkedTo = 0;
  stabs = 0;
  raisedVsBet = 0;

  decay(k = DECAY) {
    for (const f of STAT_FIELDS) this[f] *= k;
  }

  get vpipRate() { return rate("vpip", this.vpip, this.hands); }
  get pfrRate() { return rate("pfr", this.pfr, this.hands); }
  get foldRate() { return rate("foldToBet", this.foldedToBet, this.facedBet); }
  get aggrRate() { return rate("aggr", this.postAggr, this.postAggr + this.postPassive); }
  get stabRate() { return rate("stab", this.stabs, this.checkedTo); }
  get raiseRate() { return rate("raise", this.raisedVsBet, this.facedBet); }
  get shownBluffRate() { return rate("bluff", this.sdAggrLost, this.sdAggr); }

  /** How often a bet into a check is a bluff; inferred from frequency, since bluffs we fold to never show. */
  get stabBluffRate() { return Math.max(this.shownBluffRate, Math.min(0.75, this.stabRate - 0.3)); }

  /** How often a raise over our bet is a bluff. Kept apart from stabs: many players only raise with monsters. */
  get raiseBluffRate() { return Math.max(0.5 * this.shownBluffRate, Math.min(0.75, (this.raiseRate - 0.15) * 1.5)); }

  get bluffRate() { return Math.max(this.stabBluffRate, this.raiseBluffRate); }

  summary(): string {
    const f = (x: number) => x.toFixed(2);
    return `hands=${this.hands.toFixed(0)} vpip=${f(this.vpipRate)} pfr=${f(this.pfrRate)} ` +
      `fold2bet=${f(this.foldRate)} stab=${f(this.stabRate)} raise=${f(this.raiseRate)} ` +
      `bluff(stab/raise)=${f(this.stabBluffRate)}/${f(this.raiseBluffRate)}`;
  }
}


/** Our record against one opponent. */
export class Versus {
  /** times they bet/raised into us postflop */
  faced = 0;
  /** times we folded to it */
  folded = 0;
  /** chips we won (+) or lost (-) in pots decided between us */
  net = 0;
  hands = 0;

  get foldRate() { return (this.folded + 0.45 * 10) / (this.faced + 10); }
}

/** What one player has done in the current hand. */
export interface HandRecord {
  vpip: boolean;
  pfr: boolean;
  preRaises: number;
  postAggr: number;
  postStabs: number;
  postRaises: number;
  postCalls: number;
  lastAggrStreet: number;
  folded: boolean;
}

const freshHand = (): HandRecord => ({
  vpip: false, pfr: false, preRaises: 0, postAggr: 0, postStabs: 0, postRaises: 0,
  postCalls: 0, lastAggrStreet: -1, folded: false,
});

export interface ModelJSON {
  stats: Record<string, Partial<Record<StatField, number>>>;
  vs: Record<string, { faced: number; folded: number; net: number; hands: number }>;
}

export class OpponentModel {
  private statsMap = new Map<string, Stats>();
  private vsMap = new Map<string, Versus>();
  hand = new Map<string, HandRecord>();
  numStreets = 4;
  me: string | null = null;
  private streetAggressor: string | null = null;
  private street = 0;

  stats(p: string): Stats {
    let s = this.statsMap.get(p);
    if (!s) this.statsMap.set(p, (s = new Stats()));
    return s;
  }

  vs(p: string): Versus {
    let v = this.vsMap.get(p);
    if (!v) this.vsMap.set(p, (v = new Versus()));
    return v;
  }

  has(p: string) {
    return this.statsMap.has(p);
  }

  observe(e: HandEvent) {
    if (e.type === "hand_start") {
      this.hand = new Map(e.players.map((p) => [p, freshHand()]));
      this.numStreets = e.numStreets;
      this.streetAggressor = null;
      this.street = 0;
      for (const p of e.players) {
        const st = this.stats(p);
        st.decay();
        st.hands += 1;
      }
    } else if (e.type === "action") {
      const { player: p, street: s, action: a } = e;
      if (s !== this.street) { this.street = s; this.streetAggressor = null; }
      const st = this.stats(p);
      let hs = this.hand.get(p);
      if (!hs) this.hand.set(p, (hs = freshHand()));
      if (a === "fold") hs.folded = true;
      if (s === 0) {
        if ((a === "call" || a === "raise") && !hs.vpip) { hs.vpip = true; st.vpip += 1; }
        if (a === "raise") {
          if (!hs.pfr) { hs.pfr = true; st.pfr += 1; }
          hs.preRaises += 1;
        }
      } else {
        if (e.toCall > 0) {
          st.facedBet += 1;
          if (a === "fold") st.foldedToBet += 1;
          if (a === "raise") { st.raisedVsBet += 1; hs.postRaises += 1; }
          if (p === this.me && this.streetAggressor && this.streetAggressor !== p) {
            const v = this.vs(this.streetAggressor);
            v.faced += 1;
            v.folded += +(a === "fold");
          }
        } else {
          st.checkedTo += 1;
          st.stabs += +(a === "raise");
          hs.postStabs += +(a === "raise");
        }
        if (a === "raise") {
          st.postAggr += 1;
          hs.postAggr += 1;
          hs.lastAggrStreet = s;
        } else if (a === "call" || a === "check") {
          st.postPassive += 1;
          if (a === "call") hs.postCalls += 1;
        }
      }
      if (a === "raise") this.streetAggressor = p;
    } else if (e.type === "showdown") {
      const last = this.numStreets - 1;
      const winners = new Set(e.winners);
      for (const p of Object.keys(e.hands)) {
        const hs = this.hand.get(p);
        if (hs && hs.lastAggrStreet === last) {
          this.stats(p).sdAggr += 1;
          if (!winners.has(p)) this.stats(p).sdAggrLost += 1;
        }
      }
    } else if (e.type === "hand_end" && this.me !== null && this.me in e.deltas) {
      const d = e.deltas[this.me];
      const live = [...this.hand].filter(([p, hs]) => !hs.folded && p !== this.me).map(([p]) => p);
      let other: string | null = null;
      if (!(this.hand.get(this.me)?.folded ?? false) && live.length === 1) {
        other = live[0];   // heads-up at the end
      } else {
        const winners = Object.entries(e.deltas).filter(([p, x]) => x > 0 && p !== this.me).map(([p]) => p);
        other = winners.length === 1 ? winners[0] : null;
      }
      if (other && d) {
        this.vs(other).net += d;
        this.vs(other).hands += 1;
      }
    }
  }

  rangeFor(p: string, eq: EquityEngine): OppRange {
    const st = this.stats(p), hs = this.hand.get(p) ?? freshHand();
    let frac: number;
    if (hs.preRaises >= 2) frac = st.pfrRate * 0.4;
    else if (hs.preRaises === 1) frac = st.pfrRate;
    else if (hs.vpip) frac = st.vpipRate;
    else frac = 1;
    frac = clamp(Math.round(frac * 40) / 40, 0.025, 1);   // bucket so preflop cache hits
    let leak = 0.08, strict: number;
    if (hs.postAggr) {
      // value part: top of the range, tighter with each bet/raise; bluff part: `leak`
      strict = 1 - 0.45 ** hs.postAggr;
      leak = st.stabBluffRate ** hs.postStabs * st.raiseBluffRate ** hs.postRaises;
    } else if (hs.postCalls) {
      // a player who folds 70% to bets and called is in their top 30%
      strict = Math.min(0.95, st.foldRate + 0.1 * (hs.postCalls - 1));
      leak = 0.05;
    } else {
      strict = 0;
    }
    return { minScore: eq.threshold(frac), strict: round2(strict), leak: round2(leak) };
  }

  toJSON(): ModelJSON {
    const stats: ModelJSON["stats"] = {};
    for (const [p, s] of this.statsMap) stats[p] = Object.fromEntries(STAT_FIELDS.map((f) => [f, s[f]]));
    const vs: ModelJSON["vs"] = {};
    for (const [p, v] of this.vsMap) vs[p] = { faced: v.faced, folded: v.folded, net: v.net, hands: v.hands };
    return { stats, vs };
  }

  load(d: Partial<ModelJSON>) {
    for (const [p, s] of Object.entries(d.stats ?? {})) Object.assign(this.stats(p), s);
    for (const [p, v] of Object.entries(d.vs ?? {})) Object.assign(this.vs(p), v);
  }
}
