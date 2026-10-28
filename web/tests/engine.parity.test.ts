// The TS table engine must replay Python's hands exactly: same deck, same requested actions,
// same events and chip deltas. Fixtures come from scripts/make_fixtures.py.
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/engine.json";
import type { HandEvent } from "@/engine/events";
import type { ActionKind } from "@/engine/game";
import { PYTHON_RULES, apply, startHand } from "@/engine/table";
import { PRESETS } from "@/engine/variant";

interface Fixture {
  variant: string;
  seats: string[];
  stacks: Record<string, number>;
  deck: number[];
  handId: number;
  actions: [string, ActionKind, number][];
  events: Record<string, unknown>[];
  deltas: Record<string, number>;
}

/** Only the keys Python's event has, so TS-only extras don't count as differences. */
function project(e: HandEvent, like: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(like).map((k) => [k, (e as unknown as Record<string, unknown>)[k]]));
}

describe("table engine matches pokerbot/engine.py", () => {
  const hands = fixtures as unknown as Fixture[];

  it(`replays ${hands.length} Python hands event for event`, () => {
    for (const h of hands) {
      const ctx = `hand ${h.handId} (${h.variant}, ${h.seats.length} seats)`;
      let step = startHand({
        variant: PRESETS[h.variant], seats: h.seats, stacks: h.stacks, deck: h.deck,
        handId: h.handId, rules: PYTHON_RULES,
      });
      for (const [who, kind, amount] of h.actions) {
        expect(step.state.toAct, ctx).toBe(who);
        step = apply(step.state, { kind, amount });
      }
      expect(step.state.done, ctx).toBe(true);
      const got = step.state.history.filter((e) => e.type !== "deal");
      expect(got.length, ctx).toBe(h.events.length);
      got.forEach((e, i) => expect(project(e, h.events[i]), `${ctx}, event ${i}`).toEqual(h.events[i]));
      const end = got[got.length - 1];
      expect(end.type === "hand_end" && end.deltas, ctx).toEqual(h.deltas);
    }
  });
});
