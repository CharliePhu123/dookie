// Turns engine events into what's on screen: a GameView the renderer draws every frame, log
// lines in the game's voice, the ledger, and the pacing between beats (a bot "thinking", the
// pause after the flop, the beat before the pot is pushed). Speed 0 means instant.
import { OpponentModel, type ModelJSON } from "@/bots/opponents";
import type { Card } from "@/engine/cards";
import type { HandEvent } from "@/engine/events";
import { Rng } from "@/engine/rng";
import type { HandState } from "@/engine/table";
import { boardSize, type Variant } from "@/engine/variant";
import { LedgerBuilder, type Ledger } from "./ledger";
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
  /** your result this session, counting buy-ins */
  session: number;
  /** your best hand right now, in words */
  handName: string | null;
  /** what you'd have to call, while it's your decision */
  toCall: number;
  /** drives tension lighting: pot relative to the average stack, anyone all in, your turn */
  tension: { pot: number; allIn: boolean; yourTurn: boolean };
}

/** Milliseconds at 1x speed. */
const BEATS = {
  hand_start: 250, deal: 450, blinds: 250, street: 750, botAction: 450, yourAction: 120,
  showdown: 1400, hand_end: 1100, thinkMin: 450, thinkMax: 1000,
};

const LOG_KEEP = 200;

export class Director implements Presenter {
  view: GameView;
  /** 1 = normal, 2 or 4 = faster, 0 = instant */
  speed = 1;
  readonly narrator: Narrator;
  private ledger = new LedgerBuilder();
  private flavor: Rng;
  private wake: (() => void) | null = null;

  constructor(private v: Variant, private ids: string[], seed: string, private onChange: () => void = () => {}) {
    this.flavor = new Rng(`${seed}/flavor`);
    this.narrator = new Narrator(v, Object.fromEntries(ids.map((p) => [p, kindOf(p)])), YOU, this.flavor);
    this.view = {
      handNo: 0, blinds: [v.smallBlind, v.bigBlind], street: "", board: [], boardSize: boardSize(v), pot: 0,
      seats: ids.map((id) => ({ id, kind: kindOf(id), stack: v.startingStack, bet: 0, cards: null, dealer: false, acting: false, allIn: false, won: 0 })),
      log: [], ledger: this.ledger.ledger,
      prompt: { mode: "wait", info: "", options: "", input: "", feedback: null },
      read: null, session: 0, handName: null, toCall: 0, tension: { pot: 0, allIn: false, yourTurn: false },
    };
  }

  private seat(id: string) {
    return this.view.seats.find((s) => s.id === id)!;
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
    this.changed();
    await this.sleep(BEATS.thinkMin + this.flavor.random() * (BEATS.thinkMax - BEATS.thinkMin));
  }

  setStacks(bank: Record<string, number>) {
    for (const s of this.view.seats) s.stack = bank[s.id] ?? s.stack;
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

  async present(events: HandEvent[], state: HandState): Promise<void> {
    for (const e of events) {
      this.apply(e, state);
      this.ledger.observe(e);
      this.view.ledger = this.ledger.ledger;
      const lines = this.narrator.lines([e]);
      if (lines.length) this.view.log.push(...lines);
      this.updateDerived(state);
      this.changed();
      const beat = e.type === "action" ? (e.player === YOU ? BEATS.yourAction : BEATS.botAction) : BEATS[e.type];
      await this.sleep(beat);
    }
  }

  private apply(e: HandEvent, state: HandState) {
    const V = this.view;
    switch (e.type) {
      case "hand_start":
        V.handNo = e.handId + 1;
        V.street = "PRE";
        V.board = [];
        V.pot = 0;
        for (const s of V.seats) Object.assign(s, { bet: 0, cards: null, dealer: s.id === e.button, acting: false, allIn: false, won: 0 });
        break;
      case "deal":
        for (const s of V.seats) s.cards = s.id === YOU ? state.hole[YOU].slice() : new Array(e.holeCards).fill(null);
        break;
      case "blinds":
        for (const s of V.seats) { s.stack = e.stacks[s.id]; s.bet = e.bets[s.id]; s.allIn = e.stacks[s.id] === 0; }
        V.pot = e.pot;
        break;
      case "street":
        V.board = e.board.slice();
        V.street = this.ledger.ledger.streets[e.street] ?? "";
        for (const s of V.seats) s.bet = 0;
        break;
      case "action": {
        const s = this.seat(e.player);
        for (const q of V.seats) { q.stack = e.stacks[q.id]; q.bet = e.bets[q.id]; }
        s.acting = false;
        s.allIn = e.allIn;
        if (e.action === "fold") s.cards = null;
        V.pot = e.potAfter;
        break;
      }
      case "showdown":
        V.board = e.board.slice();
        V.street = "SHOW";
        for (const [p, hole] of Object.entries(e.hands)) this.seat(p).cards = hole.slice();
        break;
      case "hand_end":
        for (const s of V.seats) {
          s.stack = e.stacks[s.id];
          s.bet = 0;
          s.acting = false;
          s.won = e.pots.reduce((a, pot) => a + (pot.won[s.id] ?? 0), 0);
        }
        V.pot = 0;
        break;
    }
  }

  private updateDerived(state: HandState) {
    const V = this.view;
    const me = V.seats.find((s) => s.id === YOU)!;
    V.handName = me.cards && me.cards[0] !== null && V.board.length >= 3
      ? this.narrator.handName(me.cards as Card[], V.board) : null;
    const stacks = V.seats.map((s) => s.stack + s.bet);
    const avg = stacks.reduce((a, b) => a + b, 0) / Math.max(1, stacks.length);
    V.tension = {
      pot: V.pot / Math.max(1, avg),
      allIn: V.seats.some((s) => s.allIn && s.cards !== null) && !state.done,
      yourTurn: V.prompt.mode === "act",
    };
  }
}
