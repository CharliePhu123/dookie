// What the table screen shows: everything the engine (phase 4) hands the renderer.
import type { Card } from "@/engine/cards";
import type { Creature } from "@/game/creatures";
import type { FxEvent } from "@/game/fx";
import { Q, type ColorCode } from "./palette";
import type { Mood } from "./world";

export interface SeatView {
  creature: Creature;
  stack: number;
  bet: number;
  /** null = folded; card values or null entries for face-down cards */
  cards: (Card | null)[] | null;
  dealer: boolean;
  acting: boolean;
  allIn: boolean;
  /** chips won this hand, shown when the pot is pushed */
  won?: number;
  /** a tell: a tiny idle animation that leaks hand strength, e.g. "drool" for the gnashback */
  tell?: string | null;
  /** "tilted" | "heater" | "wary" | "short": a status mark over the creature */
  mood?: string | null;
  /** finishing place once out of the tournament; the seat goes dark */
  out?: number | null;
}

export interface ReadView {
  vpip: number;
  pfr: number;
  foldToBet: number;
  stab: number;
  bluff: number;
}

/** The typed-command prompt, like play.py. Strings may use {{X|markup}}. */
export interface PromptView {
  info: string;            // "YOUR MOVE  pot 1,040 · to call 320 · stack 9,900"
  options: string;         // items separated by two spaces: "[f]old  [c]all 320  ..."
  input: string;           // what you've typed so far
  feedback: string | null; // error or odds output under the prompt
  active: boolean;         // your turn; false shows "[enter] next hand"
  /** "wait" while someone else acts: shows `info` ("waiting on the Seer...") and what you've typed ahead */
  mode?: "act" | "next" | "wait";
}

/** play.py's action grid: rows = players, columns = streets, cells = action codes. */
export interface LedgerView {
  streets: string[];       // e.g. ["PRE", "FLOP", "TURN", "RIVER", "SHOW"]
  rows: { name: string; glyph: string; color: number; cells: string[][] }[];
}

export interface TableView {
  place: string;
  handNo: number;
  blinds: [number, number];
  street: string;
  board: Card[];
  boardSize: number;
  pot: number;           // chips in the middle from earlier streets
  seats: SeatView[];     // seat 0 is you, at the bottom
  log: string[];         // markup strings, newest last
  read: ReadView | null;
  session: number;
  handName?: string;     // your best hand so far, in words
  toCall?: number;
  prompt: PromptView;
  ledger: LedgerView;
  /** override the mood the world derives from the view */
  mood?: Partial<Mood>;
  /** animation and sound cues, oldest first (see game/fx.ts); animate the ones you haven't seen */
  fx?: FxEvent[];
  /** display settings from typed commands */
  settings?: { crt: boolean };
}

export const LEDGER_LEGEND = "b blind  X check  C call  B bet  R raise  A all-in  F fold  W win";

/** How tense the room should feel, from the state of the hand. */
export function moodFromView(v: TableView): Mood {
  const inPlay = v.pot + v.seats.reduce((n, s) => n + s.bet, 0);
  const live = v.seats.filter((s) => s.cards !== null);
  const avgStack = live.length ? live.reduce((n, s) => n + s.stack + s.bet, 0) / live.length : 1;
  const acting = v.seats.findIndex((s) => s.acting);
  return {
    tension: Math.min(1, (inPlay / (inPlay + avgStack)) * 1.6),
    allIn: live.some((s) => s.allIn),
    yourTurn: v.prompt.active && (acting === 0 || acting === -1),
    acting: acting >= 0 ? acting : null,
    actingColor: acting >= 0 ? v.seats[acting].creature.color : 0,
    ...v.mood,
  };
}

// As text on the dark background, the two darkest palette entries are lifted so they read.
const TEXT: Partial<Record<ColorCode, number>> = { k: 0x3a625f, K: 0x6b918b };

export type Seg = { text: string; fg: number | null };

/** Qud-style markup: "You fold. {{M|The Seer}} notes it." -> coloured segments (null = default). */
export function markup(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /\{\{([A-Za-z])\|([^}]*)\}\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), fg: null });
    const code = m[1] as ColorCode;
    out.push({ text: m[2], fg: TEXT[code] ?? Q[code] ?? null });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), fg: null });
  return out;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
export function ordinal(n: number): string {
  const tens = n % 100, ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
