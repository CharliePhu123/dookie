# ASCII Poker: plan

A browser poker roguelite on Vercel, drawn entirely in glyphs in the style of Caves of Qud:
a dark teal-black field, a saturated 18-colour palette, a message log in the game's voice,
and creatures in place of players. You play hold'em (and stranger variants) against the bots
from `pokerbot/`, which are ported to TypeScript and run in your browser.

The style is inspired by Caves of Qud. Its name, creature names, place names and art belong
to Freehold Games, so none of them ship in this game (see [Naming](#naming-and-ip)).

## Where we are

| # | Phase | Status |
|---|---|---|
| 0 | Scaffold Next.js app, palette, canvas glyph grid, static table mock | **done**: `npm run dev` shows the mock table |
| 1 | Port cards, variant, evaluator | **done**: vitest passes, including exact parity with Python on 5,000 hands per variant |
| 2 | Engine: seeded RNG, equity, step-driven table state machine | **done**: 800 Python hands replay event for event; 20,000 random hands plus a fast-check property conserve chips; equity matches Python |
| 3 | Bots in TypeScript, in a Worker | **done**: heads-up +313 ±60 bb/100 vs SimpleEquityBot and +130 ±26 vs Exploiter over 6,000 hands (Python: +249 ±63, +108 ±28); the Worker runs in Chromium |
| 4 | Playable MVP | **done**: you play hold'em against five creatures by typing play.py-style commands, in the ASCII-shader cave; saves after every hand |
| 5 | Ship it (PR to `main`, production deploy) | **done**: PR #2 merged; production deploys from `main` |
| 6 | Juice | **done**: animations, sound, tells, moods, typed settings, crisp rendering |
| 7+ | everything below | not started |

What the phase 0 mock shows (screenshot taken from `npm run build && npm start`), and what
needs fixing as we go:

- Box borders (`║`) have gaps between rows, because the 1.45 line height is taller than the
  font's glyph. Draw box-drawing characters as vector lines, the same way the canvas already
  draws `░▒▓█` as filled rectangles.
- The table's `▓▒░` rim reads as stair-stepped blocks rather than carved stone. Add a
  per-cell colour jitter and a one-cell inner highlight.
- Seat titles overlap the table rim ("the Bayesian Seer" runs into the stone at left).
  Seat layout needs per-seat-count anchor tables, not a pure ellipse.
- In the side panel, "folds to bet" runs into its stat bar. Shorten labels or widen the column.

## The game, in one paragraph

You are `@`, a wanderer with a stake. In **Quick Play** you sit at a table with the creatures
you choose. In **The Pilgrimage** (the headline mode) you travel a glyph map from a salt-flat
caravanserai down into the deep places. Each region deals a different variant, each table is
a lineup of creatures with their own play styles, tells and moods, and between tables you
trade winnings for relics that bend the rules in your favour. Go broke and the run ends with
a tombstone and a chronicle of your most legendary hands. The Seer, a Bayesian creature with
many eyes, remembers how you play between visits.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where does the bot run? | **Ported to TypeScript, in the browser, inside a Web Worker** | No server round trips, so animations never wait on the network. Free static hosting. The Monte Carlo loop is faster in JS than in Python. The Worker keeps the frame rate smooth while bots think. |
| Framework | **Next.js (App Router) + TypeScript** | Vercel-native, and room for server features later (daily leaderboard, shared replays) without a rewrite. Everything through phase 7 is fully static; phase 8 adds share-card functions. |
| Rendering | **One `<canvas>` glyph grid** (cells with glyph + fg + bg) plus a sprite layer for moving glyphs | Pixel-exact ASCII, cheap per-cell colour, and animation is just moving sprites between cells. |
| Menus and screens | **Drawn in glyphs too**, with a thin DOM layer underneath for buttons, focus and screen readers | Qud's menus are part of its look. The DOM layer keeps mobile and accessibility honest. |
| Engine shape | **Pure, step-driven state machine**: `legalActions(state)`, `apply(state, action) → {state, events}` | The UI has to pause for the human and for animations. The Python engine's `bot.act()` loop can't do that. Pure functions make replays, undo-for-tests and property tests cheap. |
| Randomness | **One seeded PRNG** (xoshiro128\*\*) split into named streams: `deck`, `bots`, `flavor`, `world` | Daily runs, reproducible bugs, and shareable replays that need no server. |
| Replays | **Seed + action list**, not re-running bots | Bot Monte Carlo is nondeterministic across machines and versions; recorded actions are exact. |
| Short all-in raises | **Real rule** in the TS engine (a short all-in does not reopen betting), behind a `shortAllInReopens` flag that parity tests set to `true` to match Python | Humans notice wrong rules; parity tests still line up. |
| Font | IBM Plex Mono (OFL) via `next/font` by default; optional CP437 bitmap font in settings | Legible at small sizes, free licence. Not Qud's own font. |
| Audio | **Synthesised with WebAudio**, no audio files | Fits the lo-fi look, zero asset licensing, tiny bundle. |
| Persistence | `localStorage`, versioned with migrations | Chips, settings, relics, run state, the Seer's model of you, hand history. |
| Python | Stays the reference implementation and the place to tune | TS parity fixtures are generated from Python, so the two can't drift silently. |

## Modes

| Mode | What it is | Phase |
|---|---|---|
| **Quick Play** | One cash table. Choose variant, table size (2–8), blinds, stack and opponents. Rebuys allowed. | 4 |
| **Duel with the Seer** | Heads-up against AdaptiveBot. Its model of you persists between visits and its read is shown live. | 4 |
| **Sit & Go** | Single-table tournament with rising blinds; last creature standing. | 7 |
| **The Pilgrimage** | Roguelite run across a glyph map: regions, creatures, relics, bosses, permadeath. | 7 |
| **Daily Pilgrimage** | Same seed for everyone that day; one attempt; share a glyph result string. | 8 |
| **Replay Theatre** | Step through any saved hand with all cards face up; share a replay as a URL. | 8 |
| **Lessons from the Seer** | After a hand, see what AdaptiveBot would have done at each of your decisions and why. | 8 |

## Look and feel

- **Palette** (Qud-like, in `render/palette.ts`): black `#0f3b3a`, dark grey `#155352`, grey
  `#b1c9c3`, white `#ffffff`, dark red `#a64a2e`, red `#d74200`, dark orange `#f15f22`, orange
  `#e99f10`, brown `#98875f`, gold `#cfc041`, dark green `#009403`, green `#00c420`, dark cyan
  `#40a4b9`, cyan `#77bfcf`, dark blue `#0048bd`, blue `#0096ff`, dark magenta `#b154cf`,
  magenta `#da5bd6`. Background `#041312`. Log markup `{{R|text}}` uses these single-letter codes.
- **The table** is a carved stone oval (`▓▒░` shading) on a dark field, with dim green `░` felt.
  Each region reskins it: salt-crust white stone, sunken rust, fungal purple felt, crystal.
- **Cards** are 4×3 glyph boxes. The back is `▒` in dark cyan; hearts and diamonds red, clubs and
  spades white. Optional four-colour deck (clubs green, diamonds blue).
- **Message log** in the game's voice: *"The gnashback shoves 9,550 chips across the felt,
  frothing."*, *"You fold. The Seer notes it."* Hand names type out letter by letter.
- **Side panel:** the Seer's read on you (VPIP, PFR, fold to bet, stabs, bluffs) as stat bars,
  the creature list with stacks and moods, and your session or run result.
- **Optional CRT mode:** scanlines, slight bloom on bright glyphs (`shadowBlur`), vignette.

### Creatures

Every bot is a creature: a glyph, a colour, a name, a title, a bot config, a tell and a
voice. The existing seven, renamed where the name was Qud's own (the renames in
`game/creatures.ts` land in phase 4):

| Glyph | Creature | Bot | Plays like |
|---|---|---|---|
| `@` white | you, *the wanderer* | human | |
| `Ω` magenta | **the Seer**, *the Bayesian Seer* | `AdaptiveBot` (look-ahead) | Models you, adapts, mixes sizes. The recurring rival. |
| `Σ` cyan | **the Reckoner** | `SimpleEquityBot` | Equity and pot odds, no model. Honest. |
| `g` red | **a frothing gnashback** (was "snapjaw") | `Maniac` | Raises 45% of the time. Pays everyone. |
| `t` brown | **the hoarding tortoise** | `Nit` | Top 12% preflop. When it bets, believe it. |
| `I` grey | **a chrome idol** | `CallingStation` | Always calls. Never bluff it. |
| `m` orange | **the mimic** | `Exploiter` | Bets when you check, folds to your bets. Punish it with check-raises. |
| `?` green | **a glitching sprite** | `RandomBot` | Pure noise. |

New creatures are mostly `AdaptiveBot` with different `params`, which gives distinct personalities
for free, plus a few rule-bending bosses:

| Glyph | Creature | Config | Personality |
|---|---|---|---|
| `&` dark red | a rust-wraith | adaptive, `bet_rel 1.15`, `bluff_scale 0.5` | Tight and aggressive. |
| `δ` brown | a dune-strider | adaptive, `bet_rel 1.3`, `defend 1`, `trap 0` | Loose and passive; calls too much. |
| `ƒ` dark magenta | a fungal hermit | adaptive, `trap 0.8` | Slow-plays everything strong. |
| `ж` gold | the many-handed croupier | none | Deals. Flavour only; it is the deal animation's origin. |
| `☼` orange | **boss:** the Sun-Eater | adaptive, `bluff_scale 1.8`, `mix 0.08` | Relentless pressure. Table rule: straddle every hand. |
| `Ψ` cyan | **boss:** the Chorus | three adaptive configs, one chosen per hand | Three heads, three styles; the tell shows which head is speaking. |
| `◊` white | **boss:** the Crystal Arbiter | adaptive, tuned for the variant | Final boss. Table rule: big board (5 streets). |

**Moods** are real parameter changes, shown as a status glyph above the creature:

- **Tilted** `!` red: after losing a big pot. For N hands, `bet_rel` −0.1 and `bluff_scale` ×1.5.
- **On a heater** `*` orange flicker: after three wins. More aggressive, fewer folds.
- **Wary** `?` cyan: after you show a bluff. Calls wider against you for a while.
- **Short-stacked** `↓`: shoves wider (push/fold below 12bb).

**Tells**: each creature has an idle animation that correlates with its hand strength, with a
per-creature reliability (the gnashback drools `~` with strong hands 70% of the time; the
tortoise retreats into its shell `(t)`; the idol never tells). The tell is computed in the
Worker from the bot's own equity, so it is honest, learnable and never cheats for or against you.

### Animations

- Cards fly from the croupier to each seat along an arc, trailing dim glyphs. Board cards flip
  (`▒ → ▌ → K♠`).
- Chip glyphs (`•` `○` `◘`) slide from bets into the pot when a street ends; the pot bursts back
  toward the winner, split pots split visibly.
- All-in: brief screen shake plus a red glyph pulse on the seat. All-in and called: the remaining
  board deals slowly, one card at a time, with equities shown.
- Winner: the seat glyph flickers gold and the hand name types out in the log.
- Rare hands get a fanfare: quads crackle with blue sparks, a straight flush calls down a
  lightning bolt of `╲╱` across the screen, a royal flush turns the felt gold for a moment.
- Bot "thinking": the creature glyph slowly cycles brightness (`Ω` dim → bright).
- Idle: stone shading flickers, embers (`·`) drift off the table edge, the croupier's hands shuffle.
- Bust: the creature's glyph crumbles into `.` `,` `'` that scatter and fade.
- Everything respects `prefers-reduced-motion` and has a speed setting (1×, 2×, 4×, instant).

### Sound (WebAudio, synthesised)

Card flick (short filtered noise burst), chip clatter (a few randomised clicks), all-in thunder
(low sine plus noise swell), win chime (pentatonic arpeggio, longer for bigger pots), a per-creature
"voice" bleep when it acts (pitch and timbre from the creature), and a low ambient cave drone (two
detuned oscillators with a slow LFO) that changes per region. Master, effects and ambience volumes;
muted until the first user gesture, as browsers require.

### Controls

Keyboard first, Qud style: `f` fold, `c` call/check, `r` opens the bet slider (`←`/`→` in big
blinds, `h` half pot, `p` pot, `a` all-in, Enter confirms, Esc cancels), `?` shows odds, `l` look
mode (move a cursor over any glyph to read about it), `L` opens the full log, `Space` next hand,
`Esc` menu. Pre-action checkboxes (check/fold, call any) when it isn't your turn. Every key also
has a clickable button, and on mobile the buttons are the main controls.

### Odds and coaching

- `?` overlay: your equity against random hands, pot odds, and the call/fold break-even, with the
  numbers explained in a line of text. A relic upgrades this to equity against the ranges the
  Seer would assign.
- **Lessons from the Seer**: after a hand, step through your decisions and see what AdaptiveBot
  scored each option at (it already computes an EV per option in look-ahead). Shown as a glyph bar
  per option.

## The Pilgrimage (roguelite run)

- **Map**: a glyph overworld of about 12 nodes across 3–4 regions, generated from the run seed.
  Paths branch, so you choose your route.
- **Regions deal different variants**, which the engine already supports:

  | Region (working names) | Variant | Tone |
  |---|---|---|
  | The Salt-Flat Caravanserai | hold'em | Warm-up tables, mostly simple and station creatures |
  | The Sunken Halls | short deck | Rust, dripping water, tight creatures |
  | The Fungal Deep | Omaha (NL) | Purple felt, spores drift instead of embers |
  | The Crystal Spire | big board | Final region and the Arbiter |

- **Node types**: table (leave after you double up or after N hands), sit & go, merchant (buy
  relics), shrine (a gamble: stake chips or a relic on a coin of fate), rest (recover a buy-in),
  boss.
- **Relics** affect only your information or your money, never the bots' cards, so the bots stay
  honest:

  | Relic | Effect |
  |---|---|
  | Third Eye | Once per table, see the next board card before you act. |
  | Seer's Lens | The `?` overlay uses range-aware equity. |
  | Mirror Mask | The Seer's model of you is blinded for this table (bots fall back to priors). |
  | Night-Sight | See mucked cards at the end of each hand. |
  | Chitin Purse | The first all-in you lose at each table refunds 25%. |
  | Tongue of Ash (cursed) | You post double blinds, but start each table with +50% stack. |
  | Two-Headed (stretch) | Dealt three hole cards, discard one on the flop. Needs per-seat discard support in the engine. |

- **Permadeath**: when you're broke with no buy-ins left, the run ends on a tombstone:
  *"Here lies the wanderer, who called the gnashback's river shove with seven-high."*
- **Chronicle**: a generated history of the run in the game's voice: your biggest pot, your worst
  beat, the creatures you broke, the relics you carried. Saved, viewable, and shareable as text.
- **Score**: chips banked plus feats.

## Meta

- **Feats** (achievements): win with 7-2, bust the idol, bluff the Seer off a hand, hit a royal,
  finish a pilgrimage, finish one without relics, and so on. Shown with Qud-style popups.
- **Bestiary**: every creature you've met, with your record against it and its observed stats.
- **Daily Pilgrimage share string**, copyable:
  ```
  ASCII POKER · daily 2026-10-28
  @ ◘◘◘○○ reached the Fungal Deep · +12,400
  ```
- **Hand history**: every hand saved as seed + actions; export as plain text in a standard
  hand-history format; replay URL encodes the compressed seed + actions, so sharing needs no server.

## Settings

Speed, reduced motion, sound volumes, four-colour deck, font (Plex or CP437 bitmap), CRT mode,
default table size and variant, starting stack and blinds, bot think time, reset the Seer's memory,
export and import save data.

## Accessibility and mobile

- An `aria-live` region mirrors the message log in plain text; every control is a real button.
- Suits always have a glyph, never colour alone; a high-contrast palette option.
- Mobile portrait gets its own scene layout (about 48 columns), with large action buttons and the
  bet slider as a native range input. Landscape phones use the desktop layout scaled down.

## Architecture

```
web/src/
  engine/   cards, variant, evaluator (done); rng, equity, types, table (state machine), handHistory
  bots/     opponentModel, adaptiveBot (look-ahead), sparring (station, maniac, nit, simple,
            exploiter, random), personalities (creature → bot config), tells, moods
  worker/   botWorker.ts + a typed client: act(seat, view) → Action, observe(event)
  render/   grid, palette, canvas (done); sprites, tweens, timeline, effects (shake, particles,
            lightning), layouts (desktop, mobile), scenes (table, map, merchant, menus, tombstone)
  audio/    synth voices, ambience
  game/     creatures (done), session (quick play), run (pilgrimage: map gen, nodes, relics),
            director (events → animation timeline → view), text (log/chronicle templates),
            save (localStorage, versioned), feats
  app/      / (title and menu), /play, /pilgrimage, /replay, /settings, /about
web/tests/  evaluator (done), rng, equity, engine invariants and parity, bots, text, save migrations
scripts/    make_fixtures.py: evaluator fixtures (done); add equity and full-hand engine fixtures
```

**Data flow per hand:** the engine emits events (`hand_start`, `blinds`, `deal`, `action`,
`street`, `showdown`, `hand_end`, same shape as the Python events). The **director** turns each
event into timeline steps (animations, sounds, log lines) and only then commits the new view
state. Bots learn from the same events through the Worker. Human input is enabled only when the
engine is waiting on you and the timeline is idle. React holds menus and the DOM button layer;
the per-frame game state lives in a plain store, outside React.

**Bot timing:** each decision has a compute budget (about 150 ms; less for Omaha's slower
evaluator) and a separate minimum display time (0.4–1.2 s at 1×, scaled by the speed setting), so
bots feel like they think without making you wait for maths.

## Deploying on Vercel

The game ships on Vercel from the start; nothing in phases 0–8 needs a server.

- **Project**: [`dookie`](https://vercel.com/charliephu123/dookie) in the `charliephu123` team,
  connected to `charliephu123/dookie` through the Git integration. **Root Directory: `web`**
  (the first deploy failed with `NEXT_NO_VERSION` until this was set), framework Next.js,
  Node 24. The Python kit at the repo root is never built or deployed.
- **Branches**: production deploys from the repo's default branch, which is currently
  `claude/focused-bell-1gjcyv` because it's the only branch. Create `main`, make it the default
  on GitHub and the production branch in Vercel, so work branches become previews. Vercel
  Authentication is on (standard protection), so preview URLs need a Vercel login or a share
  link to open.
- **Ignored Build Step**: `git diff HEAD^ HEAD --quiet -- .` (run from `web/`), so commits that
  only touch the Python kit don't trigger a build.
- **Everything prerenders as static**: the table, map and menus are client components on static
  routes, `next/font` self-hosts the font at build time, and the bot Worker is bundled with
  `new Worker(new URL("../worker/botWorker.ts", import.meta.url))`. No environment variables
  until phase 9. `next.config.ts` already turns on `cacheComponents`; keep game state out of
  server components so it stays that way.
- **Vercel Web Analytics and Speed Insights** (`@vercel/analytics`, `@vercel/speed-insights`):
  page views plus custom events (hand played, run started, run ended and how, daily completed),
  and real-user frame and load metrics to check the 60 fps and Worker budgets on real devices.
- **Share cards**: `opengraph-image` routes built with `next/og` render the glyph result for a
  daily run (`/daily/[date]/[code]`) and a replay (`/replay/[code]`) as an image, so links pasted
  into chat unfurl as a little ASCII table. These are the first Vercel Functions (phase 8).
- **Online, later (phase 9)**: Upstash Redis from the Vercel Marketplace for the daily leaderboard
  (its env vars are injected into the project automatically), written through Next.js route
  handlers with rate limiting. The engine and bots are plain TypeScript, so the route handler
  verifies a submitted daily run by replaying it: same seed, same bot code, recorded human
  actions. For that to be exact, daily runs use a fixed Monte Carlo iteration count instead of
  the time budget (a time budget makes bot decisions depend on machine speed).
- **Custom domain**: optional, added once there's a real title.

## Phases

| # | What | Done when |
|---|---|---|
| 0 | Scaffold, palette, glyph grid, static table mock | **done** |
| 1 | Port cards, variant, evaluator | **done** |
| 2 | **done.** Seeded RNG; port equity; game types; step-driven table engine with side pots and the real short-all-in rule | Equities match Python fixtures within MC noise; chips sum to zero over 10k random hands (property tests with fast-check); full-hand parity with the Python engine on fixed decks and action lists |
| 3 | **done.** Port sparring bots, opponent model, AdaptiveBot with look-ahead; the Worker; a headless `npm run sim` | TS AdaptiveBot beats TS SimpleEquityBot heads-up by a margin inside Python's CI (+249 ±63 bb/100), and decisions stay under budget |
| 4 | **done.** **Playable MVP**: Quick Play; director, typed commands (no bet slider, by request), log text generator, odds overlay, rebuys, persistence; render fixes from the mock review | You can play a full session in the browser, keyboard or mouse, and the Seer remembers you on reload |
| 5 | Ship it on Vercel (see [Deploying on Vercel](#deploying-on-vercel)): `main` branch, Git-connected project with root `web/`, preview deploys per PR, Analytics and Speed Insights; GitHub Actions for lint, vitest, Python tests and build | Production URL works on desktop and mobile; every PR gets a working preview |
| 6 | **done.** Juice: sprites and tweens, every animation above, sound, screen shake, rare-hand fanfares, tells, moods, CRT mode, speed and reduced motion | Feels alive at 60 fps on a laptop; reduced motion leaves no animation running |
| 7 | The Pilgrimage: map generation, regions and variants, new creatures and bosses, merchant and relics, shrines, sit & go, permadeath, tombstone and chronicle | A full run from caravanserai to Arbiter is winnable, losable, and different each seed |
| 8 | Meta: daily seed and share string, Replay Theatre and replay URLs, `next/og` share cards, hand-history export, feats, bestiary, Lessons from the Seer, mobile portrait layout, CP437 font | All of the above work from the static deploy (share cards are the only functions) |
| 9 | Optional online: daily leaderboard and server-stored replays (Upstash Redis via the Vercel Marketplace, route handlers) | Leaderboard is live and rejects results that don't replay from their seed + actions |

Phase 4 is the first thing worth playing. Phases 6–8 can run in parallel once 4 is in.

## Testing

- **Parity with Python**: evaluator (done), equity within MC noise, and full hands (deck order +
  actions → identical events and deltas) with `shortAllInReopens = true`.
- **Engine invariants** (fast-check): chips conserved, no negative stacks, legal actions only,
  every hand terminates, side pots pay correctly, odd chips go to the right seat.
- **Bot strength**: headless matchups in CI with a fixed seed and a small hand count as a smoke
  test; the full matchup table runs on demand.
- **Replays**: replaying a saved hand from seed + actions reproduces it exactly.
- **Save migrations**: every old save version loads.
- **Visual**: Playwright screenshots of key scenes (table, map, tombstone) at desktop and mobile
  sizes, compared in CI.

## Naming and IP

- Working title stays "ascii-poker". The game must not be called "Caves of Qud", or use its
  creature names (snapjaw, glowmoth, and so on), place names (Joppa, Golgotha and so on), its
  currency of water drams, its font or its tiles. The creatures above are renamed to original
  ones for this reason ("frothing snapjaw" becomes "frothing gnashback").
- A colour palette and the `{{R|text}}` markup style are general techniques, not assets; fine to keep.
- Fonts: IBM Plex Mono (OFL). For the CP437 option, use a font whose licence allows web
  embedding, such as the Ultimate Oldschool PC Font Pack (CC BY-SA 4.0, needs attribution on
  `/about`).

## Risks

- **Bot strength drifting in the port.** Parity fixtures and the same headless matchups as Python.
- **Main-thread jank from Monte Carlo.** The Worker plus a per-decision time budget.
- **Canvas text crispness on HiDPI screens.** Scale by `devicePixelRatio` and snap glyphs to cells
  (already done in `GlyphCanvas`).
- **Scope.** This plan is big. Phase 4 alone is a complete, shippable game; everything after it
  is additive and can stop at any phase.
- **Omaha speed.** Its evaluator is about 60× slower; lower Monte Carlo iterations in the Fungal
  Deep and lean on the time budget.
- **Next.js 16 differences.** `web/AGENTS.md` warns that APIs differ from older versions; read
  `node_modules/next/dist/docs/` before touching routing, fonts or config.

## Open questions

1. A real title for the game (the working title is fine until phase 5).
2. Pilgrimage first or polish first? This plan ships Quick Play (phase 4) first, then juice (6),
   then the run (7).
3. Is an online leaderboard (phase 9) wanted at all, given it's the only part that needs a server?

## Notes from phase 2

- **Python engine fix:** `pokerbot/engine.py` used to deal and announce the next street after
  everyone else had folded (a `street` event with a card nobody should see). It now stops first.
  Chip results are unchanged; the TS engine behaves the same way.
- **Rules:** `web/src/engine/table.ts` takes `STANDARD_RULES` (real short-all-in and odd-chip rules,
  the default) or `PYTHON_RULES` (matches `pokerbot/engine.py`, used by the parity test).
- **Equity noise:** postflop "strict" range cutoffs are re-sampled from only 150 hands on every
  equity call, so a single river equity can swing from 0.05 to 0.17 between calls on the same
  spot (sd about 0.03). The parity test averages 20 calls to compare expectations. In phase 3,
  caching the cutoff per board and sampling 400 hands made no measurable difference over
  20,000 heads-up hands (+119 ±13 vs +125 ±14 bb/100 against Exploiter, +302 ±34 vs +320 ±35
  against SimpleEquityBot), so the bot keeps Python's behaviour.
- **Regenerating fixtures:** `python3 scripts/make_fixtures.py` writes all three fixture files;
  the evaluator fixture is byte-for-byte unchanged by the new sections.

## Notes from phase 3

- Bots live in `web/src/bots/` and run through `web/src/worker/` (`BotClient.create()` uses a Web
  Worker in the browser, in-process elsewhere). `/lab` is a page where the bots play each other
  through the Worker; it's how we check the Worker bundles and keeps up in a real browser.
- `npm run sim` is the TS twin of `run_match.py`, about 6× faster.
- Acceptance runs (seed 1, standard rules): heads-up vs SimpleEquityBot +313 ±60 bb/100, vs
  Exploiter +130 ±26 (6,000 hands each); 7-handed against 2× simple, Exploiter, nit, maniac and
  station, AdaptiveBot finishes in the top group (+664 ±192 over 2,500 hands). Slowest decision 64 ms.
- Bots are reproducible from a seed when given `timeLimit: Infinity` (no wall-clock cutoffs); the
  daily mode and leaderboard verification need that.

## Notes from phase 4

- **Input is typed, play.py style** (no bet slider): `f` `x` `c` `r 740` `h` `p` `a` `?`, then Enter.
  A real but invisible `<input>` takes the typing, so phones get a keyboard. Errors clear the line.
- **The view** is two layers: a fine-cell ASCII-shader world on canvas (lamp, braziers, haze,
  watchers, tension lighting) and a DOM layer for everything you read. The Seer's read, the
  creature list and the hand ledger live in a drawer (Tab). The full log is behind L.
- **Code:** `web/src/game/` holds the game (session, director, narrator, ledger, commands,
  save); `web/src/components/PokerGame.tsx` connects it to `TableScreen`.
- **Not yet:** Duel mode and settings (speed, opponents, variant) have no UI; the defaults are
  hold'em, five creatures, 50/100 blinds and 10,000 chips. A world glyph can show through the
  prompt text. No card or chip movement yet (phase 6).

## Notes from phase 6

- **Cues:** `web/src/game/fx.ts` is the contract. The director issues cues per engine event and
  waits for them; the screen animates them (`components/useFx.ts`) and `audio/synth.ts` plays them.
- **Settings are typed**, like everything else: `speed 1/2/4/instant`, `sound on/off`, `volume N`,
  `crt on/off`, `help`. They work mid-hand without using your turn.
- **Tells** come from each creature's true hand strength, computed in the worker (which never
  sees your cards), shown at its own reliability. **Moods** (tilted, heater, wary, short) change
  how bots play via `setMood()`.
- **Sharpness:** the world's per-cell glow is scaled by whole device pixels with no smoothing,
  and the world keeps the ground clear under every piece of readable text.
- **The ledger** is now a quiet action trail under each seat; the full grid lives in the Tab drawer.
