"""Opponent modelling: running stats per player with Bayesian priors, plus per-hand
action tracking that turns into an OppRange for the equity engine.

Stats persist across hands (and across rounds if you save/load them), so the bot
gets sharper exactly when the later, higher-weighted rounds are played. They also
decay, so an opponent who changes strategy mid-tournament is re-learned in ~200 hands.

Anti-exploitation bookkeeping lives here too:
  * stab rate: how often a player bets when checked to. Bluffs we fold to never reach
    showdown, so frequency is the only way to see them.
  * per-opponent "versus me" record: how often we fold to their bets and how many
    chips we have won or lost against them, which drives the bot's safety switch.
"""
import json
from collections import defaultdict
from dataclasses import dataclass, asdict

from .equity import OppRange

PRIORS = {  # (prior rate, weight in pseudo-hands)
    "vpip": (0.40, 10),
    "pfr": (0.20, 10),
    "fold_to_bet": (0.45, 8),
    "aggr": (0.35, 8),
    "bluff": (0.30, 5),
    "stab": (0.40, 8),
    "raise": (0.12, 8),
}
DECAY = 0.995   # per hand seen; effective memory ~200 hands


@dataclass
class Stats:
    hands: float = 0
    vpip: float = 0
    pfr: float = 0
    faced_bet: float = 0
    folded_to_bet: float = 0
    post_aggr: float = 0
    post_passive: float = 0
    sd_aggr: float = 0
    sd_aggr_lost: float = 0
    checked_to: float = 0
    stabs: float = 0
    raised_vs_bet: float = 0

    def decay(self, k=DECAY):
        for f in self.__dataclass_fields__:
            setattr(self, f, getattr(self, f) * k)

    def _rate(self, name, num, den):
        p, w = PRIORS[name]
        return (num + p * w) / (den + w)

    @property
    def vpip_rate(self): return self._rate("vpip", self.vpip, self.hands)
    @property
    def pfr_rate(self): return self._rate("pfr", self.pfr, self.hands)
    @property
    def fold_rate(self): return self._rate("fold_to_bet", self.folded_to_bet, self.faced_bet)
    @property
    def aggr_rate(self): return self._rate("aggr", self.post_aggr, self.post_aggr + self.post_passive)
    @property
    def stab_rate(self): return self._rate("stab", self.stabs, self.checked_to)

    @property
    def raise_rate(self): return self._rate("raise", self.raised_vs_bet, self.faced_bet)

    @property
    def shown_bluff_rate(self):
        return self._rate("bluff", self.sd_aggr_lost, self.sd_aggr)

    @property
    def stab_bluff_rate(self):
        """How often a bet into a check is a bluff. Someone betting 90% of the time when
        checked to is bluffing a lot, even though we never get to see it."""
        return max(self.shown_bluff_rate, min(0.75, self.stab_rate - 0.3))

    @property
    def raise_bluff_rate(self):
        """How often a raise over our bet is a bluff. Kept separate from stabs: plenty of
        players bluff into checks but only raise with monsters."""
        return max(0.5 * self.shown_bluff_rate, min(0.75, (self.raise_rate - 0.15) * 1.5))

    @property
    def bluff_rate(self):
        return max(self.stab_bluff_rate, self.raise_bluff_rate)

    def summary(self) -> str:
        return (f"hands={self.hands:.0f} vpip={self.vpip_rate:.2f} pfr={self.pfr_rate:.2f} "
                f"fold2bet={self.fold_rate:.2f} stab={self.stab_rate:.2f} raise={self.raise_rate:.2f} "
                f"bluff(stab/raise)={self.stab_bluff_rate:.2f}/{self.raise_bluff_rate:.2f}")


@dataclass
class Versus:
    """Our record against one opponent."""
    faced: float = 0       # times they bet/raised into us postflop
    folded: float = 0      # times we folded to it
    net: float = 0         # chips we won (+) or lost (-) in pots decided between us
    hands: int = 0

    @property
    def fold_rate(self):
        return (self.folded + 0.45 * 10) / (self.faced + 10)


@dataclass
class HandState:
    vpip: bool = False
    pfr: bool = False
    pre_raises: int = 0
    post_aggr: int = 0
    post_stabs: int = 0
    post_raises: int = 0
    post_calls: int = 0
    last_aggr_street: int = -1
    folded: bool = False


