"""python3 run_match.py --variant holdem --hands 2000 --players adaptive,simple,station,maniac,nit,random"""
import argparse
import math
import random
import sys
import time
from collections import defaultdict

from pokerbot.bot import AdaptiveBot
from pokerbot.engine import Table
from pokerbot.sparring import CallingStation, Exploiter, Maniac, Nit, RandomBot, SimpleEquityBot
from pokerbot.variant import PRESETS, Variant

FACTORIES = {
    "adaptive": AdaptiveBot,
    "simple": SimpleEquityBot,
    "station": CallingStation,
    "maniac": Maniac,
    "nit": Nit,
    "random": RandomBot,
    "exploiter": Exploiter,
}


def run(variant: Variant, players: list, hands: int, table_size: int, seed: int, quiet=False):
    rng = random.Random(seed)
    bots, ids = {}, []
    for i, name in enumerate(players):
        pid = f"{name}#{i}" if players.count(name) > 1 else name
        base, _, kv = name.partition(":")
        if kv:  # "adaptive:mw_margin=0;bet_rel=1.05"
            params = {k: float(x) for k, x in (pair.split("=") for pair in kv.split(";"))}
            bots[pid] = FACTORIES[base](variant, seed=seed + i, params=params)
        else:
            bots[pid] = FACTORIES[base](variant, seed=seed + i)
        ids.append(pid)
    table = Table(variant, bots, seed)
    results = defaultdict(list)
    t0 = time.time()
    for h in range(hands):
        seated = rng.sample(ids, min(table_size, len(ids)))  # random seats every hand
        for p, d in table.play_hand(seated, h).items():
            results[p].append(d)
        if not quiet and (h + 1) % max(1, hands // 10) == 0:
            print(f"  ...{h + 1} hands ({time.time() - t0:.0f}s)", file=sys.stderr)
    bb = variant.big_blind
    rows = []
    for p, ds in results.items():
        m = sum(ds) / len(ds)
        sd = math.sqrt(sum((d - m) ** 2 for d in ds) / max(1, len(ds) - 1))
        rows.append((p, 100 * m / bb, 196 * sd / bb / math.sqrt(len(ds)), len(ds)))
    rows.sort(key=lambda r: -r[1])
    if not quiet:
        print(f"\n{variant.name}: {hands} hands, {min(table_size, len(ids))}-handed, "
              f"{time.time() - t0:.0f}s")
        print(f"{'bot':<14}{'bb/100':>9}{'±95%':>9}{'hands':>8}")
        for p, m, ci, n in rows:
            print(f"{p:<14}{m:>9.1f}{ci:>9.1f}{n:>8}")
        for p, c in table.illegal.items():
            print(f"  ! {p}: {c} illegal/crashed actions")
        ad = next((b for b in bots.values() if isinstance(b, AdaptiveBot)), None)
        if ad:
            print("\nwhat adaptive learned:")
            for p in ids:
                if p in ad.model.stats and not isinstance(bots[p], AdaptiveBot):
                    print(f"  {p:<12} {ad.model.stats[p].summary()}")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="holdem", choices=sorted(PRESETS))
    ap.add_argument("--hands", type=int, default=2000)
    ap.add_argument("--players", default="adaptive,simple,station,maniac,nit,random",
                    help='comma list; tune with e.g. "adaptive:bet_rel=1.05;margin=0"')
    ap.add_argument("--table-size", type=int, default=6)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    run(PRESETS[a.variant], a.players.split(","), a.hands, a.table_size, a.seed)
