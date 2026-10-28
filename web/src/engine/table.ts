// N-player no-limit / pot-limit hold'em-family engine, step-driven so the UI can pause for
// the human and for animations. Port of pokerbot/engine.py:
//
//   let step = startHand({ variant, seats, stacks, deck });
//   while (!step.state.done) step = apply(step.state, chooseAction(decision(step.state)!));
//
// Every function is pure: `apply` returns a new state and never mutates the one passed in,
// so states can be saved, replayed, branched ("what if I'd called?") and posted to a Worker.
import type { Card } from "./cards";
import { Evaluator } from "./evaluator";
import type { Chips, HandEvent, Pot } from "./events";
import { CALL, CHECK, FOLD, type Action, type ActionKind, type GameState } from "./game";
import type { Rng } from "./rng";
import { boardSize, deck as variantDeck, numStreets, type Variant } from "./variant";

export interface Rules {
  /**
   * Real rule (false): an all-in raise smaller than a full raise does not reopen the betting
   * to players who already acted, unless short raises add up to a full one.
   * Python's engine (true) lets any raise reopen the betting.
   */
  shortAllInReopens: boolean;
  /** Real rule (false): odd chips go to the first winner left of the button. Python (true): button first. */
  oddChipToButton: boolean;
}

export const STANDARD_RULES: Rules = { shortAllInReopens: false, oddChipToButton: false };
/** Matches pokerbot/engine.py exactly; used by the parity tests. */
export const PYTHON_RULES: Rules = { shortAllInReopens: true, oddChipToButton: true };

export interface HandState {
  variant: Variant;
  rules: Rules;
  handId: number;
  /** seats[0] is the button */
  seats: string[];
  /** undealt cards; dealt from the end */
  deck: Card[];
  hole: Record<string, Card[]>;
  board: Card[];
  startStacks: Chips;
  stacks: Chips;
  streetBet: Chips;
  totalIn: Chips;
  folded: Record<string, boolean>;
  allIn: Record<string, boolean>;
  street: number;
  current: number;
  lastRaise: number;
  /** players who have acted since the last raise */
  acted: string[];
  /** the bet level each player left behind when they last acted this street (null = hasn't acted) */
  actedAt: Record<string, number | null>;
  /** next seat index to consider (mod seats.length) */
  cursor: number;
  /** whose decision it is; null when the hand is over */
  toAct: string | null;
  done: boolean;
  /** coerced or malformed actions per player */
  illegal: Chips;
  history: HandEvent[];
}

export interface Step {
  state: HandState;
  /** events produced by this step, in order */
  events: HandEvent[];
}

export interface HandSetup {
  variant: Variant;
  /** seats[0] is the button */
  seats: string[];
  /** a shuffled deck; cards are dealt from the end. Use shuffledDeck(). */
  deck: Card[];
  /** chips behind per player; defaults to variant.startingStack */
  stacks?: Chips;
  handId?: number;
  rules?: Rules;
}

export function shuffledDeck(v: Variant, rng: Rng): Card[] {
  return rng.shuffle(variantDeck(v));
}

const evaluators = new WeakMap<Variant, Evaluator>();
function evaluatorFor(v: Variant): Evaluator {
  let ev = evaluators.get(v);
  if (!ev) evaluators.set(v, (ev = new Evaluator(v)));
  return ev;
}

const sum = (c: Chips) => Object.values(c).reduce((a, b) => a + b, 0);
const copy = <T>(r: Record<string, T>): Record<string, T> => ({ ...r });

function clone(s: HandState): HandState {
  return {
    ...s,
    deck: s.deck.slice(),
    hole: s.hole,   // never mutated after the deal
    board: s.board.slice(),
    stacks: copy(s.stacks),
    streetBet: copy(s.streetBet),
    totalIn: copy(s.totalIn),
    folded: copy(s.folded),
    allIn: copy(s.allIn),
    acted: s.acted.slice(),
    actedAt: copy(s.actedAt),
    illegal: copy(s.illegal),
    history: s.history.slice(),
  };
}

