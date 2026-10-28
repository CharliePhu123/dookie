"use client";

// The table screen: the world (an ASCII-shader cave on a canvas) with the readable layer on
// top: seats, cards, chips, the HUD, the log, the typed-command prompt, the ledger and the
// drawer. Both layers share one layout in CSS pixels.
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { RANKS, rankOf, suitOf, type Card } from "@/engine/cards";
import { makeLayout, type Layout } from "@/render/layout";
import { css } from "@/render/palette";
import { fmt, LEDGER_LEGEND, markup, moodFromView, type LedgerView, type SeatView, type TableView } from "@/render/view";
import WorldCanvas from "./WorldCanvas";

// ---- window size, without setState-in-effect ---------------------------------------------

function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const snapshot = () => `${window.innerWidth}x${window.innerHeight}x${window.devicePixelRatio || 1}`;
const serverSnapshot = () => "0x0x1";

// ---- small pieces -------------------------------------------------------------------------

function Markup({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {markup(text).map((s, i) => (
        <span key={i} style={s.fg === null ? undefined : { color: css(s.fg) }}>{s.text}</span>
      ))}
    </span>
  );
}

const SUIT = "♣♦♥♠";

function CardFace({ c, size }: { c: Card | null | undefined; size: { w: number; h: number } }) {
  const style = { "--cw": `${size.w}px`, "--ch": `${size.h}px` } as CSSProperties;
  if (c === undefined) return <div className="card empty" style={style} />;
  if (c === null) return <div className="card back" style={style} />;
  const red = suitOf(c) === 1 || suitOf(c) === 2;
  const label = (rankOf(c) === 8 ? "10" : RANKS[rankOf(c)]) + SUIT[suitOf(c)];
  return (
    <div className={`card face${red ? " red" : ""}`} style={style}>
      <span className="tl">{label}</span>
      <span className="br">{label}</span>
    </div>
  );
}

function Seat({ s, i, L, v }: { s: SeatView; i: number; L: Layout; v: TableView }) {
  const slot = L.seats[i];
  const you = i === 0;
  const cr = s.creature;
  const cls = ["seat", you && "you", s.acting && "acting", !s.cards && "folded", s.allIn && "allin",
    slot.anchor.y < L.table.cy ? "above" : "below"].filter(Boolean).join(" ");
  const size = you ? L.bigCard : L.card;
  const toCall = v.toCall ?? 0;
  const potTotal = v.pot + v.seats.reduce((n, x) => n + x.bet, 0);
  return (
    <div className={cls} style={{ left: slot.box.x, top: slot.box.y, width: slot.box.w, height: slot.box.h,
      "--glow": css(cr.color) } as CSSProperties}>
      <div className="seat-name">
        <span className="glyph" style={{ color: css(cr.color) }}>{cr.glyph}</span>
        <span className="name">{cr.name}</span>
        {s.dealer && <span className="dealer" title="dealer">◉</span>}
        {s.acting && !you && <span className="dots"><i>·</i><i>·</i><i>·</i></span>}
      </div>
      {!L.phone && !you && <div className="seat-title">{cr.title}</div>}
      <div className="seat-stack"><span className="chip">◘</span> {fmt(s.stack)}</div>
      <div className="cards">
        {s.cards ? s.cards.map((c, k) => <CardFace key={k} c={c} size={size} />) : <span className="folded-note">folded</span>}
      </div>
      {you && v.handName && (
        <div className="hand-info">
          {v.handName}
          {toCall > 0 && <> · need {Math.round((toCall / (potTotal + toCall)) * 100)}% to call</>}
        </div>
      )}
    </div>
  );
}

