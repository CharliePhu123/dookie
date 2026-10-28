// Cards are ints: rankIndex * 4 + suitIndex. Rank 0 = deuce, 12 = ace. Same as pokerbot/cards.py.
export type Card = number;

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;

export function card(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`bad card ${s}`);
  return r * 4 + su;
}

export function cards(s: string): Card[] {
  const t = s.replace(/[\s,]/g, "");
  const out: Card[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(card(t.slice(i, i + 2)));
  return out;
}

export const cardStr = (c: Card) => RANKS[rankOf(c)] + SUITS[suitOf(c)];
export const handStr = (cs: readonly Card[]) => cs.map(cardStr).join(" ");
