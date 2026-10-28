"use client";

import { useEffect, useRef } from "react";
import { worldFontSize, type Layout } from "@/render/layout";
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
 * Two canvases: a one-pixel-per-cell glow stretched smooth by CSS, and the glyphs above it.
 */
export default function WorldCanvas({ layout, mood, fontFamily }: { layout: Layout; mood: Mood; fontFamily: string }) {
  const glowRef = useRef<HTMLCanvasElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    const canvas = ref.current!, glow = glowRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(layout.W * dpr);
    canvas.height = Math.round(layout.H * dpr);
    canvas.style.width = `${layout.W}px`;
    canvas.style.height = `${layout.H}px`;
    glow.style.width = `${layout.cols * layout.cell.w}px`;
    glow.style.height = `${layout.rows * layout.cell.h}px`;
    const ctx = canvas.getContext("2d")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, stopped = false, last = -1;
    const start = performance.now();
    const times: { step: number; paint: number; cells: number }[] = (window.__worldTimes = []);

    document.fonts.ready.then(() => {
      if (stopped) return;
      const world = new World(layout);
      const painter = new WorldPainter(glow, ctx, world, fontFamily, dpr, worldFontSize(layout.W));
      window.__atlas = () => painter.atlasInfo;
      const tick = (t: number) => {
        const t0 = performance.now();
        world.step(t, moodRef.current);
        const t1 = performance.now();
        painter.paint();
        if (times.length < 600) times.push({ step: t1 - t0, paint: performance.now() - t1, cells: painter.lastCells });
      };
      if (motion.matches) { tick(0); return; }   // reduced motion: one still frame
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
  }, [layout, fontFamily]);

  return (
    <>
      <canvas ref={glowRef} className="world glow" aria-hidden="true" />
      <canvas ref={ref} className="world" aria-hidden="true" />
    </>
  );
}
