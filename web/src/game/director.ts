// Turns engine events into what's on screen: a GameView the renderer draws every frame, log
// lines in the game's voice, the ledger, and the pacing between beats (a bot "thinking", the
// pause after the flop, the beat before the pot is pushed). Speed 0 means instant.
import { OpponentModel, type ModelJSON } from "@/bots/opponents";
import type { Mood } from "@/bots/bot";
import type { Card } from "@/engine/cards";
import type { HandEvent } from "@/engine/events";
import { Rng } from "@/engine/rng";
import type { HandState } from "@/engine/table";
import { boardSize, type Variant } from "@/engine/variant";
import { DEAL_STAGGER, FX_MS, type Fx, type FxEvent } from "./fx";
import { LedgerBuilder, type Ledger } from "./ledger";
import { TELLS, tellShows, type MoodChange } from "./moods";
import { Narrator } from "./narrator";
import { YOU, kindOf, type Presenter } from "./session";

export interface SeatModel {
  id: string;
  /** creature key */
  kind: string;
  stack: number;
  bet: number;
  /** null = folded or not dealt; null entries are face-down cards */
  cards: (Card | null)[] | null;
  dealer: boolean;
  acting: boolean;
  allIn: boolean;
  /** chips won this hand, shown at the end */
  won: number;
  /** a small idle animation that leaks hand strength (the gnashback drools), or null */
  tell: string | null;
  /** tilted, on a heater, wary, short-stacked: changes how it plays */
  mood: Mood | null;
  /** finishing place once out of the tournament (6 = first out of 6), else null */
  out: number | null;
}

export interface ReadModel {
  vpip: number;
  pfr: number;
  foldToBet: number;
  stab: number;
  bluff: number;
  hands: number;
}

export interface PromptModel {
  /** "act": your decision; "next": between hands; "wait": someone else is acting */
  mode: "act" | "next" | "wait";
  info: string;
  options: string;
  input: string;
  feedback: string | null;
}

export interface GameView {
  handNo: number;
  blinds: [number, number];
  street: string;
  board: Card[];
  boardSize: number;
  pot: number;
  /** seat 0 is you; the rest in order around the table */
  seats: SeatModel[];
  log: string[];
  ledger: Ledger;
  prompt: PromptModel;
  read: ReadModel | null;
  /** your chips against your buy-in */
  session: number;
  /** your best hand right now, in words */
  handName: string | null;
  /** what you'd have to call, while it's your decision */
  toCall: number;
  /** drives tension lighting: pot relative to the average stack, anyone all in, your turn */
  tension: { pot: number; allIn: boolean; yourTurn: boolean };
  /** animation and sound cues, oldest first; consumers remember the last id they handled */
  fx: FxEvent[];
  /** display settings */
  settings: { crt: boolean };
}

/** Milliseconds at 1x speed. */
const BEATS = {
  hand_start: 250, deal: 450, blinds: 250, street: 750, botAction: 450, yourAction: 120,
  showdown: 1400, hand_end: 1100, thinkMin: 450, thinkMax: 1000,
};

const LOG_KEEP = 200;
const FX_KEEP = 64;
const BOARD_STAGGER = 140;
const WIN_STAGGER = 350;

export class Director implements Presenter {
  view: GameView;
  /** 1 = normal, 2 or 4 = faster, 0 = instant */
  speed = 1;
  narrator: Narrator;
  private ledger = new LedgerBuilder();
  private flavor: Rng;
  private wake: (() => void) | null = null;
  private fxId = 0;
  /** no animations, only end states (prefers-reduced-motion) */
  reducedMotion = false;
  /** every cue as it's issued (the synth listens here) */
  onFx: (e: FxEvent) => void = () => {};

  constructor(private v: Variant, ids: string[], seed: string, private onChange: () => void = () => {}) {
    this.flavor = new Rng(`${seed}/flavor`);
    this.narrator = this.narratorFor(ids);
    this.view = {
      handNo: 0, blinds: [v.smallBlind, v.bigBlind], street: "", board: [], boardSize: boardSize(v), pot: 0,
      seats: this.seatsFor(ids),
      log: [], ledger: this.ledger.ledger,
      prompt: { mode: "wait", info: "", options: "", input: "", feedback: null },
      read: null, session: 0, handName: null, toCall: 0, tension: { pot: 0, allIn: false, yourTurn: false },
      fx: [], settings: { crt: false },
    };
  }

