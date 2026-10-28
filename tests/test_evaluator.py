import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pokerbot.cards import cards
from pokerbot.evaluator import Evaluator, CATEGORY_NAMES
from pokerbot.variant import PRESETS

H = Evaluator(PRESETS["holdem"])
S = Evaluator(PRESETS["shortdeck"])
O = Evaluator(PRESETS["omaha"])


def cat(ev, hole, board):
    return CATEGORY_NAMES[ev.category(ev.rank(cards(hole), cards(board)))]


def test_categories():
    assert cat(H, "AhKh", "QhJhTh2c3d") == "straight flush"
    assert cat(H, "Ah2h", "3h4h5h9c9d") == "straight flush"   # steel wheel
    assert cat(H, "AhAd", "AsAc5h9c9d") == "quads"
    assert cat(H, "AhAd", "As9c9d2h3h") == "full house"
    assert cat(H, "AhAd", "As9c9d9h3h") == "full house"       # two trips
    assert cat(H, "2h7h", "Jh9hKh2c3d") == "flush"
    assert cat(H, "Ac2d", "3h4s5c9c9d") == "straight"
    assert cat(H, "AcAd", "Ah7s5c9c2d") == "trips"
    assert cat(H, "AcAd", "Kh7sKc9c2d") == "two pair"
    assert cat(H, "AcQd", "Ah7s5c9c2d") == "pair"
    assert cat(H, "AcQd", "Jh7s5c9c2d") == "high card"


def test_ordering_and_kickers():
    b = cards("Kh7s5c9c2d")
    assert H.rank(cards("AcKd"), b) > H.rank(cards("QcKs"), b)        # kicker
    assert H.rank(cards("AcKd"), b) == H.rank(cards("AhKc"), b)       # split
    assert H.rank(cards("6c8d"), b) > H.rank(cards("KcKd"), b)        # straight > set
    assert H.rank(cards("3c4d"), cards("Ah5s2c9c9d")) < H.rank(cards("3c6d"), cards("4h5s2c9c9d"))  # wheel < 6-high


def test_shortdeck():
    assert cat(S, "Ah6d", "7c8s9h2c3d") == "straight"                # A-6-7-8-9
    b = cards("Th9h6h6c7d")
    assert S.rank(cards("AhKh"), b) > S.rank(cards("6sTc"), b)        # flush > full house
    b = cards("TsJh8c6dAc")
    assert S.rank(cards("TcTd"), b) > S.rank(cards("9sQd"), b)        # trips > straight


def test_omaha_must_use_two():
    # four hearts on board, one heart in hand -> no flush in Omaha
    assert cat(O, "AhKsQd2c", "3h5h7h9hJc") != "flush"
    assert cat(O, "AhKhQd2c", "3h5h7h9cJc") == "flush"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
