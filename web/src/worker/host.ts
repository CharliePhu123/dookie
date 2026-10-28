// The bot side of the protocol, independent of where it runs: the Web Worker wraps it,
// and tests (or a no-Worker fallback) call it directly.
import { AdaptiveBot } from "@/bots/adaptive";
import type { Bot } from "@/bots/bot";
import { makeBot } from "@/bots/index";
import type { Card } from "@/engine/cards";
import { EquityEngine, anyRange } from "@/engine/equity";
import { CHECK, FOLD } from "@/engine/game";
import { Rng } from "@/engine/rng";
import type { Variant } from "@/engine/variant";
import type { FromWorker, ToWorker } from "./protocol";

export class BotHost {
  private bots = new Map<string, Bot>();
  /** for tells: everyone's hole cards and the board, and an engine to rate them */
  private holes = new Map<string, Card[]>();
  private board: Card[] = [];
  private folded = new Set<string>();
  private variant: Variant | null = null;
  private eq: EquityEngine | null = null;

  handle(m: ToWorker): FromWorker | null {
    switch (m.type) {
      case "init": {
        this.bots.clear();
        this.variant = m.variant;
        this.eq = null;
        for (const s of m.seats) {
          const bot = makeBot(s.spec, m.variant, { rng: new Rng(s.seed), iters: s.iters, timeLimit: s.timeLimit });
          if (s.model && bot instanceof AdaptiveBot) bot.model.load(s.model);
          this.bots.set(s.id, bot);
        }
        return null;
      }
      case "deal":
        this.bots.get(m.id)?.onDeal?.(m.hole);
        this.holes.set(m.id, m.hole);
        return null;
      case "observe":
        for (const e of m.events) {
          for (const b of this.bots.values()) b.observe?.(e);
          if (e.type === "hand_start") { this.holes.clear(); this.board = []; this.folded.clear(); }
          else if (e.type === "street") this.board = e.board;
          else if (e.type === "action" && e.action === "fold") this.folded.add(e.player);
        }
        return null;
      case "mood":
        this.bots.get(m.id)?.setMood?.(m.mood);
        return null;
      case "strength": {
        const strength: Record<string, number> = {};
        if (this.variant) {
          this.eq ??= new EquityEngine(this.variant, undefined, new Rng("tells"));
          for (const [id, hole] of this.holes) {
            if (this.folded.has(id)) continue;
            strength[id] = this.board.length ? this.eq.equity(hole, this.board, [anyRange()], 200) : this.eq.percentile(hole);
          }
        }
        return { type: "strength", reqId: m.reqId, strength };
      }
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