  private narratorFor(ids: string[]) {
    return new Narrator(this.v, Object.fromEntries(ids.map((p) => [p, kindOf(p)])), YOU, this.flavor);
  }

  private seatsFor(ids: string[]): SeatModel[] {
    return ids.map((id) => ({ id, kind: kindOf(id), stack: this.v.startingStack, bet: 0, cards: null, dealer: false, acting: false, allIn: false, won: 0, tell: null, mood: null, out: null }));
  }

  private seat(id: string) {
    return this.view.seats.find((s) => s.id === id)!;
  }

  private seatIndex(id: string) {
    return this.view.seats.findIndex((s) => s.id === id);
  }

  /** Issue a cue; returns when it will have finished, in ms from now at the current speed. */
  cue(fx: Fx, delay = 0): number {
    const animate = this.speed > 0 && !this.reducedMotion;
    const e: FxEvent = {
      id: ++this.fxId, at: typeof performance !== "undefined" ? performance.now() : 0, fx,
      ms: animate ? FX_MS[fx.kind] / this.speed : 0, delay: animate ? delay / this.speed : 0,
    };
    this.view.fx.push(e);
    if (this.view.fx.length > FX_KEEP) this.view.fx.splice(0, this.view.fx.length - FX_KEEP);
    this.onFx(e);
    return e.delay + e.ms;
  }

  private changed() {
    this.onChange();
  }

