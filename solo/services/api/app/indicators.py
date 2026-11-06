import math
from statistics import mean


def _round(value: float | None, digits: int = 2) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def sma(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if period <= 0:
        return out
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= period:
            running -= values[index - period]
        if index >= period - 1:
            out[index] = running / period
    return out


def ema(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    multiplier = 2 / (period + 1)
    previous = mean(values[:period])
    out[period - 1] = previous
    for index in range(period, len(values)):
        previous = values[index] * multiplier + previous * (1 - multiplier)
        out[index] = previous
    return out


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return out
    gains = []
    losses = []
    for index in range(1, period + 1):
        delta = values[index] - values[index - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))
    average_gain = sum(gains) / period
    average_loss = sum(losses) / period
    out[period] = 100 if average_loss == 0 else 100 - 100 / (1 + average_gain / average_loss)
    for index in range(period + 1, len(values)):
        delta = values[index] - values[index - 1]
        gain = max(delta, 0)
        loss = max(-delta, 0)
        average_gain = (average_gain * (period - 1) + gain) / period
        average_loss = (average_loss * (period - 1) + loss) / period
        out[index] = 100 if average_loss == 0 else 100 - 100 / (1 + average_gain / average_loss)
    return out


def atr(bars: list[dict], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(bars)
    if len(bars) <= period:
        return out
    true_ranges = []
    for index, bar in enumerate(bars):
        if index == 0:
            true_ranges.append(bar["h"] - bar["l"])
            continue
        previous_close = bars[index - 1]["c"]
        true_ranges.append(
            max(bar["h"] - bar["l"], abs(bar["h"] - previous_close), abs(bar["l"] - previous_close))
        )
    previous = mean(true_ranges[1 : period + 1])
    out[period] = previous
    for index in range(period + 1, len(bars)):
        previous = (previous * (period - 1) + true_ranges[index]) / period
        out[index] = previous
    return out


def macd(values: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    fast_line = ema(values, fast)
    slow_line = ema(values, slow)
    line = [
        fast_value - slow_value if fast_value is not None and slow_value is not None else None
        for fast_value, slow_value in zip(fast_line, slow_line)
    ]
    non_null = [value for value in line if value is not None]
    signal_non_null = ema(non_null, signal)
    signal_line: list[float | None] = [None] * len(line)
    offset = len(line) - len(non_null)
    for index, value in enumerate(signal_non_null):
        signal_line[index + offset] = value
    histogram = [
        value - signal_value if value is not None and signal_value is not None else None
        for value, signal_value in zip(line, signal_line)
    ]
    return {"macd": line, "signal": signal_line, "hist": histogram}


def pivot_points(bar: dict) -> dict:
    pivot = (bar["h"] + bar["l"] + bar["c"]) / 3
    return {
        "p": pivot,
        "r1": 2 * pivot - bar["l"],
        "s1": 2 * pivot - bar["h"],
        "r2": pivot + (bar["h"] - bar["l"]),
        "s2": pivot - (bar["h"] - bar["l"]),
    }


def max_drawdown(values: list[float]) -> dict:
    if not values:
        return {"amount": 0.0, "pct": 0.0, "peak": None, "trough": None}
    peak = values[0]
    max_amount = 0.0
    max_pct = 0.0
    peak_value = values[0]
    trough_value = values[0]
    for value in values:
        if value > peak:
            peak = value
        drawdown = peak - value
        drawdown_pct = drawdown / peak if peak else 0
        if drawdown > max_amount:
            max_amount = drawdown
            max_pct = drawdown_pct
            peak_value = peak
            trough_value = value
    return {
        "amount": round(max_amount, 2),
        "pct": round(max_pct * 100, 2),
        "peak": round(peak_value, 2),
        "trough": round(trough_value, 2),
    }


def pct_change(values: list[float]) -> list[float]:
    out = []
    for previous, current in zip(values, values[1:]):
        if previous == 0:
            continue
        out.append(current / previous - 1)
    return out


def pearson(left: list[float], right: list[float]) -> float | None:
    size = min(len(left), len(right))
    if size < 3:
        return None
    x = left[-size:]
    y = right[-size:]
    mean_x = mean(x)
    mean_y = mean(y)
    numerator = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
    denominator = math.sqrt(sum((a - mean_x) ** 2 for a in x) * sum((b - mean_y) ** 2 for b in y))
    if denominator == 0:
        return None
    return max(-1.0, min(1.0, numerator / denominator))


def round_values(value: float | None, digits: int = 2) -> float | None:
    return _round(value, digits)


def parabolic_sar(bars: list[dict], step: float = 0.02, max_step: float = 0.2) -> list[dict | None]:
    """Standard Parabolic SAR with explicit trend state.

    This is the public formula, not a reproduction of any third-party script.
    The first bar has no SAR because the direction needs two bars to seed.
    """
    out: list[dict | None] = [None] * len(bars)
    if len(bars) < 2:
        return out
    rising = bars[1]["c"] >= bars[0]["c"]
    acceleration = step
    extreme = bars[0]["h"] if rising else bars[0]["l"]
    sar = bars[0]["l"] if rising else bars[0]["h"]
    for index in range(1, len(bars)):
        bar = bars[index]
        previous_sar = sar
        sar = previous_sar + acceleration * (extreme - previous_sar)
        if rising:
            if bar["l"] < sar:
                rising = False
                sar = extreme
                extreme = bar["l"]
                acceleration = step
            else:
                if bar["h"] > extreme:
                    extreme = bar["h"]
                    acceleration = min(max_step, acceleration + step)
                lower_guard = bars[index - 1]["l"]
                if index >= 2:
                    lower_guard = min(lower_guard, bars[index - 2]["l"])
                sar = min(sar, lower_guard)
        else:
            if bar["h"] > sar:
                rising = True
                sar = extreme
                extreme = bar["h"]
                acceleration = step
            else:
                if bar["l"] < extreme:
                    extreme = bar["l"]
                    acceleration = min(max_step, acceleration + step)
                upper_guard = bars[index - 1]["h"]
                if index >= 2:
                    upper_guard = max(upper_guard, bars[index - 2]["h"])
                sar = max(sar, upper_guard)
        out[index] = {
            "t": int(bar["t"]),
            "value": round(sar, 4),
            "trend": "bullish" if rising else "bearish",
        }
    return out


def find_swings(bars: list[dict], left: int = 2, right: int = 2) -> list[dict]:
    """Confirmed pivot highs/lows using only bars to the left and right."""
    if len(bars) < left + right + 1:
        return []
    swings: list[dict] = []
    for index in range(left, len(bars) - right):
        window = [
            item
            for offset, item in enumerate(bars[index - left : index + right + 1])
            if offset != left
        ]
        bar = bars[index]
        if bar["h"] > max(item["h"] for item in window):
            swings.append(
                {"index": index, "t": int(bar["t"]), "price": bar["h"], "kind": "high", "confirmed_at": index + right}
            )
        if bar["l"] < min(item["l"] for item in window):
            swings.append(
                {"index": index, "t": int(bar["t"]), "price": bar["l"], "kind": "low", "confirmed_at": index + right}
            )
    return sorted(swings, key=lambda item: (item["index"], item["kind"]))


def market_structure(bars: list[dict], swings: list[dict] | None = None) -> dict:
    """Heuristic BOS/CHoCH map from confirmed swing breaks.

    A close beyond the most recent confirmed swing high/low creates a BOS in
    the current trend and a CHoCH when it reverses that trend. It is a
    descriptive map, not proof of institutional intent.
    """
    swings = swings if swings is not None else find_swings(bars)
    pending: dict[int, list[dict]] = {}
    for swing in swings:
        pending.setdefault(swing["confirmed_at"], []).append(swing)
    last_high: dict | None = None
    last_low: dict | None = None
    trend = "neutral"
    events: list[dict] = []
    for index, bar in enumerate(bars):
        for swing in pending.get(index, []):
            if swing["kind"] == "high":
                last_high = swing
            else:
                last_low = swing
        if last_high and bar["c"] > last_high["price"]:
            direction = "bullish"
            event_type = "CHoCH" if trend == "bearish" else "BOS"
            events.append(
                {
                    "index": index,
                    "t": int(bar["t"]),
                    "price": bar["c"],
                    "level": last_high["price"],
                    "direction": direction,
                    "type": event_type,
                    "label": f"{event_type} ↑",
                    "swing_t": last_high["t"],
                }
            )
            trend = direction
            last_high = None
        if last_low and bar["c"] < last_low["price"]:
            direction = "bearish"
            event_type = "CHoCH" if trend == "bullish" else "BOS"
            events.append(
                {
                    "index": index,
                    "t": int(bar["t"]),
                    "price": bar["c"],
                    "level": last_low["price"],
                    "direction": direction,
                    "type": event_type,
                    "label": f"{event_type} ↓",
                    "swing_t": last_low["t"],
                }
            )
            trend = direction
            last_low = None
    return {"trend": trend, "events": events[-12:], "last_event": events[-1] if events else None}


def detect_order_blocks(bars: list[dict], structure: dict, lookback: int = 18) -> list[dict]:
    """Find the last opposite-colour candle before a confirmed structure break."""
    blocks: list[dict] = []
    for event in structure.get("events", [])[-10:]:
        index = int(event["index"])
        start = max(1, index - lookback)
        candidate = None
        for cursor in range(index - 1, start - 1, -1):
            bar = bars[cursor]
            if event["direction"] == "bullish" and bar["c"] < bar["o"]:
                candidate = (cursor, bar)
                break
            if event["direction"] == "bearish" and bar["c"] > bar["o"]:
                candidate = (cursor, bar)
                break
        if not candidate:
            continue
        cursor, bar = candidate
        top = bar["h"]
        bottom = bar["l"]
        later = bars[index + 1 :]
        if event["direction"] == "bullish":
            invalidated = any(item["c"] < bottom for item in later)
            tested = any(item["l"] <= top for item in later)
        else:
            invalidated = any(item["c"] > top for item in later)
            tested = any(item["h"] >= bottom for item in later)
        status = "invalidated" if invalidated else "tested" if tested else "fresh"
        blocks.append(
            {
                "t": int(bar["t"]),
                "event_t": event["t"],
                "side": event["direction"],
                "top": round(top, 4),
                "bottom": round(bottom, 4),
                "status": status,
                "label": f"{'Bullish' if event['direction'] == 'bullish' else 'Bearish'} order block",
            }
        )
    # A failed order block that was closed through is a breaker candidate.
    return blocks[-6:]


def detect_fair_value_gaps(bars: list[dict], atr_values: list[float | None], max_items: int = 8) -> list[dict]:
    """Three-candle imbalances with size relative to local ATR."""
    gaps: list[dict] = []
    for index in range(2, len(bars)):
        first, third = bars[index - 2], bars[index]
        atr_value = atr_values[index] if index < len(atr_values) else None
        if third["l"] > first["h"]:
            top, bottom = third["l"], first["h"]
            side = "bullish"
        elif third["h"] < first["l"]:
            top, bottom = first["l"], third["h"]
            side = "bearish"
        else:
            continue
        size = top - bottom
        if size <= 0 or (atr_value and size < atr_value * 0.12):
            continue
        later = bars[index + 1 :]
        if side == "bullish":
            deepest = min((item["l"] for item in later), default=top)
            filled = max(0.0, min(1.0, (top - max(deepest, bottom)) / size))
        else:
            highest = max((item["h"] for item in later), default=bottom)
            filled = max(0.0, min(1.0, (min(highest, top) - bottom) / size))
        status = "filled" if filled >= 0.95 else "tested" if filled >= 0.15 else "fresh"
        gaps.append(
            {
                "t": int(third["t"]),
                "side": side,
                "top": round(top, 4),
                "bottom": round(bottom, 4),
                "size": round(size, 4),
                "filled_pct": round(filled * 100, 1),
                "status": status,
                "label": f"{'Bullish' if side == 'bullish' else 'Bearish'} fair value gap",
            }
        )
    return gaps[-max_items:]


def detect_liquidity_sweeps(bars: list[dict], swings: list[dict], max_items: int = 8) -> list[dict]:
    """Wick through a prior swing followed by a close back inside."""
    sweeps: list[dict] = []
    for swing in swings:
        start = swing["index"] + 1
        for index in range(start, min(len(bars), start + 35)):
            bar = bars[index]
            if swing["kind"] == "high" and bar["h"] > swing["price"] and bar["c"] < swing["price"]:
                sweeps.append(
                    {
                        "t": int(bar["t"]),
                        "side": "buy_side",
                        "level": round(swing["price"], 4),
                        "extreme": round(bar["h"], 4),
                        "label": "Buy-side liquidity sweep",
                    }
                )
                break
            if swing["kind"] == "low" and bar["l"] < swing["price"] and bar["c"] > swing["price"]:
                sweeps.append(
                    {
                        "t": int(bar["t"]),
                        "side": "sell_side",
                        "level": round(swing["price"], 4),
                        "extreme": round(bar["l"], 4),
                        "label": "Sell-side liquidity sweep",
                    }
                )
                break
    return sweeps[-max_items:]


def premium_discount(bars: list[dict], lookback: int = 50) -> dict:
    window = bars[-lookback:] if len(bars) > lookback else bars
    if not window:
        return {"available": False, "reason": "No bars"}
    high = max(bar["h"] for bar in window)
    low = min(bar["l"] for bar in window)
    close = window[-1]["c"]
    span = high - low
    equilibrium = (high + low) / 2
    position = ((close - low) / span * 100) if span else 50
    zone = "premium" if position > 55 else "discount" if position < 45 else "equilibrium"
    return {
        "available": True,
        "range_high": round(high, 4),
        "range_low": round(low, 4),
        "equilibrium": round(equilibrium, 4),
        "position_pct": round(position, 1),
        "zone": zone,
        "lookback": len(window),
        "note": "Position inside the recent range. It is not a probability of reversal.",
    }


def resample_bars(bars: list[dict], factor: int) -> list[dict]:
    """Aggregate equal-period bars, for example 1h -> 4h."""
    if factor <= 1 or not bars:
        return bars
    bucket_ms = factor * 60 * 60 * 1000
    buckets: dict[int, dict] = {}
    for bar in bars:
        bucket = int(bar["t"] // bucket_ms * bucket_ms)
        current = buckets.get(bucket)
        if current is None:
            buckets[bucket] = {
                "t": int(bar["t"]),
                "o": bar["o"],
                "h": bar["h"],
                "l": bar["l"],
                "c": bar["c"],
                "v": bar.get("v", 0),
            }
        else:
            current["t"] = int(bar["t"])
            current["h"] = max(current["h"], bar["h"])
            current["l"] = min(current["l"], bar["l"])
            current["c"] = bar["c"]
            current["v"] += bar.get("v", 0)
    return list(buckets.values())


def stddev(values: list[float | None], period: int) -> list[float | None]:
    """Rolling population standard deviation over non-None values in window."""
    out: list[float | None] = [None] * len(values)
    if period <= 0:
        return out
    for index in range(period - 1, len(values)):
        window = [v for v in values[index - period + 1 : index + 1] if v is not None]
        if len(window) < period:
            continue
        mu = sum(window) / period
        variance = sum((v - mu) ** 2 for v in window) / period
        out[index] = math.sqrt(variance)
    return out


def bollinger_bands(
    values: list[float], period: int = 20, std_dev: float = 2.0
) -> dict[str, list[float | None]]:
    """Bollinger Bands: middle = SMA, upper/lower = middle ± std_dev * rolling stddev."""
    middle = sma(values, period)
    deviations = stddev([float(v) if v is not None else float("nan") for v in values], period)
    upper: list[float | None] = [None] * len(values)
    lower: list[float | None] = [None] * len(values)
    for index in range(len(values)):
        if middle[index] is not None and deviations[index] is not None:
            upper[index] = middle[index] + std_dev * deviations[index]
            lower[index] = middle[index] - std_dev * deviations[index]
    return {"upper": upper, "middle": middle, "lower": lower}


def stochastic(
    bars: list[dict], k_period: int = 14, d_period: int = 3
) -> dict[str, list[float | None]]:
    """Stochastic Oscillator: %K = (close - lowest low) / (highest high - lowest low) * 100."""
    k: list[float | None] = [None] * len(bars)
    if len(bars) < k_period:
        return {"k": k, "d": k}
    for index in range(k_period - 1, len(bars)):
        window = bars[index - k_period + 1 : index + 1]
        highest = max(bar["h"] for bar in window)
        lowest = min(bar["l"] for bar in window)
        close = bars[index]["c"]
        if highest == lowest:
            k[index] = 50.0
        else:
            k[index] = (close - lowest) / (highest - lowest) * 100
    d = sma([v if v is not None else float("nan") for v in k], d_period)
    return {"k": k, "d": d}


def obv(bars: list[dict]) -> list[float | None]:
    """On Balance Volume: cumulative volume, +vol on up close, -vol on down close."""
    out: list[float | None] = [None] * len(bars)
    if not bars:
        return out
    running = 0.0
    for index, bar in enumerate(bars):
        volume = bar.get("v", 0) or 0
        if index == 0:
            running = volume
        else:
            prev_close = bars[index - 1]["c"]
            if bar["c"] > prev_close:
                running += volume
            elif bar["c"] < prev_close:
                running -= volume
        out[index] = running
    return out


def vwap(bars: list[dict]) -> list[float | None]:
    """Volume Weighted Average Price: cumulative (typical_price * volume) / cumulative volume."""
    out: list[float | None] = [None] * len(bars)
    if not bars:
        return out
    cum_pv = 0.0
    cum_v = 0.0
    for index, bar in enumerate(bars):
        typical = (bar["h"] + bar["l"] + bar["c"]) / 3
        volume = bar.get("v", 0) or 0
        cum_pv += typical * volume
        cum_v += volume
        out[index] = cum_pv / cum_v if cum_v > 0 else None
    return out


def _true_ranges(bars: list[dict]) -> list[float]:
    ranges: list[float] = []
    for index, bar in enumerate(bars):
        if index == 0:
            ranges.append(bar["h"] - bar["l"])
        else:
            previous_close = bars[index - 1]["c"]
            ranges.append(
                max(bar["h"] - bar["l"], abs(bar["h"] - previous_close), abs(bar["l"] - previous_close))
            )
    return ranges


def _directional_movement(bars: list[dict]) -> tuple[list[float], list[float]]:
    plus_dm: list[float] = [0.0] * len(bars)
    minus_dm: list[float] = [0.0] * len(bars)
    for index in range(1, len(bars)):
        up_move = bars[index]["h"] - bars[index - 1]["h"]
        down_move = bars[index - 1]["l"] - bars[index]["l"]
        if up_move > down_move and up_move > 0:
            plus_dm[index] = up_move
        elif down_move > up_move and down_move > 0:
            minus_dm[index] = down_move
    return plus_dm, minus_dm


def adx(bars: list[dict], period: int = 14) -> dict[str, list[float | None]]:
    """Average Directional Index with +DI and -DI."""
    tr = _true_ranges(bars)
    plus_dm, minus_dm = _directional_movement(bars)
    n = len(bars)
    tr_smooth: list[float | None] = [None] * n
    plus_smooth: list[float | None] = [None] * n
    minus_smooth: list[float | None] = [None] * n
    if n <= period:
        return {"adx": tr_smooth, "plus_di": plus_smooth, "minus_di": minus_smooth}
    # Wilder smoothing: first value is sum of first `period`, then recursive.
    tr_sum = sum(tr[1 : period + 1])
    plus_sum = sum(plus_dm[1 : period + 1])
    minus_sum = sum(minus_dm[1 : period + 1])
    tr_smooth[period] = tr_sum
    plus_smooth[period] = plus_sum
    minus_smooth[period] = minus_sum
    for index in range(period + 1, n):
        tr_sum = tr_sum - tr_sum / period + tr[index]
        plus_sum = plus_sum - plus_sum / period + plus_dm[index]
        minus_sum = minus_sum - minus_sum / period + minus_dm[index]
        tr_smooth[index] = tr_sum
        plus_smooth[index] = plus_sum
        minus_smooth[index] = minus_sum
    plus_di: list[float | None] = [None] * n
    minus_di: list[float | None] = [None] * n
    dx: list[float | None] = [None] * n
    for index in range(period, n):
        if tr_smooth[index] and tr_smooth[index] > 0:
            plus_di[index] = 100 * plus_smooth[index] / tr_smooth[index]
            minus_di[index] = 100 * minus_smooth[index] / tr_smooth[index]
            di_sum = plus_di[index] + minus_di[index]
            if di_sum > 0:
                dx[index] = 100 * abs(plus_di[index] - minus_di[index]) / di_sum
    adx_out: list[float | None] = [None] * n
    if n > 2 * period - 1:
        adx_sum = sum(v for v in dx[period : 2 * period] if v is not None)
        adx_out[2 * period - 1] = adx_sum / period
        for index in range(2 * period, n):
            if dx[index] is not None:
                prev = adx_out[index - 1]
                adx_out[index] = (prev * (period - 1) + dx[index]) / period if prev is not None else dx[index]
    return {"adx": adx_out, "plus_di": plus_di, "minus_di": minus_di}


def detect_support_resistance(
    bars: list[dict], swings: list[dict] | None = None, min_touches: int = 2
) -> dict[str, list[dict]]:
    """Detect support and resistance levels from swing highs/lows with touch counts."""
    swings = swings if swings is not None else find_swings(bars, 2, 2)
    highs = [s for s in swings if s["kind"] == "high"]
    lows = [s for s in swings if s["kind"] == "low"]

    def cluster_levels(points: list[dict], kind: str) -> list[dict]:
        # Group nearby price levels within 0.5% of each other
        clusters: list[dict] = []
        sorted_points = sorted(points, key=lambda p: p["price"])
        for point in sorted_points:
            placed = False
            for cluster in clusters:
                if abs(cluster["price"] - point["price"]) / cluster["price"] <= 0.005:
                    cluster["touches"] += 1
                    cluster["bars"].append(point["index"])
                    cluster["price"] = (cluster["price"] * (cluster["touches"] - 1) + point["price"]) / cluster["touches"]
                    placed = True
                    break
            if not placed:
                clusters.append(
                    {"price": point["price"], "touches": 1, "kind": kind, "bars": [point["index"]]}
                )
        return [c for c in clusters if c["touches"] >= min_touches]

    resistance = cluster_levels(highs, "resistance")
    support = cluster_levels(lows, "support")
    resistance.sort(key=lambda c: c["price"], reverse=True)
    support.sort(key=lambda c: c["price"])
    return {"support": support[:8], "resistance": resistance[:8]}


def detect_chart_patterns(bars: list[dict], swings: list[dict] | None = None) -> list[dict]:
    """Simple heuristic chart patterns: double top/bottom, head and shoulders-ish."""
    swings = swings if swings is not None else find_swings(bars, 2, 2)
    patterns: list[dict] = []
    highs = [s for s in swings if s["kind"] == "high"]
    lows = [s for s in swings if s["kind"] == "low"]
    if len(highs) >= 2:
        h1, h2 = highs[-2], highs[-1]
        if abs(h1["price"] - h2["price"]) / h1["price"] <= 0.02 and h2["index"] > h1["index"]:
            patterns.append(
                {
                    "type": "double_top",
                    "label": "Double Top",
                    "price": round((h1["price"] + h2["price"]) / 2, 2),
                    "t": h2["t"],
                    "bias": "bearish",
                    "note": "Two swing highs near same level; breakdown below neckline confirms.",
                }
            )
    if len(lows) >= 2:
        l1, l2 = lows[-2], lows[-1]
        if abs(l1["price"] - l2["price"]) / l1["price"] <= 0.02 and l2["index"] > l1["index"]:
            patterns.append(
                {
                    "type": "double_bottom",
                    "label": "Double Bottom",
                    "price": round((l1["price"] + l2["price"]) / 2, 2),
                    "t": l2["t"],
                    "bias": "bullish",
                    "note": "Two swing lows near same level; breakout above neckline confirms.",
                }
            )
    return patterns[-6:]


def wma(values: list[float], period: int = 20) -> list[float | None]:
    """Weighted Moving Average: more recent bars weigh more."""
    out: list[float | None] = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    weights = list(range(1, period + 1))
    weight_sum = sum(weights)
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        out[index] = sum(v * w for v, w in zip(window, weights)) / weight_sum
    return out


def cci(bars: list[dict], period: int = 20) -> list[float | None]:
    """Commodity Channel Index: measures deviation from typical price mean."""
    typical = [(bar["h"] + bar["l"] + bar["c"]) / 3 for bar in bars]
    sma_t = sma(typical, period)
    out: list[float | None] = [None] * len(bars)
    if period <= 0 or len(bars) < period:
        return out
    for index in range(period - 1, len(bars)):
        window = typical[index - period + 1 : index + 1]
        mean_dev = sum(abs(v - sma_t[index]) for v in window) / period
        if mean_dev == 0:
            out[index] = 0.0
        else:
            out[index] = (typical[index] - sma_t[index]) / (0.015 * mean_dev)
    return out


def williams_r(bars: list[dict], period: int = 14) -> list[float | None]:
    """Williams %R: (highest high - close) / (highest high - lowest low) * -100."""
    out: list[float | None] = [None] * len(bars)
    if period <= 0 or len(bars) < period:
        return out
    for index in range(period - 1, len(bars)):
        window = bars[index - period + 1 : index + 1]
        hh = max(bar["h"] for bar in window)
        ll = min(bar["l"] for bar in window)
        if hh == ll:
            out[index] = -100.0
        else:
            out[index] = (hh - bars[index]["c"]) / (hh - ll) * -100
    return out


def supertrend(
    bars: list[dict], period: int = 10, multiplier: float = 3.0
) -> dict[str, list[float | None]]:
    """Supertrend: trend-following indicator based on ATR and median price."""
    n = len(bars)
    atr_values = atr(bars, period)
    hl2 = [(bar["h"] + bar["l"]) / 2 for bar in bars]
    basic_ub: list[float | None] = [None] * n
    basic_lb: list[float | None] = [None] * n
    final_ub: list[float | None] = [None] * n
    final_lb: list[float | None] = [None] * n
    supertrend_out: list[float | None] = [None] * n
    direction: list[str | None] = [None] * n
    for index in range(period, n):
        atr_v = atr_values[index] if atr_values[index] is not None else 0
        basic_ub[index] = hl2[index] + multiplier * atr_v
        basic_lb[index] = hl2[index] - multiplier * atr_v
    for index in range(period, n):
        if index == period:
            final_ub[index] = basic_ub[index]
            final_lb[index] = basic_lb[index]
        else:
            prev_close = bars[index - 1]["c"]
            prev_final_ub = final_ub[index - 1] if final_ub[index - 1] is not None else basic_ub[index]
            prev_final_lb = final_lb[index - 1] if final_lb[index - 1] is not None else basic_lb[index]
            final_ub[index] = (
                basic_ub[index] if basic_ub[index] < prev_final_ub or prev_close > prev_final_ub else prev_final_ub
            )
            final_lb[index] = (
                basic_lb[index] if basic_lb[index] > prev_final_lb or prev_close < prev_final_lb else prev_final_lb
            )
        if index == period:
            direction[index] = -1 if bars[index]["c"] <= final_ub[index] else 1
            supertrend_out[index] = final_ub[index] if direction[index] == -1 else final_lb[index]
        else:
            prev_st = supertrend_out[index - 1] if supertrend_out[index - 1] is not None else hl2[index]
            prev_dir = direction[index - 1] if direction[index - 1] is not None else 1
            if prev_dir == 1:
                if bars[index]["c"] <= final_lb[index]:
                    direction[index] = -1
                    supertrend_out[index] = final_ub[index]
                else:
                    direction[index] = 1
                    supertrend_out[index] = max(final_lb[index], prev_st)
            else:
                if bars[index]["c"] >= final_ub[index]:
                    direction[index] = 1
                    supertrend_out[index] = final_lb[index]
                else:
                    direction[index] = -1
                    supertrend_out[index] = min(final_ub[index], prev_st)
    return {"supertrend": supertrend_out, "direction": direction}


def keltner_channels(
    bars: list[dict], period: int = 20, multiplier: float = 2.0
) -> dict[str, list[float | None]]:
    """Keltner Channels: EMA ± multiplier * ATR."""
    typical = [(bar["h"] + bar["l"] + bar["c"]) / 3 for bar in bars]
    ema_typical = ema(typical, period)
    atr_values = atr(bars, period)
    upper: list[float | None] = [None] * len(bars)
    lower: list[float | None] = [None] * len(bars)
    for index in range(len(bars)):
        if ema_typical[index] is not None and atr_values[index] is not None:
            upper[index] = ema_typical[index] + multiplier * atr_values[index]
            lower[index] = ema_typical[index] - multiplier * atr_values[index]
    return {"middle": ema_typical, "upper": upper, "lower": lower}


def donchian_channels(bars: list[dict], period: int = 20) -> dict[str, list[float | None]]:
    """Donchian Channels: highest high / lowest low over period."""
    upper: list[float | None] = [None] * len(bars)
    lower: list[float | None] = [None] * len(bars)
    middle: list[float | None] = [None] * len(bars)
    for index in range(period - 1, len(bars)):
        window = bars[index - period + 1 : index + 1]
        hh = max(bar["h"] for bar in window)
        ll = min(bar["l"] for bar in window)
        upper[index] = hh
        lower[index] = ll
        middle[index] = (hh + ll) / 2
    return {"upper": upper, "middle": middle, "lower": lower}


def rate_of_change(values: list[float], period: int = 12) -> list[float | None]:
    """Rate of Change: (current - previous) / previous * 100."""
    out: list[float | None] = [None] * len(values)
    if period <= 0 or len(values) <= period:
        return out
    for index in range(period, len(values)):
        prev = values[index - period]
        if prev == 0:
            out[index] = None
        else:
            out[index] = (values[index] - prev) / prev * 100
    return out

