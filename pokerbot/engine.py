"""Local N-player no-limit / pot-limit engine for sparring. Stacks reset every hand.

Simplification: a short all-in raise reopens the betting (real rules say it doesn't).
"""
import random
from collections import defaultdict

from .evaluator import Evaluator
from .game import Action, GameState, PlayerView
from .variant import Variant


class Table:
    def __init__(self, variant: Variant, bots: dict, seed=None):
        self.v = variant
        self.bots = bots
        self.rng = random.Random(seed)
        self.ev = Evaluator(variant)
        self.illegal = defaultdict(int)

    def _broadcast(self, event, history):
        history.append(event)
        for b in self.bots.values():
            obs = getattr(b, "observe", None)
            if obs:
                obs(event)

    def play_hand(self, seats: list, hand_id: int = 0, stacks: dict | None = None) -> dict:
        """seats[0] is the button. Returns chip deltas per player. Pass `stacks` to carry
        chip counts between hands; by default everyone starts with variant.starting_stack."""
        v, n = self.v, len(seats)
        deck = v.deck()
        self.rng.shuffle(deck)
        stacks = {p: (stacks or {}).get(p, v.starting_stack) for p in seats}
        hole = {p: tuple(deck.pop() for _ in range(v.hole_cards)) for p in seats}
        board: list = []
        folded, allin = set(), set()
        total_in = {p: 0 for p in seats}
        street_bet = {p: 0 for p in seats}
        history: list = []
        self.last_history = history

        def put(p, x):
            x = min(x, stacks[p])
            stacks[p] -= x
            street_bet[p] += x
            total_in[p] += x
            if stacks[p] == 0:
                allin.add(p)

        self._broadcast({"type": "hand_start", "hand_id": hand_id, "players": list(seats),
                         "button": seats[0], "num_streets": v.num_streets}, history)
        if v.ante:
            for p in seats:
                put(p, v.ante)
            for p in seats:
                street_bet[p] = 0
        sb, bb = (seats[0], seats[1]) if n == 2 else (seats[1], seats[2])
        put(sb, v.small_blind)
        put(bb, v.big_blind)
        for p in seats:
            on_deal = getattr(self.bots[p], "on_deal", None)
            if on_deal:
                on_deal(hole[p])
        self._broadcast({"type": "blinds", "sb": sb, "bb": bb, "stacks": dict(stacks),
                         "bets": dict(street_bet), "pot": sum(total_in.values())}, history)

        for street, ncards in enumerate(v.streets):
            if len(seats) - len(folded) < 2:
                break   # everyone else folded: don't deal (or announce) the next street
            for _ in range(ncards):
                board.append(deck.pop())
            if street > 0:
                for p in seats:
                    street_bet[p] = 0
                self._broadcast({"type": "street", "street": street, "board": tuple(board)}, history)
            start = (0 if n == 2 else 3 % n) if street == 0 else 1
            current = max(street_bet.values())
            last_raise = v.big_blind
            acted: set = set()
            i = start
            while True:
                live = [p for p in seats if p not in folded]
                active = [p for p in live if p not in allin]
                if len(live) < 2 or not active:
                    break
                if all(p in acted and street_bet[p] == current for p in active):
                    break
                if len(active) == 1 and street_bet[active[0]] >= current:
                    break
                p = seats[i % n]
                i += 1
                if p in folded or p in allin or (p in acted and street_bet[p] == current):
                    continue

                to_call = min(current - street_bet[p], stacks[p])
                max_to = street_bet[p] + stacks[p]
                if v.pot_limit:
                    max_to = min(max_to, current + sum(total_in.values()) + (current - street_bet[p]))
                min_to = min(current + last_raise, max_to)
                state = GameState(
                    variant=v, hand_id=hand_id, me=p, hole=hole[p], board=tuple(board), street=street,
                    pot=sum(total_in.values()), to_call=to_call, current_bet=current,
                    min_raise_to=min_to, max_raise_to=max_to, my_stack=stacks[p],
                    my_street_bet=street_bet[p],
                    players=[PlayerView(q, stacks[q], street_bet[q], total_in[q], q in folded, q in allin)
                             for q in seats],
                    history=history)
                try:
                    a = self.bots[p].act(state)
                except Exception:
                    self.illegal[p] += 1
                    a = Action("fold")
                kind = a.kind if isinstance(a, Action) else "fold"
                can_raise = max_to > current and stacks[p] > to_call
                if kind == "fold" and to_call == 0:
                    kind = "check"
                elif kind == "check" and to_call > 0:
                    self.illegal[p] += 1
                    kind = "fold"
                elif kind == "call" and to_call == 0:
                    kind = "check"
                elif kind == "raise" and not can_raise:
                    kind = "call" if to_call else "check"
                elif kind not in ("fold", "check", "call", "raise"):
                    self.illegal[p] += 1
                    kind = "fold" if to_call else "check"

                pot_before = sum(total_in.values())
                amount = 0
                if kind == "fold":
                    folded.add(p)
                elif kind == "call":
                    amount = to_call
                    put(p, to_call)
                elif kind == "raise":
                    amount = int(min(max_to, max(min_to, a.amount)))
                    if amount - current >= last_raise:
                        last_raise = amount - current
                    current = amount
                    put(p, amount - street_bet[p])
                    acted = set()
                acted.add(p)
                self._broadcast({"type": "action", "player": p, "street": street, "action": kind,
                                 "amount": amount, "to_call": to_call, "pot": pot_before,
                                 "all_in": p in allin, "stacks": dict(stacks),
                                 "bets": dict(street_bet), "pot_after": sum(total_in.values())}, history)

        # ---- payout ----
        live = [p for p in seats if p not in folded]
        payout = defaultdict(int)
        if len(live) == 1:
            payout[live[0]] = sum(total_in.values())
            winners = set(live)
        else:
            while len(board) < v.board_size:
                board.append(deck.pop())
            ranks = {p: self.ev.rank(hole[p], board) for p in live}
            winners = set()
            prev = 0
            for level in sorted({total_in[p] for p in seats if total_in[p] > 0}):
                slice_ = sum(min(total_in[p], level) - min(total_in[p], prev) for p in seats)
                elig = [p for p in live if total_in[p] >= level] or \
                       [max(live, key=lambda q: total_in[q])]
                best = max(ranks[p] for p in elig)
                ws = [p for p in elig if ranks[p] == best]
                share, rem = divmod(slice_, len(ws))
                for j, w in enumerate(ws):
                    payout[w] += share + (1 if j < rem else 0)
                winners.update(ws)
                prev = level
            self._broadcast({"type": "showdown", "board": tuple(board),
                             "hands": {p: hole[p] for p in live}, "winners": sorted(winners)}, history)
        deltas = {p: payout[p] - total_in[p] for p in seats}
        assert sum(deltas.values()) == 0, deltas
        self._broadcast({"type": "hand_end", "deltas": deltas}, history)
        return deltas
