// The bot side of the protocol, independent of where it runs: the Web Worker wraps it,
// and tests (or a no-Worker fallback) call it directly.
import { AdaptiveBot } from "@/bots/adaptive";
import type { Bot } from "@/bots/bot";
import { makeBot } from "@/bots/index";
import { CHECK, FOLD } from "@/engine/game";
import { Rng } from "@/engine/rng";
import type { FromWorker, ToWorker } from "./protocol";

export class BotHost {
  private bots = new Map<string, Bot>();

  handle(m: ToWorker): FromWorker | null {
    switch (m.type) {
      case "init": {
        this.bots.clear();
        for (const s of m.seats) {
          const bot = makeBot(s.spec, m.variant, { rng: new Rng(s.seed), iters: s.iters, timeLimit: s.timeLimit });
          if (s.model && bot instanceof AdaptiveBot) bot.model.load(s.model);
          this.bots.set(s.id, bot);
        }
        return null;
      }
      case "deal":
        this.bots.get(m.id)?.onDeal?.(m.hole);
        return null;
      case "observe":
        for (const e of m.events) for (const b of this.bots.values()) b.observe?.(e);
        return null;
      case "act": {
        const bot = this.bots.get(m.state.me);
        const t = performance.now();
        if (!bot) return { type: "error", reqId: m.reqId, message: `no bot in seat ${m.state.me}` };
        let action;
        try {
          action = bot.act(m.state);
        } catch (err) {
          action = m.state.toCall ? FOLD : CHECK;
          console.error(err);
        }
        const thought = bot instanceof AdaptiveBot ? bot.lastThought : null;
        return { type: "action", reqId: m.reqId, action, ms: performance.now() - t, thought };
      }
      case "save": {
        const models: Record<string, ReturnType<AdaptiveBot["save"]>> = {};
        for (const [id, b] of this.bots) if (b instanceof AdaptiveBot) models[id] = b.save();
        return { type: "saved", reqId: m.reqId, models };
      }
    }
  }
}
