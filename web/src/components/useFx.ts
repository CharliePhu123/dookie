"use client";

// Plays the director's animation cues (TableView.fx) as sprites over the readable layer.
//
// Every cue arrives after the view has already changed, so each animation travels from where
// things were to where the readable layer now shows them, and hides its destination until it
// lands. Sprites are plain absolutely-positioned elements moved only by transform and opacity
// (Web Animations), created on demand and removed when they finish. A cue with ms = 0
// (instant speed, reduced motion) does nothing: the view already shows the end state.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { FANFARE_CATEGORY, type FxEvent } from "@/game/fx";
import type { Layout, Pt } from "@/render/layout";
import type { TableView } from "@/render/view";

interface Snap { bets: number[]; cards: number[] }

const CHIPS = ["•", "○", "◘"];
const CHIP_COLORS = ["#e99f10", "#cfc041", "#f15f22"];

export function useFx(scene: RefObject<HTMLDivElement | null>, layer: RefObject<HTMLDivElement | null>,
  v: TableView, L: Layout | null) {
  const seen = useRef<number | null>(null);
  const prev = useRef<Snap | null>(null);

  useLayoutEffect(() => {
    const list = v.fx ?? [];
    const last = list.length ? list[list.length - 1].id : 0;
    if (seen.current === null) {
      seen.current = last;   // don't replay what happened before we were mounted
    } else if (scene.current && layer.current && L && last > seen.current) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fx = new FxPlayer(scene.current, layer.current, L, prev.current);
      for (const e of list) {
        if (e.id <= seen.current) continue;
        if (!reduce && e.ms > 0) fx.play(e);
      }
      seen.current = last;
    }
    prev.current = { bets: v.seats.map((s) => s.bet), cards: v.seats.map((s) => s.cards?.length ?? 0) };
  });
}

