// Monte Carlo equity against opponent *ranges*, not just random hands. Port of
// pokerbot/equity.py; see there for the reasoning. A range is approximated two ways:
//   minScore: a preflop-strength floor, i.e. "this player only plays their top X%".
//   strict:   the weakest `strict` fraction of hands on the visible board is thrown out,
//             i.e. "when this player bets, they usually have something".
import type { Card } from "./cards";
import { Evaluator } from "./evaluator";
import { Rng } from "./rng";
import { boardSize, deck as variantDeck, type Variant } from "./variant";

export interface OppRange {
  minScore: number;
  strict: number;
  /** share of the range that is a bluff / any hand */
  leak: number;
}

export const anyRange = (): OppRange => ({ minScore: -Infinity, strict: 0, leak: 0.08 });
export const oppRange = (r: Partial<OppRange>): OppRange => ({ ...anyRange(), ...r });

const now = () => performance.now();

export class EquityEngine {
  static MAX_TRIES = 15;

  readonly ev: Evaluator;
  readonly rng: Rng;
  readonly deck: Card[];
  readonly scoreDist: Float64Array;
  private rankPos = new Float64Array(13);
  private rankOrd = new Int8Array(13);
  private cache = new Map<string, number>();

  constructor(readonly v: Variant, evaluator?: Evaluator, rng?: Rng) {
    this.ev = evaluator ?? new Evaluator(v);
    this.rng = rng ?? new Rng();
    this.deck = variantDeck(v);
    const order = [...new Set(this.deck.map((c) => c >> 2))].sort((a, b) => a - b);
    const n = Math.max(order.length - 1, 1);
    order.forEach((r, i) => { this.rankPos[r] = i / n; this.rankOrd[r] = i; });
    const sample = new Float64Array(20000);
    for (let i = 0; i < sample.length; i++) sample[i] = this.handScore(this.rng.sample(this.deck, v.holeCards));
    this.scoreDist = sample.sort();
  }

  // ---- preflop strength heuristic -------------------------------------------------

  /** Chen-like score generalised to k hole cards and arbitrary decks. */
  handScore(hole: readonly Card[]): number {
    const rp = this.rankPos, ro = this.rankOrd;
    const ps: number[] = [];
    for (let i = 0; i < hole.length; i++) {
      for (let j = i + 1; j < hole.length; j++) {
        const a = hole[i], b = hole[j];
        const ra = a >> 2, rb = b >> 2;
        const [hi, lo] = rp[ra] >= rp[rb] ? [rp[ra], rp[rb]] : [rp[rb], rp[ra]];
        let s = hi + 0.6 * lo;
        if (ra === rb) {
          s += 0.9 + 0.6 * hi;
        } else {
          if ((a & 3) === (b & 3)) s += 0.2;
          const gap = Math.abs(ro[ra] - ro[rb]);
          if (gap <= 4) s += 0.06 * (5 - gap);
        }
        ps.push(s);
      }
    }
    if (!ps.length) return rp[hole[0] >> 2];   // one-card variants
    ps.sort((x, y) => y - x);
    let rest = 0;
    for (const s of ps.slice(1, 3)) rest += s;
    return ps[0] + 0.35 * rest;
  }

  /** Score a hand needs to be in the top `topFrac` of all starting hands. */
  threshold(topFrac: number): number {
    if (topFrac >= 1) return -Infinity;
    const d = this.scoreDist;
    return d[Math.min(d.length - 1, Math.floor((1 - topFrac) * d.length))];
  }

  /** Fraction of starting hands that score below this one. */
  percentile(hole: readonly Card[]): number {
    const d = this.scoreDist, x = this.handScore(hole);
    let lo = 0, hi = d.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo / d.length;
  }

  // ---- equity ---------------------------------------------------------------------

  /** Suit-isomorphic key for a hole, so AsKs and AhKh share a cache entry. */
  private canon(hole: readonly Card[]): string {
    const hs = [...hole].sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3));
    const remap = new Map<number, number>();
    return hs.map((c) => {
      if (!remap.has(c & 3)) remap.set(c & 3, remap.size);
      return (c >> 2) * 4 + remap.get(c & 3)!;
    }).join(",");
  }

  /**
   * Probability of winning (ties split) against these opponent ranges.
   * `deadline` is a performance.now() timestamp; sampling stops when it passes.
   */
  equity(hole: readonly Card[], board: readonly Card[], opps: readonly OppRange[],
    iters = 400, deadline?: number): number {
    if (!opps.length) return 1;
    let key: string | null = null;
    if (!board.length) {
      key = this.canon(hole) + "|" + opps.map((o) => `${o.minScore},${o.strict},${o.leak}`).join(";");
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit;
    }

    const { ev, rng } = this, k = this.v.holeCards;
    const known = new Set([...hole, ...board]);
    const deck = this.deck.filter((c) => !known.has(c));
    const need = boardSize(this.v) - board.length;
    // strength cutoffs on the visible board: rank of the hand at the `strict` quantile
    const cut = new Map<number, number>();
    if (board.length >= 3) {
      for (const strict of new Set(opps.filter((r) => r.strict > 0).map((r) => r.strict))) {
        const sample: number[] = [];
        for (let i = 0; i < 150; i++) sample.push(ev.rank(rng.sample(deck, k), board));
        sample.sort((a, b) => a - b);
        cut.set(strict, sample[Math.min(sample.length - 1, Math.floor(strict * sample.length))]);
      }
    }

    const fullBoard = [...board, ...new Array<Card>(need)];
    let total = 0, done = 0;
    for (let it = 0; it < iters; it++) {
      if (deadline !== undefined && (it & 31) === 31 && now() > deadline) break;
      rng.shuffle(deck);
      for (let i = 0; i < need; i++) fullBoard[board.length + i] = deck[i];
      let pos = need;
      const mine = ev.rank(hole, fullBoard);
      let best = -1, ties = 0;
      for (const r of opps) {
        // with probability `leak` the hand is a bluff/random hand; otherwise it must be
        // inside the range (falling back to the best candidate seen)
        let h: Card[] | null = null;
        if (pos + k > deck.length) break;
        const strictCut = cut.get(r.strict);
        if (rng.random() < r.leak || (r.minScore === -Infinity && strictCut === undefined)) {
          h = deck.slice(pos, pos + k);
          pos += k;
        } else {
          let bestH: Card[] | null = null;
          let bestKey: [number, number, number, number] | null = null;
          for (let t = 0; t < EquityEngine.MAX_TRIES; t++) {
            if (pos + k > deck.length) break;
            const cand = deck.slice(pos, pos + k);
            pos += k;
            const sc = this.handScore(cand);
            const strength = strictCut !== undefined ? ev.rank(cand, board) : 0;
            const okPre = sc >= r.minScore;
            const okPost = strictCut === undefined || strength >= strictCut;
            if (okPre && okPost) { h = cand; break; }
            const candKey: [number, number, number, number] = [+okPre, +okPost, strength, sc];
            if (bestKey === null || greater(candKey, bestKey)) { bestH = cand; bestKey = candKey; }
          }
          h ??= bestH;
        }
        if (h === null) break;
        const v = ev.rank(h, fullBoard);
        if (v > best) { best = v; ties = 0; }
        else if (v === best) ties++;
      }
      // like Python, an iteration counts even if the deck ran out before every opponent got a hand
      if (mine > best) total += 1;
      else if (mine === best) total += 1 / (ties + 2);
      done++;
    }
    const eq = done ? total / done : 0.5;
    if (key !== null && done === iters) this.cache.set(key, eq);
    return eq;
  }
}

function greater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
