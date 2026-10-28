"""Fast-enough pure-Python hand evaluator for any number of cards and any rank subset.

rank(hole, board) -> int; bigger is better. Equal ints are a split.
"""
from itertools import combinations

from .cards import RANKS
from .variant import Variant

HIGH, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH = range(9)
CATEGORY_NAMES = ["high card", "pair", "two pair", "trips", "straight", "flush",
                  "full house", "quads", "straight flush"]


def _top(mask: int, n: int) -> list[int]:
    out = []
    while mask and len(out) < n:
        r = mask.bit_length() - 1
        out.append(r)
        mask ^= 1 << r
    return out


class Evaluator:
    def __init__(self, variant: Variant):
        self.v = variant
        order = sorted(RANKS.index(r) for r in variant.ranks)
        straights = []
        for i in range(len(order) - 4):
            w = order[i:i + 5]
            straights.append((sum(1 << r for r in w), w[-1]))
        if variant.ace_low_straights and 12 in order and len(order) > 5:
            w = [12] + order[:4]
            straights.append((sum(1 << r for r in w), order[3]))
        straights.sort(key=lambda s: -s[1])
        self.straights = straights

        cats = list(range(9))
        if variant.trips_beats_straight:
            cats[TRIPS], cats[STRAIGHT] = cats[STRAIGHT], cats[TRIPS]
        if variant.flush_beats_full_house:
            cats[FLUSH], cats[FULL_HOUSE] = cats[FULL_HOUSE], cats[FLUSH]
        # cats[position] = category; cat_value[category] = position
        self.cat_value = [0] * 9
        for pos, cat in enumerate(cats):
            self.cat_value[cat] = pos
        self.value_cat = cats

    def _enc(self, cat: int, ks) -> int:
        v = self.cat_value[cat] << 20
        shift = 16
        for k in ks:
            v |= k << shift
            shift -= 4
        return v

    def category(self, value: int) -> int:
        return self.value_cat[value >> 20]

    def rank_any(self, cs) -> int:
        """Best hand using any 5 of the given cards (works with fewer than 5 too)."""
        counts = [0] * 13
        sm = [0, 0, 0, 0]
        for c in cs:
            counts[c >> 2] += 1
            sm[c & 3] |= 1 << (c >> 2)
        rank_mask = sm[0] | sm[1] | sm[2] | sm[3]

        flush = 0
        for m in sm:
            if m.bit_count() >= 5:
                flush = m
                break
        if flush:
            for smask, high in self.straights:
                if flush & smask == smask:
                    return self._enc(STRAIGHT_FLUSH, (high,))

        quads = trips = pairs = 0
        for r in range(13):
            n = counts[r]
            if n >= 4:
                quads |= 1 << r
            elif n == 3:
                trips |= 1 << r
            elif n == 2:
                pairs |= 1 << r
        if quads:
            q = quads.bit_length() - 1
            return self._enc(QUADS, [q] + _top(rank_mask & ~(1 << q), 1))

        best = -1
        if trips and (trips.bit_count() >= 2 or pairs):
            t = trips.bit_length() - 1
            p = ((trips & ~(1 << t)) | pairs).bit_length() - 1
            best = self._enc(FULL_HOUSE, (t, p))
        if flush:
            best = max(best, self._enc(FLUSH, _top(flush, 5)))
        if best >= 0:
            return best

        for smask, high in self.straights:
            if rank_mask & smask == smask:
                best = self._enc(STRAIGHT, (high,))
                break
        if trips:
            t = trips.bit_length() - 1
            best = max(best, self._enc(TRIPS, [t] + _top(rank_mask & ~(1 << t), 2)))
        if best >= 0:
            return best

        if pairs.bit_count() >= 2:
            hi, lo = _top(pairs, 2)
            return self._enc(TWO_PAIR, [hi, lo] + _top(rank_mask & ~(1 << hi) & ~(1 << lo), 1))
        if pairs:
            p = pairs.bit_length() - 1
            return self._enc(PAIR, [p] + _top(rank_mask & ~(1 << p), 3))
        return self._enc(HIGH, _top(rank_mask, 5))

    def rank(self, hole, board) -> int:
        mu = self.v.must_use_hole
        if mu is None or len(board) < 5 - mu:
            return self.rank_any(list(hole) + list(board))
        best = -1
        for h in combinations(hole, mu):
            for b in combinations(board, 5 - mu):
                r = self.rank_any(h + b)
                if r > best:
                    best = r
        return best

    def describe(self, hole, board) -> str:
        return CATEGORY_NAMES[self.category(self.rank(hole, board))]
