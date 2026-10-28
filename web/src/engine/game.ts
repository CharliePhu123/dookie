// The bot <-> engine contract. Mirrors pokerbot/game.py: the engine hands a bot (or the
// human's UI) a GameState and gets an Action back.
import type { Card } from "./cards";
import type { Variant } from "./variant";
import type { HandEvent } from "./events";

export type ActionKind = "fold" | "check" | "call" | "raise";

export interface Action {
  kind: ActionKind;
  /** for raise: the TOTAL street bet you are raising TO */
  amount: number;
}

export const FOLD: Action = { kind: "fold", amount: 0 };
export const CHECK: Action = { kind: "check", amount: 0 };
export const CALL: Action = { kind: "call", amount: 0 };
export const raise = (to: number): Action => ({ kind: "raise", amount: Math.floor(to) });
export const actionStr = (a: Action) => (a.kind === "raise" ? `raise ${a.amount}` : a.kind);

export interface PlayerView {
  id: string;
  /** chips behind */
  stack: number;
  streetBet: number;
  totalIn: number;
  folded: boolean;
  allIn: boolean;
}

export interface GameState {
  variant: Variant;
  handId: number;
  me: string;
  hole: readonly Card[];
  board: readonly Card[];
  street: number;
  /** everything in the middle, including this street's bets */
  pot: number;
  /** already capped at my stack */
  toCall: number;
  currentBet: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  myStack: number;
  myStreetBet: number;
  /** in seat order, seat 0 = button */
  players: PlayerView[];
  history: readonly HandEvent[];
}

export const canCheck = (s: GameState) => s.toCall === 0;
export const canRaise = (s: GameState) => s.maxRaiseTo > s.currentBet && s.myStack > s.toCall;
export const liveOpponents = (s: GameState) => s.players.filter((p) => !p.folded && p.id !== s.me);

/** A raise clamped to the legal range; falls back to call/check when raising isn't allowed. */
export function raiseTo(s: GameState, amount: number): Action {
  if (!canRaise(s)) return s.toCall ? CALL : CHECK;
  return raise(Math.min(s.maxRaiseTo, Math.max(s.minRaiseTo, amount)));
}
