"use client";

// A static hand to show the look: your turn on the turn, facing an all-in, mid-typing a raise.
// Replaced by the live engine in phase 4.
import { cards } from "@/engine/cards";
import { CREATURES } from "@/game/creatures";
import type { TableView } from "@/render/view";
import TableScreen from "./TableScreen";

const C = CREATURES;

const VIEW: TableView = {
  place: "the Salt-Flat Caravanserai",
  handNo: 34,
  blinds: [50, 100],
  street: "TURN",
  board: cards("Ks 7d 2c Qh"),
  boardSize: 5,
  pot: 3450,
  seats: [
    { creature: C.you, stack: 41200, bet: 0, cards: cards("Qs 4s"), dealer: false, acting: true, allIn: false },
    { creature: C.adaptive, stack: 120833, bet: 0, cards: [null, null], dealer: false, acting: false, allIn: false },
    { creature: C.simple, stack: 17233, bet: 0, cards: null, dealer: false, acting: false, allIn: false },
    { creature: C.maniac, stack: 0, bet: 9550, cards: [null, null], dealer: true, acting: false, allIn: true },
    { creature: C.nit, stack: 136256, bet: 0, cards: null, dealer: false, acting: false, allIn: false },
    { creature: C.station, stack: 9100, bet: 9550, cards: [null, null], dealer: false, acting: false, allIn: false },
  ],
  log: [
    "{{K|The salt wind moans down the passage. Someone feeds the braziers.}}",
    "{{K|Hand 34. The gnashback takes the dealer's stone.}}",
    "{{C|The Reckoner}} folds on the flop.",
    "{{w|The hoarding tortoise}} folds, clutching its chips.",
    "{{R|The frothing gnashback}} shoves {{W|9,550}} chips across the felt, frothing.",
    "{{y|The chrome idol}} calls. It always calls.",
  ],
  read: { vpip: 0.3, pfr: 0.05, foldToBet: 0.23, stab: 0.27, bluff: 0.3 },
  session: -4472,
  handName: "a pair of queens",
  toCall: 9550,
  prompt: {
    active: true,
    info: "{{W|YOUR MOVE}}   pot {{Y|22,550}} · to call {{Y|9,550}} · stack {{Y|41,200}}",
    options: "{{W|[f]}}old  {{W|[c]}}all 9,550  {{W|[r <amt>]}} raise to 19,100–41,200  {{W|[h]}}alf pot  {{W|[p]}}ot  {{W|[a]}}ll-in  {{W|[?]}} odds",
    input: "r 25",
    feedback: "{{K|equity vs 3 hands:}} {{Y|31%}} {{K|· you need}} {{Y|30%}} {{K|to call · you have a pair}}",
  },
  ledger: {
    streets: ["PRE", "FLOP", "TURN", "RIVER", "SHOW"],
    rows: [
      { name: "YOU", glyph: C.you.glyph, color: C.you.color, cells: [["C"], ["X", "C"], [], [], []] },
      { name: "SEER", glyph: C.adaptive.glyph, color: C.adaptive.color, cells: [["b", "R300"], ["B400"], ["X"], [], []] },
      { name: "RECKONER", glyph: C.simple.glyph, color: C.simple.color, cells: [["C"], ["F"], [], [], []] },
      { name: "GNASHBACK", glyph: C.maniac.glyph, color: C.maniac.color, cells: [["C"], ["C"], ["A9.6k"], [], []] },
      { name: "TORTOISE", glyph: C.nit.glyph, color: C.nit.color, cells: [["F"], [], [], [], []] },
      { name: "IDOL", glyph: C.station.glyph, color: C.station.color, cells: [["b", "C"], ["C"], ["C"], [], []] },
    ],
  },
};

export default function MockTable({ fontFamily }: { fontFamily: string }) {
  return <TableScreen view={VIEW} fontFamily={fontFamily} />;
}
