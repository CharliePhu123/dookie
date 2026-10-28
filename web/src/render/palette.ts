// A Qud-like 18-colour palette, keyed by the single-letter codes the log markup uses:
// "{{R|red text}}" in a message renders in Q.R.
export const Q = {
  k: "#0f3b3a", // black (teal-black)
  K: "#155352", // dark grey
  y: "#b1c9c3", // grey
  Y: "#ffffff", // white
  r: "#a64a2e", // dark red
  R: "#d74200", // red
  o: "#f15f22", // dark orange
  O: "#e99f10", // orange
  w: "#98875f", // brown
  W: "#cfc041", // gold
  g: "#009403", // dark green
  G: "#00c420", // green
  c: "#40a4b9", // dark cyan
  C: "#77bfcf", // cyan
  b: "#0048bd", // dark blue
  B: "#0096ff", // blue
  m: "#b154cf", // dark magenta
  M: "#da5bd6", // magenta
} as const;

export type ColorCode = keyof typeof Q;
export const BG = "#041312";

/** Mix two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}
