"""1-year Indian index scanner.

Scans every registered Indian index (broad, sectoral, BSE) over the previous
year of public daily candles and returns a compact per-index summary plus a
downsampled sparkline. Data is delayed public data, never fabricated —
indices that fail to return candles are marked unavailable.
"""

from __future__ import annotations

import asyncio

from . import market
from ..candlestick_patterns import detect_candlestick_patterns
from ..indicators import atr as atr_fn
from ..indicators import rsi as rsi_fn
from ..indicators import sma as sma_fn

# Every available Indian index in the SYMBOLS registry (existing + added).
SCAN_KEYS: list[str] = [
    "NIFTY",
    "SENSEX",
    "BANKNIFTY",
    "NIFTY_NEXT50",
    "NIFTY100",
    "NIFTY_MIDCAP50",
    "NIFTY_MIDCAP150",
    "NIFTY_IT",
    "NIFTY_AUTO",
    "NIFTY_PHARMA",
    "NIFTY_FMCG",
    "NIFTY_METAL",
    "NIFTY_ENERGY",
    "NIFTY_INFRA",
    "NIFTY_PSU_BANK",
    "NIFTY_REALTY",
    "BSE100",
    "BSE500",
    "INDIAVIX",
]

CATEGORIES: dict[str, str] = {
    "NIFTY": "broad",
    "SENSEX": "broad",
    "BANKNIFTY": "broad",
    "NIFTY_NEXT50": "broad",
    "NIFTY100": "broad",
    "NIFTY_MIDCAP50": "broad",
    "NIFTY_MIDCAP150": "broad",
    "NIFTY_IT": "sectoral",
    "NIFTY_AUTO": "sectoral",
    "NIFTY_PHARMA": "sectoral",
    "NIFTY_FMCG": "sectoral",
    "NIFTY_METAL": "sectoral",
    "NIFTY_ENERGY": "sectoral",
    "NIFTY_INFRA": "sectoral",
    "NIFTY_PSU_BANK": "sectoral",
    "NIFTY_REALTY": "sectoral",
    "BSE100": "bse",
    "BSE500": "bse",
    "INDIAVIX": "volatility",
}


def _last_value(series: list[float | None]) -> float | None:
    for value in reversed(series):
        if value is not None:
            return value
    return None


def _trend(close: float, sma50_value: float | None, sma200_value: float | None) -> str:
    if sma50_value is None and sma200_value is None:
        return "unknown"
    if sma50_value is None:
        return "uptrend" if close > sma200_value else "downtrend"
    if sma200_value is None:
        return "uptrend" if close > sma50_value else "downtrend"
    if close > sma50_value and close > sma200_value:
        return "strong_uptrend" if sma50_value > sma200_value else "uptrend"
    if close < sma50_value and close < sma200_value:
        return "strong_downtrend" if sma50_value < sma200_value else "downtrend"
    return "sideways"


