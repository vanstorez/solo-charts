"""Original chart-structure analysis for Solo Charts.

The concepts below are public technical-analysis ideas. This module does not
copy, bundle or impersonate any third-party TradingView script.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ..cache import cache
from ..indicators import (
    atr,
    detect_fair_value_gaps,
    detect_liquidity_sweeps,
    detect_order_blocks,
    ema,
    find_swings,
    macd,
    market_structure,
    parabolic_sar,
    premium_discount,
    resample_bars,
    rsi,
)
from ..provenance import feed_meta
from ..providers import globaldatafeeds as gdf
from ..providers import yahoo
from ..timeutil import iso
from . import market

MTF_SPECS = [
    {"interval": "5m", "range": "5d", "label": "5m", "weight": 0.8},
    {"interval": "15m", "range": "5d", "label": "15m", "weight": 1.0},
    {"interval": "30m", "range": "5d", "label": "30m", "weight": 1.1},
    {"interval": "1h", "range": "1mo", "label": "1H", "weight": 1.3},
    {"interval": "4h", "range": "3mo", "label": "4H", "weight": 1.6, "derive_from": "1h"},
    {"interval": "1d", "range": "1y", "label": "1D", "weight": 2.0},
]


def _as_of(bar: dict | None) -> datetime | None:
    if not bar:
        return None
    try:
        return datetime.fromtimestamp(float(bar["t"]) / 1000, timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


async def _load_bars(symbol: dict, interval: str, range_value: str) -> dict:
    """Fetch bars from the licensed feed when mapped, otherwise Yahoo."""
    fetch_interval = interval
    factor = 1
    if interval == "4h":
        fetch_interval = "1h"
        factor = 4
    bars: list[dict] = []
    provider = "Yahoo Finance"
    error = None
    if symbol.get("gdf") and gdf.configured():
        try:
            count = market._range_bar_estimate(fetch_interval, range_value)
            result = await gdf.history(
                {"exchange": symbol["gdf"]["exchange"], "identifier": symbol["gdf"]["identifier"]},
                fetch_interval,
                count,
            )
            bars = result.get("bars") or []
            provider = "Global Datafeeds"
        except Exception as exc:
            error = str(exc)[:220]
    if not bars and symbol.get("yahoo"):
        try:
            yahoo_interval = market.INTERVAL_MAP[fetch_interval]
            result = await yahoo.chart(symbol["yahoo"], yahoo_interval, range_value, ttl=90)
            bars = result.get("bars") or []
            provider = "Yahoo Finance"
            error = None
        except Exception as exc:
            error = str(exc)[:220]
    if factor > 1:
        bars = resample_bars(bars, factor)
    return {"bars": bars, "provider": provider, "error": error, "source_interval": fetch_interval}


def _snapshot(bars: list[dict], provider: str, label: str, weight: float) -> dict:
    if len(bars) < 10:
        return {
            "label": label,
            "interval": label,
            "trend": "unavailable",
            "score": None,
            "price": None,
            "ema20": None,
            "ema50": None,
            "rsi": None,
            "macd_hist": None,
            "structure": "unavailable",
            "last_event": None,
            "bars": len(bars),
            "source": provider,
            "weight": weight,
            "error": "Fewer than 10 bars returned",
        }
    closes = [bar["c"] for bar in bars]
    ema20 = ema(closes, 20)[-1]
    ema50 = ema(closes, 50)[-1]
    rsi14 = rsi(closes, 14)[-1]
    macd_hist = macd(closes)["hist"][-1]
    score = sum(
        [
            bool(ema20 and closes[-1] > ema20),
            bool(ema20 and ema50 and ema20 > ema50),
            bool(rsi14 is not None and rsi14 >= 50),
            bool(macd_hist is not None and macd_hist > 0),
        ]
    )
    structure = market_structure(bars, find_swings(bars, 2, 2))
    return {
        "label": label,
        "interval": label,
        "trend": "bullish" if score >= 3 else "bearish" if score <= 1 else "neutral",
        "score": score,
        "score_pct": round(score / 4 * 100, 1),
        "price": round(closes[-1], 4),
        "ema20": round(ema20, 4) if ema20 is not None else None,
        "ema50": round(ema50, 4) if ema50 is not None else None,
        "rsi": round(rsi14, 2) if rsi14 is not None else None,
        "macd_hist": round(macd_hist, 5) if macd_hist is not None else None,
        "structure": structure["trend"],
        "last_event": structure["last_event"]["label"] if structure["last_event"] else None,
        "bars": len(bars),
        "source": provider,
        "weight": weight,
        "error": None,
    }


def _mtf(rows: list[dict]) -> dict:
    available = [row for row in rows if isinstance(row.get("score"), int)]
    if not available:
        return {
            "timeframes": rows,
            "direction": "unavailable",
            "alignment_pct": None,
            "confidence_label": "unavailable",
            "score": None,
            "note": "No timeframe returned enough bars for a trend calculation.",
        }
    total_weight = sum(row["weight"] for row in available)
    weighted = sum((row["score"] - 2) * row["weight"] for row in available) / (total_weight * 2)
    alignment = sum(abs(row["score"] - 2) * row["weight"] for row in available) / (total_weight * 2) * 100
    direction = "bullish" if weighted > 0.2 else "bearish" if weighted < -0.2 else "mixed"
    confidence_label = "high alignment" if alignment >= 75 else "moderate alignment" if alignment >= 45 else "mixed / low alignment"
    return {
        "timeframes": rows,
        "direction": direction,
        "alignment_pct": round(alignment, 1),
        "confidence_label": confidence_label,
        "score": round(weighted, 3),
        "note": (
            "Alignment is a transparent weighted count of four trend checks across six timeframes. "
            "It is not a probability, a win rate or a guarantee; the label is deliberately not called a forecast."
        ),
    }


def _structure_payload(bars: list[dict], provider: str) -> dict:
    swings = find_swings(bars, 2, 2)
    structure = market_structure(bars, swings)
    sar_points = parabolic_sar(bars)
    blocks = detect_order_blocks(bars, structure)
    gaps = detect_fair_value_gaps(bars, atr(bars, 14))
    sweeps = detect_liquidity_sweeps(bars, swings)
    pd = premium_discount(bars, 50)
    fresh_blocks = [block for block in blocks if block["status"] == "fresh"]
    tested_blocks = [block for block in blocks if block["status"] == "tested"]
    invalidated_blocks = [block for block in blocks if block["status"] == "invalidated"]
    latest_sar = sar_points[-1] if sar_points else None
    summary = []
    if structure["last_event"]:
        event = structure["last_event"]
        summary.append(f"Latest structure event: {event['label']} at {event['price']:.2f}.")
    else:
        summary.append("No confirmed BOS/CHoCH in the returned window.")
    summary.append(
        f"Order blocks: {len(fresh_blocks)} fresh, {len(tested_blocks)} tested, {len(invalidated_blocks)} invalidated."
    )
    if gaps:
        summary.append(f"Fair-value gaps: {len([g for g in gaps if g['status'] == 'fresh'])} fresh, {len([g for g in gaps if g['status'] == 'filled'])} filled.")
    if pd.get("available"):
        summary.append(f"Price is in the {pd['zone']} half of the last {pd['lookback']} bars ({pd['position_pct']}%).")
    summary.append(f"Parabolic SAR is {latest_sar['trend'] if latest_sar else 'unavailable'}.")
    return {
        "structure": structure,
        "parabolic_sar": {
            "available": bool(sar_points),
            "latest": latest_sar,
            "points": [point for point in sar_points if point is not None],
        },
        "swings": swings[-30:],
        "order_blocks": blocks,
        "breaker_blocks": invalidated_blocks,
        "fair_value_gaps": gaps,
        "liquidity_sweeps": sweeps,
        "premium_discount": pd,
        "summary": summary,
        "source": provider,
    }


async def get_analysis(symbol_input: str = "NIFTY", interval_input: str = "1d", range_input: str = "1y") -> dict:
    symbol = market.resolve_symbol(symbol_input)
    if not symbol:
        return {"available": False, "reason": f"Unknown symbol: {symbol_input}"}
    interval = interval_input if interval_input in market.INTERVALS else "1d"
    allowed = market.ALLOWED_RANGES[interval]
    range_value = range_input if range_input in allowed else market.DEFAULT_RANGE[interval]
    cache_key = f"analysis:{symbol['key']}:{interval}:{range_value}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    fetch_tasks = [
        _load_bars(symbol, spec.get("derive_from", spec["interval"]), spec["range"])
        for spec in MTF_SPECS
    ]
    current_task = _load_bars(symbol, interval, range_value)
    results = await asyncio.gather(*fetch_tasks, current_task, return_exceptions=True)
    current_result = results[-1]
    if isinstance(current_result, Exception) or not current_result.get("bars"):
        detail = str(current_result)[:240] if isinstance(current_result, Exception) else (current_result or {}).get("error")
        return {
            "available": False,
            "reason": detail or "No bars returned for structure analysis.",
            "symbol": symbol["key"],
            "interval": interval,
            "range": range_value,
        }

    current_bars = current_result["bars"]
    current_provider = current_result["provider"]
    snapshots = []
    for index, spec in enumerate(MTF_SPECS):
        result = results[index]
        if isinstance(result, Exception):
            snapshots.append(
                {
                    "label": spec["label"],
                    "interval": spec["label"],
                    "trend": "unavailable",
                    "score": None,
                    "price": None,
                    "ema20": None,
                    "ema50": None,
                    "rsi": None,
                    "macd_hist": None,
                    "structure": "unavailable",
                    "last_event": None,
                    "bars": 0,
                    "source": "unavailable",
                    "weight": spec["weight"],
                    "error": str(result)[:220],
                }
            )
            continue
        snapshots.append(_snapshot(result["bars"], result["provider"], spec["label"], spec["weight"]))

    structure_payload = _structure_payload(current_bars, current_provider)
    mtf_payload = _mtf(snapshots)
    source_as_of = _as_of(current_bars[-1])
    meta = feed_meta(
        "Solo local analysis",
        f"structure and multi-timeframe trend ({interval})",
        as_of=source_as_of,
        source_type="derived",
        status="ok",
        detail=(
            f"Calculated locally from {current_provider} bars. MTF uses the same provider mapping per timeframe. "
            "SMC/order-block/breaker/FVG labels are original heuristic descriptions, not LuxAlgo, AlgoAlpha, "
            "GainzAlgo or Zeierman scripts and not institutional order flow."
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
        "input_provider": current_provider,
        "structure": structure_payload,
        "mtf": mtf_payload,
        "indicator_contract": [
            {"key": "parabolic_sar", "label": "Parabolic SAR", "status": "implemented", "note": "Public formula; dots are local calculations."},
            {"key": "market_structure", "label": "BOS / CHoCH", "status": "implemented", "note": "Confirmed swing breaks, not institutional intent."},
            {"key": "order_blocks", "label": "Order blocks", "status": "implemented", "note": "Last opposite candle before a structure break; heuristic."},
            {"key": "breaker_blocks", "label": "Breaker blocks", "status": "implemented", "note": "Failed order blocks; original definition, not a third-party script."},
            {"key": "fair_value_gaps", "label": "Fair value gaps", "status": "implemented", "note": "Three-candle imbalance with an ATR size filter."},
            {"key": "liquidity_sweeps", "label": "Liquidity sweeps", "status": "implemented", "note": "Wick through a prior swing then close back inside."},
            {"key": "premium_discount", "label": "Premium / discount", "status": "implemented", "note": "Position in the recent range; not a reversal probability."},
            {"key": "mtf_trend", "label": "Multi-timeframe trend", "status": "implemented", "note": "Four checks across six timeframes; alignment is not confidence."},
        ],
        "third_party_note": (
            "TradingView scripts such as LuxAlgo SMC, AlgoAlpha Breakout, Smart Money Concepts Probability, "
            "TradeVision Pro and VuManChu Swing are third-party works with their own licences. Solo does not "
            "copy, bundle or imply endorsement. This page implements independent, explainable equivalents."
        ),
    }
    return cache.set(cache_key, payload, 45)
