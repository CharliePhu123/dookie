// A tournament at the table: who's playing, their chips between hands, the button, who's
// out. No rebuys: bust and you're out, and the last one with chips wins.
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
  smallBlind: 5,
  bigBlind: 10,
  stack: 1_000,
  seed: "",
};

export interface SessionSave {
  config: SessionConfig;
  bank: Record<string, number>;
  /** finishing place of everyone who's out: 6 = first out of 6 */
  out: Record<string, number>;
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
  /** A line for the log that isn't an engine event (eliminations and the like). */
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
  out: Record<string, number>;
  handNo: number;
  state: HandState | null = null;
  private rng: Rng;

  /** `saved` resumes a tournament; just `models` starts a new one with the Seer's memory. */
  constructor(config: SessionConfig, private bots: BotClient, saved?: Partial<SessionSave>) {
    const seed = config.seed || String(Date.now());
    this.config = config = { ...config, seed };
    this.v = variantFor(config);
    this.ids = [YOU, ...config.opponents.map((k, i) => (config.opponents.indexOf(k) === i ? k : `${k}#${i + 1}`))];
    this.rng = new Rng(seed);
    if (saved?.rng) this.rng.restore(saved.rng);
    this.bank = saved?.bank ?? Object.fromEntries(this.ids.map((p) => [p, config.stack]));
    this.out = saved?.out ?? {};
    this.handNo = saved?.handNo ?? 0;
    const seeds = new Rng(`${seed}/bots`);
    bots.init(this.v, this.ids.filter((p) => p !== YOU).map((id) => ({
      id, spec: kindOf(id), seed: seeds.next(), model: saved?.models?.[id],
    })));
  }

  /** Your result so far against the one buy-in. */
  net(id = YOU): number {
    return this.bank[id] - this.config.stack;
  }

  /** Everyone still in, in seat order. */
  alive(): string[] {
    return this.ids.filter((p) => !(p in this.out));
  }

  /** You're out, or you're the last one standing. */
  get over(): boolean {
    return YOU in this.out || this.alive().length < 2;
  }

  /** Play one hand to the end. The button moves one seat each hand, skipping empty seats. */
  async playHand(show: Presenter, human: HumanInput, onOut?: (id: string, place: number) => void): Promise<HandState> {
    const n = this.ids.length;
    let b = this.handNo % n;
    while (this.ids[b] in this.out) b = (b + 1) % n;
    const live = this.alive();
    const at = live.indexOf(this.ids[b]);
    const seats = [...live.slice(at), ...live.slice(0, at)];
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
    // whoever started the hand with fewer chips finishes lower
    const busted = seats.filter((p) => this.bank[p] === 0).sort((a, c) => step.state.startStacks[a] - step.state.startStacks[c]);
    let place = live.length;
    for (const p of busted) {
      this.out[p] = place--;
      onOut?.(p, this.out[p]);
    }
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
      config: this.config, bank: this.bank, out: this.out, handNo: this.handNo,
      rng: this.rng.state(), models: await this.bots.save(),
    };
  }
}