function emit(s: HandState, out: HandEvent[], e: HandEvent) {
  s.history.push(e);
  out.push(e);
}

function put(s: HandState, p: string, x: number) {
  x = Math.min(x, s.stacks[p]);
  s.stacks[p] -= x;
  s.streetBet[p] += x;
  s.totalIn[p] += x;
  if (s.stacks[p] === 0) s.allIn[p] = true;
}

const live = (s: HandState) => s.seats.filter((p) => !s.folded[p]);

export function startHand(setup: HandSetup): Step {
  const { variant: v, seats } = setup;
  if (seats.length < 2) throw new Error("need at least two players");
  const deck = setup.deck.slice();
  const stacks: Chips = {};
  for (const p of seats) stacks[p] = setup.stacks?.[p] ?? v.startingStack;
  const hole: Record<string, Card[]> = {};
  for (const p of seats) hole[p] = Array.from({ length: v.holeCards }, () => deck.pop()!);
  const zero = () => Object.fromEntries(seats.map((p) => [p, 0]));
  const s: HandState = {
    variant: v, rules: setup.rules ?? STANDARD_RULES, handId: setup.handId ?? 0, seats, deck, hole,
    board: [], startStacks: { ...stacks }, stacks, streetBet: zero(), totalIn: zero(),
    folded: Object.fromEntries(seats.map((p) => [p, false])),
    allIn: Object.fromEntries(seats.map((p) => [p, false])),
    street: 0, current: 0, lastRaise: v.bigBlind, acted: [],
    actedAt: Object.fromEntries(seats.map((p) => [p, null])),
    cursor: 0, toAct: null, done: false, illegal: zero(), history: [],
  };
  const out: HandEvent[] = [];
  const n = seats.length;
  emit(s, out, { type: "hand_start", handId: s.handId, players: [...seats], button: seats[0], numStreets: numStreets(v) });
  emit(s, out, { type: "deal", holeCards: v.holeCards });
  for (const p of seats) if (stacks[p] === 0) s.allIn[p] = true;
  if (v.ante) {
    for (const p of seats) put(s, p, v.ante);
    for (const p of seats) s.streetBet[p] = 0;
  }
  const [sb, bb] = n === 2 ? [seats[0], seats[1]] : [seats[1], seats[2]];
  put(s, sb, v.smallBlind);
  put(s, bb, v.bigBlind);
  emit(s, out, { type: "blinds", sb, bb, stacks: copy(s.stacks), bets: copy(s.streetBet), pot: sum(s.totalIn) });
  beginStreet(s, out);
  advance(s, out);
  return { state: s, events: out };
}

/** Deal the current street's cards and reset the betting round. */
function beginStreet(s: HandState, out: HandEvent[]) {
  const n = s.seats.length;
  for (let i = 0; i < s.variant.streets[s.street]; i++) s.board.push(s.deck.pop()!);
  if (s.street > 0) {
    for (const p of s.seats) s.streetBet[p] = 0;
    emit(s, out, { type: "street", street: s.street, board: s.board.slice() });
  }
  s.cursor = s.street === 0 ? (n === 2 ? 0 : 3 % n) : 1;
  s.current = Math.max(...Object.values(s.streetBet));
  s.lastRaise = s.variant.bigBlind;
  s.acted = [];
  for (const p of s.seats) s.actedAt[p] = null;
}

/** Who acts next this street, or null if the betting round is over. Moves the cursor. */
function nextToAct(s: HandState): string | null {
  const n = s.seats.length;
  for (;;) {
    const lv = live(s);
    const active = lv.filter((p) => !s.allIn[p]);
    if (lv.length < 2 || !active.length) return null;
    if (active.every((p) => s.acted.includes(p) && s.streetBet[p] === s.current)) return null;
    if (active.length === 1 && s.streetBet[active[0]] >= s.current) return null;
    const p = s.seats[s.cursor % n];
    s.cursor++;
    if (s.folded[p] || s.allIn[p] || (s.acted.includes(p) && s.streetBet[p] === s.current)) continue;
    return p;
  }
}

