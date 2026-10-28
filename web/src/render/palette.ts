// A Qud-like 18-colour palette, keyed by the single-letter codes the log markup uses:
// "{{R|red text}}" in a message renders in Q.R. Colours are packed 0xRRGGBB ints so the
// renderer can light and mix them every frame without allocating strings.
export const Q = {
  k: 0x0f3b3a, // black (teal-black)
  K: 0x155352, // dark grey
  y: 0xb1c9c3, // grey
  Y: 0xffffff, // white
  r: 0xa64a2e, // dark red
  R: 0xd74200, // red
  o: 0xf15f22, // dark orange
  O: 0xe99f10, // orange
  w: 0x98875f, // brown
  W: 0xcfc041, // gold
  g: 0x009403, // dark green
  G: 0x00c420, // green
  c: 0x40a4b9, // dark cyan
  C: 0x77bfcf, // cyan
  b: 0x0048bd, // dark blue
  B: 0x0096ff, // blue
  m: 0xb154cf, // dark magenta
  M: 0xda5bd6, // magenta
} as const;

export type ColorCode = keyof typeof Q;
export const BG = 0x041312;

/** Mix two colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Multiply a colour by per-channel light levels (1 = unchanged), clamped. */
export function light(c: number, lr: number, lg: number, lb: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * lr) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * lg) | 0;
  const b = Math.min(255, (c & 255) * lb) | 0;
  return (r << 16) | (g << 8) | b;
}

const cssCache = new Map<number, string>();
export function css(c: number): string {
  let s = cssCache.get(c);
  if (s === undefined) {
    if (cssCache.size > 60000) cssCache.clear();
    s = "#" + c.toString(16).padStart(6, "0");
    cssCache.set(c, s);
  }
  return s;
}
