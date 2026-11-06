"""Candlestick pattern detection for chart signals.

All functions are pure, transparent heuristics — not probabilities or trade
recommendations. They describe what a candle formation looks like so a trader
can decide. No pattern here guarantees a reversal or continuation.
"""

from __future__ import annotations

from typing import Any

from .indicators import _round


def _body(bar: dict) -> float:
    return abs(bar["c"] - bar["o"])


def _range(bar: dict) -> float:
    return bar["h"] - bar["l"]


def _upper_wick(bar: dict) -> float:
    return bar["h"] - max(bar["o"], bar["c"])


def _lower_wick(bar: dict) -> float:
    return min(bar["o"], bar["c"]) - bar["l"]


def _is_green(bar: dict) -> bool:
    return bar["c"] >= bar["o"]


def _is_red(bar: dict) -> bool:
    return bar["c"] < bar["o"]


def _signal(
    bars: list[dict],
    index: int,
    pattern: str,
    label: str,
    side: str,
    strength: str = "medium",
) -> dict | None:
    bar = bars[index]
    # Signal price: high for bearish (resistance/rejection), low for bullish (support/acceptance)
    price = bar["l"] if side == "bullish" else bar["h"]
    return {
        "t": int(bar["t"]),
        "price": _round(price, 2),
        "pattern": pattern,
        "label": label,
        "side": side,
        "strength": strength,
        "index": index,
    }


def detect_hammer(bars: list[dict], index: int) -> dict | None:
    """Hammer: small body at top, long lower wick (~2x body), tiny upper wick.

    Bullish reversal candidate when it appears after a downtrend.
    """
    if index < 2:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if body == 0 or rng == 0:
        return None
    lower_wick = _lower_wick(bar)
    upper_wick = _upper_wick(bar)
    # body in top third of range, lower wick at least 2x body, upper wick small
    body_position = (max(bar["o"], bar["c"]) - bar["l"]) / rng
    if (
        lower_wick >= 2 * body
        and upper_wick <= body * 0.5
        and body_position >= 0.6
        and body <= rng * 0.3
    ):
        # Confirm with prior downtrend (last 3 bars lower lows)
        prior_low_trend = all(
            bars[index - i]["l"] > bars[index - i - 1]["l"] for i in range(1, 3) if index - i - 1 >= 0
        )
        side = "bullish" if prior_low_trend else "neutral"
        return _signal(bars, index, "hammer", "Hammer", side, "strong" if side == "bullish" else "weak")
    return None


def detect_hanging_man(bars: list[dict], index: int) -> dict | None:
    """Hanging Man: hammer shape but after an uptrend — bearish reversal candidate."""
    if index < 2:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if body == 0 or rng == 0:
        return None
    lower_wick = _lower_wick(bar)
    upper_wick = _upper_wick(bar)
    body_position = (max(bar["o"], bar["c"]) - bar["l"]) / rng
    if (
        lower_wick >= 2 * body
        and upper_wick <= body * 0.5
        and body_position >= 0.6
        and body <= rng * 0.3
    ):
        # Confirm with prior uptrend (last 3 bars higher highs)
        prior_high_trend = all(
            bars[index - i]["h"] < bars[index - i - 1]["h"] for i in range(1, 3) if index - i - 1 >= 0
        )
        side = "bearish" if prior_high_trend else "neutral"
        return _signal(
            bars, index, "hanging_man", "Hanging Man", side, "strong" if side == "bearish" else "weak"
        )
    return None


def detect_shooting_star(bars: list[dict], index: int) -> dict | None:
    """Shooting Star: small body at bottom, long upper wick — bearish reversal."""
    if index < 2:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if body == 0 or rng == 0:
        return None
    upper_wick = _upper_wick(bar)
    lower_wick = _lower_wick(bar)
    body_position = (bar["h"] - min(bar["o"], bar["c"])) / rng
    if (
        upper_wick >= 2 * body
        and lower_wick <= body * 0.5
        and body_position >= 0.6
        and body <= rng * 0.3
    ):
        prior_high_trend = all(
            bars[index - i]["h"] < bars[index - i - 1]["h"] for i in range(1, 3) if index - i - 1 >= 0
        )
        side = "bearish" if prior_high_trend else "neutral"
        return _signal(
            bars,
            index,
            "shooting_star",
            "Shooting Star",
            side,
            "strong" if side == "bearish" else "weak",
        )
    return None