/** Run the hand forward until someone has to decide, or it ends. */
function advance(s: HandState, out: HandEvent[]) {
  for (;;) {
    const p = nextToAct(s);
    if (p !== null) { s.toAct = p; return; }
    s.street++;
    if (s.street >= numStreets(s.variant) || live(s).length < 2) { payout(s, out); return; }
    beginStreet(s, out);
  }
}

export interface Legal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

/** What the player to act may do. */
export function legal(s: HandState): Legal {
  const p = s.toAct;
  if (p === null) throw new Error("hand is over");
  const toCall = Math.min(s.current - s.streetBet[p], s.stacks[p]);
  let maxTo = s.streetBet[p] + s.stacks[p];
  if (s.variant.potLimit) maxTo = Math.min(maxTo, s.current + sum(s.totalIn) + (s.current - s.streetBet[p]));
  const at = s.actedAt[p];
  if (!s.rules.shortAllInReopens && at !== null && s.current - at < s.lastRaise) {
    maxTo = Math.min(maxTo, s.current);   // only short all-ins since we acted: call or fold
  }
  const minTo = Math.min(s.current + s.lastRaise, maxTo);
  const canRaise = maxTo > s.current && s.stacks[p] > toCall;
  return { toCall, canCheck: toCall === 0, canRaise, minRaiseTo: minTo, maxRaiseTo: maxTo };
}

/** The decision the player to act faces, as the GameState a bot or the UI receives. */
export function decision(s: HandState): GameState | null {
  const p = s.toAct;
  if (p === null) return null;
  const l = legal(s);
  return {
    variant: s.variant, handId: s.handId, me: p, hole: s.hole[p], board: s.board.slice(),
    street: s.street, pot: sum(s.totalIn), toCall: l.toCall, currentBet: s.current,
    minRaiseTo: l.minRaiseTo, maxRaiseTo: l.maxRaiseTo, myStack: s.stacks[p], myStreetBet: s.streetBet[p],
    players: s.seats.map((q) => ({
      id: q, stack: s.stacks[q], streetBet: s.streetBet[q], totalIn: s.totalIn[q],
      folded: s.folded[q], allIn: s.allIn[q],
    })),
    history: s.history,
  };
}

/** Turn whatever was asked for into the legal action the engine will take, like Python does. */
export function coerce(s: HandState, a: Action | null | undefined): { action: Action; illegal: boolean } {
  const l = legal(s);
  const kind = a?.kind as ActionKind | undefined;
  if (kind === "fold") return { action: l.toCall ? FOLD : CHECK, illegal: false };
  if (kind === "check") return l.toCall ? { action: FOLD, illegal: true } : { action: CHECK, illegal: false };
  if (kind === "call") return { action: l.toCall ? CALL : CHECK, illegal: false };
  if (kind === "raise") {
    if (!l.canRaise) return { action: l.toCall ? CALL : CHECK, illegal: false };
    const amt = Number.isFinite(a!.amount) ? Math.floor(a!.amount) : l.minRaiseTo;
    return { action: { kind: "raise", amount: Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, amt)) }, illegal: false };
  }
  return { action: l.toCall ? FOLD : CHECK, illegal: true };
}

