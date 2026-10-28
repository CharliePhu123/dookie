import type { Variant } from "@/engine/variant";
import { AdaptiveBot } from "./adaptive";
import type { Bot, BotOptions } from "./bot";
import { CallingStation, Exploiter, Maniac, Nit, RandomBot, SimpleEquityBot } from "./sparring";

export type { Bot, BotOptions } from "./bot";
export { AdaptiveBot, ADAPTIVE_DEFAULTS, type AdaptiveParams, type Thought } from "./adaptive";

type BotCtor = new (v: Variant, o?: BotOptions) => Bot;

export const BOT_KINDS: Record<"adaptive" | "simple" | "station" | "maniac" | "nit" | "random" | "exploiter", BotCtor> = {
  adaptive: AdaptiveBot,
  simple: SimpleEquityBot,
  station: CallingStation,
  maniac: Maniac,
  nit: Nit,
  random: RandomBot,
  exploiter: Exploiter,
};
export type BotKind = keyof typeof BOT_KINDS;

/**
 * Build a bot from a spec like "adaptive" or "adaptive:bet_rel=1.0;margin=0", the same
 * syntax as run_match.py --players.
 */
export function makeBot(spec: string, v: Variant, o: BotOptions = {}): Bot {
  const [kind, kv] = spec.split(":", 2);
  const ctor = BOT_KINDS[kind as BotKind];
  if (!ctor) throw new Error(`unknown bot "${kind}"; try ${Object.keys(BOT_KINDS).join(", ")}`);
  const params = { ...(o.params ?? {}) };
  if (kv) {
    for (const pair of kv.split(";")) {
      const [k, x] = pair.split("=");
      params[k.trim()] = Number(x);
    }
  }
  return new ctor(v, { ...o, params });
}
