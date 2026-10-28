// Hand evaluator for any number of cards and any rank subset. Port of pokerbot/evaluator.py:
// the integer it returns is bit-for-bit the same as Python's, which the parity test checks.
import { RANKS, type Card } from "./cards";
import type { Variant } from "./variant";

export const HIGH = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4, FLUSH = 5,
  FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8;
export const CATEGORY_NAMES = ["high card", "pair", "two pair", "trips", "straight", "flush",
  "full house", "quads", "straight flush"];

const bitLength = (m: number) => 32 - Math.clz32(m);
function popcount(m: number) {
  let n = 0;
  while (m) { m &= m - 1; n++; }
  return n;
}
function top(mask: number, n: number): number[] {
  const out: number[] = [];
  while (mask && out.length < n) {
    const r = bitLength(mask) - 1;
    out.push(r);
    mask ^= 1 << r;
  }
  return out;
}

function* combinations<T>(xs: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= xs.length - (k - acc.length); i++) {
    acc.push(xs[i]);
    yield* combinations(xs, k, i + 1, acc);
    acc.pop();
  }
}

export class Evaluator {
  readonly straights: [number, number][];  // [mask, high rank], best first
  readonly catValue: number[];             // category -> ordering position
  readonly valueCat: number[];             // ordering position -> category
  private counts = new Int8Array(13);

  constructor(readonly v: Variant) {
    const order = [...v.ranks].map((r) => RANKS.indexOf(r)).sort((a, b) => a - b);
    const straights: [number, number][] = [];
    for (let i = 0; i + 4 < order.length; i++) {
      const w = order.slice(i, i + 5);
      straights.push([w.reduce((m, r) => m | (1 << r), 0), w[4]]);
    }
    if (v.aceLowStraights && order.includes(12) && order.length > 5) {
      const w = [12, ...order.slice(0, 4)];
      straights.push([w.reduce((m, r) => m | (1 << r), 0), order[3]]);
    }
    straights.sort((a, b) => b[1] - a[1]);
    this.straights = straights;

    const cats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (v.tripsBeatsStraight) [cats[TRIPS], cats[STRAIGHT]] = [cats[STRAIGHT], cats[TRIPS]];
    if (v.flushBeatsFullHouse) [cats[FLUSH], cats[FULL_HOUSE]] = [cats[FULL_HOUSE], cats[FLUSH]];
    this.catValue = new Array(9).fill(0);
    cats.forEach((cat, pos) => (this.catValue[cat] = pos));
    this.valueCat = cats;
  }

  private enc(cat: number, ks: number[]): number {
    let v = this.catValue[cat] << 20;
    let shift = 16;
    for (const k of ks) { v |= k << shift; shift -= 4; }
    return v;
  }

  category(value: number): number {
    return this.valueCat[value >> 20];
  }

  /** Best hand using any 5 of the given cards (works with fewer than 5 too). */
  rankAny(cs: readonly Card[]): number {
    const counts = this.counts;
    counts.fill(0);
    const sm = [0, 0, 0, 0];
    for (const c of cs) {
      counts[c >> 2]++;
      sm[c & 3] |= 1 << (c >> 2);
    }
    const rankMask = sm[0] | sm[1] | sm[2] | sm[3];

    let flush = 0;
    for (const m of sm) if (popcount(m) >= 5) { flush = m; break; }
    if (flush) {
      for (const [smask, high] of this.straights)
        if ((flush & smask) === smask) return this.enc(STRAIGHT_FLUSH, [high]);
    }

    let quads = 0, trips = 0, pairs = 0;
    for (let r = 0; r < 13; r++) {
      const n = counts[r];
      if (n >= 4) quads |= 1 << r;
      else if (n === 3) trips |= 1 << r;
      else if (n === 2) pairs |= 1 << r;
    }
    if (quads) {
      const q = bitLength(quads) - 1;
      return this.enc(QUADS, [q, ...top(rankMask & ~(1 << q), 1)]);
    }

    let best = -1;
    if (trips && (popcount(trips) >= 2 || pairs)) {
      const t = bitLength(trips) - 1;
      const p = bitLength((trips & ~(1 << t)) | pairs) - 1;
      best = this.enc(FULL_HOUSE, [t, p]);
    }
    if (flush) best = Math.max(best, this.enc(FLUSH, top(flush, 5)));
    if (best >= 0) return best;

    for (const [smask, high] of this.straights)
      if ((rankMask & smask) === smask) { best = this.enc(STRAIGHT, [high]); break; }
    if (trips) {
      const t = bitLength(trips) - 1;
      best = Math.max(best, this.enc(TRIPS, [t, ...top(rankMask & ~(1 << t), 2)]));
    }
    if (best >= 0) return best;

    if (popcount(pairs) >= 2) {
      const [hi, lo] = top(pairs, 2);
      return this.enc(TWO_PAIR, [hi, lo, ...top(rankMask & ~(1 << hi) & ~(1 << lo), 1)]);
    }
    if (pairs) {
      const p = bitLength(pairs) - 1;
      return this.enc(PAIR, [p, ...top(rankMask & ~(1 << p), 3)]);
    }
    return this.enc(HIGH, top(rankMask, 5));
  }

  rank(hole: readonly Card[], board: readonly Card[]): number {
    const mu = this.v.mustUseHole;
    if (mu === null || board.length < 5 - mu) return this.rankAny([...hole, ...board]);
    let best = -1;
    for (const h of combinations(hole, mu))
      for (const b of combinations(board, 5 - mu)) {
        const r = this.rankAny([...h, ...b]);
        if (r > best) best = r;
      }
    return best;
  }

  describe(hole: readonly Card[], board: readonly Card[]): string {
    return CATEGORY_NAMES[this.category(this.rank(hole, board))];
  }
}
