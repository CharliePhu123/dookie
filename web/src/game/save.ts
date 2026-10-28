// Saving to localStorage. Every access is guarded: storage can be missing, full or blocked
// (private windows, embedded previews), and the game must still run without it.
import type { GameSave } from "./game";

const KEY = "ascii-poker/save";

export function loadSave(): GameSave | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameSave;
    return s?.version === 1 && s.session?.bank ? s : null;
  } catch {
    return null;
  }
}

export function writeSave(s: GameSave) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: carry on unsaved
  }
}

export function clearSave() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