function Ledger({ ledger, className }: { ledger: LedgerView; className?: string }) {
  return (
    <div className={`ledger ${className ?? ""}`}>
      <table>
        <thead>
          <tr><th />{ledger.streets.map((s) => <th key={s}>{s}</th>)}</tr>
        </thead>
        <tbody>
          {ledger.rows.map((r) => (
            <tr key={r.name}>
              <td className="who"><span style={{ color: css(r.color) }}>{r.glyph}</span> {r.name}</td>
              {r.cells.map((c, k) => <td key={k}>{c.join(" ")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend">{LEDGER_LEGEND}</div>
    </div>
  );
}

function Bars({ v }: { v: TableView }) {
  if (!v.read) return <p className="dim">It is watching you.</p>;
  const rows: [string, number, number][] = [
    ["plays", v.read.vpip, 0xda5bd6], ["raises", v.read.pfr, 0xda5bd6], ["folds to bets", v.read.foldToBet, 0x77bfcf],
    ["stabs", v.read.stab, 0xe99f10], ["bluffs", v.read.bluff, 0xd74200],
  ];
  return (
    <div className="bars">
      {rows.map(([label, value, color]) => (
        <div className="bar" key={label}>
          <span>{label}</span>
          <span className="track"><span style={{ width: `${value * 100}%`, background: css(color) }} /></span>
          <span className="pct">{Math.round(value * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function Prompt({ v, L }: { v: TableView; L: Layout }) {
  const p = v.prompt;
  return (
    <div className="prompt" style={{ left: L.prompt.x, top: L.prompt.y, width: L.prompt.w }}>
      {p.active ? (
        <>
          <div className="info">{p.info.split(/ · | {2,}/).map((o, i) => <Markup key={i} text={o} className="opt" />)}</div>
          <div className="options">
            {p.options.split(/ {2,}/).map((o, i) => <Markup key={i} text={o} className="opt" />)}
          </div>
          <div className="input"><span className="caret-mark">&gt;</span> {p.input}<span className="cursor" /></div>
          <div className="feedback">{p.feedback ? <Markup text={p.feedback} /> : " "}</div>
        </>
      ) : (
        <div className="input idle"><span className="key">[enter]</span> next hand<span className="cursor" /></div>
      )}
    </div>
  );
}

// ---- the screen ---------------------------------------------------------------------------

export default function TableScreen({ view: v, fontFamily }: { view: TableView; fontFamily: string }) {
  const size = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const L = useMemo(() => {
    const [w, h, dpr] = size.split("x").map(Number);
    return w ? makeLayout(w, h, v.seats.length, dpr) : null;
  }, [size, v.seats.length]);
  const mood = useMemo(() => moodFromView(v), [v]);
  const [drawer, setDrawer] = useState(false);
  const [fullLog, setFullLog] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") { e.preventDefault(); setDrawer((d) => !d); }
      else if (e.key === "Escape") { setDrawer(false); setFullLog(false); }
      else if (e.key === "L" || (e.key === "l" && !v.prompt.input)) setFullLog((f) => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v.prompt.input]);

  if (!L) return null;
  const potTotal = v.pot + v.seats.reduce((n, s) => n + s.bet, 0);
  const logRoom = L.prompt.x - 36;
  const recent = v.log.slice(-3);

  return (
    <div className={`scene${L.phone ? " phone" : ""}${mood.allIn ? " tense" : ""}`}>
      <WorldCanvas layout={L} mood={mood} fontFamily={fontFamily} />

      <div className="layer">
        <div className="hud tl">
          <span>hand <b>{v.handNo}</b></span><span className="sep">·</span>
          <span>blinds <b>{fmt(v.blinds[0])}/{fmt(v.blinds[1])}</b></span><span className="sep">·</span>
          <span className="street">{v.street}</span>
          {!L.phone && <div className="place">{v.place}</div>}
        </div>
        <div className="hud tr">
          <span>session <b className={v.session >= 0 ? "pos" : "neg"}>{v.session >= 0 ? "+" : "−"}{fmt(Math.abs(v.session))}</b></span>
          {!L.phone ? (
            <div className="hint">
              <button type="button" onClick={() => setDrawer((d) => !d)}><kbd>tab</kbd> the seer&apos;s read</button> ·{" "}
              <button type="button" onClick={() => setFullLog((f) => !f)}><kbd>l</kbd> log</button>
            </div>
          ) : (
            <button type="button" className="sheet-toggle" aria-label="the Seer's read" onClick={() => setDrawer((d) => !d)}>≡</button>
          )}
        </div>
        {L.phone && v.log.length > 0 && (
          <button type="button" className="latest" onClick={() => setFullLog(true)}><Markup text={v.log[v.log.length - 1]} /></button>
        )}

        <div className="board" style={{ left: L.board.x, top: L.board.y }}>
          {Array.from({ length: v.boardSize }, (_, i) => <CardFace key={i} c={v.board[i]} size={L.card} />)}
        </div>
        <div className="pot" style={{ left: L.pot.x, top: L.pot.y }}>
          <span className="label">pot</span> <span className="chip">◘</span> {fmt(potTotal)}
        </div>

        {v.seats.map((s, i) => L.seats[i] && <Seat key={i} s={s} i={i} L={L} v={v} />)}
        {v.seats.map((s, i) => {
          const slot = L.seats[i];
          if (!slot || (!s.bet && !s.allIn)) return null;
          return (
            <div key={i} className={`bet${s.allIn ? " allin" : ""}`} style={{ left: slot.bet.x, top: slot.bet.y }}>
              {s.allIn && <span className="tag">ALL-IN</span>}
              <span className="chip">{s.allIn ? "◘" : "•"}</span> {fmt(s.bet)}
            </div>
          );
        })}

        {!L.phone && logRoom > 230 && (
          <div className="log" style={{ maxWidth: Math.min(460, logRoom) }}>
            {recent.map((m, i) => (
              <div key={v.log.length - recent.length + i} style={{ opacity: [0.4, 0.68, 1][i + 3 - recent.length] }}>
                <Markup text={m} />
              </div>
            ))}
          </div>
        )}
        {L.ledgerFloats && <Ledger ledger={v.ledger} className="floating" />}
        <Prompt v={v} L={L} />
      </div>

      <aside className={`drawer${drawer ? " open" : ""}`} aria-hidden={!drawer}>
        <h2>The Seer&apos;s read</h2>
        <Bars v={v} />
        <h2>Creatures</h2>
        <ul className="creatures">
          {v.seats.map((s, i) => (
            <li key={i} className={s.cards ? "" : "out"}>
              <span><span style={{ color: css(s.creature.color) }}>{s.creature.glyph}</span> {s.creature.name}</span>
              <span className="state">{s.allIn ? "all in" : s.acting ? "to act" : !s.cards ? "folded" : s.dealer ? "dealer" : ""}</span>
              <span className="stack">{fmt(s.stack)}</span>
            </li>
          ))}
        </ul>
        <h2>This hand</h2>
        <Ledger ledger={v.ledger} />
        <h2>Keys</h2>
        <p className="keys"><kbd>tab</kbd> close · <kbd>l</kbd> full log · <kbd>esc</kbd> back</p>
        {L.phone && <button type="button" className="sheet-close" onClick={() => setDrawer(false)}>close</button>}
      </aside>

      {fullLog && (
        <div className="fulllog" role="dialog" aria-label="Message log">
          <h2>Messages</h2>
          <div className="lines">{v.log.map((m, i) => <div key={i}><Markup text={m} /></div>)}</div>
          <button type="button" className="keys" onClick={() => setFullLog(false)}><kbd>l</kbd> or <kbd>esc</kbd> to close</button>
        </div>
      )}
    </div>
  );
}
