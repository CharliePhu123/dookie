"""Everything that differs between poker variants lives here.

When the variant is announced at the starting gun, the first job is to express it as a
Variant. Most hold'em-family games fit: number of hole cards, how the board comes out,
which ranks are in the deck, Omaha-style "must use exactly N hole cards", short-deck
ranking swaps, antes, pot limit vs no limit.
"""
from dataclasses import dataclass, field

from .cards import RANKS, SUITS


@dataclass(frozen=True)
class Variant:
    name: str = "holdem"
    hole_cards: int = 2
    # board cards dealt *before* each betting round; len(streets) = number of betting rounds
    streets: tuple = (0, 3, 1, 1)
    ranks: str = RANKS
    suits: str = SUITS
    must_use_hole: int | None = None   # Omaha = 2; None = any 5 of hole+board
    flush_beats_full_house: bool = False
    trips_beats_straight: bool = False
    ace_low_straights: bool = True     # A-2-3-4-5 (or A-6-7-8-9 in short deck)
    small_blind: int = 1
    big_blind: int = 2
    ante: int = 0
    starting_stack: int = 200
    pot_limit: bool = False

    @property
    def board_size(self) -> int:
        return sum(self.streets)

    @property
    def num_streets(self) -> int:
        return len(self.streets)

    def deck(self) -> list[int]:
        return [RANKS.index(r) * 4 + SUITS.index(s) for r in self.ranks for s in self.suits]


PRESETS = {
    "holdem": Variant(),
    "shortdeck": Variant(name="shortdeck", ranks="6789TJQKA", flush_beats_full_house=True,
                         trips_beats_straight=True, ante=1),
    "omaha": Variant(name="omaha", hole_cards=4, must_use_hole=2),
    "plo": Variant(name="plo", hole_cards=4, must_use_hole=2, pot_limit=True),
    "3card": Variant(name="3card", hole_cards=3),          # 3 hole cards, use any
    "royal": Variant(name="royal", ranks="TJQKA"),         # 20-card deck
    "bigboard": Variant(name="bigboard", streets=(0, 3, 1, 1, 1)),  # extra street, 6-card board
    "deepstack": Variant(name="deepstack", starting_stack=1000),
}
