// The whole game minus pixels: a Session (rules, chips, bots), a Director (what's on screen
// and when), and typed input, play.py style. The React component feeds it keys and draws
// `game.view` every frame; tests drive it the same way with no canvas at all.
import { EquityEngine } from "@/engine/equity";
import { Evaluator } from "@/engine/evaluator";
import type { Action, GameState } from "@/engine/game";
import { BotClient } from "@/worker/client";
import { infoLine, optionsLine, oddsText, parseCommand } from "./commands";
import { Director, type GameView } from "./director";
import { MoodTracker, moodLine } from "./moods";
import { DEFAULT_CONFIG, Session, type SessionConfig, type SessionSave } from "./session";
import { DEFAULT_SETTINGS, HELP, parseSetting, type Settings } from "./settings";

export interface GameSave {
  version: 1;
  session: SessionSave;
  /** the last few log lines, so a reload picks up where you were */
  log: string[];
}

export interface GameOptions {
  config?: Partial<SessionConfig>;
  save?: GameSave | null;
  bots?: BotClient;
  /** speed, sound, CRT; `speed` below overrides the saved speed (tests use 0) */
  settings?: Settings;
  /** 1 = normal pace, 0 = instant */
  speed?: number;
  onChange?: () => void;
  persist?: (s: GameSave) => void;
  /** a setting changed by a typed command; save it and apply sound/volume */
  onSettings?: (s: Settings) => void;
}

const MAX_INPUT = 24;

export class Game {
  readonly session: Session;
  readonly director: Director;
  private bots: BotClient;
  private eq: EquityEngine | null = null;
  private ev: Evaluator;
  private current: GameState | null = null;
  private answer: ((a: Action) => void) | null = null;
  private next: (() => void) | null = null;
  private running = false;
  private moods: MoodTracker;
  settings: Settings;

  constructor(private o: GameOptions = {}) {
    const config = o.save?.session.config ?? { ...DEFAULT_CONFIG, ...o.config };
    this.bots = o.bots ?? BotClient.create();
    this.session = new Session(config, this.bots, o.save?.session);
    this.director = new Director(this.session.v, this.session.ids, this.session.config.seed, o.onChange);
    this.settings = { ...DEFAULT_SETTINGS, ...o.settings };
    this.director.speed = o.speed ?? this.settings.speed;
    this.director.view.settings = { crt: this.settings.crt };
    this.director.setStacks(this.session.bank);
    this.director.setSession(this.session.net());
    if (o.save) {
      this.director.view.log.push(...o.save.log, "{{K|· · ·}}", "You return to the table. The creatures remember you.");
      this.director.setRead(o.save.session.models);
    } else {
      const n = this.session.ids.length - 1;
      this.director.log(
        `You sit down at the stone table. ${n === 1 ? "A creature looks" : `${["", "One", "Two", "Three", "Four", "Five", "Six", "Seven"][n]} creatures look`} up.`,
        "{{K|Type a letter, then Enter:}} {{W|c}} call {{K|·}} {{W|f}} fold {{K|·}} {{W|r 300}} raise to 300 {{K|·}} {{W|?}} odds",
      );
    }
    this.ev = new Evaluator(this.session.v);
    this.moods = new MoodTracker(this.session.ids, this.ev);
  }

  get view(): GameView {
    return this.director.view;
  }

  /** Play hands until stop(). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.running) {
      await this.playOne();
      if (!this.running) break;
      await this.waitForNext();
    }
  }

  /** Play exactly one hand (tests use this). */
  async playOne(): Promise<void> {
    const s = this.session, d = this.director;
    d.setPrompt({ mode: "wait", info: "", options: "", feedback: null });
    const hand = await s.playHand(d, (g) => this.ask(g), (id) => {
      d.bust(id);
      d.note(d.narrator.rebuy(id, s.config.stack, s.buyins[id]));
    });
    d.setStacks(s.bank);
    const changes = this.moods.update(hand, s.bank, s.v.bigBlind);
    for (const c of changes) s.setMood(c.id, c.mood);
    d.moods(changes, (c) => moodLine(d.narrator.who(c.id, true), c));
    d.setSession(s.net());
    const saved = await s.save();
    d.setRead(saved.models);
    this.o.persist?.({ version: 1, session: saved, log: d.view.log.slice(-12) });
  }

