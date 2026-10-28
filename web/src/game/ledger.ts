// The hand ledger from play.py: one row per player, one column per street (plus SHOW), each
// cell holding that player's actions in short codes. Built incrementally from engine events.
//   b blind · X check · C call · B bet · R raise · A all-in · F fold · W win
import type { HandEvent } from "@/engine/events";
import { short } from "./commands";

export const LEDGER_LEGEND = "b blind  X check  C call  B bet  R raise  A all-in  F fold  W win";

export interface Ledger {
  streets: string[];
  players: string[];
  /** codes[player][street], where the last street is SHOW */
  codes: Record<string, string[][]>;
}

/** PRE FLOP TURN RIVER SHOW; extra streets (big board) go before the river as 4TH, 5TH... */
export function streetNames(numStreets: number): string[] {
  if (numStreets <= 4) return [...["PRE", "FLOP", "TURN", "RIVER"].slice(0, numStreets), "SHOW"];
  const extra = Array.from({ length: numStreets - 4 }, (_, i) => `${i + 4}TH`);
  return ["PRE", "FLOP", "TURN", ...extra, "RIVER", "SHOW"];
}

export class LedgerBuilder {
  ledger: Ledger = { streets: [], players: [], codes: {} };
  private street = 0;
  private streetHasBet = false;

  observe(e: HandEvent) {
    const L = this.ledger;
    switch (e.type) {
      case "hand_start":
        this.ledger = {
          streets: streetNames(e.numStreets),
          players: e.players,
          codes: Object.fromEntries(e.players.map((p) => [p, Array.from({ length: e.numStreets + 1 }, () => [])])),
        };
        this.street = 0;
        this.streetHasBet = false;
        break;
      case "blinds":
        L.codes[e.sb]?.[0].push("b");
        L.codes[e.bb]?.[0].push("b");
        break;
      case "street":
        this.street = e.street;
        this.streetHasBet = false;
        break;
      case "action": {
        let code: string;
        if (e.action === "fold") code = "F";
        else if (e.action === "check") code = "X";
        else if (e.action === "call") code = e.allIn ? "A" : "C";
        else {
          const letter = e.allIn ? "A" : this.street > 0 && !this.streetHasBet ? "B" : "R";
          code = letter + short(e.amount);
          this.streetHasBet = true;
        }
        L.codes[e.player]?.[e.street].push(code);
        break;
      }
      case "hand_end":
        for (const [p, d] of Object.entries(e.deltas)) if (d > 0) L.codes[p]?.[L.streets.length - 1].push(`W+${short(d)}`);
        break;
    }
  }
}
