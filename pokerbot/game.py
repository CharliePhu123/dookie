"""The bot <-> engine contract. Write an adapter from the organisers' API to this."""
from dataclasses import dataclass, field

from .variant import Variant


@dataclass(frozen=True)
class Action:
    kind: str          # "fold" | "check" | "call" | "raise"
    amount: int = 0    # for raise: the TOTAL street bet you are raising TO

    def __str__(self):
        return f"{self.kind} {self.amount}" if self.kind == "raise" else self.kind


FOLD, CHECK, CALL = Action("fold"), Action("check"), Action("call")


@dataclass
class PlayerView:
    id: str
    stack: int          # chips behind
    street_bet: int
    total_in: int
    folded: bool
    all_in: bool


@dataclass
class GameState:
    variant: Variant
    hand_id: int
    me: str
    hole: tuple
    board: tuple
    street: int
    pot: int            # everything in the middle, including this street's bets
    to_call: int        # already capped at my stack
    current_bet: int
    min_raise_to: int
    max_raise_to: int
    my_stack: int
    my_street_bet: int
    players: list       # PlayerView in seat order, seat 0 = button
    history: list = field(default_factory=list)

    @property
    def num_streets(self) -> int:
        return self.variant.num_streets

    @property
    def can_check(self) -> bool:
        return self.to_call == 0

    @property
    def can_raise(self) -> bool:
        return self.max_raise_to > self.current_bet and self.my_stack > self.to_call

    @property
    def live_opponents(self) -> list:
        return [p for p in self.players if not p.folded and p.id != self.me]

    def raise_to(self, amount: float) -> Action:
        if not self.can_raise:
            return CALL if self.to_call else CHECK
        return Action("raise", int(min(self.max_raise_to, max(self.min_raise_to, amount))))