  stop() {
    this.running = false;
    this.next?.();
    this.bots.close();
  }

  /** Settings typed at the prompt (speed, sound, volume, crt, help). True if the line was one. */
  private setting(line: string): boolean {
    const r = parseSetting(line, this.settings);
    if (!r) return false;
    if ("help" in r) {
      this.director.setPrompt({ input: "", feedback: HELP });
    } else if ("error" in r) {
      this.director.cue({ kind: "error" });
      this.director.setPrompt({ input: "", feedback: `{{R|${r.error}}}` });
    } else {
      this.settings = r.settings;
      this.director.speed = r.settings.speed;
      this.director.view.settings = { crt: r.settings.crt };
      this.o.onSettings?.(r.settings);
      this.director.setPrompt({ input: "", feedback: `{{K|ok:}} ${r.message}` });
    }
    return true;
  }

  private ask(g: GameState): Promise<Action> {
    this.current = g;
    for (const s of this.director.view.seats) s.acting = s.id === g.me;
    this.director.view.toCall = g.toCall;
    this.director.setPrompt({ mode: "act", info: infoLine(g), options: optionsLine(g), feedback: null });
    return new Promise((resolve) => { this.answer = resolve; });
  }

  private waitForNext(): Promise<void> {
    const net = this.session.net();
    this.director.setPrompt({
      mode: "next", info: "", feedback: null,
      options: `{{W|[enter]}} next hand   {{K|·}}   session ${net >= 0 ? "{{G|+" : "{{R|−"}${Math.abs(net).toLocaleString("en-US")}}}`,
    });
    return new Promise((resolve) => { this.next = () => { this.next = null; resolve(); }; });
  }

  // ---- input ----------------------------------------------------------------------------

  /** Replace the typed text (from a native <input>, e.g. on phones). */
  setInput(text: string) {
    this.director.setPrompt({ input: text.slice(0, MAX_INPUT), feedback: null });
  }

  /** A key from the keyboard: printable characters, Enter, Backspace, Escape. */
  key(k: string) {
    const p = this.view.prompt;
    if (k.length === 1) this.director.cue({ kind: "key" });
    if (k === "Enter") return this.submit();
    if (k === "Backspace") return this.setInput(p.input.slice(0, -1));
    if (k === "Escape") return this.setInput("");
    if (k === " " && p.mode !== "act") return this.submit();
    if (k.length === 1) return this.setInput(p.input + k);
  }

  /** Enter: act on the typed command, start the next hand, or hurry the current beat. */
  submit() {
    const p = this.view.prompt;
    if (p.input.trim() && this.setting(p.input)) return;
    if (p.mode === "next") {
      this.setInput("");
      this.next?.();
      return;
    }
    if (p.mode === "wait" || !this.current || !this.answer) {
      this.director.skip();
      return;
    }
    const cmd = parseCommand(p.input, this.current);
    if (cmd.kind === "none") return;
    if (cmd.kind === "error") {
      this.director.cue({ kind: "error" });
      // like a terminal: the line is gone, the complaint stays
      this.director.setPrompt({ input: "", feedback: `{{K|${p.input.trim()}:}} {{R|${cmd.message}}}` });
      return;
    }
    if (cmd.kind === "odds") {
      this.eq ??= new EquityEngine(this.session.v);
      this.director.setPrompt({ input: "", feedback: oddsText(this.current, this.eq, this.ev) });
      return;
    }
    const answer = this.answer;
    this.answer = null;
    this.current = null;
    this.director.view.toCall = 0;
    this.director.setPrompt({ mode: "wait", input: "", feedback: null, info: "", options: "" });
    answer(cmd.action);
  }
}
