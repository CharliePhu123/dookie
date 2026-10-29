// Settings, changed by typing at the prompt like everything else:
//   speed 1 | 2 | 4 | instant · sound on | off · volume 0-100 · crt on | off · bots 4-7 · help
// They persist in localStorage, apart from the game save.
export interface Settings {
  /** 1 normal, 2 fast, 4 very fast, 0 instant */
  speed: number;
  sound: boolean;
  /** 0..1 */
  volume: number;
  crt: boolean;
  /** creatures at the table, from the next tournament */
  bots: number;
}

export const MIN_BOTS = 4;
export const MAX_BOTS = 7;

export const DEFAULT_SETTINGS: Settings = { speed: 1, sound: true, volume: 0.6, crt: false, bots: 5 };

const KEY = "ascii-poker/settings";

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const s: Settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    if (!(Number.isInteger(s.bots) && s.bots >= MIN_BOTS && s.bots <= MAX_BOTS)) s.bots = DEFAULT_SETTINGS.bots;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // blocked or full: settings last for this visit only
  }
}

export const HELP = "{{W|c}} call {{K|·}} {{W|x}} check {{K|·}} {{W|f}} fold {{K|·}} {{W|r 30}} raise to 30 {{K|·}} {{W|h}}/{{W|p}}/{{W|a}} half pot, pot, all-in {{K|·}} {{W|?}} odds" +
  "  {{K||}}  {{W|speed}} 1/2/4/instant {{K|·}} {{W|sound}} on/off {{K|·}} {{W|volume}} 0-100 {{K|·}} {{W|crt}} on/off {{K|·}} {{W|bots}} 4-7 {{K|·}} {{W|tab}} the Seer's read {{K|·}} {{W|l}} log";

export type SettingResult = { settings: Settings; message: string } | { help: true } | { error: string } | null;

const ON = ["on", "yes", "1", "true"];
const OFF = ["off", "no", "0", "false"];

/** A settings command, or null if the line isn't one (so it may be a poker command). */
export function parseSetting(raw: string, cur: Settings): SettingResult {
  const [cmd, arg = ""] = raw.trim().toLowerCase().split(/\s+/, 2);
  if (cmd === "help" || cmd === "keys" || cmd === "commands") return { help: true };
  if (cmd === "speed") {
    const named: Record<string, number> = { normal: 1, slow: 1, fast: 2, faster: 4, instant: 0, "0": 0 };
    const v = arg in named ? named[arg] : Number(arg.replace(/x$/, ""));
    if (![0, 1, 2, 4].includes(v)) return { error: "speed 1, 2, 4 or instant" };
    return { settings: { ...cur, speed: v }, message: `speed ${v === 0 ? "instant" : `${v}x`}` };
  }
  if (cmd === "mute") return { settings: { ...cur, sound: false }, message: "sound off" };
  if (cmd === "unmute") return { settings: { ...cur, sound: true }, message: "sound on" };
  if (cmd === "sound" || cmd === "crt") {
    const want = ON.includes(arg) ? true : OFF.includes(arg) ? false : arg === "" ? !cur[cmd] : null;
    if (want === null) return { error: `${cmd} on or off` };
    return { settings: { ...cur, [cmd]: want }, message: `${cmd} ${want ? "on" : "off"}` };
  }
  if (cmd === "volume" || cmd === "vol") {
    const v = Number(arg.replace("%", ""));
    if (!Number.isFinite(v) || v < 0 || v > 100) return { error: "volume 0-100" };
    return { settings: { ...cur, volume: v / 100, sound: v > 0 }, message: `volume ${Math.round(v)}%` };
  }
  if (cmd === "bots" || cmd === "opponents") {
    const v = Number(arg);
    if (!Number.isInteger(v) || v < MIN_BOTS || v > MAX_BOTS) return { error: `bots ${MIN_BOTS}-${MAX_BOTS}` };
    return { settings: { ...cur, bots: v }, message: `${v} creatures from the next tournament` };
  }
  return null;
}
