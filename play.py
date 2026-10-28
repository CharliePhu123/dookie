"""Play against the bots in your terminal.

    python3 play.py                                  # heads-up vs AdaptiveBot
    python3 play.py --opponents adaptive,simple,maniac,nit,station
    python3 play.py --variant shortdeck --speed 0.3 --ascii
"""
import argparse
import math
import os
import sys
import time

from pokerbot.bot import AdaptiveBot
from pokerbot.cards import RANKS
from pokerbot.engine import Table
from pokerbot.equity import EquityEngine, OppRange
from pokerbot.evaluator import CATEGORY_NAMES, Evaluator
from pokerbot.game import Action, CALL, CHECK, FOLD
from pokerbot.sparring import CallingStation, Exploiter, Maniac, Nit, RandomBot, SimpleEquityBot
from pokerbot.variant import PRESETS

BOTS = {"adaptive": AdaptiveBot, "simple": SimpleEquityBot, "exploiter": Exploiter,
        "nit": Nit, "maniac": Maniac, "station": CallingStation, "random": RandomBot}
ME = "YOU"
W, H = 80, 18                       # table canvas size
OVAL_W, OVAL_TOP = 50, 4
LEGEND = "b BLIND  X CHECK  C CALL  B BET  R RAISE  A ALL-IN  F FOLD  W WIN"


def fmt(n: int) -> str:
    return f"{n:,}"


def short(n: int) -> str:
    if n >= 10000:
        return f"{n / 1000:.0f}k"
    if n >= 1000:
        return f"{n / 1000:.1f}k".replace(".0k", "k")
    return str(n)


