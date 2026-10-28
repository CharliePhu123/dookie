# ASCII Poker (web)

The browser game: Next.js, a canvas glyph renderer, and the poker engine and bots from
`../pokerbot/` ported to TypeScript. See `../PLAN.md` for the design and the phase plan.

```bash
npm install
npm run dev          # http://localhost:3000 (the table), /lab (bots playing through the Web Worker)
npm test             # vitest: evaluator, equity, engine parity and invariants, bots, render
npm run lint
npm run build
npm run sim -- --hands 4000 --players adaptive,simple --table-size 2   # headless matches, like run_match.py
```

`npm run sim` takes `--variant` (holdem, shortdeck, omaha, plo, 3card, royal, bigboard,
deepstack), `--players` (comma list of `adaptive`, `simple`, `station`, `maniac`, `nit`,
`random`, `exploiter`, with knobs like `"adaptive:bet_rel=1.0;mix=0"`), `--table-size`,
`--seed`, and `--python-rules` (let short all-ins reopen betting, as `pokerbot/engine.py` does).

## Layout

```
src/engine/   cards, variant, evaluator, rng, equity, game (bot contract), events, table (state machine)
src/bots/     opponent model, AdaptiveBot (the Seer), sparring bots, makeBot(), runMatch()
src/worker/   botWorker + BotClient: bots run off the main thread; BotHost is the shared core
src/render/   glyph grid, palette, cave, lighting, layout, scene
src/game/     creatures
src/app/      / (table), /lab (bot lab)
tests/        vitest; fixtures/*.json come from ../scripts/make_fixtures.py
scripts/      sim.ts
```

## Parity with Python

`python3 ../scripts/make_fixtures.py` regenerates the fixtures. The TS engine replays Python's
hands event for event under `PYTHON_RULES`; the game itself uses `STANDARD_RULES` (real
short-all-in and odd-chip rules).
