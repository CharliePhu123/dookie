// GameView (what the game knows) -> TableView (what the table screen draws).
import { CREATURES } from "./creatures";
import type { GameView } from "./director";
import { YOU } from "./session";
import type { TableView } from "@/render/view";

export const PLACE = "the Salt-Flat Caravanserai";

const creatureOf = (id: string, kind: string) => (id === YOU ? CREATURES.you : CREATURES[kind] ?? CREATURES.random);

export function toTableView(g: GameView): TableView {
  const bets = g.seats.reduce((n, s) => n + s.bet, 0);
  return {
    place: PLACE,
    handNo: g.handNo,
    blinds: g.blinds,
    street: g.street,
    board: g.board,
    boardSize: g.boardSize,
    pot: Math.max(0, g.pot - bets),   // the screen adds this street's bets back
    seats: g.seats.map((s) => ({
      creature: creatureOf(s.id, s.kind), stack: s.stack, bet: s.bet, cards: s.cards,
      dealer: s.dealer, acting: s.acting, allIn: s.allIn, won: s.won, tell: s.tell, mood: s.mood,
    })),
    fx: g.fx,
    settings: g.settings,
    log: g.log,
    read: g.read,
    session: g.session,
    handName: g.handName ?? undefined,
    toCall: g.toCall,
    prompt: { ...g.prompt, active: g.prompt.mode === "act" },
    ledger: {
      streets: g.ledger.streets,
      rows: g.seats.filter((s) => g.ledger.codes[s.id]).map((s) => {
        const c = creatureOf(s.id, s.kind);
        return { name: c.name, glyph: c.glyph, color: c.color, cells: g.ledger.codes[s.id] };
      }),
    },
  };
}
