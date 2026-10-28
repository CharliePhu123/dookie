"""AdaptiveBot: range-aware equity + pot odds + exploitative adjustments.

Every threshold is expressed as "relative equity" (equity x players in the pot), so the
same logic works heads-up, six-handed, and in any variant without retuning.
"""
import math
import random
import time
import traceback

from .equity import EquityEngine, OppRange
from .evaluator import Evaluator
from .game import Action, CALL, CHECK, FOLD, GameState
from .opponents import OpponentModel
from .variant import Variant


class AdaptiveBot:
    # Tunable knobs. Override per-instance: AdaptiveBot(v, params={"mw_margin": 0.0})
    # or from the CLI: --players "adaptive:mw_margin=0,adaptive,simple"
    DEFAULTS = {
        "bet_rel": 1.08,      # bet when equity x players >= this (vs an average folder)
        "raise_gap": 0.22,    # raise needs bet_rel + this
        "margin": 0.0,        # extra equity required over pot odds to call
        "mw_margin": 0.0,     # extra again in multiway pots before the river
        "bluff_scale": 1.0,   # multiplies all bluff frequencies
        "use_ranges": 1,      # 0 = treat every opponent as a random hand
        # --- anti-exploitation (set balance=0;defend=0 to get the old, readable bot) ---
        "balance": 1,         # bet sizes independent of hand strength, baseline bluffs
        "trap": 0.35,         # max slow-play rate, scaled by how often they bet into checks
        "base_bluff": 0.22,   # heads-up bluff rate with air vs an average folder
        "defend": 1,          # call wider vs players we fold to too often
        "safety_bb": 60,      # lost this many bb to someone over 40+ pots -> guard mode vs them
        # --- look-ahead (postflop) ---
        "lookahead": 1,       # 0 = old threshold rules after the flop
        "mix": 0.04,          # randomise between options whose EVs are within ~mix x pot
    }
    LOOK_SIZES = (0.33, 0.66, 1.0)
    SIZES = (0.33, 0.66, 1.0)
    SIZE_WEIGHTS = (0.3, 0.45, 0.25)
    STATION_SIZES = (0.66, 1.0, 1.3)   # vs players who rarely fold: bigger, still mixed
    STATION_WEIGHTS = (0.3, 0.45, 0.25)

    def __init__(self, variant: Variant, iters: int = 300, time_limit: float = 0.05,
                 seed=None, stats_path: str | None = None, debug: bool = False,
                 params: dict | None = None):
        self.p = {**self.DEFAULTS, **(params or {})}
        self.v = variant
        self.rng = random.Random(seed)
        self.ev = Evaluator(variant)
        self.eq = EquityEngine(variant, self.ev, self.rng)
        self.model = OpponentModel()
        self.iters, self.time_limit, self.debug = iters, time_limit, debug
        self.stats_path = stats_path
        if stats_path:
            try:
                self.model.load(stats_path)
            except (OSError, ValueError):
                pass

    # ---- engine hooks ---------------------------------------------------------------
    def observe(self, event: dict):
        self.model.observe(event)

    def act(self, state: GameState) -> Action:
        try:
            return self._act(state)
        except Exception:
            if self.debug:
                traceback.print_exc()
            return CHECK if state.can_check else FOLD   # never time out or crash

    def save(self):
        if self.stats_path:
            self.model.save(self.stats_path)

    # ---- strategy -------------------------------------------------------------------
    def _act(self, s: GameState) -> Action:
        self.model.me = s.me
        opps = [p.id for p in s.live_opponents]
        p = self.p
        if p["use_ranges"]:
            ranges = [self.model.range_for(o, self.eq) for o in opps]
        else:
            ranges = [OppRange.any()] * len(opps)
        eq = self.eq.equity(s.hole, s.board, ranges, self.iters, time.time() + self.time_limit)
        n = len(opps) + 1
        rel = eq * n
        final = s.street == s.num_streets - 1
        preflop = s.street == 0
        stats = [self.model.stats[o] for o in opps]
        fold_rate = sum(st.fold_rate for st in stats) / len(stats)
        stab_rate = max(st.stab_rate for st in stats)
        spr = s.my_stack / max(s.pot, 1)
        aggressor = next((e["player"] for e in reversed(s.history)
                          if e["type"] == "action" and e["street"] == s.street
                          and e["action"] == "raise"), None)

        if aggressor and aggressor != s.me:
            st = self.model.stats[aggressor]
            facing_raise = any(e["type"] == "action" and e["street"] == s.street and e["player"] == s.me
                               and e["action"] == "raise" for e in s.history)
            bluff_rate = st.raise_bluff_rate if facing_raise else st.stab_bluff_rate
        else:
            bluff_rate = 0.3

        # guard mode: someone is beating us, so assume they have read us. Slow-play and
        # defend more against them so our checks and folds stop being free money.
        guard = any(self.model.vs[o].hands >= 40 and
                    self.model.vs[o].net < -p["safety_bb"] * s.variant.big_blind for o in opps)

        if p["lookahead"] and not preflop:
            act = self._lookahead(s, opps, ranges, eq, aggressor, guard)
            if self.debug:
                print(f"[{s.me}] st{s.street} eq={eq:.2f} call={s.to_call} pot={s.pot} -> {act}")
            return act

        # thin value vs stations, tighter vs folders; call wider vs bluffers
        bet_rel = min(p["bet_rel"] + 0.2, max(p["bet_rel"] - 0.1, p["bet_rel"] + 0.5 * (fold_rate - 0.45)))
        raise_rel = bet_rel + p["raise_gap"]
        thr_eq = bet_rel / n
        strength = min(1.0, max(0.0, (eq - thr_eq) / max(1e-6, 1.0 - thr_eq)))

        def committed(target):
            return target > 0.55 * (s.my_street_bet + s.my_stack)

        def balanced_size():
            # size depends on who we're betting into, never on our own hand
            if preflop:
                frac = 0.8
            elif fold_rate < 0.35:
                frac = self.rng.choices(self.STATION_SIZES, self.STATION_WEIGHTS)[0]
            else:
                frac = self.rng.choices(self.SIZES, self.SIZE_WEIGHTS)[0]
            target = s.my_street_bet + s.to_call + frac * (s.pot + s.to_call)
            return s.raise_to(s.max_raise_to if committed(target) else target)

        def value_size():
            if p["balance"]:
                if strength > 0.6 and spr < 1.5:
                    return s.raise_to(s.max_raise_to)
                return balanced_size()
            if preflop:
                frac = 0.8
            else:
                frac = 0.5 + 0.5 * strength + (0.25 if fold_rate < 0.35 else 0.0)
            target = s.my_street_bet + s.to_call + frac * (s.pot + s.to_call)
            if strength > 0.6 and (spr < 2.5 or committed(target)):
                target = s.max_raise_to
            return s.raise_to(target)

        def bluff_size():
            if p["balance"]:
                return balanced_size()
            return s.raise_to(s.my_street_bet + s.to_call + 0.6 * (s.pot + s.to_call))

        bluff_p = 0.0
        if n == 2 and not preflop:
            exploit = max(0.0, (fold_rate - 0.4) * 2.0)
            if p["balance"]:
                # baseline bluffs only pay vs players who fold; vs stations they burn chips
                base = p["base_bluff"] * min(1.0, max(0.0, (fold_rate - 0.25) / 0.2))
                weak = eq < 0.35 or (not final and eq < 0.5)
                # vs a heavy folder, betting beats checking even with showdown value
                bluff_p = base + exploit if weak or fold_rate > 0.55 else 0.0
            else:
                bluff_p = exploit
            if not final and eq > 0.3:
                bluff_p += 0.15  # semi-bluff with equity
            bluff_p = min(0.65, bluff_p) * p["bluff_scale"]
        elif n == 3 and not preflop and p["balance"] and eq < 0.25:
            bluff_p = 0.06 * p["bluff_scale"]

        if s.to_call > 0:
            odds = s.to_call / (s.pot + s.to_call)
            margin = p["margin"] - 0.1 * (bluff_rate - 0.3) + (p["mw_margin"] if n > 2 and not final else 0.0)
            if p["defend"] and aggressor and not preflop:
                v = self.model.vs[aggressor]
                margin -= min(0.12, max(0.0, (v.fold_rate - 0.5) * 0.6))
                if guard:
                    margin -= 0.03
            if s.can_raise and rel >= raise_rel:
                act = value_size()
            elif eq >= odds + margin:
                act = CALL
            elif s.can_raise and spr > 3 and self.rng.random() < bluff_p * 0.35:
                act = bluff_size()
            else:
                act = FOLD
        else:
            # slow-playing only pays vs players who bet when checked to
            trap = p["trap"] * min(1.0, max(0.0, (stab_rate - 0.25) / 0.35)) * (0.6 if final else 1.0)
            if guard:
                trap = max(trap, 0.2)
            if s.can_raise and rel >= bet_rel and not preflop and strength > 0.5 \
                    and self.rng.random() < trap:
                act = CHECK   # slow-play: our checking range now contains monsters
            elif s.can_raise and rel >= bet_rel:
                act = value_size()
            elif s.can_raise and self.rng.random() < bluff_p:
                act = bluff_size()
            else:
                act = CHECK

        if self.debug:
            print(f"[{s.me}] st{s.street} eq={eq:.2f} n={n} rel={rel:.2f} "
                  f"call={s.to_call} pot={s.pot} -> {act}")
        return act

    # ---- look-ahead -----------------------------------------------------------------
    def _lookahead(self, s: GameState, opps, ranges, eq, aggressor, guard) -> Action:
        """Score every legal option by expected chips, predicting how each opponent
        responds from what we've learned about them, then pick (with a little mixing).

        EVs are "chips we end up taking from the pot, minus chips we add from now on",
        so check-through = eq * pot and fold = 0. Horizon: this street plus the
        opponent's most likely response on the next one.
        """
        P, C = s.pot, s.to_call
        final = s.street == s.num_streets - 1
        stats = {o: self.model.stats[o] for o in opps}
        views = {pv.id: pv for pv in s.players}
        rng_of = dict(zip(opps, ranges))
        sub = max(120, self.iters * 2 // 3)

        def eq_vs(rs):
            return self.eq.equity(s.hole, s.board, rs, sub, time.time() + self.time_limit)

        def narrowed(o, keep, leak=0.05):
            """Opponent o's current range, cut to the top `keep` fraction by board strength."""
            r = rng_of[o]
            keep = min(1.0, max(0.03, keep))
            return OppRange(min_score=r.min_score, strict=round(1 - (1 - r.strict) * keep, 2),
                            leak=round(leak, 2))

        def clamp(x, lo=0.02, hi=0.95):
            return min(hi, max(lo, x))

        # How likely each opponent is to fold / re-raise depends on what they've already
        # done this hand: someone who just bet or raised only folds their bluffs.
        fold, reraise = {}, {}
        for o in opps:
            st = stats[o]
            mine = [e for e in s.history if e["type"] == "action" and e["street"] == s.street
                    and e["player"] == o and e["action"] == "raise"]
            if mine:
                bluff = 1.0
                for e in mine:
                    bluff *= st.raise_bluff_rate if e["to_call"] > 0 else st.stab_bluff_rate
                fold[o] = clamp(bluff)
                reraise[o] = clamp(0.45 * (1 - bluff), 0.05, 0.6)
            else:
                calls = self.model.hand.get(o).post_calls if o in self.model.hand else 0
                fold[o] = clamp(st.fold_rate * 0.75 ** calls)
                reraise[o] = clamp(st.raise_rate, 0.01, 0.6)
        if guard:   # assume the people beating us fold less and raise more than we think
            fold = {o: clamp(f - 0.1) for o, f in fold.items()}
        options: dict = {}

        # ---- passive option -------------------------------------------------------
        if C == 0:
            acted = {e["player"] for e in s.history
                     if e["type"] == "action" and e["street"] == s.street}
            to_act = [o for o in opps if o not in acted and not views[o].all_in]
            if to_act:
                p_stab = 1.0
                for o in to_act:
                    p_stab *= 1 - stats[o].stab_rate
                p_stab = 1 - p_stab
                x = 0.6 * P
                eq_s = eq_vs([narrowed(o, stats[o].stab_rate, stats[o].stab_bluff_rate)
                              if o in to_act else rng_of[o] for o in opps])
                options[CHECK] = (1 - p_stab) * eq * P + p_stab * max(0.0, eq_s * (P + 2 * x) - x)
            else:
                options[CHECK] = eq * P
        else:
            options[FOLD] = 0.0
            P1 = P + C
            if final or not aggressor or aggressor not in stats:
                options[CALL] = eq * P1 - C
            else:
                # they keep betting next street with roughly their stab frequency
                a = stats[aggressor]
                q = clamp(a.stab_rate, 0.05, 0.9)
                x = 0.66 * P1
                eq2 = eq_vs([narrowed(o, q, a.stab_bluff_rate) if o == aggressor else rng_of[o]
                             for o in opps])
                options[CALL] = -C + (1 - q) * eq * P1 + q * max(0.0, eq2 * (P1 + 2 * x) - x)

        # ---- aggressive options ---------------------------------------------------
        if s.can_raise:
            eq_called = eq_vs([narrowed(o, 1 - fold[o]) for o in opps])
            eq_rr = eq_vs([narrowed(o, reraise[o], 0.03) for o in opps])
            targets = {round(s.my_street_bet + C + f * (P + C)) for f in self.LOOK_SIZES}
            if s.my_stack < 4 * P:
                targets.add(s.max_raise_to)
            for target in sorted(targets):
                target = min(s.max_raise_to, max(s.min_raise_to, target))
                if target > 0.55 * (s.my_street_bet + s.my_stack):
                    target = s.max_raise_to          # don't leave a silly amount behind
                add = target - s.my_street_bet
                size = (target - s.current_bet) / max(1, P + C)
                p_all_fold, p_no_rr, call_chips = 1.0, 1.0, 0.0
                for o in opps:
                    f = clamp(fold[o] + 0.15 * min(0.6, size - 0.66))
                    p_all_fold *= f
                    p_no_rr *= 1 - reraise[o]
                    pv = views[o]
                    call_chips += (1 - f) * min(target - pv.street_bet, pv.stack)
                p_rr = min(1 - p_all_fold, 1 - p_no_rr)
                p_call = max(0.0, 1 - p_all_fold - p_rr)
                cont = max(1e-9, 1 - p_all_fold)
                ev_called = eq_called * (P + add + call_chips / cont) - add
                # re-raised: to ~3x, then we call it off or fold, whichever is better
                rr_to = min(3 * target, s.my_street_bet + s.my_stack)
                extra = rr_to - target
                ev_rr = max(-add, eq_rr * (P + add + rr_to - s.current_bet + extra) - add - extra)
                options[Action("raise", int(target))] = (
                    p_all_fold * P + p_call * ev_called + p_rr * ev_rr)

        # ---- choose: best EV, mixing between near-equal options ----------------------
        best = max(options.values())
        temp = self.p["mix"] * self.p["balance"] * max(P, 1)
        if temp <= 0:
            return max(options, key=options.get)
        acts = list(options)
        weights = [math.exp((options[a] - best) / temp) for a in acts]
        choice = self.rng.choices(acts, weights)[0]
        if self.debug:
            print("   " + "  ".join(f"{a}:{v:.0f}" for a, v in options.items()))
        return choice
