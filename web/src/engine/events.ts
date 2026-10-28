// What happens during a hand, as a stream of events. Same shape as the events
// pokerbot/engine.py broadcasts (keys camelCased); the renderer animates from them and
// bots learn from them. Fields marked TS-only have no Python counterpart.
import type { Card } from "./cards";
import type { ActionKind } from "./game";

export type Chips = Record<string, number>;

export interface Pot {
  amount: number;
  /** players who could win this pot */
  eligible: string[];
  /** who won it and how much each got */
  won: Chips;
}

export type HandEvent =
  | { type: "hand_start"; handId: number; players: string[]; button: string; numStreets: number }
  /** TS-only: everyone has been dealt `holeCards` cards (the cards themselves stay private) */
  | { type: "deal"; holeCards: number }
  | { type: "blinds"; sb: string; bb: string; stacks: Chips; bets: Chips; pot: number }
  | { type: "street"; street: number; board: Card[] }
  | {
    type: "action"; player: string; street: number; action: ActionKind; amount: number;
    toCall: number; pot: number; allIn: boolean; stacks: Chips; bets: Chips; potAfter: number;
  }
  | { type: "showdown"; board: Card[]; hands: Record<string, Card[]>; winners: string[] }
  /** `stacks`, `winners` and `pots` are TS-only */
  | { type: "hand_end"; deltas: Chips; stacks: Chips; winners: string[]; pots: Pot[] };

export type EventOf<T extends HandEvent["type"]> = Extract<HandEvent, { type: T }>;
