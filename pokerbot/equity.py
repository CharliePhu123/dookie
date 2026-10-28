"""Monte Carlo equity against opponent *ranges*, not just random hands.

A range is approximated two ways, both cheap enough to run inside the sampling loop:
  * min_score: a preflop-strength floor (from a generic heuristic that works for any
    number of hole cards and any deck), i.e. "this player only plays their top X%".
  * strict: the weakest `strict` fraction of hands, ranked by made-hand strength on the
    visible board, is thrown out, i.e. "when this player bets, they usually have something".
"""
import bisect
import random
import time
from dataclasses import dataclass
from itertools import combinations

from .evaluator import Evaluator
from .variant import Variant


@dataclass(frozen=True)
class OppRange:
    min_score: float = float("-inf")
    strict: float = 0.0
    leak: float = 0.08      # share of the range that is a bluff / any hand

    @staticmethod
    def any() -> "OppRange":
        return OppRange()


class EquityEngine:
    MAX_TRIES = 15

    def __init__(self, variant: Variant, evaluator: Evaluator | None = None, rng=None):
        self.v = variant
        self.ev = evaluator or Evaluator(variant)
        self.rng = rng or random.Random()
        self.deck = variant.deck()
        order = sorted({c >> 2 for c in self.deck})
        n = max(len(order) - 1, 1)
        self.rank_pos = {r: i / n for i, r in enumerate(order)}
        self.rank_ord = {r: i for i, r in enumerate(order)}
        sample = [self.hand_score(self.rng.sample(self.deck, variant.hole_cards)) for _ in range(20000)]
        self.score_dist = sorted(sample)
        self._cache: dict = {}

    # ---- preflop strength heuristic -------------------------------------------------
    def hand_score(self, hole) -> float:
        """Chen-like score generalised to k hole cards and arbitrary decks."""
        rp, ro = self.rank_pos, self.rank_ord
        ps = []
        for a, b in combinations(hole, 2):
            ra, rb = a >> 2, b >> 2
            hi, lo = (rp[ra], rp[rb]) if rp[ra] >= rp[rb] else (rp[rb], rp[ra])
            s = hi + 0.6 * lo
            if ra == rb:
                s += 0.9 + 0.6 * hi
            else:
                if (a & 3) == (b & 3):
                    s += 0.2
                gap = abs(ro[ra] - ro[rb])
                if gap <= 4:
                    s += 0.06 * (5 - gap)
            ps.append(s)
        if not ps:  # one-card variants
            return rp[hole[0] >> 2]
        ps.sort(reverse=True)
        return ps[0] + 0.35 * sum(ps[1:3])

    def threshold(self, top_frac: float) -> float:
        """Score a hand needs to be in the top `top_frac` of all starting hands."""
        if top_frac >= 1.0:
            return float("-inf")
        d = self.score_dist
        return d[min(len(d) - 1, int((1.0 - top_frac) * len(d)))]

    def percentile(self, hole) -> float:
        return bisect.bisect_left(self.score_dist, self.hand_score(hole)) / len(self.score_dist)

    # ---- equity ---------------------------------------------------------------------
    def _canon(self, hole):
        hs = sorted(hole, key=lambda c: (-(c >> 2), c & 3))
        remap, out = {}, []
        for c in hs:
            s = remap.setdefault(c & 3, len(remap))
            out.append((c >> 2) * 4 + s)
        return tuple(out)

    def equity(self, hole, board, opps: list[OppRange], iters: int = 400,
               deadline: float | None = None) -> float:
        if not opps:
            return 1.0
        key = None
        if not board:
            key = (self._canon(hole), tuple(opps))
            if key in self._cache:
                return self._cache[key]

        ev, rng, k = self.ev, self.rng, self.v.hole_cards
        hole, board = list(hole), list(board)
        known = set(hole) | set(board)
        deck = [c for c in self.deck if c not in known]
        need = self.v.board_size - len(board)
        # strength cutoffs on the visible board: rank of the hand at the `strict` quantile
        cut = {}
        if len(board) >= 3:
            for strict in {r.strict for r in opps if r.strict > 0}:
                sample = sorted(ev.rank(rng.sample(deck, k), board) for _ in range(150))
                cut[strict] = sample[min(len(sample) - 1, int(strict * len(sample)))]
        score = self.hand_score
        total = 0.0
        done = 0
        for it in range(iters):
            if deadline and (it & 31) == 31 and time.time() > deadline:
                break
            rng.shuffle(deck)
            full_board = board + deck[:need]
            pos = need
            mine = ev.rank(hole, full_board)
            best, ties = -1, 0
            for r in opps:
                # with probability `leak` the hand is a bluff/random hand; otherwise it
                # must be inside the range (falling back to the best candidate seen)
                h = None
                if pos + k > len(deck):
                    break
                if rng.random() < r.leak or (r.min_score == float("-inf") and r.strict not in cut):
                    h = deck[pos:pos + k]
                    pos += k
                else:
                    best_h, best_key = None, None
                    for _ in range(self.MAX_TRIES):
                        if pos + k > len(deck):
                            break
                        cand = deck[pos:pos + k]
                        pos += k
                        sc = score(cand)
                        strength = ev.rank(cand, board) if r.strict in cut else 0
                        ok_pre = sc >= r.min_score
                        ok_post = r.strict not in cut or strength >= cut[r.strict]
                        if ok_pre and ok_post:
                            h = cand
                            break
                        key = (ok_pre, ok_post, strength, sc)
                        if best_key is None or key > best_key:
                            best_h, best_key = cand, key
                    if h is None:
                        h = best_h
                if h is None:
                    break
                v = ev.rank(h, full_board)
                if v > best:
                    best, ties = v, 0
                elif v == best:
                    ties += 1
            if mine > best:
                total += 1.0
            elif mine == best:
                total += 1.0 / (ties + 2)
            done += 1
        eq = total / done if done else 0.5
        if key is not None and done == iters:
            self._cache[key] = eq
        return eq
