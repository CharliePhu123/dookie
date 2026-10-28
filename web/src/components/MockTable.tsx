"use client";

// Phase 0: a static hand to show the look. Replaced by the live engine in phase 4.
import { useCallback, useRef } from "react";
import { cards } from "@/engine/cards";
import { CREATURES } from "@/game/creatures";
import { makeLayout } from "@/render/layout";
import { createScene, drawScene, type Scene, type TableView } from "@/render/scene";
import type { Grid } from "@/render/grid";
import GlyphCanvas from "./GlyphCanvas";

const VIEW: TableView = {
  place: "the Salt-Flat Caravanserai",
  handNo: 34,
  blinds: [50, 100],
  street: "TURN",
  board: cards("Ks 7d 2c Qh"),
  boardSize: 5,
  pot: 3450,
  seats: [
    { creature: CREATURES.you, stack: 5528, bet: 0, cards: cards("Qs 4s"), dealer: false, acting: false, allIn: false },
    { creature: CREATURES.adaptive, stack: 120833, bet: 900, cards: [null, null], dealer: false, acting: true, allIn: false },
    { creature: CREATURES.simple, stack: 17233, bet: 0, cards: null, dealer: false, acting: false, allIn: false },
    { creature: CREATURES.maniac, stack: 0, bet: 9550, cards: [null, null], dealer: true, acting: false, allIn: true },
    { creature: CREATURES.nit, stack: 136256, bet: 0, cards: null, dealer: false, acting: false, allIn: false },
    { creature: CREATURES.station, stack: 9100, bet: 450, cards: [null, null], dealer: false, acting: false, allIn: false },
  ],
  log: [
    "{{K|The salt wind moans down the passage. Someone feeds the braziers.}}",
    "{{K|Hand 34 begins. The gnashback takes the dealer's stone.}}",
    "{{C|The Reckoner}} folds.",
    "{{w|The hoarding tortoise}} folds, clutching its chips.",
    "{{R|The frothing gnashback}} shoves {{W|9,550}} chips across the felt, frothing.",
    "{{y|The chrome idol}} calls. It always calls.",
    "{{M|The Bayesian Seer}} considers you. Its eyes are many.",
  ],
  read: { vpip: 0.3, pfr: 0.05, foldToBet: 0.23, stab: 0.27, bluff: 0.3 },
  session: -4472,
  handName: "a pair of queens",
  prompt: "{{K|waiting on}} {{M|the Seer}}{{K|...}}   {{W|f}} fold  {{W|c}} call  {{W|r}} raise  {{W|a}} all-in  {{W|?}} odds",
};

export default function MockTable({ fontFamily }: { fontFamily: string }) {
  const scene = useRef<Scene | null>(null);
  const draw = useCallback((g: Grid, t: number) => {
    const s = scene.current;
    if (!s || s.layout.cols !== g.cols || s.layout.rows !== g.rows)
      scene.current = createScene(makeLayout(g.cols, g.rows, VIEW.seats.length));
    drawScene(g, VIEW, t, scene.current!);
  }, []);
  return <GlyphCanvas fontFamily={fontFamily} draw={draw} />;
}
