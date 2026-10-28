"""Seat several AdaptiveBot configs at the same tables against a fixed field, across
seeds in parallel, and rank them. Edit CONFIGS / FIELD at the event."""
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor

from run_match import run
from pokerbot.variant import PRESETS

CONFIGS = sys.argv[3].split(",") if len(sys.argv) > 3 else [
    "adaptive", "adaptive:mw_margin=0;margin=0", "adaptive:use_ranges=0"]
FIELD = ["simple", "simple", "station", "maniac", "nit"]


def one(args):
    variant, hands, seed = args
    return run(PRESETS[variant], CONFIGS + FIELD, hands, 6, seed, quiet=True)


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "holdem"
    hands = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
    seeds = range(100, 108)
    agg = defaultdict(list)
    with ProcessPoolExecutor() as ex:
        for rows in ex.map(one, [(variant, hands, s) for s in seeds]):
            for p, m, ci, n in rows:
                agg[p].append(m)
    print(f"{variant}, {len(seeds)} seeds x {hands} hands, 6 of {len(CONFIGS) + len(FIELD)} seated")
    for p, ms in sorted(agg.items(), key=lambda kv: -sum(kv[1])):
        mean = sum(ms) / len(ms)
        sd = (sum((m - mean) ** 2 for m in ms) / (len(ms) - 1)) ** 0.5
        print(f"  {p:<40}{mean:>8.1f} bb/100  (±{1.96 * sd / len(ms) ** 0.5:.0f})")