  /** Wait `ms` at the current speed; skip() cuts it short. */
  private sleep(ms: number): Promise<void> {
    if (this.speed <= 0 || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); this.wake = null; resolve(); };
      const t = setTimeout(done, ms / this.speed);
      this.wake = done;
    });
  }

  /** Hurry the current beat along (a keypress while waiting). */
  skip() {
    this.wake?.();
  }

  log(...lines: string[]) {
    this.view.log.push(...lines);
    if (this.view.log.length > LOG_KEEP) this.view.log.splice(0, this.view.log.length - LOG_KEEP);
    this.changed();
  }

  note(markup: string) {
    this.log(markup);
  }

  async think(id: string): Promise<void> {
    for (const s of this.view.seats) s.acting = s.id === id;
    this.view.prompt = { ...this.view.prompt, mode: "wait", info: `{{K|waiting on}} ${this.narrator.who(id)}{{K|...}}` };
    this.view.toCall = 0;
    this.cue({ kind: "think", seat: this.seatIndex(id) });
    this.changed();
    await this.sleep(BEATS.thinkMin + this.flavor.random() * (BEATS.thinkMax - BEATS.thinkMin));
  }

  setStacks(bank: Record<string, number>) {
    for (const s of this.view.seats) s.stack = bank[s.id] ?? s.stack;
    this.changed();
  }

  /** Mark who's already out (a reload mid-tournament). */
  setOut(out: Record<string, number>) {
    for (const s of this.view.seats) s.out = out[s.id] ?? null;
    this.changed();
  }

  setSession(net: number) {
    this.view.session = net;
    this.changed();
  }

  /** The Seer's model of you, from its saved model. */
  setRead(models: Record<string, ModelJSON>) {
    const seer = Object.keys(models).find((id) => kindOf(id) === "adaptive");
    if (!seer) return;
    const m = new OpponentModel();
    m.load(models[seer]);
    const st = m.stats(YOU);
    this.view.read = { vpip: st.vpipRate, pfr: st.pfrRate, foldToBet: st.foldRate, stab: st.stabRate, bluff: st.bluffRate, hands: st.hands };
    this.changed();
  }

  setPrompt(p: Partial<PromptModel>) {
    this.view.prompt = { ...this.view.prompt, ...p };
    this.view.tension.yourTurn = this.view.prompt.mode === "act";
    this.changed();
  }

  /** Show tells from each creature's true hand strength (each creature has its own reliability). */
  strengths(st: Record<string, number>) {
    for (const s of this.view.seats) {
      const def = TELLS[s.kind];
      s.tell = def && s.cards && st[s.id] !== undefined && tellShows(def, st[s.id], this.flavor) ? def.tell : null;
    }
    this.changed();
  }

  /** Moods changed after a hand: mark the seats and say so in the log. */
  moods(changes: MoodChange[], line: (c: MoodChange) => string | null) {
    for (const c of changes) {
      this.seat(c.id).mood = c.mood;
      const l = line(c);
      if (l) this.view.log.push(l);
    }
    if (changes.length) this.changed();
  }

  /** Someone ran out of chips: they crumble and their seat goes dark. */
  eliminate(id: string, place: number) {
    Object.assign(this.seat(id), { stack: 0, mood: null, tell: null, out: place });
    this.cue({ kind: "bust", seat: this.seatIndex(id) });
    this.changed();
  }

  /** A new tournament with the same creatures: everyone back in with a fresh stack. */
  /** A new tournament; `ids` when a different set of creatures sits down. */
  reset(bank: Record<string, number>, ids?: string[]) {
    const V = this.view;
    Object.assign(V, { handNo: 0, street: "", board: [], pot: 0, handName: null, toCall: 0 });
    if (ids) {
      this.narrator = this.narratorFor(ids);
      V.seats = this.seatsFor(ids);
    }
    for (const s of V.seats) {
      Object.assign(s, { stack: bank[s.id], bet: 0, cards: null, dealer: false, acting: false, allIn: false, won: 0, tell: null, mood: null, out: null });
    }
    this.changed();
  }

  async present(events: HandEvent[], state: HandState): Promise<void> {
    for (const e of events) {
      const before = this.view.seats.map((s) => s.bet);
      this.apply(e, state);
      this.ledger.observe(e);
      this.view.ledger = this.ledger.ledger;
      const lines = this.narrator.lines([e]);
      if (lines.length) this.view.log.push(...lines);
      this.updateDerived(state);
      const fxDone = this.cues(e, state, before);
      this.changed();
      const beat = e.type === "action" ? (e.player === YOU ? BEATS.yourAction : BEATS.botAction) : BEATS[e.type];
      await this.sleep(Math.max(beat, fxDone * this.speed));   // sleep() takes 1x ms
    }
  }

  /** Animation cues for one event; returns ms until the last one finishes (at the current speed). */
  private cues(e: HandEvent, state: HandState, betsBefore: number[]): number {
    const V = this.view;
    let done = 0;
    const at = (ms: number) => { done = Math.max(done, ms); };
    switch (e.type) {
      case "deal": {
        // one card at a time around the table, starting left of the button
        const order = [...state.seats.slice(1), state.seats[0]].map((id) => this.seatIndex(id));
        let i = 0;
        for (let k = 0; k < e.holeCards; k++) for (const seat of order) at(this.cue({ kind: "deal", seat, k, n: e.holeCards }, DEAL_STAGGER * i++));
        break;
      }
      case "blinds":
        V.seats.forEach((s, seat) => { if (s.bet) at(this.cue({ kind: "bet", seat, amount: s.bet, allIn: s.allIn })); });
        break;
      case "street": {
        if (betsBefore.some((b) => b > 0)) at(this.cue({ kind: "collect" }));
        const fresh = e.board.length - this.boardShown;
        for (let j = 0; j < fresh; j++) {
          const index = this.boardShown + j;
          at(this.cue({ kind: "board", index, card: e.board[index] }, FX_MS.collect * +betsBefore.some((b) => b > 0) + BOARD_STAGGER * j));
        }
        this.boardShown = e.board.length;
        break;
      }
      case "action": {
        const seat = this.seatIndex(e.player);
        if (e.action === "fold") at(this.cue({ kind: "fold", seat }));
        else if (e.action === "check") at(this.cue({ kind: "check", seat }));
        else at(this.cue({ kind: "bet", seat, amount: V.seats[seat].bet - betsBefore[seat], allIn: e.allIn }));
        if (e.allIn) at(this.cue({ kind: "allIn", seat }));
        break;
      }
      case "showdown": {
        if (betsBefore.some((b) => b > 0)) at(this.cue({ kind: "collect" }));
        const fresh = e.board.length - this.boardShown;   // all-in run-outs deal the rest here
        for (let j = 0; j < fresh; j++) {
          const index = this.boardShown + j;
          at(this.cue({ kind: "board", index, card: e.board[index] }, BOARD_STAGGER * j));
        }
        this.boardShown = e.board.length;
        for (const p of Object.keys(e.hands)) if (p !== YOU) at(this.cue({ kind: "reveal", seat: this.seatIndex(p) }));
        this.shown = e.hands;
        break;
      }
      case "hand_end": {
        if (betsBefore.some((b) => b > 0)) at(this.cue({ kind: "collect" }));
        let k = 0;
        V.seats.forEach((s, seat) => {
          if (!s.won) return;
          const hole = this.shown[s.id];
          const category = hole ? this.narrator.category(hole, V.board) : null;
          at(this.cue({ kind: "win", seat, amount: s.won, hand: hole ? this.narrator.handName(hole, V.board) : null, category }, WIN_STAGGER * k++));
        });
        break;
      }
      case "hand_start":
        this.boardShown = 0;
        this.shown = {};
        break;
    }
    return done;
  }

  private boardShown = 0;
  private shown: Record<string, Card[]> = {};

  private apply(e: HandEvent, state: HandState) {
    const V = this.view;
    // seats out of the tournament sit the hand out
    const seated = V.seats.filter((s) => s.id in state.startStacks);
    switch (e.type) {
      case "hand_start":
        V.handNo = e.handId + 1;
        V.street = "PRE";
        V.board = [];
        V.pot = 0;
        for (const s of V.seats) Object.assign(s, { bet: 0, cards: null, dealer: s.id === e.button, acting: false, allIn: false, won: 0, tell: null });
        break;
      case "deal":
        for (const s of seated) s.cards = s.id === YOU ? state.hole[YOU].slice() : new Array(e.holeCards).fill(null);
        break;
      case "blinds":
        for (const s of seated) { s.stack = e.stacks[s.id]; s.bet = e.bets[s.id]; s.allIn = e.stacks[s.id] === 0; }
        V.pot = e.pot;
        break;
      case "street":
        V.board = e.board.slice();
        V.street = this.ledger.ledger.streets[e.street] ?? "";
        for (const s of V.seats) s.bet = 0;
        break;
      case "action": {
        const s = this.seat(e.player);
        for (const q of seated) { q.stack = e.stacks[q.id]; q.bet = e.bets[q.id]; }
        s.acting = false;
        s.allIn = e.allIn;
        // they've acted: stop saying we're waiting on them (think() names the next one)
        if (V.prompt.mode === "wait") V.prompt = { ...V.prompt, info: "" };
        if (e.action === "fold") { s.cards = null; s.tell = null; }
        V.pot = e.potAfter;
        break;
      }
      case "showdown":
        V.board = e.board.slice();
        V.street = "SHOW";
        for (const [p, hole] of Object.entries(e.hands)) this.seat(p).cards = hole.slice();
        break;
      case "hand_end":
        for (const s of seated) {
          s.stack = e.stacks[s.id];
          s.bet = 0;
          s.acting = false;
          s.tell = null;
          s.won = e.pots.reduce((a, pot) => a + (pot.won[s.id] ?? 0), 0);
        }
        // the pot stays on show while it's paid out; the next hand_start clears it
        break;
    }
  }

  private updateDerived(state: HandState) {
    const V = this.view;
    const me = V.seats.find((s) => s.id === YOU)!;
    V.handName = me.cards && me.cards[0] !== null && V.board.length >= 3
      ? this.narrator.handName(me.cards as Card[], V.board) : null;
    const stacks = V.seats.filter((s) => s.out === null).map((s) => s.stack + s.bet);
    const avg = stacks.reduce((a, b) => a + b, 0) / Math.max(1, stacks.length);
    V.tension = {
      pot: state.done ? 0 : V.pot / Math.max(1, avg),
      allIn: V.seats.some((s) => s.allIn && s.cards !== null) && !state.done,
      yourTurn: V.prompt.mode === "act",
    };
  }
}