class Style:
    def __init__(self, color: bool, ascii_only: bool):
        self.color, self.ascii = color, ascii_only

    def paint(self, s, code):
        return f"\033[{code}m{s}\033[0m" if self.color else s

    def bold(self, s):
        return self.paint(s, "1")

    def dim(self, s):
        return self.paint(s, "2")

    def card_cells(self, c) -> list:
        """One list entry per visible column, so colour codes don't break alignment."""
        r, s = RANKS[c >> 2], c & 3
        suit = "cdhs"[s] if self.ascii else "♣♦♥♠"[s]
        code = "31" if s in (1, 2) else "1"
        return [self.paint(r, code), self.paint(suit, code)]


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.cells = [[" "] * w for _ in range(h)]

    def put(self, x, y, cells):
        if isinstance(cells, str):
            cells = list(cells)
        for i, ch in enumerate(cells):
            if 0 <= y < self.h and 0 <= x + i < self.w:
                self.cells[y][x + i] = ch

    def center(self, cx, y, cells):
        if isinstance(cells, str):
            cells = list(cells)
        self.put(max(0, min(self.w - len(cells), cx - len(cells) // 2)), y, cells)

    def render(self):
        return "\n".join("".join(row).rstrip() for row in self.cells)


class TableUI:
    """Keeps a picture of the current hand from engine events and draws it."""

    def __init__(self, variant, circle, bank, style, speed, reader=None):
        self.v, self.circle, self.bank, self.st = variant, circle, bank, style
        self.speed = speed
        self.reader = reader            # an AdaptiveBot whose read on you we display
        self.ev = Evaluator(variant)
        self.clear = sys.stdout.isatty() and not os.environ.get("NO_CLEAR")
        self.hand_no = 0
        self.message = ""

    # ---- event tracking ------------------------------------------------------------
    def reset(self, e):
        self.hand_no += 1
        self.button = e["button"]
        self.players = e["players"]
        self.board, self.hole, self.shown, self.winners, self.deltas = [], (), {}, set(), {}
        self.stacks = {p: self.bank[p] for p in self.players}
        self.bets = {p: 0 for p in self.players}
        self.folded, self.allin = set(), set()
        self.codes = {p: [[] for _ in range(self.v.num_streets + 1)] for p in self.players}
        self.street, self.pot, self.last_actor = 0, 0, None
        self.street_has_bet = False
        self.message = ""

    def observe(self, e):
        t = e["type"]
        if t == "hand_start":
            self.reset(e)
        elif t == "blinds":
            self.stacks, self.bets, self.pot = e["stacks"], e["bets"], e["pot"]
            for p in (e["sb"], e["bb"]):
                self.codes[p][0].append("b")
        elif t == "street":
            self.street, self.board = e["street"], list(e["board"])
            self.bets = {p: 0 for p in self.players}
            self.street_has_bet = False
            self.pause(0.6)
        elif t == "action":
            p, a = e["player"], e["action"]
            self.stacks, self.bets, self.pot = e["stacks"], e["bets"], e["pot_after"]
            self.last_actor = p
            if a == "fold":
                self.folded.add(p)
                code = "F"
            elif a == "check":
                code = "X"
            elif a == "call":
                code = "A" if e["all_in"] else "C"
            else:
                letter = "A" if e["all_in"] else ("B" if self.street > 0 and not self.street_has_bet else "R")
                code = letter + short(e["amount"])
                self.street_has_bet = True
            if e["all_in"]:
                self.allin.add(p)
            self.codes[p][e["street"]].append(code)
            if p != ME:
                self.draw()
                self.pause(1.0)
        elif t == "showdown":
            self.last_actor = None
            self.board = list(e["board"])
            self.shown = dict(e["hands"])
            self.winners = set(e["winners"])
        elif t == "hand_end":
            self.last_actor = None
            self.deltas = e["deltas"]
            for p, d in self.deltas.items():
                if d > 0:
                    self.winners.add(p)
                    self.codes[p][-1].append("W+" + short(d))

    def pause(self, k):
        if self.speed:
            time.sleep(self.speed * k)

    # ---- drawing -------------------------------------------------------------------
    def street_names(self):
        n = self.v.num_streets
        if n == 4:
            return ["PRE", "FLOP", "TURN", "RIVER"]
        return ["PRE"] + [f"ST{i}" for i in range(1, n)]

    def seat_xy(self, i, n):
        """Top-left-ish anchor (centre x, first line y) for seat i of n; seat 0 (you) at the bottom."""
        ang = math.pi / 2 + 2 * math.pi * i / n
        cy = OVAL_TOP + 4.5
        return round(W / 2 + 36 * math.cos(ang)), round(cy + 7.2 * math.sin(ang) - 1.5)

    def draw_oval(self, c):
        insets = [8, 5, 3, 2, 1, 1, 2, 3, 5, 8]
        left = [".", ".-'", ".'", "/", "|", "|", "\\", "'.", "'-.", "'"]
        right = [".", "'-.", "'.", "\\", "|", "|", "/", ".'", ".-'", "'"]
        x0 = (W - OVAL_W) // 2
        for r, (ins, l, rt) in enumerate(zip(insets, left, right)):
            fill = OVAL_W - 2 * ins - len(l) - len(rt)
            row = l + ("=" if r in (0, 9) else " ") * fill + rt
            c.put(x0 + ins, OVAL_TOP + r, [self.st.dim(ch) if ch != " " else " " for ch in row])

    def cards_cells(self, cs):
        out = []
        for c in cs:
            out += self.st.card_cells(c) + [" "]
        return out[:-1]

    def seat_lines(self, p):
        """Returns (name, stack, cards, tail) as lists of single-column cells."""
        st = self.st
        name = ("> " if p == self.last_actor and p not in self.folded else "") + \
            p.upper() + (" (D)" if p == self.button else "")
        name = [st.bold(ch) for ch in name] if p == ME else list(name)
        stack = list(fmt(self.stacks.get(p, self.bank[p])))
        if p in self.folded:
            cards = [st.dim(ch) for ch in "fold"]
        elif p == ME and self.hole:
            cards = self.cards_cells(self.hole)
        elif p in self.shown:
            cards = self.cards_cells(self.shown[p])
        else:
            cards = [st.dim(ch) for ch in " ".join(["##"] * self.v.hole_cards)]
        bet = self.bets.get(p, 0)
        tail = list("ALL-IN" if p in self.allin else (f"bet {fmt(bet)}" if bet else ""))
        return name, stack, cards, tail

    def table_canvas(self):
        c = Canvas(W, H)
        self.draw_oval(c)
        n = len(self.circle)
        for i, p in enumerate(self.circle):
            x, y = self.seat_xy(i, n)
            if p not in self.players:
                c.center(x, y + 1, self.st.dim(f"{p.upper()} (out)"))
                continue
            for dy, cells in enumerate(self.seat_lines(p)):
                c.center(x, y + dy, cells)
        # board + pot in the middle
        cy = OVAL_TOP + 4
        cells = []
        for i in range(self.v.board_size):
            if i < len(self.board):
                cells += ["["] + self.st.card_cells(self.board[i]) + ["]"]
            else:
                cells += [self.st.dim(ch) for ch in "[  ]"]
            cells.append(" ")
        c.center(W // 2, cy, cells[:-1])
        c.center(W // 2, cy + 2, f"POT {fmt(self.pot)}")
        return c

    def action_grid(self):
        names = self.street_names() + ["SHOW"]
        cw = max(10, (W - 12 - 10) // self.v.num_streets)
        widths = [cw] * self.v.num_streets + [10]
        head = f"{'STREET':<12}" + "".join(f"{n:<{w}}" for n, w in zip(names, widths))
        rows = [self.st.bold(head)]
        for p in self.circle:
            if p not in self.players:
                continue
            cells = ""
            for col, w in zip(self.codes[p], widths):
                txt = " ".join(col)
                txt = txt if len(txt) < w else txt[:w - 2] + "…"
                cells += f"{txt:<{w}}"
            label = f"{p.upper()[:11]:<12}"
            rows.append((self.st.bold(label) if p == ME else label) + cells.rstrip())
        rows.append(self.st.dim(LEGEND))
        return "\n".join(rows)

    def read_line(self):
        if not self.reader or ME not in self.reader.model.stats:
            return ""
        s = self.reader.model.stats[ME]
        if s.hands < 5:
            return self.st.dim("BOT'S READ ON YOU: still watching...")
        return self.st.dim(f"BOT'S READ ON YOU: plays {s.vpip_rate:.0%} of hands · raises "
                           f"{s.pfr_rate:.0%} · folds to bets {s.fold_rate:.0%} · bets into "
                           f"checks {s.stab_rate:.0%} · bluff estimate {s.stab_bluff_rate:.0%}")

    def draw(self):
        out = []
        if self.clear:
            out.append("\033[2J\033[H")
        b = self.v.big_blind
        street = self.street_names()[self.street] if not self.shown else "SHOWDOWN"
        hdr = f"HAND {self.hand_no:06d}, BLINDS {fmt(self.v.small_blind)}/{fmt(b)}"
        out.append(self.st.bold(f"{hdr}{street:>{W - len(hdr)}}"))
        out.append(self.table_canvas().render())
        out.append("=" * W)
        out.append(self.action_grid())
        rl = self.read_line()
        if rl:
            out.append(rl)
        if self.message:
            out.append(self.message)
        print("\n".join(out), flush=True)


class Human:
    def __init__(self, ui: TableUI, variant):
        self.ui = ui
        self.v = variant
        self.eq = EquityEngine(variant)

    def on_deal(self, hole):
        self.ui.hole = hole

    def observe(self, e):
        self.ui.observe(e)

    def act(self, s):
        ui = self.ui
        ui.last_actor = None
        ui.draw()
        opts = ["[f]old"]
        opts.append(f"[c]all {fmt(s.to_call)}" if s.to_call else "[x] check")
        if s.can_raise:
            word = "raise" if s.to_call or s.street == 0 else "bet"
            opts.append(f"[r <amt>] {word} to {fmt(s.min_raise_to)}-{fmt(s.max_raise_to)}")
            opts.append("[h]alf pot  [p]ot  [a]ll-in")
        opts.append("[?] odds  [q]uit")
        print(f"\nYOUR MOVE  pot {fmt(s.pot)} · to call {fmt(s.to_call)} · stack {fmt(s.my_stack)}")
        print("  " + "  ".join(opts))
        while True:
            try:
                raw = input("> ").strip().lower()
            except EOFError:
                raise SystemExit
            if not raw:
                continue
            cmd, _, arg = raw.partition(" ")
            if cmd in ("q", "quit", "exit"):
                raise SystemExit
            if cmd in ("f", "fold"):
                if not s.to_call:
                    print("  nothing to call, so checking is free: type x")
                    continue
                return FOLD
            if cmd in ("x", "k", "check"):
                if s.to_call:
                    print(f"  can't check, it's {fmt(s.to_call)} to call")
                    continue
                return CHECK
            if cmd in ("c", "call"):
                return CALL if s.to_call else CHECK
            if cmd in ("a", "allin", "all-in", "jam", "shove"):
                return s.raise_to(s.max_raise_to)
            if cmd in ("h", "p"):
                frac = 0.5 if cmd == "h" else 1.0
                return s.raise_to(s.my_street_bet + s.to_call + frac * (s.pot + s.to_call))
            if cmd in ("r", "b", "raise", "bet") or cmd.isdigit():
                txt = arg if not cmd.isdigit() else cmd
                try:
                    amt = int(txt.replace(",", "").replace("k", "000"))
                except ValueError:
                    print("  e.g. r 600  (raise TO 600 total this street)")
                    continue
                if not s.can_raise:
                    print("  can't raise here")
                    continue
                if amt < s.min_raise_to or amt > s.max_raise_to:
                    print(f"  raise must be {fmt(s.min_raise_to)}-{fmt(s.max_raise_to)}")
                    continue
                return Action("raise", amt)
            if cmd == "?":
                n = len(s.live_opponents)
                e = self.eq.equity(s.hole, s.board, [OppRange.any()] * n, 3000)
                odds = s.to_call / (s.pot + s.to_call) if s.to_call else 0
                msg = f"  equity vs {n} random hand{'s' * (n > 1)}: {e:.0%}"
                if s.to_call:
                    msg += f" · you need {odds:.0%} to call"
                if s.board:
                    msg += f" · you have {Evaluator(self.v).describe(s.hole, s.board)}"
                print(msg)
                continue
            print("  ?  f / x / c / r <amt> / h / p / a / ? / q")


def main():
    ap = argparse.ArgumentParser(description="Play poker against the bots.")
    ap.add_argument("--opponents", default="adaptive", help="comma list, up to 7: " + ",".join(BOTS))
    ap.add_argument("--variant", default="holdem", choices=sorted(PRESETS))
    ap.add_argument("--blinds", default="50/100")
    ap.add_argument("--stack", type=int, default=10000)
    ap.add_argument("--speed", type=float, default=0.6, help="seconds per bot action (0 = instant)")
    ap.add_argument("--ascii", action="store_true", help="letters instead of suit symbols")
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()

    sb, bb = (int(x) for x in a.blinds.split("/"))
    base = PRESETS[a.variant]
    v = base.__class__(**{**base.__dict__, "small_blind": sb, "big_blind": bb,
                          "ante": base.ante and max(1, bb // 4), "starting_stack": a.stack})
    names = [x.strip() for x in a.opponents.split(",") if x.strip()][:7]
    bots, circle = {}, [ME]
    for i, n in enumerate(names):
        pid = n if names.count(n) == 1 else f"{n}{i + 1}"
        bots[pid] = BOTS[n](v, seed=None if a.seed is None else a.seed + i)
        circle.append(pid)
    bank = {p: v.starting_stack for p in circle}
    buyins = {p: 1 for p in circle}
    reader = next((b for b in bots.values() if isinstance(b, AdaptiveBot)), None)
    style = Style(color=sys.stdout.isatty() and not a.no_color, ascii_only=a.ascii)
    ui = TableUI(v, circle, bank, style, a.speed, reader)
    bots[ME] = Human(ui, v)
    table = Table(v, bots, seed=a.seed)

    hand = 0
    try:
        while True:
            for p in circle:                     # auto rebuy anyone who busted
                if bank[p] < v.big_blind:
                    bank[p] = v.starting_stack
                    buyins[p] += 1
            b = hand % len(circle)
            seats = circle[b:] + circle[:b]
            deltas = table.play_hand(seats, hand, stacks=bank)
            for p, d in deltas.items():
                bank[p] += d
            ui.stacks = dict(bank)
            ws = [p for p, d in deltas.items() if d > 0]
            parts = []
            for w in ws:
                how = ""
                if ui.shown and w in ui.shown:
                    how = " with " + CATEGORY_NAMES[ui.ev.category(ui.ev.rank(ui.shown[w], ui.board))]
                parts.append(f"{w.upper()} wins {fmt(deltas[w])}{how}")
            net = bank[ME] - v.starting_stack * buyins[ME]
            ui.message = style.bold(" · ".join(parts)) + f"     your session: {'+' if net >= 0 else ''}{fmt(net)}"
            ui.draw()
            hand += 1
            try:
                if input("\n[enter] next hand · [q] quit > ").strip().lower() in ("q", "quit"):
                    break
            except EOFError:
                break
    except (SystemExit, KeyboardInterrupt):
        pass
    net = bank[ME] - v.starting_stack * buyins[ME]
    print(f"\nPlayed {hand} hand{'' if hand == 1 else 's'}. You finished {'+' if net >= 0 else ''}{fmt(net)} chips "
          f"({net / v.big_blind:+.1f} big blinds).")
    if reader and ME in reader.model.stats:
        print("What the bot learned about you:", reader.model.stats[ME].summary())


if __name__ == "__main__":
    main()
