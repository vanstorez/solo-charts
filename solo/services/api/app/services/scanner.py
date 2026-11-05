from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone
from typing import Any

from ..cache import cache
from ..indicators import adx, atr, bollinger_bands, macd, rsi
from ..provenance import feed_meta
from ..timeutil import iso
from . import market
from .market import SYMBOLS, resolve_symbol

PROVIDER = "Solo market scanner"

SCAN_CACHE_KEY = "solo:scanner:results"
SCAN_CACHE_TTL = 5 * 60 * 1000  # 5 minutes

# Scan conditions available
SCAN_CONDITIONS = [
    "rsi_oversold",      # RSI < 30
    "rsi_overbought",    # RSI > 70
    "macd_bullish",      # MACD hist > 0
    "macd_bearish",      # MACD hist < 0
    "price_above_sma20", # Price > SMA 20
    "price_below_sma20", # Price < SMA 20
    "price_above_vwap",  # Price > VWAP
    "price_below_vwap",  # Price < VWAP
    "bb_squeeze",        # Bollinger Band width < ATR * 0.5
    "bb_breakout_up",    # Price > upper BB
    "bb_breakout_down",  # Price < lower BB
    "adx_strong_trend",  # ADX > 25
]


def _clean(value: Any) -> Any:
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


def _evaluate_condition(
    bars: list[dict],
    condition: str,
) -> bool | None:
    """Evaluate a single scan condition on a set of bars. Returns True/False/None."""
    if len(bars) < 20:
        return None
    closes = [bar["c"] for bar in bars]
    highs = [bar["h"] for bar in bars]
    lows = [bar["l"] for bar in bars]
    volumes = [bar.get("v", 0) or 0 for bar in bars]
    last_close = closes[-1]

    rsi14 = rsi(closes, 14)
    macd_data = macd(closes)
    bb = bollinger_bands(closes, 20, 2.0)
    adx_data = adx(bars, 14)
    atr14 = atr(bars, 14)
    sma20 = [sum(closes[max(0, i - 19) : i + 1]) / 20 for i in range(len(closes))]

    rsi_val = _last_value(rsi14)
    macd_hist = _last_value(macd_data["hist"])
    bb_upper = _last_value(bb["upper"])
    bb_lower = _last_value(bb["lower"])
    bb_middle = _last_value(bb["middle"])
    atr_val = _last_value(atr14)
    sma20_val = _last_value(sma20)
    adx_val = _last_value(adx_data["adx"])

    # Typical price * volume for VWAP
    cum_pv = 0.0
    cum_v = 0.0
    vwap = None
    for bar in bars:
        tp = (bar["h"] + bar["l"] + bar["c"]) / 3
        vol = bar.get("v", 0) or 0
        cum_pv += tp * vol
        cum_v += vol
    if cum_v > 0:
        vwap = cum_pv / cum_v

    if condition == "rsi_oversold":
        return rsi_val is not None and rsi_val < 30
    if condition == "rsi_overbought":
        return rsi_val is not None and rsi_val > 70
    if condition == "macd_bullish":
        return macd_hist is not None and macd_hist > 0
    if condition == "macd_bearish":
        return macd_hist is not None and macd_hist < 0
    if condition == "price_above_sma20":
        return last_close > sma20_val if sma20_val else None
    if condition == "price_below_sma20":
        return last_close < sma20_val if sma20_val else None
    if condition == "price_above_vwap":
        return last_close > vwap if vwap else None
    if condition == "price_below_vwap":
        return last_close < vwap if vwap else None
    if condition == "bb_squeeze":
        if bb_upper and bb_lower and bb_middle and atr_val:
            width = (bb_upper - bb_lower) / bb_middle
            return width < (atr_val / bb_middle) * 0.5
        return None
    if condition == "bb_breakout_up":
        return last_close > bb_upper if bb_upper else None
    if condition == "bb_breakout_down":
        return last_close < bb_lower if bb_lower else None
    if condition == "adx_strong_trend":
        return adx_val is not None and adx_val > 25
    return None