def detect_inverted_hammer(bars: list[dict], index: int) -> dict | None:
    """Inverted Hammer: shooting star shape after downtrend — bullish reversal."""
    if index < 2:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if body == 0 or rng == 0:
        return None
    upper_wick = _upper_wick(bar)
    lower_wick = _lower_wick(bar)
    body_position = (bar["h"] - min(bar["o"], bar["c"])) / rng
    if (
        upper_wick >= 2 * body
        and lower_wick <= body * 0.5
        and body_position >= 0.6
        and body <= rng * 0.3
    ):
        prior_low_trend = all(
            bars[index - i]["l"] > bars[index - i - 1]["l"] for i in range(1, 3) if index - i - 1 >= 0
        )
        side = "bullish" if prior_low_trend else "neutral"
        return _signal(
            bars,
            index,
            "inverted_hammer",
            "Inverted Hammer",
            side,
            "strong" if side == "bullish" else "weak",
        )
    return None


def detect_doji(bars: list[dict], index: int) -> dict | None:
    """Doji: open ≈ close, tiny body relative to range — market indecision."""
    if index < 1:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if rng == 0:
        return None
    if body <= rng * 0.05:
        side = "neutral"
        prev_close = bars[index - 1]["c"]
        if bar["c"] > prev_close:
            side = "bullish"
        elif bar["c"] < prev_close:
            side = "bearish"
        return _signal(bars, index, "doji", "Doji", side, "weak")
    return None


def detect_bullish_engulfing(bars: list[dict], index: int) -> dict | None:
    """Bullish Engulfing: green candle body fully covers previous red body."""
    if index < 1:
        return None
    prev, curr = bars[index - 1], bars[index]
    if not _is_red(prev) or not _is_green(curr):
        return None
    if curr["o"] <= prev["c"] and curr["c"] >= prev["o"]:
        return _signal(bars, index, "bullish_engulfing", "Bullish Engulfing", "bullish", "strong")
    return None


def detect_bearish_engulfing(bars: list[dict], index: int) -> dict | None:
    """Bearish Engulfing: red candle body fully covers previous green body."""
    if index < 1:
        return None
    prev, curr = bars[index - 1], bars[index]
    if not _is_green(prev) or not _is_red(curr):
        return None
    if curr["o"] >= prev["c"] and curr["c"] <= prev["o"]:
        return _signal(bars, index, "bearish_engulfing", "Bearish Engulfing", "bearish", "strong")
    return None


def detect_piercing_line(bars: list[dict], index: int) -> dict | None:
    """Piercing Line: green opens below prior red low, closes above prior red midpoint."""
    if index < 1:
        return None
    prev, curr = bars[index - 1], bars[index]
    if not _is_red(prev) or not _is_green(curr):
        return None
    prev_mid = (prev["o"] + prev["c"]) / 2
    if curr["o"] < prev["l"] and curr["c"] > prev_mid:
        return _signal(bars, index, "piercing_line", "Piercing Line", "bullish", "strong")
    return None


def detect_dark_cloud_cover(bars: list[dict], index: int) -> dict | None:
    """Dark Cloud Cover: red opens above prior green high, closes below prior green midpoint."""
    if index < 1:
        return None
    prev, curr = bars[index - 1], bars[index]
    if not _is_green(prev) or not _is_red(curr):
        return None
    prev_mid = (prev["o"] + prev["c"]) / 2
    if curr["o"] > prev["h"] and curr["c"] < prev_mid:
        return _signal(bars, index, "dark_cloud_cover", "Dark Cloud Cover", "bearish", "strong")
    return None


def detect_harami(bars: list[dict], index: int) -> dict | None:
    """Harami: small body completely inside previous large body — reversal potential."""
    if index < 1:
        return None
    prev, curr = bars[index - 1], bars[index]
    prev_body = _body(prev)
    if prev_body == 0:
        return None
    curr_body = _body(curr)
    # curr body inside prev body range, and curr is much smaller than prev
    lo = min(prev["o"], prev["c"])
    hi = max(prev["o"], prev["c"])
    if (
        curr_body < prev_body * 0.4
        and min(curr["o"], curr["c"]) >= lo
        and max(curr["o"], curr["c"]) <= hi
    ):
        side = "bullish" if _is_red(prev) and _is_green(curr) else "bearish"
        return _signal(bars, index, "harami", "Harami", side, "medium")
    return None


def detect_morning_star(bars: list[dict], index: int) -> dict | None:
    """Morning Star: long red, small indecision bar, long green — bullish reversal."""
    if index < 2:
        return None
    b0, b1, b2 = bars[index - 2], bars[index - 1], bars[index]
    body0 = _body(b0)
    body2 = _body(b2)
    rng0 = _range(b0)
    rng2 = _range(b2)
    if body0 == 0 or rng0 == 0 or body2 == 0:
        return None
    if (
        _is_red(b0)
        and _is_green(b2)
        and _body(b1) <= max(body0, body2) * 0.4  # middle bar small
        and b1["c"] < b0["c"]  # middle still below first close
        and b2["c"] > (b0["o"] + b0["c"]) / 2  # third closes above first midpoint
    ):
        return _signal(bars, index, "morning_star", "Morning Star", "bullish", "strong")
    return None


