// A sitting at the table: who's playing, their chips between hands, the button, rebuys.
// It runs one hand at a time, asking the bots (through the worker) and the human (through
// a promise) for decisions, and hands every step's events to a Presenter that paces them.
import type { Mood } from "@/bots/bot";
import type { ModelJSON } from "@/bots/opponents";
import type { HandEvent } from "@/engine/events";
import type { Action, GameState } from "@/engine/game";
import { Rng } from "@/engine/rng";
import { STANDARD_RULES, apply, decision, shuffledDeck, startHand, type HandState } from "@/engine/table";
import { PRESETS, type Variant } from "@/engine/variant";
import type { BotClient } from "@/worker/client";

export const YOU = "you";

export interface SessionConfig {
  variant: string;
  /** bot kinds, which are also creature keys: adaptive, simple, maniac, nit, station, exploiter, random */
  opponents: string[];
  smallBlind: number;
  bigBlind: number;
  stack: number;
  seed: string;
}

export const DEFAULT_CONFIG: SessionConfig = {
  variant: "holdem",
  opponents: ["adaptive", "simple", "maniac", "nit", "station"],
  smallBlind: 50,
  bigBlind: 100,
  stack: 10_000,
  seed: "",
};

export interface SessionSave {
  config: SessionConfig;
  bank: Record<string, number>;
  buyins: Record<string, number>;
  handNo: number;
  rng: number[];
  /** AdaptiveBot models by seat id: what the Seer has learned about you */
  models: Record<string, ModelJSON>;
}

export interface Presenter {
  /** Show these events (animate, log, pace); resolve when it's time to move on. */
  present(events: HandEvent[], state: HandState): Promise<void>;
  /** A bot is about to think; resolve after the minimum time it should look like it's thinking. */
  think(id: string): Promise<void>;
  /** A line for the log that isn't an engine event (rebuys and the like). */
  note(markup: string): void;
  /** Each live creature's true hand strength (0..1), after the deal and each street: for tells. */
  strengths?(s: Record<string, number>): void;
}

export type HumanInput = (g: GameState) => Promise<Action>;

export function variantFor(c: SessionConfig): Variant {
  const base = PRESETS[c.variant] ?? PRESETS.holdem;
  return {
    ...base, smallBlind: c.smallBlind, bigBlind: c.bigBlind, startingStack: c.stack,
    ante: base.ante ? Math.max(1, Math.floor(c.bigBlind / 4)) : 0,
  };
}

/** Creature key for a seat id: "maniac#2" -> "maniac". */
export const kindOf = (id: string) => (id === YOU ? YOU : id.split("#")[0]);

export class Session {
  readonly config: SessionConfig;
  readonly v: Variant;
  /** seat order around the table; ids[0] is you */
  readonly ids: string[];
  bank: Record<string, number>;
  buyins: Record<string, number>;
  handNo: number;
  state: HandState | null = null;
  private rng: Rng;

  constructor(config: SessionConfig, private bots: BotClient, saved?: SessionSave) {
    const seed = config.seed || String(Date.now());
    this.config = config = { ...config, seed };
    this.v = variantFor(config);
    this.ids = [YOU, ...config.opponents.map((k, i) => (config.opponents.indexOf(k) === i ? k : `${k}#${i + 1}`))];
    this.rng = new Rng(seed);
    if (saved?.rng) this.rng.restore(saved.rng);
    this.bank = saved?.bank ?? Object.fromEntries(this.ids.map((p) => [p, config.stack]));
    this.buyins = saved?.buyins ?? Object.fromEntries(this.ids.map((p) => [p, 1]));
    this.handNo = saved?.handNo ?? 0;
    const seeds = new Rng(`${seed}/bots`);
    bots.init(this.v, this.ids.filter((p) => p !== YOU).map((id) => ({
      id, spec: kindOf(id), seed: seeds.next(), model: saved?.models?.[id],
    })));
  }

  /** Your result so far, counting every buy-in. */
  net(id = YOU): number {
    return this.bank[id] - this.config.stack * this.buyins[id];
  }

  /** Rebuy anyone who can't cover the big blind; returns who did. */
  private rebuys(): string[] {
    const out: string[] = [];
    for (const p of this.ids) {
      if (this.bank[p] < this.v.bigBlind) {
        this.bank[p] += this.config.stack;
        this.buyins[p] += 1;
        out.push(p);
      }
    }
    return out;
  }

  /** Play one hand to the end. The button moves one seat each hand. */
  async playHand(show: Presenter, human: HumanInput, onRebuy?: (id: string) => void): Promise<HandState> {
    for (const p of this.rebuys()) onRebuy?.(p);
    const n = this.ids.length;
    const b = this.handNo % n;
    const seats = [...this.ids.slice(b), ...this.ids.slice(0, b)];
    let step = startHand({
      variant: this.v, seats, stacks: { ...this.bank }, deck: shuffledDeck(this.v, this.rng),
      handId: this.handNo, rules: STANDARD_RULES,
    });
    for (const p of seats) if (p !== YOU) this.bots.deal(p, step.state.hole[p]);
    this.state = step.state;
    this.bots.observe(step.events);
    await show.present(step.events, step.state);
    await this.readTells(show, step.events);
    while (!step.state.done) {
      const g = decision(step.state)!;
      let action: Action;
      if (g.me === YOU) {
        action = await human(g);
      } else {
        const [reply] = await Promise.all([this.bots.act(g), show.think(g.me)]);
        action = reply.action;
      }
      step = apply(step.state, action);
      this.state = step.state;
      this.bots.observe(step.events);
      await show.present(step.events, step.state);
      if (!step.state.done) await this.readTells(show, step.events);
    }
    this.bank = { ...this.bank, ...step.state.stacks };
    this.handNo++;
    return step.state;
  }

  private async readTells(show: Presenter, events: HandEvent[]) {
    if (show.strengths && events.some((e) => e.type === "deal" || e.type === "street")) show.strengths(await this.bots.strength());
  }

  /** Change how a creature feels, and so how its bot plays. */
  setMood(id: string, mood: Mood | null) {
    this.bots.mood(id, mood);
  }

  async save(): Promise<SessionSave> {
    return {
      config: this.config, bank: this.bank, buyins: this.buyins, handNo: this.handNo,
      rng: this.rng.state(), models: await this.bots.save(),
    };
  }
}
