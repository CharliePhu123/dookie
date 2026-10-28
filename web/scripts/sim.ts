// Headless bot matches, like run_match.py:
//   npm run sim -- --hands 4000 --players adaptive,simple --table-size 2
//   npm run sim -- --variant shortdeck --players "adaptive,adaptive:bet_rel=1.0,simple,station"
import { parseArgs } from "node:util";
import { formatMatch, runMatch } from "@/bots/match";
import { PYTHON_RULES, STANDARD_RULES } from "@/engine/table";
import { PRESETS } from "@/engine/variant";

const { values: a } = parseArgs({
  options: {
    variant: { type: "string", default: "holdem" },
    hands: { type: "string", default: "2000" },
    players: { type: "string", default: "adaptive,simple,station,maniac,nit,random" },
    "table-size": { type: "string", default: "6" },
    seed: { type: "string", default: "1" },
    "python-rules": { type: "boolean", default: false },
  },
});
const variant = PRESETS[a.variant!];
if (!variant) throw new Error(`unknown variant; try ${Object.keys(PRESETS).join(", ")}`);
const players = a.players!.split(",");
const hands = Number(a.hands);
const r = runMatch({
  variant, players, hands, tableSize: Number(a["table-size"]), seed: a.seed,
  rules: a["python-rules"] ? PYTHON_RULES : STANDARD_RULES,
  progress: (n) => process.stderr.write(`  ...${n} hands\n`),
});
const size = Math.min(Number(a["table-size"]), players.length);
console.log(formatMatch(r, `\n${variant.name}: ${hands} hands, ${size}-handed, ${(r.ms / 1000).toFixed(0)}s`));
