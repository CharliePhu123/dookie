"use client";

// The live game: a Game (engine, bots in a worker, pacing, typed commands) drawn by the
// table screen. Typing goes through one invisible <input>, so phones get a keyboard and
// desktop keys land in the same place.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Synth } from "@/audio/synth";
import { Game } from "@/game/game";
import { loadSave, writeSave } from "@/game/save";
import { loadSettings, saveSettings } from "@/game/settings";
import { toTableView } from "@/game/toView";
import TableScreen from "./TableScreen";

export default function PokerGame({ fontFamily }: { fontFamily: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const synth = useRef<Synth | null>(null);

  useEffect(() => {
    // redraw at most once a frame, however many times the game changes
    let frame = 0;
    let g: Game | null = null;
    const settings = loadSettings();
    const sound = (synth.current = new Synth());
    sound.setEnabled(settings.sound);
    sound.setVolume(settings.volume);
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        setGame(g);
        setTick((t) => t + 1);
        if (g) sound.setTension(Math.min(1, g.view.tension.pot * 0.8), g.view.tension.allIn);
      });
    };
    g = new Game({
      save: loadSave(), persist: writeSave, onChange: schedule, settings,
      onSettings: (s) => { saveSettings(s); sound.setEnabled(s.sound); sound.setVolume(s.volume); if (s.sound) sound.unlock(); },
    });
    const game = g;
    // the table can change size between tournaments, so read the seats as each cue plays
    game.director.onFx = (e) => {
      sound.kinds = game.view.seats.map((s) => s.kind);
      sound.play(e);
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => { game.director.reducedMotion = motion.matches; };
    onMotion();
    motion.addEventListener("change", onMotion);
    // browsers only allow audio after a gesture
    const unlock = () => sound.unlock();
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
    schedule();
    void game.start();

    // keys pressed while something else has focus still go to the prompt
    const onKey = (e: KeyboardEvent) => {
      if (e.target === input.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Tab" || ((e.key === "l" || e.key === "L") && !game.view.prompt.input)) return;   // the screen's own keys
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        game.key(e.key);
        sync(game);
        input.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      motion.removeEventListener("change", onMotion);
      cancelAnimationFrame(frame);
      game.stop();
      sound.close();
    };
  }, []);

  // Redraws wait for the next animation frame, so after Enter clears the line the text box
  // would still hold the old text for a moment, and a fast next keystroke would append to it.
  // Copy the game's input into the box right away instead.
  function sync(g: Game) {
    if (input.current && input.current.value !== g.view.prompt.input) input.current.value = g.view.prompt.input;
  }

  if (!game) return null;
  const view = toTableView(game.view);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const empty = !game.view.prompt.input;
    if (e.key === "Enter" || e.key === "Escape" || (e.key === " " && game.view.prompt.mode !== "act" && empty)) {
      e.preventDefault();
      game.key(e.key);
      sync(game);
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