def detect_evening_star(bars: list[dict], index: int) -> dict | None:
    """Evening Star: long green, small indecision bar, long red — bearish reversal."""
    if index < 2:
        return None
    b0, b1, b2 = bars[index - 2], bars[index - 1], bars[index]
    body0 = _body(b0)
    body2 = _body(b2)
    rng0 = _range(b0)
    if body0 == 0 or rng0 == 0 or body2 == 0:
        return None
    if (
        _is_green(b0)
        and _is_red(b2)
        and _body(b1) <= max(body0, body2) * 0.4
        and b1["c"] > b0["c"]
        and b2["c"] < (b0["o"] + b0["c"]) / 2
    ):
        return _signal(bars, index, "evening_star", "Evening Star", "bearish", "strong")
    return None


def detect_marubozu(bars: list[dict], index: int) -> dict | None:
    """Marubozu: no (or tiny) wicks, strong directional candle."""
    if index < 1:
        return None
    bar = bars[index]
    body = _body(bar)
    rng = _range(bar)
    if body == 0 or rng == 0:
        return None
    if (_upper_wick(bar) + _lower_wick(bar)) <= rng * 0.05:
        side = "bullish" if _is_green(bar) else "bearish"
        return _signal(bars, index, "marubozu", "Marubozu", side, "medium")
    return None


def detect_three_white_soldiers(bars: list[dict], index: int) -> dict | None:
    """Three White Soldiers: 3 consecutive green bars, each closing higher."""
    if index < 2:
        return None
    b0, b1, b2 = bars[index - 2], bars[index - 1], bars[index]
    if not (_is_green(b0) and _is_green(b1) and _is_green(b2)):
        return None
    if b0["c"] < b1["c"] < b2["c"] and b0["o"] < b1["o"] < b2["o"]:
        return _signal(bars, index, "three_white_soldiers", "Three White Soldiers", "bullish", "strong")
    return None


def detect_three_black_crows(bars: list[dict], index: int) -> dict | None:
    """Three Black Crows: 3 consecutive red bars, each closing lower."""
    if index < 2:
        return None
    b0, b1, b2 = bars[index - 2], bars[index - 1], bars[index]
    if not (_is_red(b0) and _is_red(b1) and _is_red(b2)):
        return None
    if b0["c"] > b1["c"] > b2["c"] and b0["o"] > b1["o"] > b2["o"]:
        return _signal(bars, index, "three_black_crows", "Three Black Crows", "bearish", "strong")
    return None


# Ordered detectors: later indices get priority when multiple patterns match on same bar.
_DETECTORS = [
    detect_three_white_soldiers,
    detect_three_black_crows,
    detect_morning_star,
    detect_evening_star,
    detect_bullish_engulfing,
    detect_bearish_engulfing,
    detect_piercing_line,
    detect_dark_cloud_cover,
    detect_harami,
    detect_hammer,
    detect_hanging_man,
    detect_shooting_star,
    detect_inverted_hammer,
    detect_doji,
    detect_marubozu,
]


def detect_candlestick_patterns(bars: list[dict]) -> list[dict]:
    """Scan all bars and return candlestick pattern signals.

    Returns a list of signal dicts (t, price, pattern, label, side, strength).
    Only the strongest matching pattern per bar is returned.
    """
    signals: list[dict] = []
    if len(bars) < 3:
        return signals
    for index in range(2, len(bars)):
        best: dict | None = None
        for detector in _DETECTORS:
            try:
                sig = detector(bars, index)
            except Exception:
                continue
            if sig is None:
                continue
            # Keep strongest pattern per bar; strong > medium > weak
            rank = {"strong": 3, "medium": 2, "weak": 1}.get(sig.get("strength", "medium"), 2)
            if best is None or rank > best.get("_rank", 0):
                sig["_rank"] = rank
                best = sig
        if best is not None:
            best.pop("_rank", None)
            signals.append(best)
    return signals


def pattern_signals_for_chart(bars: list[dict]) -> list[dict]:
    """Convert detected patterns into lightweight-charts compatible markers.

    Marker price uses the signal bar's extreme so it sits visibly above/below
    the candle on the chart.
    """
    signals = detect_candlestick_patterns(bars)
    markers: list[dict] = []
    for sig in signals:
        markers.append(
            {
                "time": sig["t"],
                "position": sig["price"],
                "color": "#38d9a9" if sig["side"] == "bullish" else "#ff6b81",
                "shape": "arrow_up" if sig["side"] == "bullish" else "arrow_down",
                "text": sig["label"],
                "size": 2,
                "external": {
                    "pattern": sig["pattern"],
                    "side": sig["side"],
                    "strength": sig["strength"],
                },
            }
        )
    return markers
