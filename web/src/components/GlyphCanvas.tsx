"use client";

import { useEffect, useRef } from "react";
import { measure, paint } from "@/render/canvas";
import { Grid } from "@/render/grid";
import { BG } from "@/render/palette";

interface Props {
  cols: number;
  rows: number;
  fontFamily: string;
  /** called every frame with seconds since mount; draw into the grid */
  draw: (grid: Grid, t: number) => void;
}

/** A canvas that fits a cols x rows glyph grid to the window, crisp on HiDPI screens. */
export default function GlyphCanvas({ cols, rows, fontFamily, draw }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const grid = new Grid(cols, rows);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let metrics = measure(ctx, fontFamily, 16);
    let raf = 0;
    const start = performance.now();

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      // pick the largest font size whose grid fits the viewport
      let size = 24;
      for (; size > 6; size--) {
        const m = measure(ctx, fontFamily, size);
        if (m.cellW * cols <= window.innerWidth - 16 && m.cellH * rows <= window.innerHeight - 16) break;
      }
      metrics = measure(ctx, fontFamily, size * dpr);
      canvas.width = metrics.cellW * cols;
      canvas.height = metrics.cellH * rows;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
    };

    const frame = (now: number) => {
      const t = reduce ? 0 : (now - start) / 1000;
      drawRef.current(grid, t);
      paint(ctx, grid, metrics, fontFamily);
      raf = requestAnimationFrame(frame);
    };

    document.fonts.ready.then(() => {
      fit();
      raf = requestAnimationFrame(frame);
    });
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [cols, rows, fontFamily]);

  return <canvas ref={ref} style={{ display: "block", background: BG }} />;
}
