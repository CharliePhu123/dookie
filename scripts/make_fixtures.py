"""Generate evaluator parity fixtures for the TypeScript port.

    python3 scripts/make_fixtures.py   # writes web/tests/fixtures/evaluator.json
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
