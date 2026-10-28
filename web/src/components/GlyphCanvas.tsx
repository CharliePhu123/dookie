"use client";

import { useEffect, useRef } from "react";
import { measure, Painter, LINE_HEIGHT } from "@/render/canvas";
import { Grid } from "@/render/grid";
import { BG, css } from "@/render/palette";

interface Props {
  fontFamily: string;
  /** called every frame with seconds since mount; draw into the grid (its size follows the window) */
  draw: (grid: Grid, t: number) => void;
}

/** CSS font size for a window: big enough to read, small enough to fit a full table. */
export function pickFontSize(w: number, h: number): number {
  if (w < 700) return Math.max(10, Math.min(14, Math.floor(w / (0.6 * 52))));
  return Math.max(12, Math.min(19, Math.floor(Math.min(w / (0.6 * 120), h / (LINE_HEIGHT * 38)))));
}

/** A canvas glyph grid that covers the whole window, crisp on HiDPI screens. */
export default function GlyphCanvas({ fontFamily, draw }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const painter = new Painter(ctx, fontFamily);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let grid = new Grid(1, 1);
    let raf = 0;
    let frozen = false;
    const start = performance.now();

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      const m = measure(ctx, fontFamily, Math.round(pickFontSize(w, h) * dpr));
      const cols = Math.max(20, Math.floor((w * dpr) / m.cellW));
      const rows = Math.max(12, Math.floor((h * dpr) / m.cellH));
      canvas.width = cols * m.cellW;
      canvas.height = rows * m.cellH;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      ctx.fillStyle = css(BG);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      grid = new Grid(cols, rows);
      painter.reset(cols, rows, m);
      frozen = false;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (motion.matches) {
        if (frozen) return;   // reduced motion: one still frame per resize
        frozen = true;
      }
      drawRef.current(grid, motion.matches ? 0 : (now - start) / 1000);
      painter.paint(grid);
    };

    let started = false;
    document.fonts.ready.then(() => {
      if (started) return;
      started = true;
      fit();
      raf = requestAnimationFrame(frame);
    });
    const onMotion = () => { frozen = false; };
    window.addEventListener("resize", fit);
    motion.addEventListener("change", onMotion);
    return () => {
      started = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      motion.removeEventListener("change", onMotion);
    };
  }, [fontFamily]);

  return <canvas ref={ref} style={{ display: "block", background: css(BG) }} />;
}