const T = (p: Pt, extra = "") => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%) ${extra}`;

class FxPlayer {
  private origin: DOMRect;

  constructor(private root: HTMLElement, private box: HTMLElement, private L: Layout, private prev: Snap | null) {
    this.origin = root.getBoundingClientRect();
  }

  // ---- helpers --------------------------------------------------------------------------

  private q(sel: string, within: Element = this.root) {
    return within.querySelector<HTMLElement>(sel);
  }

  private center(el: Element): Pt & { w: number; h: number } {
    const r = el.getBoundingClientRect();
    return { x: r.left - this.origin.left + r.width / 2, y: r.top - this.origin.top + r.height / 2, w: r.width, h: r.height };
  }

  /** Hide an element of the readable layer until `ms` from now. */
  private hide(el: HTMLElement | null, ms: number) {
    if (!el) return;
    el.style.opacity = "0";
    window.setTimeout(() => { el.style.opacity = ""; }, ms);
  }

  private sprite(cls: string, text = "", style: Partial<CSSStyleDeclaration> = {}) {
    const el = document.createElement("div");
    el.className = `fx-s ${cls}`;
    el.textContent = text;
    Object.assign(el.style, style);
    this.box.appendChild(el);
    return el;
  }

  private run(el: HTMLElement, frames: Keyframe[], o: KeyframeAnimationOptions, remove = true) {
    const a = el.animate(frames, { fill: "both", ...o });
    if (remove) a.onfinish = () => el.remove();
    return a;
  }

  private cardSprite(back: boolean, w: number, h: number) {
    return this.sprite(`card ${back ? "back" : ""}`, "", { width: `${w}px`, height: `${h}px` });
  }

  private seat(i: number) { return this.q(`[data-seat="${i}"]`); }

  // ---- cues ---------------------------------------------------------------------------

  play(e: FxEvent) {
    const now = performance.now();
    const wait = Math.max(0, e.at + e.delay - now);
    const ms = e.ms;
    if (now > e.at + e.delay + ms + 30) return;   // already over
    const f = e.fx;
    switch (f.kind) {
      case "deal": return this.deal(f.seat, f.k, wait, ms);
      case "board": return this.board(f.index, wait, ms);
      case "bet": return this.bet(f.seat, f.amount, wait, ms);
      case "check": return this.check(f.seat, wait, ms);
      case "fold": return this.fold(f.seat, wait, ms);
      case "allIn": return this.allIn(f.seat, wait, ms);
      case "collect": return this.collect(wait, ms);
      case "reveal": return this.reveal(f.seat, wait, ms);
      case "win": return this.win(f.seat, f.hand, f.category, wait, ms);
      case "bust": return this.bust(f.seat, wait, ms);
    }
  }

  private deal(seat: number, k: number, wait: number, ms: number) {
    const s = this.seat(seat), card = s && this.q(`[data-card="${k}"]`, s);
    if (!card) return;
    const to = this.center(card), from = this.L.croupier;
    this.hide(card, wait + ms);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 36 };
    const el = this.cardSprite(true, to.w, to.h);
    this.run(el, [
      { transform: T(from, "rotate(-30deg) scale(0.55)"), opacity: 0 },
      { transform: T(mid, "rotate(-10deg) scale(0.85)"), opacity: 1, offset: 0.45 },
      { transform: T(to, "rotate(0deg) scale(1)"), opacity: 1 },
    ], { duration: ms, delay: wait, easing: "cubic-bezier(.25,.6,.35,1)" });
    // a short trail of dim glyphs along the arc
    ["▒", "░", "·"].forEach((g, n) => {
      const u = 0.3 + n * 0.2;
      const p = { x: (1 - u) * (1 - u) * from.x + 2 * u * (1 - u) * mid.x + u * u * to.x, y: (1 - u) * (1 - u) * from.y + 2 * u * (1 - u) * mid.y + u * u * to.y };
      const t = this.sprite("trace", g);
      this.run(t, [{ transform: T(p), opacity: 0.55 }, { transform: T(p), opacity: 0 }],
        { duration: 240, delay: wait + ms * u, easing: "linear" });
    });
  }

  private board(index: number, wait: number, ms: number) {
    const card = this.q(`[data-board="${index}"]`);
    if (!card) return;
    const at = this.center(card);
    this.hide(card, wait + ms * 0.55);
    // face down, turning: ▒ narrows to an edge ▌, then the face opens out
    const back = this.cardSprite(true, at.w, at.h);
    this.run(back, [
      { transform: T(at, "scaleX(1) translateY(-6px)"), opacity: 0 },
      { transform: T(at, "scaleX(1)"), opacity: 1, offset: 0.4 },
      { transform: T(at, "scaleX(0.08)"), opacity: 1 },
    ], { duration: ms * 0.5, delay: wait, easing: "ease-in" });
    const edge = this.sprite("edge", "▌", { fontSize: `${at.h * 0.9}px` });
    this.run(edge, [{ transform: T(at), opacity: 1 }, { transform: T(at), opacity: 0 }], { duration: ms * 0.12, delay: wait + ms * 0.45 });
    card.animate([{ transform: "scaleX(0.08)" }, { transform: "scaleX(1)" }],
      { duration: ms * 0.45, delay: wait + ms * 0.55, easing: "ease-out", fill: "backwards" });
  }

  private chips(from: Pt, to: Pt, n: number, wait: number, ms: number, spread = 10, lift = 16) {
    for (let c = 0; c < n; c++) {
      const el = this.sprite("chip", CHIPS[c % 3], { color: CHIP_COLORS[c % 3] });
      const jx = (Math.random() - 0.5) * spread, jy = (Math.random() - 0.5) * spread * 0.6;
      const a = { x: from.x + jx, y: from.y + jy }, b = { x: to.x + jx * 0.4, y: to.y + jy * 0.4 };
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - lift };
      this.run(el, [
        { transform: T(a), opacity: 0 },
        { transform: T(a), opacity: 1, offset: 0.08 },
        { transform: T(m), opacity: 1, offset: 0.5 },
        { transform: T(b), opacity: 1, offset: 0.92 },
        { transform: T(b), opacity: 0 },
      ], { duration: ms * 0.7, delay: wait + (ms * 0.3 * c) / Math.max(1, n - 1), easing: "ease-in-out" });
    }
  }

  private bet(seat: number, amount: number, wait: number, ms: number) {
    const s = this.seat(seat), stack = s && this.q("[data-stack]", s);
    const spot = this.L.seats[seat]?.bet;
    if (!stack || !spot) return;
    this.hide(this.q(`[data-bet="${seat}"]`), wait + ms);
    const n = Math.max(2, Math.min(5, Math.round(Math.log10(Math.max(10, amount)))));
    this.chips(this.center(stack), spot, n, wait, ms);
  }

  private check(seat: number, wait: number, ms: number) {
    const s = this.seat(seat), glyph = s && this.q("[data-glyph]", s);
    if (!glyph) return;
    glyph.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)", offset: 0.3 }, { transform: "scale(1)" }],
      { duration: ms, delay: wait, easing: "ease-out" });
    const at = this.center(glyph);
    const ring = this.sprite("knock", "◦");
    this.run(ring, [{ transform: T(at, "scale(0.6)"), opacity: 0.8 }, { transform: T(at, "scale(2.6)"), opacity: 0 }],
      { duration: ms * 1.4, delay: wait, easing: "ease-out" });
  }

  private fold(seat: number, wait: number, ms: number) {
    const s = this.seat(seat), cards = s && this.q("[data-cards]", s);
    if (!cards) return;
    const at = this.center(cards);
    const n = this.prev?.cards[seat] || 2;
    const size = seat === 0 ? this.L.bigCard : this.L.card;
    const t = this.L.table;
    const dx = t.cx - at.x, dy = t.cy - at.y, d = Math.hypot(dx, dy) || 1;
    for (let k = 0; k < n; k++) {
      const p = { x: at.x + (k - (n - 1) / 2) * (size.w + 5), y: at.y };
      const q = { x: p.x + (dx / d) * 34, y: p.y + (dy / d) * 34 };
      const el = this.cardSprite(true, size.w, size.h);
      this.run(el, [
        { transform: T(p, "rotate(0deg)"), opacity: 0.9 },
        { transform: T(q, `rotate(${(k - 0.5) * 14}deg)`), opacity: 0 },
      ], { duration: ms, delay: wait, easing: "ease-in" });
    }
  }

  private shake(wait: number, ms: number, px: number) {
    const j = (a: number, b: number) => ({ transform: `translate(${a * px}px, ${b * px}px)` });
    this.root.animate([j(0, 0), j(1, -0.6), j(-1, 0.7), j(0.7, 1), j(-0.8, -0.8), j(0.4, 0.3), j(0, 0)],
      { duration: ms, delay: wait, easing: "linear" });
  }

  private allIn(seat: number, wait: number, ms: number) {
    const s = this.seat(seat), glyph = s && this.q("[data-glyph]", s);
    if (!glyph) return;
    const at = this.center(glyph);
    for (let r = 0; r < 2; r++) {
      const el = this.sprite("pulse", glyph.textContent ?? "!");
      this.run(el, [{ transform: T(at, "scale(1)"), opacity: 0.9 }, { transform: T(at, "scale(3.4)"), opacity: 0 }],
        { duration: ms * 0.6, delay: wait + r * ms * 0.25, easing: "ease-out" });
    }
    this.shake(wait, Math.min(260, ms * 0.45), 3);
  }

  private collect(wait: number, ms: number) {
    const bets = this.prev?.bets ?? [];
    bets.forEach((b, seat) => {
      const spot = this.L.seats[seat]?.bet;
      if (b > 0 && spot) this.chips(spot, this.L.pot, 3, wait, ms, 14, 8);
    });
  }

  private reveal(seat: number, wait: number, ms: number) {
    const s = this.seat(seat);
    if (!s) return;
    s.querySelectorAll<HTMLElement>("[data-card]").forEach((card, k) => {
      const at = this.center(card);
      const d = wait + k * ms * 0.15;
      const back = this.cardSprite(true, at.w, at.h);
      this.run(back, [{ transform: T(at, "scaleX(1)") }, { transform: T(at, "scaleX(0.06)") }],
        { duration: ms * 0.45, delay: d, easing: "ease-in" });
      card.animate([{ transform: "scaleX(0.06)" }, { transform: "scaleX(1)" }],
        { duration: ms * 0.45, delay: d + ms * 0.45, easing: "ease-out", fill: "backwards" });
    });
  }

  private win(seat: number, hand: string | null, category: number | null, wait: number, ms: number) {
    const s = this.seat(seat), stack = s && this.q("[data-stack]", s), glyph = s && this.q("[data-glyph]", s);
    if (!s || !stack || !glyph) return;
    // the pot bursts toward the winner
    this.chips(this.L.pot, this.center(stack), 10, wait, ms * 0.7, 46, 34);
    // their glyph flickers gold
    glyph.animate([
      { color: "#cfc041" }, { color: "#ffffff" }, { color: "#cfc041" }, { color: "#fff6a8" }, { color: "#cfc041" }, { color: "" },
    ], { duration: ms, delay: wait, easing: "steps(6)" });
    // the hand name types out above the seat
    if (hand) {
      // on the table side of the seat, clear of the +won label above it
      const box = this.center(s);
      const toward = box.y < this.L.table.cy ? 1 : -1;
      const above = { x: box.x, y: box.y + toward * (box.h / 2 + 14) };
      const el = this.sprite("handname", hand);
      el.style.transform = T(above);
      const n = hand.length;
      el.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
        { duration: Math.min(ms * 0.6, n * 45), delay: wait + ms * 0.25, easing: `steps(${n})`, fill: "both" });
      this.run(el, [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: ms + 1600, delay: wait });
    }
    if (category !== null && category >= FANFARE_CATEGORY) {
      if (category >= 8) this.lightning(wait + ms * 0.2);
      else this.sparks(this.center(glyph), wait, ms);
    }
  }

  /** Quads: blue sparks crackle off the winner, three times. */
  private sparks(at: Pt, wait: number, ms: number) {
    const glyphs = ["*", "+", "·", "'", "×"];
    const colors = ["#0096ff", "#77bfcf", "#ffffff", "#40a4b9"];
    for (let burst = 0; burst < 3; burst++) {
      for (let n = 0; n < 14; n++) {
        const ang = Math.random() * Math.PI * 2, r = 26 + Math.random() * 46;
        const el = this.sprite("spark", glyphs[n % glyphs.length], { color: colors[n % colors.length] });
        const to = { x: at.x + Math.cos(ang) * r, y: at.y + Math.sin(ang) * r * 0.7 };
        this.run(el, [{ transform: T(at), opacity: 1 }, { transform: T(to), opacity: 0 }],
          { duration: 420 + Math.random() * 200, delay: wait + burst * ms * 0.28 + Math.random() * 60, easing: "cubic-bezier(.1,.7,.3,1)" });
      }
    }
  }

  /** Straight flush: a bolt of ╲╱ down onto the table, and the felt flashes gold. */
  private lightning(wait: number) {
    const t = this.L.table;
    let x = t.cx + (Math.random() - 0.5) * t.a * 0.8, y = -10;
    const step = 15;
    while (y < t.cy) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const el = this.sprite("bolt", dir < 0 ? "╱" : "╲");
      const p = { x, y };
      this.run(el, [
        { transform: T(p), opacity: 0 }, { transform: T(p), opacity: 1, offset: 0.05 }, { transform: T(p), opacity: 0.2, offset: 0.2 },
        { transform: T(p), opacity: 1, offset: 0.32 }, { transform: T(p), opacity: 0.6, offset: 0.6 }, { transform: T(p), opacity: 0 },
      ], { duration: 900, delay: wait, easing: "linear" });
      x += dir * 9;
      y += step;
    }
    const felt = this.sprite("felt-flash", "", {
      left: `${t.cx - t.a}px`, top: `${t.cy - t.b}px`, width: `${t.a * 2}px`, height: `${t.b * 2}px`,
    });
    this.run(felt, [{ opacity: 0 }, { opacity: 0.6, offset: 0.12 }, { opacity: 0.25, offset: 0.4 }, { opacity: 0 }],
      { duration: 1100, delay: wait, easing: "ease-out" });
    this.shake(wait, 380, 5);
  }

  private bust(seat: number, wait: number, ms: number) {
    const s = this.seat(seat), glyph = s && this.q("[data-glyph]", s);
    if (!glyph) return;
    const at = this.center(glyph);
    const color = getComputedStyle(glyph).color;
    glyph.animate([{ opacity: 0 }, { opacity: 0, offset: 0.75 }, { opacity: 1 }], { duration: ms + 500, delay: wait, fill: "backwards" });
    const bits = [".", ",", "'", ".", "`", ",", ".", "'", ":"];
    bits.forEach((b, n) => {
      const el = this.sprite("crumb", b, { color });
      const to = { x: at.x + (Math.random() - 0.5) * 50, y: at.y + 12 + Math.random() * 30 };
      this.run(el, [
        { transform: T(at, "rotate(0deg)"), opacity: 1 },
        { transform: T(to, `rotate(${(Math.random() - 0.5) * 180}deg)`), opacity: 0 },
      ], { duration: ms * (0.6 + Math.random() * 0.4), delay: wait + n * 12, easing: "cubic-bezier(.3,0,.8,.6)" });
    });
  }
}