class OpponentModel:
    def __init__(self):
        self.stats: dict[str, Stats] = defaultdict(Stats)
        self.vs: dict[str, Versus] = defaultdict(Versus)
        self.hand: dict[str, HandState] = {}
        self.num_streets = 4
        self.me: str | None = None
        self.street_aggressor: str | None = None
        self.street = 0

    def observe(self, e: dict):
        t = e["type"]
        if t == "hand_start":
            self.hand = {p: HandState() for p in e["players"]}
            self.num_streets = e.get("num_streets", self.num_streets)
            self.street_aggressor, self.street = None, 0
            for p in e["players"]:
                self.stats[p].decay()
                self.stats[p].hands += 1
        elif t == "action":
            p, s, a = e["player"], e["street"], e["action"]
            if s != self.street:
                self.street, self.street_aggressor = s, None
            st, hs = self.stats[p], self.hand.setdefault(p, HandState())
            if a == "fold":
                hs.folded = True
            if s == 0:
                if a in ("call", "raise") and not hs.vpip:
                    hs.vpip = True
                    st.vpip += 1
                if a == "raise":
                    if not hs.pfr:
                        hs.pfr = True
                        st.pfr += 1
                    hs.pre_raises += 1
            else:
                if e["to_call"] > 0:
                    st.faced_bet += 1
                    if a == "fold":
                        st.folded_to_bet += 1
                    if a == "raise":
                        st.raised_vs_bet += 1
                        hs.post_raises += 1
                    if p == self.me and self.street_aggressor and self.street_aggressor != p:
                        v = self.vs[self.street_aggressor]
                        v.faced += 1
                        v.folded += a == "fold"
                else:
                    st.checked_to += 1
                    st.stabs += a == "raise"
                    hs.post_stabs += a == "raise"
                if a == "raise":
                    st.post_aggr += 1
                    hs.post_aggr += 1
                    hs.last_aggr_street = s
                elif a in ("call", "check"):
                    st.post_passive += 1
                    if a == "call":
                        hs.post_calls += 1
            if a == "raise":
                self.street_aggressor = p
        elif t == "showdown":
            last = self.num_streets - 1
            winners = set(e.get("winners", ()))
            for p in e["hands"]:
                hs = self.hand.get(p)
                if hs and hs.last_aggr_street == last:
                    self.stats[p].sd_aggr += 1
                    if p not in winners:
                        self.stats[p].sd_aggr_lost += 1
        elif t == "hand_end" and self.me in e["deltas"]:
            d = e["deltas"][self.me]
            live = [p for p, hs in self.hand.items() if not hs.folded and p != self.me]
            if not self.hand.get(self.me, HandState()).folded and len(live) == 1:
                other = live[0]                      # heads-up at the end
            else:
                winners = [p for p, x in e["deltas"].items() if x > 0 and p != self.me]
                other = winners[0] if len(winners) == 1 else None
            if other and d:
                self.vs[other].net += d
                self.vs[other].hands += 1

    def range_for(self, p: str, eq_engine) -> OppRange:
        st, hs = self.stats[p], self.hand.get(p, HandState())
        if hs.pre_raises >= 2:
            frac = st.pfr_rate * 0.4
        elif hs.pre_raises == 1:
            frac = st.pfr_rate
        elif hs.vpip:
            frac = st.vpip_rate
        else:
            frac = 1.0
        frac = min(1.0, max(0.025, round(frac * 40) / 40))   # bucket so preflop cache hits
        leak = 0.08
        if hs.post_aggr:
            # value part: top of the range, tighter with each bet/raise; bluff part: `leak`
            strict = 1.0 - 0.45 ** hs.post_aggr
            leak = st.stab_bluff_rate ** hs.post_stabs * st.raise_bluff_rate ** hs.post_raises
        elif hs.post_calls:
            # a player who folds 70% to bets and called is in their top 30%
            strict = min(0.95, st.fold_rate + 0.1 * (hs.post_calls - 1))
            leak = 0.05
        else:
            strict = 0.0
        return OppRange(min_score=eq_engine.threshold(frac), strict=round(strict, 2),
                        leak=round(leak, 2))

    def save(self, path):
        with open(path, "w") as f:
            json.dump({"stats": {p: asdict(s) for p, s in self.stats.items()},
                       "vs": {p: asdict(v) for p, v in self.vs.items()}}, f)

    def load(self, path):
        with open(path) as f:
            d = json.load(f)
        for p, s in d.get("stats", {}).items():
            self.stats[p] = Stats(**s)
        for p, v in d.get("vs", {}).items():
            self.vs[p] = Versus(**v)
