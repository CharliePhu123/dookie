// The game's handle on the bots. Promise-based: `await bots.act(state)`. Runs them in a Web
// Worker in the browser, or in-process (tests, or browsers without Workers).
import type { Thought } from "@/bots/adaptive";
import type { Mood } from "@/bots/bot";
import type { ModelJSON } from "@/bots/opponents";
import type { Card } from "@/engine/cards";
import type { HandEvent } from "@/engine/events";
import { CHECK, FOLD, type Action, type GameState } from "@/engine/game";
import type { Variant } from "@/engine/variant";
import { BotHost } from "./host";
import type { FromWorker, SeatSpec, ToWorker } from "./protocol";

export interface BotReply {
  action: Action;
  /** time the bot spent thinking, in ms */
  ms: number;
  thought: Thought | null;
}

interface Transport {
  send(m: ToWorker): void;
  onReply: (m: FromWorker) => void;
  close(): void;
}

function workerTransport(): Transport {
  const w = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
  const t: Transport = {
    send: (m) => w.postMessage(m),
    onReply: () => {},
    close: () => w.terminate(),
  };
  w.onmessage = (e: MessageEvent<FromWorker>) => t.onReply(e.data);
  w.onerror = (e) => t.onReply({ type: "error", reqId: null, message: e.message });
  return t;
}

function inlineTransport(): Transport {
  const host = new BotHost();
  const t: Transport = {
    send: (m) => queueMicrotask(() => {
      const r = host.handle(m);
      if (r) t.onReply(r);
    }),
    onReply: () => {},
    close: () => {},
  };
  return t;
}

export class BotClient {
  private nextId = 1;
  private pending = new Map<number, (m: FromWorker) => void>();

  private constructor(private t: Transport, private timeoutMs: number) {
    t.onReply = (m) => {
      if (m.type === "error") console.error("bot worker:", m.message);
      const done = m.reqId !== null ? this.pending.get(m.reqId) : undefined;
      if (done && m.reqId !== null) {
        this.pending.delete(m.reqId);
        done(m);
      }
    };
  }

  /** Bots in a Web Worker when available, otherwise in-process. */
  static create({ inline = false, timeoutMs = 4000 } = {}): BotClient {
    const useWorker = !inline && typeof Worker !== "undefined";
    return new BotClient(useWorker ? workerTransport() : inlineTransport(), timeoutMs);
  }

  init(variant: Variant, seats: SeatSpec[]) {
    this.t.send({ type: "init", variant, seats });
  }

  deal(id: string, hole: Card[]) {
    this.t.send({ type: "deal", id, hole });
  }

  /** Every event of every hand, in order, so the bots' models stay current. */
  observe(events: HandEvent[]) {
    if (events.length) this.t.send({ type: "observe", events });
  }

  /** Ask the bot in `state.me` for its action. Never rejects: a stuck bot checks or folds. */
  act(state: GameState): Promise<BotReply> {
    const fallback: BotReply = { action: state.toCall ? FOLD : CHECK, ms: this.timeoutMs, thought: null };
    return this.request<BotReply>({ type: "act", reqId: 0, state }, (m) =>
      m.type === "action" ? { action: m.action, ms: m.ms, thought: m.thought } : fallback, fallback);
  }

  /** Change how a creature feels (and so how it plays). */
  mood(id: string, mood: Mood | null) {
    this.t.send({ type: "mood", id, mood });
  }

  /** Each live bot's hand strength right now, 0..1 (preflop percentile, then equity vs one random hand). */
  strength(): Promise<Record<string, number>> {
    return this.request({ type: "strength", reqId: 0 }, (m) => (m.type === "strength" ? m.strength : {}), {});
  }

  /** The AdaptiveBots' opponent models, to persist. */
  save(): Promise<Record<string, ModelJSON>> {
    return this.request({ type: "save", reqId: 0 }, (m) => (m.type === "saved" ? m.models : {}), {});
  }

  close() {
    this.t.close();
    this.pending.clear();
  }

  private request<T>(m: Extract<ToWorker, { reqId: number }>, read: (m: FromWorker) => T, fallback: T): Promise<T> {
    const reqId = this.nextId++;
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve(fallback);
      }, this.timeoutMs);
      this.pending.set(reqId, (reply) => {
        clearTimeout(timer);
        resolve(read(reply));
      });
      this.t.send({ ...m, reqId });
    });
  }
}
