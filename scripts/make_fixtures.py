"""Generate parity fixtures for the TypeScript port.

    python3 scripts/make_fixtures.py   # writes web/tests/fixtures/{evaluator,engine,equity}.json
"""
import json
import pathlib
import random
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pokerbot.evaluator import Evaluator  # noqa: E402
from pokerbot.variant import PRESETS  # noqa: E402

rng = random.Random(2026)
out = {}
for name, n_hole, n_board, count in [("holdem", 2, 5, 3000), ("holdem", 2, 3, 500),
                                    ("shortdeck", 2, 5, 1500), ("omaha", 4, 5, 1000),
                                    ("3card", 3, 5, 500), ("royal", 2, 5, 300)]:
    v = PRESETS[name]
    ev = Evaluator(v)
    deck = v.deck()
    rows = out.setdefault(name, [])
    for _ in range(count):
        cs = rng.sample(deck, n_hole + n_board)
        hole, board = cs[:n_hole], cs[n_hole:]
        rows.append([hole, board, ev.rank(hole, board)])
path = ROOT / "web" / "tests" / "fixtures" / "evaluator.json"
path.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {sum(len(r) for r in out.values())} hands to {path}")


# ---- engine parity: scripted random players on fixed decks -------------------------------
from pokerbot.engine import Table  # noqa: E402
from pokerbot.game import Action  # noqa: E402

CAMEL = {"hand_id": "handId", "num_streets": "numStreets", "to_call": "toCall",
         "all_in": "allIn", "pot_after": "potAfter"}


def camel(e):
    return {CAMEL.get(k, k): (list(v) if isinstance(v, tuple) else
                              {p: list(h) for p, h in v.items()} if k == "hands" else v)
            for k, v in e.items()}


class FixedDeck:
    def __init__(self, order):
        self.order = order

    def shuffle(self, deck):
        deck[:] = self.order


class Scripted:
    """Random but sometimes-silly player; logs what it asked for so TS can replay it."""

    def __init__(self, rng, log):
        self.rng, self.log = rng, log

    def act(self, s):
        r = self.rng.random()
        if r < 0.15:
            a = Action("fold")
        elif r < 0.45:
            a = Action("call")
        elif r < 0.55:
            a = Action("check")          # illegal when facing a bet: engine folds it
        else:
            pick = self.rng.random()
            if pick < 0.3:
                amt = s.min_raise_to
            elif pick < 0.55:
                amt = s.my_street_bet + s.to_call + (s.pot + s.to_call)
            elif pick < 0.75:
                amt = s.max_raise_to
            elif pick < 0.9:
                amt = self.rng.randint(0, max(1, s.max_raise_to + 50))   # often out of range
            else:
                amt = s.current_bet + 1                                   # usually below min
            a = Action("raise", amt)
        self.log.append([s.me, a.kind, a.amount])
        return a


erng = random.Random(7)
hands = []
for hand_id in range(800):
    name = erng.choice(["holdem", "holdem", "holdem", "shortdeck", "omaha", "plo", "3card", "royal",
                        "bigboard"])
    v = PRESETS[name]
    n = erng.randint(2, 8)
    while n * v.hole_cards + v.board_size > len(v.deck()):
        n -= 1
    seats = [f"p{i}" for i in range(n)]
    erng.shuffle(seats)
    stacks = {p: erng.choice([v.starting_stack, erng.randint(1, 60), erng.randint(1, 400), 1, 3])
              for p in seats}
    order = v.deck()
    erng.shuffle(order)
    log = []
    bot_rng = random.Random(erng.random())
    t = Table(v, {p: Scripted(bot_rng, log) for p in seats})
    t.rng = FixedDeck(list(order))
    deltas = t.play_hand(list(seats), hand_id=hand_id, stacks=dict(stacks))
    hands.append({"variant": name, "seats": seats, "stacks": stacks, "deck": order, "handId": hand_id,
                  "actions": log, "events": [camel(e) for e in t.last_history], "deltas": deltas})
path = ROOT / "web" / "tests" / "fixtures" / "engine.json"
path.write_text(json.dumps(hands, separators=(",", ":")))
print(f"wrote {len(hands)} hands to {path}")


# ---- equity: hand scores exactly, equities within Monte Carlo noise ----------------------
from pokerbot.equity import EquityEngine, OppRange  # noqa: E402

qrng = random.Random(11)
equity = {"scores": {}, "cases": []}
for name in ["holdem", "shortdeck", "omaha", "3card", "royal"]:
    v = PRESETS[name]
    ee = EquityEngine(v, rng=random.Random(1))
    holes = [qrng.sample(v.deck(), v.hole_cards) for _ in range(300)]
    equity["scores"][name] = [[h, ee.hand_score(h)] for h in holes]
    for _ in range(4 if name == "omaha" else 8):
        nb = qrng.choice([0, 3, 4, 5])
        cs = qrng.sample(v.deck(), v.hole_cards + nb)
        hole, board = cs[:v.hole_cards], cs[v.hole_cards:]
        opps = []
        for _ in range(qrng.randint(1, 3)):
            top = qrng.choice([None, 0.5, 0.25, 0.12])
            strict = qrng.choice([0.0, 0.0, 0.3, 0.6])
            leak = qrng.choice([0.08, 0.0, 0.2])
            opps.append({"top": top, "strict": strict, "leak": leak})
        ranges = [OppRange(min_score=ee.threshold(o["top"]) if o["top"] else float("-inf"),
                           strict=o["strict"], leak=o["leak"]) for o in opps]
        iters = 1500 if name == "omaha" else 5000
        # postflop "strict" cutoffs are re-sampled from 150 hands on every call, which moves a
        # single estimate a lot (sd ~0.03); averaging 20 calls compares expectations instead
        runs = 20 if len(board) >= 3 else 1
        eq = sum(ee.equity(hole, board, ranges, iters // runs) for _ in range(runs)) / runs
        equity["cases"].append({"variant": name, "hole": hole, "board": board, "opps": opps,
                                "iters": iters, "runs": runs, "equity": eq})
path = ROOT / "web" / "tests" / "fixtures" / "equity.json"
path.write_text(json.dumps(equity, separators=(",", ":")))
print(f"wrote {len(equity['cases'])} equity cases to {path}")
