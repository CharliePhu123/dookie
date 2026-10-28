"""Cards are ints: rank_index * 4 + suit_index. Rank index 0 = deuce, 12 = ace."""

RANKS = "23456789TJQKA"
SUITS = "cdhs"


def card(s: str) -> int:
    return RANKS.index(s[0].upper()) * 4 + SUITS.index(s[1].lower())


def cards(s: str) -> list[int]:
    """cards("As Kd 7h") -> [ints]. Also accepts "AsKd7h"."""
    s = s.replace(" ", "").replace(",", "")
    return [card(s[i:i + 2]) for i in range(0, len(s), 2)]


def card_str(c: int) -> str:
    return RANKS[c >> 2] + SUITS[c & 3]


def hand_str(cs) -> str:
    return " ".join(card_str(c) for c in cs)


def rank_of(c: int) -> int:
    return c >> 2


def suit_of(c: int) -> int:
    return c & 3
