"""Glue between the organisers' bot API and AdaptiveBot.

You won't know their API until the starting gun. Whatever it looks like, the job is
the same three translations. Fill in the TODOs; everything else is already done.
"""
from pokerbot.bot import AdaptiveBot
from pokerbot.cards import card
from pokerbot.game import GameState, PlayerView
from pokerbot.variant import Variant

# 1. Describe the variant (see pokerbot/variant.py PRESETS for examples).
VARIANT = Variant(
    name="event",
    hole_cards=2,
    streets=(0, 3, 1, 1),
    small_blind=1, big_blind=2, starting_stack=400,
)

BOT = AdaptiveBot(VARIANT, iters=300, time_limit=0.05, stats_path="opponent_stats.json")


def to_card(x) -> int:
    # TODO: their card format -> ours. Common: "Ah", "ah", "10h", or (rank, suit) tuples.
    s = str(x).replace("10", "T")
    return card(s)


def on_event(their_event) -> None:
    """2. Translate every action/showdown you can see into our event dicts. This is
    what powers the opponent model, so feed it everything, including your own actions."""
    # TODO examples:
    # BOT.observe({"type": "hand_start", "players": [...seat order, button first...],
    #              "button": ..., "num_streets": VARIANT.num_streets})
    # BOT.observe({"type": "action", "player": pid, "street": i, "action": "raise",
    #              "amount": raise_to_total, "to_call": what_they_faced, "pot": pot_before})
    # BOT.observe({"type": "showdown", "hands": {pid: (c1, c2)}, "winners": [pid]})
    pass


def get_action(their_state):
    """3. Their state -> GameState -> our Action -> their action."""
    s = GameState(
        variant=VARIANT,
        hand_id=0,
        me="me",                                       # TODO our player id
        hole=tuple(to_card(c) for c in []),            # TODO
        board=tuple(to_card(c) for c in []),           # TODO
        street=0,                                      # TODO index into VARIANT.streets
        pot=0, to_call=0, current_bet=0,               # TODO
        min_raise_to=0, max_raise_to=0,                # TODO (totals for this street)
        my_stack=0, my_street_bet=0,                   # TODO
        players=[PlayerView("me", 0, 0, 0, False, False)],  # TODO everyone, seat order
    )
    a = BOT.act(s)
    # TODO map back: a.kind in fold/check/call/raise; a.amount = raise-TO total for street.
    # If their API wants raise-BY, send a.amount - s.current_bet.
    return a


def on_round_end():
    BOT.save()   # opponent stats survive restarts between tournament rounds
