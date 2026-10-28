// Messages between the game (main thread) and the bots (a Web Worker). The engine stays on
// the main thread; bots and their opponent models live in the worker, see every event, and
// answer decisions.
import type { Card } from "@/engine/cards";
import type { HandEvent } from "@/engine/events";
import type { Action, GameState } from "@/engine/game";
import type { Variant } from "@/engine/variant";
import type { ModelJSON } from "@/bots/opponents";
import type { Thought } from "@/bots/adaptive";

export interface SeatSpec {
  id: string;
  /** a makeBot spec, e.g. "adaptive" or "nit" */
  spec: string;
  seed: number | string;
  /** a saved AdaptiveBot model to restore (the Seer remembers you) */
  model?: ModelJSON;
  iters?: number;
  timeLimit?: number;
}

export type ToWorker =
  | { type: "init"; variant: Variant; seats: SeatSpec[] }
  | { type: "deal"; id: string; hole: Card[] }
  | { type: "observe"; events: HandEvent[] }
  | { type: "act"; reqId: number; state: GameState }
  | { type: "save"; reqId: number };

export type FromWorker =
  | { type: "action"; reqId: number; action: Action; ms: number; thought: Thought | null }
  | { type: "saved"; reqId: number; models: Record<string, ModelJSON> }
  | { type: "error"; reqId: number | null; message: string };
