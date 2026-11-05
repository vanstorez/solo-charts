from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from ..cache import cache
from ..provenance import feed_meta
from ..providers import yahoo
from ..timeutil import iso
from . import market

PROVIDER = "Yahoo Finance (Indian market data)"

# Curated Indian indices and sector proxies for day trading context.
INDIAN_INSTRUMENTS = [
    {"key": "NIFTY", "name": "Nifty 50", "short": "NIFTY", "yahoo": "^NSEI", "exchange": "NSE", "currency": "INR", "asset_class": "index"},
    {"key": "BANKNIFTY", "name": "Nifty Bank", "short": "BANKNIFTY", "yahoo": "^NSEBANK", "exchange": "NSE", "currency": "INR", "asset_class": "index"},
    {"key": "SENSEX", "name": "Sensex", "short": "SENSEX", "yahoo": "^BSESN", "exchange": "BSE", "currency": "INR", "asset_class": "index"},
    {"key": "NIFTYIT", "name": "Nifty IT", "short": "NIFTY IT", "yahoo": "^CNXIT", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYINFRA", "name": "Nifty Infrastructure", "short": "NIFTY INFRA", "yahoo": "^CNXINFRA", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYREALTY", "name": "Nifty Realty", "short": "NIFTY REALTY", "yahoo": "^CNXREAL", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYAUTO", "name": "Nifty Auto", "short": "NIFTY AUTO", "yahoo": "^CNXAUTO", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYPHARMA", "name": "Nifty Pharma", "short": "NIFTY PHARMA", "yahoo": "^CNXPHARMA", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYFMCG", "name": "Nifty FMCG", "short": "NIFTY FMCG", "yahoo": "^CNXFMCG", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYMETAL", "name": "Nifty Metal", "short": "NIFTY METAL", "yahoo": "^CNXMETAL", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "NIFTYENERGY", "name": "Nifty Energy", "short": "NIFTY ENERGY", "yahoo": "^CNXENERGY", "exchange": "NSE", "currency": "INR", "asset_class": "sector"},
    {"key": "INDIAVIX", "name": "India VIX", "short": "INDIA VIX", "yahoo": "^INDIAVIX", "exchange": "NSE", "currency": "INR", "asset_class": "volatility"},
]


async def _fetch_one(item: dict) -> tuple[dict, datetime | None]:
    symbol = item["yahoo"]
    as_of_dt: datetime | None = None
    try:
        snap = await yahoo.snapshot(symbol, ttl=90)
        as_of_dt = snap.get("as_of")
        return {
            **item,
            "value": snap.get("value"),
            "change": snap.get("change"),
            "previous_close": snap.get("previous_close"),
            "day_high": snap.get("day_high"),
            "day_low": snap.get("day_low"),
            "volume": snap.get("volume"),
            "as_of": iso(as_of_dt) if as_of_dt else None,
            "source": "Yahoo Finance public chart metadata",
            "data_status": "delayed",
            "delay_seconds": None,
            "error": None,
        }, as_of_dt
    except Exception as exc:
        return {
            **item,
            "value": None,
            "change": None,
            "previous_close": None,
            "day_high": None,
            "day_low": None,
            "volume": None,
            "as_of": None,
            "source": "unavailable",
            "data_status": "unavailable",
            "delay_seconds": None,
            "error": str(exc)[:200],
        }, None


async def indian_markets() -> dict:
    results = await asyncio.gather(*(_fetch_one(item) for item in INDIAN_INSTRUMENTS))
    rows: list[dict] = []
    as_of_dts: list[datetime] = []
    for row, as_of_dt in results:
        rows.append(row)
        if as_of_dt:
            as_of_dts.append(as_of_dt)
    returned = sum(1 for row in rows if row["value"] is not None)
    failed = len(rows) - returned
    latest = max(as_of_dts) if as_of_dts else None

    # Simple, transparent day-trading bias conclusion from price vs previous close.
    bias_votes = []
    for row in rows:
        if row["value"] is None or row["previous_close"] is None:
            continue
        change_pct = ((row["value"] - row["previous_close"]) / row["previous_close"]) * 100
        if change_pct > 0.3:
            bias_votes.append("bullish")
        elif change_pct < -0.3:
            bias_votes.append("bearish")
        else:
            bias_votes.append("neutral")

    if not bias_votes:
        conclusion = "unavailable"
        confidence_pct = None
        note = "No usable market data returned; conclusion cannot be formed."
    else:
        bullish = bias_votes.count("bullish")
        bearish = bias_votes.count("bearish")
        neutral = bias_votes.count("neutral")
        total = len(bias_votes)
        if bullish > bearish and bullish > neutral:
            conclusion = "bullish"
        elif bearish > bullish and bearish > neutral:
            conclusion = "bearish"
        else:
            conclusion = "mixed / neutral"
        max_side = max(bullish, bearish, neutral)
        confidence_pct = round(max_side / total * 100, 1)
        note = (
            f"{bullish} bullish, {bearish} bearish, {neutral} neutral instruments. "
            "Transparent heuristic: price vs previous close across major indices and sectors. "
            "Not a trade signal; use with your own risk rules."
        )

    meta = feed_meta(
        PROVIDER,
        "NSE/BSE indices and sector proxies",
        as_of=latest,
        source_type="delayed",
        status="ok" if failed == 0 else "degraded" if returned > 0 else "unavailable",
        detail=(
            f"{returned}/{len(rows)} Indian market snapshots returned. Yahoo Finance does not publish "
            "an exact NSE/BSE delay, so values remain delayed/unknown. Global Datafeeds licensed feed "
            "replaces this when configured."
        ),
        fresh_after=6 * 3600,
        stale_after=36 * 3600,
    )

    return {
        "market": "india",
        "quotes": rows,
        "conclusion": {
            "bias": conclusion,
            "confidence_pct": confidence_pct,
            "bullish_count": bullish if bias_votes else None,
            "bearish_count": bearish if bias_votes else None,
            "neutral_count": neutral if bias_votes else None,
            "note": note,
        },
        "meta": meta,
        "coverage": {
            "requested": len(rows),
            "returned": returned,
            "failed": failed,
            "errors": {row["key"]: row["error"] for row in rows if row["error"]},
        },
        "as_of": meta["as_of"],
        "note": (
            "Indian market data is delayed/unknown public snapshots. Missing instruments stay visibly unavailable. "
            "Day-trading bias is a transparent count across indices/sectors — not a recommendation. "
            "Paper trading only; live execution is hard-disabled."
        ),
    }


async def indian_status() -> dict:
    return {
        "market": "india",
        "provider": PROVIDER,
        "transport": "Public Yahoo Finance chart metadata",
        "freshness": "delayed/unknown",
        "instruments": len(INDIAN_INSTRUMENTS),
        "indices": sum(1 for i in INDIAN_INSTRUMENTS if i["asset_class"] == "index"),
        "sectors": sum(1 for i in INDIAN_INSTRUMENTS if i["asset_class"] == "sector"),
        "as_of": iso(datetime.now(timezone.utc)),
        "note": "Curated Indian market coverage for day-trading context. Not a consolidated NSE/BSE tape.",
    }
