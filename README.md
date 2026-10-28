# Pokerbot kit for the 60-minute No Limit tournament

You won't know the variant until the starting gun. So everything that depends on the
variant is one config object, and everything else (hand evaluation, equity, opponent
modelling, strategy, a local engine, sparring partners, a tuner) is built and tested
already. Pure Python 3.10+, no dependencies.

```
pokerbot/
  variant.py     Variant config + presets (holdem, shortdeck, omaha, plo, 3card, royal, bigboard)
  evaluator.py   any-number-of-cards evaluator, rank subsets, Omaha "use exactly 2", short-deck swaps
  equity.py      Monte Carlo equity vs opponent RANGES (preflop floor + "they bet, so they hit")
  opponents.py   VPIP / PFR / fold-to-bet / aggression / showdown-bluff stats with Bayesian priors
  bot.py         AdaptiveBot: the bot you'll submit
  engine.py      local N-player NL/PL engine with side pots
  sparring.py    random, calling station, maniac, nit, SimpleEquityBot (a typical 60-min bot),
                 Exploiter (a bot written by someone who has read ours)
play.py          play against the bots yourself in an ASCII table
run_match.py     play a field and print bb/100 with 95% CIs
tune.py          seat several AdaptiveBot configs together across seeds, in parallel, and rank them
adapter_template.py   where you plug in the organisers' API
tests/           evaluator tests
```

## How the bot plays

1. **Equity against what opponents actually hold.** Each live opponent becomes a range:
   preflop, top X% of hands where X is their VPIP (called) or PFR (raised), or 40% of
   PFR if they re-raised. Postflop, bettors and callers are cut to their top hands by
   strength on this board, plus a bluff share estimated from their stats.
2. **Look-ahead after the flop.** Every option (fold, check, call, bet or raise at ⅓, ⅔,
   1× pot, or all-in) is scored in expected chips. The score predicts each opponent's
   response from their stats: who folds, what they hold when they call, whether they
   re-raise, and whether they bet again next street. The bot picks the best option and mixes
   randomly between near-equal ones (`mix`), so it's hard to read.
3. **Preflop** uses relative-equity thresholds (equity × players in the pot), so one set
   of numbers works heads-up, 8-handed and in any variant.
4. **Never crashes and never times out.** Errors fall back to check/fold, and equity stops at a
   time deadline.
5. **Gets better as rounds get more important.** Stats accumulate every hand, and
   `stats_path` keeps them across restarts between rounds.

## Results from the local engine (200bb stacks, before look-ahead)

| variant | format | AdaptiveBot | best SimpleEquityBot |
|---|---|---|---|
| holdem | heads-up vs simple, 4,000 hands | **+309 ±93 bb/100** | −309 |
| holdem | 6-max vs 3× simple, station, maniac | **+918 ±240** | +805 ±204 |
| 3card | 6-max vs 2× simple, nit, station, maniac | **+1055 ±272** | +793 ±225 |
| shortdeck | 6-max vs 2× simple, nit, station, maniac | +969 ±267 | +1064 ±254 |
| omaha (NL) | 6-max vs 2× simple, nit, station, maniac, 1,500 hands | **+1100 ±369** | +852 ±266 |
| plo | heads-up vs simple, 3,000 hands | +2 ±119 | −2 |

**Known weak spot: pot-limit Omaha heads-up has no edge.** Equities run close together in
Omaha, and pot-limit caps the value bets the bot relies on. If the variant is a PLO-style
game, spend your tuning time there first. Omaha also evaluates about 60× slower (60 hole/board
combos per hand), so the `time_limit` deadline does real work there.

SimpleEquityBot plays equity vs random hands plus pot odds, roughly what a strong team
ships in 60 minutes. Heads-up, the edge is large and clear. 6-max error bars are wide,
because the station and the maniac pay everyone and swamp the signal. Read the 6-max
rows as "at least as good as the simple bot", not as a precise edge.

## If opponents adapt to us

Assume the worst: a team reads this code and writes a bot to beat it. `Exploiter` in
`sparring.py` is that bot. It bets whenever we check, folds to our bets unless it's strong,
and treats bigger bets as stronger. It beats SimpleEquityBot by 163 bb/100.

Heads-up, 6,000 hands per matchup:

| | vs Exploiter | vs SimpleEquityBot |
|---|---|---|
| bot before the hardening work | about −53 | about +303 |
| after modelling fixes, threshold rules | −22 ±32 | +327 ±69 |
| **current bot (look-ahead)** | **+108 ±28** | **+249 ±63** |
| current bot, `lookahead=0` | +21 ±21 | +300 ±65 |

8-handed (like the event), with both versions at the same table against 2× simple, Exploiter,
nit, maniac and station: both finish at or near the top in two 2,500-hand runs (+654/+620
with look-ahead, +536/+687 without). That's too close to separate 8-handed.

What closed most of the gap was modelling, not "playing more balanced":

- **Bluffs inferred from frequency, not just showdowns.** Bluffs we fold to never reach
  showdown, so someone betting 85% of the time when checked to gets a high bluff estimate anyway.
- **Bets into checks and raises over our bets are tracked separately.** Plenty of bots bluff
  into checks but only raise with monsters. Lumping the two together made us pay off raises.
- **Ranges narrowed by actual hand strength on the board.** Callers and bettors are cut
  to their top X% by current hand strength, with X taken from their fold and bluff rates.
- **Stats decay** (memory of about 200 hands), so a bot that switches strategy is re-learned fast.
- **Guard mode** (`safety_bb`): against anyone who has taken 60bb+ off us over 40+ pots,
  we slow-play more and call wider.
- Bet sizes depend on who we're betting into, never on our own hand.
- Slow-plays scale with how often they bet into checks; baseline bluffs scale with how often they fold.

The balance features measured about neutral against these opponents, so they cost nothing
and remove the "size and checks tell you our hand" leak against bots smarter than these.

Building look-ahead exposed a real bug: the range sampler let in far too many random
hands, about 31% of a "top 15%" range, which inflated our equity against strong ranges. Fixing it
mattered as much as the look-ahead itself.

**Still open:** look-ahead covers this street plus the opponent's next likely bet, not
the whole hand. Look-ahead is slightly behind thresholds against SimpleEquityBot
heads-up (inside the error bars). Preflop is still threshold-based.

## The 60 minutes

| min | do |
|---|---|
| 0–10 | Read the rules. Write the `Variant`. If it's a hold'em-family game, you're done with the hard part. Run `python3 tests/test_evaluator.py` and add a test for any new hand-ranking rule. |
| 10–25 | Fill in `adapter_template.py` against their API. Get a legal bot submitted **first**, even if it just checks and calls. |
| 25–40 | Submit AdaptiveBot. Sanity-run `python3 run_match.py --variant <yours> --hands 500`. |
| 40–60 | Tune: `python3 tune.py <variant> 800 "adaptive,adaptive:bet_rel=1.0,adaptive:margin=-0.03"`. Change `FIELD` in `tune.py` to look like what you're seeing. |

Between rounds: open `opponent_stats.json` (or the `what adaptive learned` printout). If the
field is mostly stations, lower `bet_rel` and set `bluff_scale=0`. If it's mostly nits,
raise `bluff_scale`.

### If the variant breaks the assumptions

| twist | where to change |
|---|---|
| different deck / ranks / hole cards / streets | `Variant` only |
| new hand ranking (e.g. flush > full house) | `Evaluator.__init__` category order, or a flag in `Variant` |
| must use exactly N hole cards | `Variant.must_use_hole` |
| pot limit | `Variant.pot_limit` |
| discard / draw / swap a card | equity: sample the replacement card inside `EquityEngine.equity`; decision: discard the card whose removal maximises `ev.rank` equity |
| bounties / bonus hands | add the expected bonus to the pot in `AdaptiveBot._act` before the odds check |
| hi-lo split | second evaluator for low; equity = 0.5·P(win high) + 0.5·P(win low) |
| tighter time limit | lower `iters` / `time_limit`; preflop equities are cached |

## Commands

```bash
python3 play.py                                   # you vs AdaptiveBot, heads-up
python3 play.py --opponents adaptive,simple,maniac,nit,station
python3 run_match.py --hands 2000
python3 run_match.py --variant shortdeck --players adaptive,simple --table-size 2 --hands 3000
python3 tune.py holdem 1200
python3 tests/test_evaluator.py
```