def _summarise(key: str, payload: dict) -> dict:
    symbol = market.SYMBOLS.get(key, {})
    name = symbol.get("name", key)
    exchange = symbol.get("exchange", "—")
    # market.get_chart returns {"bars": [{"t","o","h","l","c","v"}...], "meta": ...}
    candles = payload.get("bars") or []
    bars = [
        {
            "t": c.get("t"),
            "o": c.get("o"),
            "h": c.get("h"),
            "l": c.get("l"),
            "c": c.get("c"),
            "v": c.get("v", 0) or 0,
        }
        for c in candles
        if c.get("c") is not None
    ]
    if len(bars) < 20:
        raise ValueError(f"Insufficient history for {key}")

    closes = [bar["c"] for bar in bars if bar["c"] is not None]
    if len(closes) < 20:
        raise ValueError(f"Insufficient closes for {key}")
    last_close = closes[-1]
    previous_close = closes[-2] if len(closes) > 1 else last_close
    first_close = closes[0]

    high_52w = max(bar["h"] for bar in bars if bar["h"] is not None)
    low_52w = min(bar["l"] for bar in bars if bar["l"] is not None)

    rsi_series = rsi_fn(closes, 14)
    rsi_value = _last_value(rsi_series)
    sma50_series = sma_fn(closes, 50)
    sma200_series = sma_fn(closes, 200)
    atr_series = atr_fn(bars, 14)
    atr_value = _last_value(atr_series)

    signals = detect_candlestick_patterns(bars)
    bullish_total = sum(1 for s in signals if s["side"] == "bullish")
    bearish_total = sum(1 for s in signals if s["side"] == "bearish")
    recent = signals[-8:] if len(signals) > 8 else signals
    recent_bull = sum(1 for s in recent if s["side"] == "bullish")
    recent_bear = sum(1 for s in recent if s["side"] == "bearish")

    day_change_pct = ((last_close - previous_close) / previous_close * 100) if previous_close else None
    year_change_pct = ((last_close - first_close) / first_close * 100) if first_close else None
    pct_from_high = ((last_close - high_52w) / high_52w * 100) if high_52w else None

    sma50_value = _last_value(sma50_series)
    sma200_value = _last_value(sma200_series)
    trend = _trend(last_close, sma50_value, sma200_value)

    # Downsampled sparkline: every other bar (~120 points) keeps cards light.
    times = [bar["t"] for bar in bars]
    step = max(1, len(closes) // 120)
    spark_times = times[::step]
    spark_closes = closes[::step]

    return {
        "key": key,
        "name": name,
        "short": symbol.get("short", key),
        "exchange": exchange,
        "category": CATEGORIES.get(key, "broad"),
        "currency": symbol.get("currency", "INR"),
        "available": True,
        "last_close": round(last_close, 2),
        "previous_close": round(previous_close, 2),
        "day_change_pct": round(day_change_pct, 2) if day_change_pct is not None else None,
        "year_change_pct": round(year_change_pct, 2) if year_change_pct is not None else None,
        "high_52w": round(high_52w, 2),
        "low_52w": round(low_52w, 2),
        "pct_from_52w_high": round(pct_from_high, 2) if pct_from_high is not None else None,
        "rsi14": round(rsi_value, 1) if rsi_value is not None else None,
        "sma50": round(sma50_value, 2) if sma50_value is not None else None,
        "sma200": round(sma200_value, 2) if sma200_value is not None else None,
        "trend": trend,
        "atr14": round(atr_value, 2) if atr_value is not None else None,
        "atr_pct": round(atr_value / last_close * 100, 2) if atr_value and last_close else None,
        "signals_bullish_total": bullish_total,
        "signals_bearish_total": bearish_total,
        "signals_recent_bullish": recent_bull,
        "signals_recent_bearish": recent_bear,
        "last_signal": recent[-1]["label"] if recent else None,
        "last_signal_side": recent[-1]["side"] if recent else None,
        "bar_count": len(closes),
        "spark_times": spark_times,
        "spark_closes": spark_closes,
    }


async def scan_indices() -> dict:
    """Scan all Indian indices over 1y of daily bars. Failures stay unavailable."""
    semaphore = asyncio.Semaphore(6)

    async def scan_one(key: str) -> dict:
        try:
            async with semaphore:
                payload = await market.get_chart(key, "1d", "1y")
            return _summarise(key, payload)
        except Exception:
            symbol = market.SYMBOLS.get(key, {})
            return {
                "key": key,
                "name": symbol.get("name", key),
                "short": symbol.get("short", key),
                "exchange": symbol.get("exchange", "—"),
                "category": CATEGORIES.get(key, "broad"),
                "currency": symbol.get("currency", "INR"),
                "available": False,
            }

    results = await asyncio.gather(*(scan_one(key) for key in SCAN_KEYS))

    available = [r for r in results if r["available"]]
    unavailable = [r for r in results if not r["available"]]
    available.sort(key=lambda r: r["year_change_pct"] or 0, reverse=True)

    advancing_1y = sum(1 for r in available if (r["year_change_pct"] or 0) > 0)
    advancing_day = sum(1 for r in available if (r["day_change_pct"] or 0) > 0)
    strongest = max(available, key=lambda r: r["year_change_pct"] or 0, default=None)
    weakest = min(available, key=lambda r: r["year_change_pct"] or 0, default=None)

    sample_meta = None
    try:
        _, sample_meta = await market.get_quotes(["NIFTY"])
    except Exception:
        sample_meta = None

    return {
        "available": True,
        "scanned": len(results),
        "returned": len(available),
        "advancing_1y": advancing_1y,
        "declining_1y": len(available) - advancing_1y,
        "advancing_today": advancing_day,
        "declining_today": len(available) - advancing_day,
        "strongest": {k: strongest[k] for k in ("key", "name", "year_change_pct")} if strongest else None,
        "weakest": {k: weakest[k] for k in ("key", "name", "year_change_pct")} if weakest else None,
        "indices": available + unavailable,
        "meta": sample_meta or {},
    }
