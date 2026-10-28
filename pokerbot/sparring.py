"""Opponents to test against. SimpleEquityBot is roughly what a strong team ships in 60
minutes; the rest are the archetypes you will meet in a student field."""
import random

from .equity import EquityEngine, OppRange
from .game import Action, CALL, CHECK, FOLD, GameState


class RandomBot:
    def __init__(self, variant, seed=None):
        self.rng = random.Random(seed)

    def act(self, s: GameState) -> Action:
        r = self.rng.random()
        if r < 0.25:
            return FOLD if s.to_call else CHECK
        if r < 0.8:
            return CALL if s.to_call else CHECK
        return s.raise_to(self.rng.randint(s.min_raise_to, max(s.min_raise_to, s.max_raise_to)))


class CallingStation:
    def __init__(self, variant, seed=None):
        pass

    def act(self, s):
        return CALL if s.to_call else CHECK


class Maniac:
    def __init__(self, variant, seed=None):
        self.rng = random.Random(seed)

    def act(self, s):
        r = self.rng.random()
        if r < 0.45:
            return s.raise_to(s.my_street_bet + s.to_call + (s.pot + s.to_call))
        if s.to_call and r > 0.92:
            return FOLD
        return CALL if s.to_call else CHECK


class _EquityBase:
    iters = 250

    def __init__(self, variant, seed=None):
        self.rng = random.Random(seed)
        self.eq = EquityEngine(variant, rng=self.rng)

    def equity(self, s):
        return self.eq.equity(s.hole, s.board, [OppRange.any()] * len(s.live_opponents), self.iters)


class Nit(_EquityBase):
    """Plays the top 12% preflop, bets strong hands, folds to pressure without them."""

    def act(self, s):
        if s.street == 0:
            if self.eq.percentile(s.hole) > 0.88:
                return s.raise_to(s.current_bet * 3)
            return CHECK if s.can_check else FOLD
        e = self.equity(s) * (len(s.live_opponents) + 1)
        if e > 1.5:
            return s.raise_to(s.my_street_bet + s.to_call + 0.66 * (s.pot + s.to_call))
        if s.to_call and e > 1.3:
            return CALL
        return CHECK if s.can_check else FOLD


class SimpleEquityBot(_EquityBase):
    """Equity vs random hands + pot odds. No opponent model."""

    def act(self, s):
        e = self.equity(s)
        rel = e * (len(s.live_opponents) + 1)
        if s.to_call:
            if rel > 1.5:
                return s.raise_to(s.my_street_bet + s.to_call + (s.pot + s.to_call))
            return CALL if e > s.to_call / (s.pot + s.to_call) else FOLD
        if rel > 1.25:
            return s.raise_to(s.my_street_bet + 0.66 * s.pot)
        return CHECK


class Exploiter(_EquityBase):
    """Worst case: a team that has read AdaptiveBot's code (or modelled it well).
    Bets whenever checked to (assumes our checks are weak), folds to our bets unless
    strong (assumes our bets are value), and treats bigger bets as stronger."""

    def __init__(self, variant, seed=None):
        super().__init__(variant, seed)
        self.strong = OppRange(min_score=self.eq.threshold(0.5), strict=0.9)

    def act(self, s):
        if s.street == 0:
            return SimpleEquityBot.act(self, s)
        n = len(s.live_opponents) + 1
        if s.to_call:
            e = self.eq.equity(s.hole, s.board, [self.strong] * (n - 1), self.iters)
            size = s.to_call / max(1, s.pot - s.to_call)
            if e * n > 1.6:
                return s.raise_to(s.my_street_bet + s.to_call + (s.pot + s.to_call))
            if e >= s.to_call / (s.pot + s.to_call) + 0.05 + 0.1 * size:
                return CALL
            return FOLD
        e = self.equity(s)
        if e * n > 1.25 or self.rng.random() < 0.85:
            return s.raise_to(s.my_street_bet + 0.6 * s.pot)
        return CHECK
