"use client";

// The live game: a Game (engine, bots in a worker, pacing, typed commands) drawn by the
// table screen. Typing goes through one invisible <input>, so phones get a keyboard and
// desktop keys land in the same place.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Game } from "@/game/game";
import { loadSave, writeSave } from "@/game/save";
import { toTableView } from "@/game/toView";
import TableScreen from "./TableScreen";

export default function PokerGame({ fontFamily }: { fontFamily: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // redraw at most once a frame, however many times the game changes
    let frame = 0;
    let g: Game | null = null;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setGame(g); setTick((t) => t + 1); });
    };
    g = new Game({ save: loadSave(), persist: writeSave, onChange: schedule });
    schedule();
    void g.start();
    const game = g;

    // keys pressed while something else has focus still go to the prompt
    const onKey = (e: KeyboardEvent) => {
      if (e.target === input.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Tab" || ((e.key === "l" || e.key === "L") && !game.view.prompt.input)) return;   // the screen's own keys
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        game.key(e.key);
        input.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      game.stop();
    };
  }, []);

  if (!game) return null;
  const view = toTableView(game.view);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const empty = !game.view.prompt.input;
    if (e.key === "Enter" || e.key === "Escape" || (e.key === " " && game.view.prompt.mode !== "act")) {
      e.preventDefault();
      game.key(e.key);
    } else if ((e.key === "l" || e.key === "L") && empty) {
      e.preventDefault();   // the screen opens the log instead
    }
  };

  return (
    <div onPointerDown={() => input.current?.focus({ preventScroll: true })}>
      <TableScreen view={view} fontFamily={fontFamily} />
      <input
        ref={input}
        className="typing"
        aria-label="Command: f fold, x check, c call, r and an amount to raise, h half pot, p pot, a all-in, ? odds"
        value={game.view.prompt.input}
        onChange={(e) => game.setInput(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
      />
    </div>
  );
}
