"use client";

// Bots play each other through the Web Worker, to check it bundles and keeps up in a real browser.
import { useEffect, useState } from "react";
import { Rng } from "@/engine/rng";
import { apply, decision, shuffledDeck, startHand } from "@/engine/table";
import { PRESETS } from "@/engine/variant";
import { BotClient } from "@/worker/client";

const PLAYERS = ["adaptive", "simple", "nit", "maniac", "station", "exploiter"];
const HANDS = 60;

interface Status {
  hands: number;
  decisions: number;
  slowestMs: number;
  totalMs: number;
  chips: Record<string, number>;
  worker: boolean;
}

export default function BotLab() {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    let live = true;
    const v = PRESETS.holdem;
    const rng = new Rng("lab");
    const bots = BotClient.create();
    bots.init(v, PLAYERS.map((id, i) => ({ id, spec: id, seed: i })));
    const s: Status = { hands: 0, decisions: 0, slowestMs: 0, totalMs: 0, chips: Object.fromEntries(PLAYERS.map((p) => [p, 0])), worker: typeof Worker !== "undefined" };
    (async () => {
      for (let h = 0; h < HANDS && live; h++) {
        let step = startHand({ variant: v, seats: rng.shuffle(PLAYERS.slice()), deck: shuffledDeck(v, rng), handId: h });
        for (const p of step.state.seats) bots.deal(p, step.state.hole[p]);
        bots.observe(step.events);
        while (!step.state.done) {
          const reply = await bots.act(decision(step.state)!);
          s.decisions++;
          s.totalMs += reply.ms;
          s.slowestMs = Math.max(s.slowestMs, reply.ms);
          step = apply(step.state, reply.action);
          bots.observe(step.events);
        }
        const end = step.state.history[step.state.history.length - 1];
        if (end.type === "hand_end") for (const [p, d] of Object.entries(end.deltas)) s.chips[p] += d;
        s.hands = h + 1;
        if (live) setSt({ ...s, chips: { ...s.chips } });
      }
    })();
    return () => { live = false; bots.close(); };
  }, []);

  return (
    <pre data-testid="lab" data-hands={st?.hands ?? 0} style={{ padding: 16, fontFamily: "monospace", lineHeight: 1.4 }}>
      {st ? [
        `bot lab · ${st.worker ? "web worker" : "in-process"} · ${st.hands}/${HANDS} hands · ${st.decisions} decisions`,
        `think time: avg ${(st.totalMs / Math.max(1, st.decisions)).toFixed(1)} ms, slowest ${st.slowestMs.toFixed(0)} ms`,
        "",
        ...Object.entries(st.chips).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p.padEnd(12)}${String(c).padStart(8)}`),
      ].join("\n") : "starting..."}
    </pre>
  );
}
