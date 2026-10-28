"use client";

import { useEffect, useRef, type RefObject } from "react";
import { worldFontSize, type Box, type Layout } from "@/render/layout";
import { WorldPainter } from "@/render/painter";
import { World, type Mood } from "@/render/world";

const STEP = 1 / 20;   // the world updates at 20 Hz

declare global {
  interface Window {
    __worldTimes?: { step: number; paint: number; cells: number }[];
    __atlas?: () => { size: number; resets: number };
  }
}

/**
 * The world layer: the cave as an ASCII shader, filling the window behind the readable layer.
 * Two canvases, both pixel-exact: the per-cell background light, scaled up by whole device
 * pixels with nearest-neighbour sampling, and the glyphs above it. `quiet` holds the boxes of
 * readable text (CSS px) the world keeps clear.
 */
export default function WorldCanvas({ layout, mood, fontFamily, quiet }: {
  layout: Layout; mood: Mood; fontFamily: string; quiet: RefObject<Box[] | null>;
}) {
  const glowRef = useRef<HTMLCanvasElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    const canvas = ref.current!, glow = glowRef.current!;
    const dpr = window.devicePixelRatio || 1;
    // backing stores in whole device pixels, shown at exactly that size
    canvas.width = Math.round(layout.W * dpr);
    canvas.height = Math.round(layout.H * dpr);
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    const cw = Math.round(layout.cell.w * dpr), ch = Math.round(layout.cell.h * dpr);
    glow.style.width = `${(layout.cols * cw) / dpr}px`;
    glow.style.height = `${(layout.rows * ch) / dpr}px`;
    const ctx = canvas.getContext("2d")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, stopped = false, last = -1;
    let applied: Box[] | null = null;
    const start = performance.now();
    const times: { step: number; paint: number; cells: number }[] = (window.__worldTimes = []);

    document.fonts.ready.then(() => {
      if (stopped) return;
      const world = new World(layout);
      const painter = new WorldPainter(glow, ctx, world, fontFamily, dpr, worldFontSize(layout.W));
      window.__atlas = () => painter.atlasInfo;
      const tick = (t: number) => {
        if (quiet.current !== applied) { applied = quiet.current; world.setQuiet(applied ?? []); }
        const t0 = performance.now();
        world.step(t, moodRef.current);
        const t1 = performance.now();
        painter.paint();
        if (times.length < 600) times.push({ step: t1 - t0, paint: performance.now() - t1, cells: painter.lastCells });
      };
      if (motion.matches) {
        // reduced motion: still frames, redrawn only when the text they sit under moves
        const still = () => { if (stopped) return; if (quiet.current !== applied) tick(0); raf = requestAnimationFrame(still); };
        tick(0);
        raf = requestAnimationFrame(still);
        return;
      }
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const t = (now - start) / 1000;
        const n = Math.floor(t / STEP);
        if (n === last) return;
        last = n;
        tick(t);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [layout, fontFamily, quiet]);

  return (
    <>
      <canvas ref={glowRef} className="world glow" aria-hidden="true" />
      <canvas ref={ref} className="world" aria-hidden="true" />
    </>
  );
}