async def _scan_symbol(symbol: dict, condition: str, interval: str, range_value: str) -> dict | None:
    """Scan a single symbol for a condition. Returns result dict or None on error."""
    try:
        yahoo = __import__("app.providers.yahoo", fromlist=["chart"]).chart
        yahoo_interval = market.INTERVAL_MAP[interval]
        result = await yahoo(symbol["yahoo"], yahoo_interval, range_value, ttl=90)
        bars = result.get("bars") or []
        if not bars:
            return None
        matched = _evaluate_condition(bars, condition)
        if matched is None:
            return None
        last_close = bars[-1]["c"]
        return {
            "key": symbol["key"],
            "name": symbol["name"],
            "short": symbol["short"],
            "exchange": symbol["exchange"],
            "price": round(last_close, 2),
            "change": round((last_close / bars[-2]["c"] - 1) * 100, 2) if len(bars) > 1 and bars[-2]["c"] else None,
            "condition": condition,
            "matched": matched,
            "provider": result.get("provider", "Yahoo Finance"),
        }
    except Exception:
        return None


async def scan_market(
    condition: str = "rsi_oversold",
    interval: str = "1d",
    range_value: str = "1y",
    symbols: list[str] | None = None,
) -> dict:
    """Scan symbols for a technical condition and return matches."""
    cache_key = f"{SCAN_CACHE_KEY}:{condition}:{interval}:{range_value}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Determine which symbols to scan
    if symbols:
        symbol_list = [resolve_symbol(s) for s in symbols]
        symbol_list = [s for s in symbol_list if s and s.get("yahoo")]
    else:
        # Scan all known symbols that have Yahoo data
        symbol_list = [
            {"key": key, **spec}
            for key, spec in SYMBOLS.items()
            if spec.get("yahoo")
        ]

    if not symbol_list:
        return {
            "condition": condition,
            "interval": interval,
            "range": range_value,
            "matches": [],
            "scanned": 0,
            "matched_count": 0,
            "error": "No symbols to scan",
            "meta": feed_meta(
                PROVIDER,
                f"market scanner ({condition})",
                as_of=datetime.now(timezone.utc),
                source_type="derived",
                status="unavailable",
                detail="No symbols available for scanning",
                fresh_after=300,
                stale_after=900,
            ),
        }

    # Scan all symbols concurrently (limited concurrency)
    semaphore = asyncio.Semaphore(8)

    async def scan_one(sym: dict) -> dict | None:
        async with semaphore:
            return await _scan_symbol(sym, condition, interval, range_value)

    results = await asyncio.gather(*(scan_one(s) for s in symbol_list), return_exceptions=True)

    matches: list[dict] = []
    scanned = 0
    for result in results:
        if isinstance(result, Exception):
            continue
        if result is None:
            continue
        scanned += 1
        if result.get("matched"):
            matches.append(result)

    matches.sort(key=lambda m: abs(m.get("change") or 0), reverse=True)

    source_as_of = datetime.now(timezone.utc)
    meta = feed_meta(
        PROVIDER,
        f"market scanner ({condition})",
        as_of=source_as_of,
        source_type="derived",
        status="ok",
        detail=f"Scanned {scanned} symbols for '{condition}' on {interval}. {len(matches)} matches found.",
        fresh_after=300,
        stale_after=900,
    )

    payload = {
        "condition": condition,
        "interval": interval,
        "range": range_value,
        "matches": matches,
        "scanned": scanned,
        "matched_count": len(matches),
        "meta": meta,
        "as_of": meta["as_of"],
        "note": "Scanner results are heuristic technical conditions — not trade signals. Paper trading only.",
    }
    return cache.set(cache_key, _clean(payload), SCAN_CACHE_TTL // 1000)
