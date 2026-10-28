// Typed commands, the way play.py takes them: type a letter (and an amount), press Enter.
//   f fold · x check · c call (or check) · r 740 raise to 740 · h half pot · p pot · a all-in · ? odds
import { CATEGORY_NAMES, Evaluator } from "@/engine/evaluator";
import { anyRange, type EquityEngine } from "@/engine/equity";
import {
  CALL, CHECK, FOLD, canRaise, liveOpponents, raise, raiseTo, type Action, type GameState,
} from "@/engine/game";

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** 1,234 -> "1.2k", like play.py's short(). */
export function short(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  return String(n);
}

export type Command =
  | { kind: "action"; action: Action }
  | { kind: "odds" }
  | { kind: "error"; message: string }
  | { kind: "none" };

/** "740", "1,200", "1.5k", "2k" -> chips; NaN if it isn't a number. */
export function parseAmount(s: string): number {
  const t = s.replace(/[,\s]/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)(k?)$/.exec(t);
  if (!m) return NaN;
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
}

/** What a typed line means at this decision. Never returns an illegal action. */
export function parseCommand(raw: string, s: GameState): Command {
  const line = raw.trim().toLowerCase();
  if (!line) return { kind: "none" };
  const m = /^([a-z?]+|\d[\d,.]*k?)\s*(.*)$/.exec(line);
  const cmd = m ? m[1] : line;
  const arg = m ? m[2] : "";
  const word = s.toCall || s.street === 0 ? "raise" : "bet";

  if (cmd === "f" || cmd === "fold") {
    if (!s.toCall) return { kind: "error", message: "nothing to call, so checking is free: type x" };
    return { kind: "action", action: FOLD };
  }
  if (cmd === "x" || cmd === "k" || cmd === "check") {
    if (s.toCall) return { kind: "error", message: `can't check, it's ${fmt(s.toCall)} to call` };
    return { kind: "action", action: CHECK };
  }
  if (cmd === "c" || cmd === "call") return { kind: "action", action: s.toCall ? CALL : CHECK };
  if (["a", "allin", "all-in", "jam", "shove"].includes(cmd)) {
    if (!canRaise(s)) return { kind: "action", action: s.toCall ? CALL : CHECK };
    return { kind: "action", action: raise(s.maxRaiseTo) };
  }
  if (cmd === "h" || cmd === "p") {
    if (!canRaise(s)) return { kind: "error", message: `can't ${word} here` };
    const frac = cmd === "h" ? 0.5 : 1;
    return { kind: "action", action: raiseTo(s, s.myStreetBet + s.toCall + frac * (s.pot + s.toCall)) };
  }
  const numeric = /^\d/.test(cmd);
  if (["r", "b", "raise", "bet"].includes(cmd) || numeric) {
    const amt = parseAmount(numeric ? cmd : arg);
    if (!canRaise(s)) return { kind: "error", message: `can't ${word} here` };
    if (Number.isNaN(amt)) return { kind: "error", message: `e.g. r ${fmt(s.minRaiseTo)}  (${word} TO that much this street)` };
    if (amt < s.minRaiseTo || amt > s.maxRaiseTo) {
      return { kind: "error", message: `${word} must be ${fmt(s.minRaiseTo)}–${fmt(s.maxRaiseTo)}` };
    }
    return { kind: "action", action: raise(amt) };
  }
  if (cmd === "?" || cmd === "odds") return { kind: "odds" };
  return { kind: "error", message: "f fold · x check · c call · r <amt> · h half pot · p pot · a all-in · ? odds" };
}

/** The options line for this decision, with the key letters in gold. */
export function optionsLine(s: GameState): string {
  const k = (key: string) => `{{W|${key}}}`;
  const opts = [`[${k("f")}]old`, s.toCall ? `[${k("c")}]all ${fmt(s.toCall)}` : `[${k("x")}] check`];
  if (canRaise(s)) {
    const word = s.toCall || s.street === 0 ? "raise" : "bet";
    opts.push(`[${k("r")} <amt>] ${word} to ${fmt(s.minRaiseTo)}–${fmt(s.maxRaiseTo)}`);
    opts.push(`[${k("h")}]alf pot`, `[${k("p")}]ot`, `[${k("a")}]ll-in`);
  }
  opts.push(`[${k("?")}] odds`);
  return opts.join("  ");
}

export function infoLine(s: GameState): string {
  return `YOUR MOVE  pot {{W|${fmt(s.pot)}}} · to call {{W|${fmt(s.toCall)}}} · stack {{W|${fmt(s.myStack)}}}`;
}

/** The `?` answer: equity vs random hands, pot odds, and what you have. */
export function oddsText(s: GameState, eq: EquityEngine, ev: Evaluator): string {
  const n = liveOpponents(s).length;
  const e = eq.equity(s.hole, s.board, new Array(n).fill(null).map(anyRange), 3000);
  let msg = `equity vs ${n} random hand${n > 1 ? "s" : ""}: ${Math.round(e * 100)}%`;
  if (s.toCall) msg += ` · you need ${Math.round((100 * s.toCall) / (s.pot + s.toCall))}% to call`;
  if (s.board.length) msg += ` · you have ${CATEGORY_NAMES[ev.category(ev.rank(s.hole, s.board))]}`;
  return msg;
}
