// Everything that differs between variants. Mirrors pokerbot/variant.py.
import { RANKS, SUITS, type Card } from "./cards";

export interface Variant {
  name: string;
  holeCards: number;
  /** board cards dealt before each betting round; length = number of betting rounds */
  streets: number[];
  ranks: string;
  suits: string;
  /** Omaha = 2; null = any 5 of hole + board */
  mustUseHole: number | null;
  flushBeatsFullHouse: boolean;
  tripsBeatsStraight: boolean;
  aceLowStraights: boolean;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingStack: number;
  potLimit: boolean;
}

const HOLDEM: Variant = {
  name: "holdem",
  holeCards: 2,
  streets: [0, 3, 1, 1],
  ranks: RANKS,
  suits: SUITS,
  mustUseHole: null,
  flushBeatsFullHouse: false,
  tripsBeatsStraight: false,
  aceLowStraights: true,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  startingStack: 200,
  potLimit: false,
};

export const PRESETS: Record<string, Variant> = {
  holdem: HOLDEM,
  shortdeck: { ...HOLDEM, name: "shortdeck", ranks: "6789TJQKA", flushBeatsFullHouse: true, tripsBeatsStraight: true, ante: 1 },
  omaha: { ...HOLDEM, name: "omaha", holeCards: 4, mustUseHole: 2 },
  plo: { ...HOLDEM, name: "plo", holeCards: 4, mustUseHole: 2, potLimit: true },
  "3card": { ...HOLDEM, name: "3card", holeCards: 3 },
  royal: { ...HOLDEM, name: "royal", ranks: "TJQKA" },
  bigboard: { ...HOLDEM, name: "bigboard", streets: [0, 3, 1, 1, 1] },
};

export const boardSize = (v: Variant) => v.streets.reduce((a, b) => a + b, 0);
export const numStreets = (v: Variant) => v.streets.length;

export function deck(v: Variant): Card[] {
  const out: Card[] = [];
  for (const r of v.ranks) for (const s of v.suits) out.push(RANKS.indexOf(r) * 4 + SUITS.indexOf(s));
  return out;
}