/** Apply the acting player's action (coerced to something legal) and run to the next decision. */
export function apply(prev: HandState, requested: Action | null | undefined): Step {
  const p = prev.toAct;
  if (p === null) throw new Error("hand is over");
  const s = clone(prev);
  const out: HandEvent[] = [];
  const { action, illegal } = coerce(s, requested);
  if (illegal) s.illegal[p]++;
  const toCall = Math.min(s.current - s.streetBet[p], s.stacks[p]);
  const potBefore = sum(s.totalIn);
  let amount = 0;
  if (action.kind === "fold") {
    s.folded[p] = true;
  } else if (action.kind === "call") {
    amount = toCall;
    put(s, p, toCall);
  } else if (action.kind === "raise") {
    amount = action.amount;
    if (amount - s.current >= s.lastRaise) s.lastRaise = amount - s.current;
    s.current = amount;
    put(s, p, amount - s.streetBet[p]);
    s.acted = [];
  }
  s.acted.push(p);
  s.actedAt[p] = s.current;
  s.toAct = null;
  emit(s, out, {
    type: "action", player: p, street: s.street, action: action.kind, amount, toCall, pot: potBefore,
    allIn: s.allIn[p], stacks: copy(s.stacks), bets: copy(s.streetBet), potAfter: sum(s.totalIn),
  });
  advance(s, out);
  return { state: s, events: out };
}

function payout(s: HandState, out: HandEvent[]) {
  const { seats, totalIn } = s;
  const lv = live(s);
  const won: Chips = Object.fromEntries(seats.map((p) => [p, 0]));
  const winners = new Set<string>();
  const pots: Pot[] = [];
  if (lv.length === 1) {
    won[lv[0]] = sum(totalIn);
    winners.add(lv[0]);
    pots.push({ amount: won[lv[0]], eligible: [lv[0]], won: { [lv[0]]: won[lv[0]] } });
  } else {
    const ev = evaluatorFor(s.variant);
    while (s.board.length < boardSize(s.variant)) s.board.push(s.deck.pop()!);
    const ranks: Chips = Object.fromEntries(lv.map((p) => [p, ev.rank(s.hole[p], s.board)]));
    // odd chips: Python pays winners in seat order from the button; the real rule starts left of it
    const order = s.rules.oddChipToButton ? seats : [...seats.slice(1), seats[0]];
    let prev = 0;
    const levels = [...new Set(seats.map((p) => totalIn[p]).filter((x) => x > 0))].sort((a, b) => a - b);
    for (const level of levels) {
      let slice = 0;
      for (const p of seats) slice += Math.min(totalIn[p], level) - Math.min(totalIn[p], prev);
      let elig = lv.filter((p) => totalIn[p] >= level);
      if (!elig.length) elig = [lv.reduce((a, b) => (totalIn[b] > totalIn[a] ? b : a))];
      const best = Math.max(...elig.map((p) => ranks[p]));
      const ws = order.filter((p) => elig.includes(p) && ranks[p] === best);
      const share = Math.floor(slice / ws.length), rem = slice % ws.length;
      const got: Chips = {};
      ws.forEach((w, j) => { got[w] = share + (j < rem ? 1 : 0); won[w] += got[w]; winners.add(w); });
      // merge into the previous pot when the same players are contesting it
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === elig.join()) {
        last.amount += slice;
        for (const [w, x] of Object.entries(got)) last.won[w] = (last.won[w] ?? 0) + x;
      } else {
        pots.push({ amount: slice, eligible: elig, won: got });
      }
      prev = level;
    }
    emit(s, out, {
      type: "showdown", board: s.board.slice(),
      hands: Object.fromEntries(lv.map((p) => [p, s.hole[p]])), winners: [...winners].sort(),
    });
  }
  const deltas: Chips = {};
  for (const p of seats) {
    deltas[p] = won[p] - totalIn[p];
    s.stacks[p] += won[p];
  }
  s.done = true;
  s.toAct = null;
  emit(s, out, { type: "hand_end", deltas, stacks: copy(s.stacks), winners: [...winners].sort(), pots });
}

/** Play a whole hand synchronously, asking `act` for each decision. For sims and tests. */
export function playHand(setup: HandSetup, act: (g: GameState, s: HandState) => Action): HandState {
  let { state } = startHand(setup);
  while (!state.done) state = apply(state, act(decision(state)!, state)).state;
  return state;
}
