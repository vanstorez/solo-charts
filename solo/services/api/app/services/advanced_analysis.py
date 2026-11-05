from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone
from typing import Any

from ..cache import cache
from ..indicators import (
    adx,
    atr,
    bollinger_bands,
    detect_chart_patterns,
    detect_support_resistance,
    ema,
    find_swings,
    macd,
    max_drawdown,
    obv,
    pivot_points,
    rsi,
    sma,
    stochastic,
    vwap,
)
from ..provenance import feed_meta
from ..timeutil import iso
from . import market

PROVIDER = "Solo advanced analysis"


def _clean(value: Any) -> Any:
    """Convert NaN/Inf to None so JSON serialization doesn't fail."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def _last_value(series: list[float | None]) -> float | None:
    for value in reversed(series):
        if value is not None and math.isfinite(value):
            return value
    return None


def _round_clean(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


ANALYSIS_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"]


async def _load_bars(symbol: dict, interval: str, range_value: str) -> dict:
    """Fetch bars from licensed feed when mapped, otherwise Yahoo."""
    bars: list[dict] = []
    provider = "Yahoo Finance"
    error = None
    if symbol.get("gdf") and __import__("app.providers.globaldatafeeds", fromlist=["configured"]).configured():
        try:
            gdf = __import__("app.providers.globaldatafeeds", fromlist=["history"]).history
            count = market._range_bar_estimate(interval, range_value)
            result = await gdf(
                {"exchange": symbol["gdf"]["exchange"], "identifier": symbol["gdf"]["identifier"]},
                interval,
                count,
            )
            bars = result.get("bars") or []
            provider = "Global Datafeeds"
        except Exception as exc:
            error = str(exc)[:220]
    if not bars and symbol.get("yahoo"):
        try:
            yahoo = __import__("app.providers.yahoo", fromlist=["chart"]).chart
            yahoo_interval = market.INTERVAL_MAP[interval]
            result = await yahoo(symbol["yahoo"], yahoo_interval, range_value, ttl=90)
            bars = result.get("bars") or []
            provider = "Yahoo Finance"
            error = None
        except Exception as exc:
            error = str(exc)[:220]
    return {"bars": bars, "provider": provider, "error": error}


async def advanced_analysis(symbol_input: str = "NIFTY", interval_input: str = "1d", range_input: str = "1y") -> dict:
    symbol = market.resolve_symbol(symbol_input)
    if not symbol:
        return {"available": False, "reason": f"Unknown symbol: {symbol_input}"}

    interval = interval_input if interval_input in market.INTERVALS else "1d"
    allowed = market.ALLOWED_RANGES[interval]
    range_value = range_input if range_input in allowed else market.DEFAULT_RANGE[interval]

    cache_key = f"advanced:{symbol['key']}:{interval}:{range_value}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = await _load_bars(symbol, interval, range_value)
    bars = result["bars"]
    provider = result["provider"]
    error = result.get("error")

    if not bars:
        return {
            "available": False,
            "reason": error or "No bars returned for advanced analysis.",
            "symbol": symbol["key"],
            "interval": interval,
            "range": range_value,
        }

    closes = [bar["c"] for bar in bars]
    highs = [bar["h"] for bar in bars]
    lows = [bar["l"] for bar in bars]
    volumes = [bar.get("v", 0) or 0 for bar in bars]
    last_close = closes[-1]

    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    ema20 = ema(closes, 20)
    ema50 = ema(closes, 50)
    rsi14 = rsi(closes, 14)
    macd_data = macd(closes)
    bb = bollinger_bands(closes, 20, 2.0)
    stoch = stochastic(bars, 14, 3)
    obv_series = obv(bars)
    vwap_series = vwap(bars)
    adx_data = adx(bars, 14)
    atr14 = atr(bars, 14)
    pivot = pivot_points(bars[-1]) if bars else {}
    drawdown = max_drawdown(closes)

    swings = find_swings(bars, 2, 2)
    sr = detect_support_resistance(bars, swings)
    patterns = detect_chart_patterns(bars, swings)

    signal = _signal_from_indicators(
        last_close,
        _last_value(rsi14),
        _last_value(macd_data["hist"]),
        bb,
        adx_data,
        stoch,
        _last_value(vwap_series),
    )

    timeframes = []
    for tf in ["1d", "1h", "15m", "5m"]:
        try:
            tf_result = await _load_bars(symbol, tf, market.DEFAULT_RANGE.get(tf, "1d"))
            tf_bars = tf_result["bars"]
            if len(tf_bars) >= 10:
                tf_closes = [b["c"] for b in tf_bars]
                tf_rsi = rsi(tf_closes, 14)
                tf_macd = macd(tf_closes)
                tf_bb = bollinger_bands(tf_closes, 20, 2.0)
                tf_signal = _signal_from_indicators(
                    tf_closes[-1],
                    _last_value(tf_rsi),
                    _last_value(tf_macd["hist"]),
                    tf_bb,
                    adx(tf_bars, 14),
                    stochastic(tf_bars, 14, 3),
                    _last_value(vwap(tf_bars)),
                )
                timeframes.append(
                    {
                        "interval": tf,
                        "bias": tf_signal["bias"],
                        "score": tf_signal["score"],
                        "price": round(tf_closes[-1], 2),
                        "provider": tf_result["provider"],
                        "bars": len(tf_bars),
                    }
                )
        except Exception:
            timeframes.append(
                {"interval": tf, "bias": "unavailable", "score": 0, "price": None, "provider": "unavailable", "bars": 0}
            )

    source_as_of = None
    if bars:
        try:
            source_as_of = datetime.fromtimestamp(float(bars[-1]["t"]) / 1000, timezone.utc)
        except (TypeError, ValueError, OSError):
            source_as_of = None

    meta = feed_meta(
        PROVIDER,
        f"advanced technical analysis ({interval})",
        as_of=source_as_of,
        source_type="derived",
        status="ok" if not error else "degraded",
        detail=(
            f"Calculated locally from {provider} bars. Indicators are public formulas "
            "(SMA, EMA, RSI, MACD, Bollinger Bands, Stochastic, OBV, VWAP, ADX). "
            "Signal is a transparent heuristic score, not a trade recommendation."
        ),
        fresh_after=900,
        stale_after=6 * 3600,
    )

    payload = {
        "available": True,
        "symbol": symbol["key"],
        "name": symbol["name"],
        "exchange": symbol["exchange"],
        "interval": interval,
        "range": range_value,
        "generated_at": iso(datetime.now(timezone.utc)),
        "meta": meta,
        "input_provider": provider,
        "price": _round_clean(last_close),
        "change_pct": (
            _round_clean((last_close / closes[-2] - 1) * 100, 2) if len(closes) > 1 and closes[-2] else None
        ),
        "indicators": {
            "sma20": _round_clean(_last_value(sma20)),
            "sma50": _round_clean(_last_value(sma50)),
            "ema20": _round_clean(_last_value(ema20)),
            "ema50": _round_clean(_last_value(ema50)),
            "rsi14": _round_clean(_last_value(rsi14), 2),
            "macd": _round_clean(_last_value(macd_data["macd"]), 5),
            "macd_signal": _round_clean(_last_value(macd_data["signal"]), 5),
            "macd_hist": _round_clean(_last_value(macd_data["hist"]), 5),
            "bb_upper": _round_clean(_last_value(bb["upper"])),
            "bb_middle": _round_clean(_last_value(bb["middle"])),
            "bb_lower": _round_clean(_last_value(bb["lower"])),
            "stoch_k": _round_clean(_last_value(stoch["k"]), 2),
            "stoch_d": _round_clean(_last_value(stoch["d"]), 2),
            "obv": _round_clean(_last_value(obv_series), 2),
            "vwap": _round_clean(_last_value(vwap_series), 4),
            "adx": _round_clean(_last_value(adx_data["adx"]), 2),
            "plus_di": _round_clean(_last_value(adx_data["plus_di"]), 2),
            "minus_di": _round_clean(_last_value(adx_data["minus_di"]), 2),
            "atr14": _round_clean(_last_value(atr14), 4),
            "pivot": {k: _round_clean(v) for k, v in pivot.items()} if pivot else {},
            "drawdown": drawdown,
        },
        "levels": sr,
        "patterns": patterns,
        "signal": signal,
        "timeframes": timeframes,
        "series": {
            "closes": [_round_clean(c) for c in closes[-200:]],
            "times": [int(b["t"]) for b in bars[-200:]],
            "sma20": [_round_clean(v) for v in sma20[-200:]],
            "ema20": [_round_clean(v) for v in ema20[-200:]],
            "bb_upper": [_round_clean(v) for v in bb["upper"][-200:]],
            "bb_lower": [_round_clean(v) for v in bb["lower"][-200:]],
            "rsi14": [_round_clean(v, 2) for v in rsi14[-200:]],
            "macd_hist": [_round_clean(v, 5) for v in macd_data["hist"][-200:]],
        },
        "note": (
            "All indicators are public formulas calculated locally. The signal score is a transparent "
            "count of aligned conditions — not a probability, not a trade recommendation. "
            "Paper trading only; live execution is hard-disabled."
        ),
    }
    return cache.set(cache_key, _clean(payload), 45)


def _signal_from_indicators(
    close: float | None,
    rsi_value: float | None,
    macd_hist: float | None,
    bb: dict[str, list[float | None]],
    adx_data: dict[str, list[float | None]],
    stoch: dict[str, list[float | None]],
    vwap_value: float | None,
) -> dict[str, Any]:
    """Generate a transparent, explainable trading signal from indicator values."""
    if close is None:
        return {"bias": "unavailable", "score": 0, "reasons": ["No price data available"]}

    reasons: list[str] = []
    score = 0

    if rsi_value is not None:
        if rsi_value < 30:
            score += 1
            reasons.append(f"RSI {rsi_value:.1f} — oversold (bullish)")
        elif rsi_value > 70:
            score -= 1
            reasons.append(f"RSI {rsi_value:.1f} — overbought (bearish)")
        else:
            reasons.append(f"RSI {rsi_value:.1f} — neutral")

    if macd_hist is not None:
        if macd_hist > 0:
            score += 1
            reasons.append("MACD histogram positive (bullish momentum)")
        else:
            score -= 1
            reasons.append("MACD histogram negative (bearish momentum)")

    upper = _last_value(bb["upper"])
    middle = _last_value(bb["middle"])
    lower = _last_value(bb["lower"])
    if close and upper and lower:
        if close <= lower:
            score += 1
            reasons.append("Price at/below lower Bollinger Band (oversold bounce zone)")
        elif close >= upper:
            score -= 1
            reasons.append("Price at/above upper Bollinger Band (overbought rejection zone)")
        elif middle and close > middle:
            reasons.append("Price above Bollinger middle (short-term bullish)")
        elif middle and close < middle:
            reasons.append("Price below Bollinger middle (short-term bearish)")

    adx_value = _last_value(adx_data["adx"])
    plus_di = _last_value(adx_data["plus_di"])
    minus_di = _last_value(adx_data["minus_di"])
    if adx_value is not None and plus_di is not None and minus_di is not None:
        if adx_value > 25:
            if plus_di > minus_di:
                score += 1
                reasons.append(f"ADX {adx_value:.1f} — strong uptrend")
            else:
                score -= 1
                reasons.append(f"ADX {adx_value:.1f} — strong downtrend")
        else:
            reasons.append(f"ADX {adx_value:.1f} — weak/no trend")

    k = _last_value(stoch["k"])
    d = _last_value(stoch["d"])
    if k is not None and d is not None:
        if k < 20 and d < 20:
            score += 1
            reasons.append("Stochastic oversold (bullish)")
        elif k > 80 and d > 80:
            score -= 1
            reasons.append("Stochastic overbought (bearish)")

    if vwap_value is not None and close:
        if close > vwap_value:
            score += 0.5
            reasons.append("Price above VWAP (intraday bullish)")
        else:
            score -= 0.5
            reasons.append("Price below VWAP (intraday bearish)")

    if score > 0.5:
        bias = "bullish"
    elif score < -0.5:
        bias = "bearish"
    else:
        bias = "neutral"

    return {"bias": bias, "score": round(score, 2), "reasons": reasons}
