// Each bot is a creature at the table: a glyph, a colour, a name and a title.
// Names are original; none are taken from Caves of Qud (see PLAN.md, Naming and IP).
import { Q } from "@/render/palette";

export interface Creature {
  key: string;
  glyph: string;
  color: number;
  name: string;
  title: string;
}

export const CREATURES: Record<string, Creature> = {
  you: { key: "you", glyph: "@", color: Q.Y, name: "YOU", title: "the wanderer" },
  adaptive: { key: "adaptive", glyph: "Ω", color: Q.M, name: "SEER", title: "the Bayesian Seer" },
  simple: { key: "simple", glyph: "Σ", color: Q.C, name: "RECKONER", title: "the Reckoner" },
  maniac: { key: "maniac", glyph: "g", color: Q.R, name: "GNASHBACK", title: "a frothing gnashback" },
  nit: { key: "nit", glyph: "t", color: Q.w, name: "TORTOISE", title: "the hoarding tortoise" },
  station: { key: "station", glyph: "I", color: Q.y, name: "IDOL", title: "a chrome idol" },
  exploiter: { key: "exploiter", glyph: "m", color: Q.O, name: "MIMIC", title: "the mimic" },
  random: { key: "random", glyph: "?", color: Q.G, name: "GLITCH", title: "a glitching sprite" },
};
