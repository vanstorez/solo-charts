"""NSE India direct quotes.

Reads the exchange's own public website endpoints (nseindia.com/api/...).
During market hours the NSE site updates these values in real time, which is
the best free-of-charge access that legally exists for personal use.

Rules enforced here:
- Personal, low-frequency access only: a single allIndices call per refresh
  window (no scraping loops, no bulk history pulls), cached in-process.
- Never fabricates: on failure the caller falls back to the usual delayed
  public providers and the value keeps its honest label.
- Strictly personal use. This is NOT a licensed data feed and NOT for resale
  or redistribution of any kind.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..config import get_settings
from ..timeutil import market_session
from .http import ProviderError, fetch_json

# Our registry key -> the index name used on nseindia.com
NSE_INDEX_NAMES: dict[str, str] = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "INDIAVIX": "INDIA VIX",
    "NIFTY_NEXT50": "NIFTY NEXT 50",
    "NIFTY100": "NIFTY 100",
    "NIFTY_MIDCAP50": "NIFTY MIDCAP 50",
    "NIFTY_MIDCAP150": "NIFTY MIDCAP 150",
    "NIFTY_IT": "NIFTY IT",
    "NIFTY_AUTO": "NIFTY AUTO",
    "NIFTY_PHARMA": "NIFTY PHARMA",
    "NIFTY_FMCG": "NIFTY FMCG",
    "NIFTY_METAL": "NIFTY METAL",
    "NIFTY_ENERGY": "NIFTY ENERGY",
    "NIFTY_INFRA": "NIFTY INFRA",
    "NIFTY_PSU_BANK": "NIFTY PSU BANK",
    "NIFTY_REALTY": "NIFTY REALTY",
    # Finance / services / media / consumption where present on the site
    "NIFTY_FIN_SERVICE": "NIFTY FIN SERVICE",
    "NIFTY_SERV_SECTOR": "NIFTY SERV SECTOR",
    "NIFTY_HEALTHCARE": "NIFTY HEALTHCARE",
    "NIFTY_CONSUMPTION": "NIFTY INDIA CONSUMPTION",
    "NIFTY_COMMODITIES": "NIFTY COMMODITIES",
    "NIFTY_CPSE": "NIFTY CPSE",
    "NIFTY_PVT_BANK": "NIFTY PVT BANK",
    "NIFTY_GROWTH_15": "NIFTY LOW VOLATILITY 30",
}

_STATE: dict[str, Any] = {"enabled_override": None}
_LOCK = asyncio.Lock()
_LAST_CALL = 0.0
MIN_CALL_GAP_SECONDS = 12.0  # polite ceiling: well under scraping pace
CACHE_KEY = "nse:all-indices"


def _enabled() -> bool:
    override = _STATE["enabled_override"]
    if override is not None:
        return bool(override)
    return bool(getattr(get_settings(), "nse_direct_enabled", True))


def set_enabled(value: bool | None) -> None:
    """Runtime override used by the settings endpoints (None = follow config)."""
    _STATE["enabled_override"] = value


def status() -> dict[str, Any]:
    session = market_session()
    return {
        "provider": "NSE India (nseindia.com public endpoints)",
        "enabled": _enabled(),
        "index_names_supported": len(NSE_INDEX_NAMES),
        "access": "personal use only — not a licensed feed, not for resale",
        "session_open": session["is_open"],
        "note": (
            "Single polite allIndices request per refresh window. When market is open the "
            "NSE site publishes near-real-time values; after close it marks the day's close."
        ),
    }


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


async def _guarded_wait() -> None:
    global _LAST_CALL
    async with _LOCK:
        gap = time.time() - _LAST_CALL
        if gap < MIN_CALL_GAP_SECONDS:
            await asyncio.sleep(MIN_CALL_GAP_SECONDS - gap)
        _LAST_CALL = time.time()


def _ttl_for_now() -> int:
    return 10 if market_session()["is_open"] else 120


async def all_indices() -> list[dict[str, str]]:
    """One polite request; returns the normalized rows for NSE indices."""
    await _guarded_wait()
    payload = await fetch_json(
        "nseindia",
        "https://www.nseindia.com/api/allIndices",
        timeout=15.0,
    )
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ProviderError("NSE allIndices returned no data rows")
    return rows


async def quotes(keys: list[str]) -> dict[str, dict[str, Any]]:
    """Live/eod quotes for the requested keys that are NSE index names."""
    if not _enabled():
        return {}
    wanted: dict[str, str] = {}
    for key in keys:
        name = NSE_INDEX_NAMES.get(key)
        if name:
            wanted[key] = name
    if not wanted:
        return {}

    from ..cache import cache

    async def fetch() -> dict[str, dict[str, Any]]:
        try:
            rows = await all_indices()
        except ProviderError:
            return {}
        lookup = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("index")
            if name:
                lookup[name] = row
        session_open = market_session()["is_open"]
        out: dict[str, dict[str, Any]] = {}
        for key, name in wanted.items():
            row = lookup.get(name)
            if not row:
                continue
            last = _to_float(row.get("last"))
            if last is None:
                continue
            variation = _to_float(row.get("variation")) or 0.0
            pchange = _to_float(row.get("percentChange"))
            if pchange is None:
                previous = _to_float(row.get("previousClose"))
                pchange = (variation / previous * 100) if previous else None
            out[key] = {
                "value": last,
                "change": round(variation, 2),
                "change_pct": round(pchange, 2) if pchange is not None else None,
                "open": _to_float(row.get("open")),
                "high": _to_float(row.get("dayHigh")),
                "low": _to_float(row.get("dayLow")),
                "previous_close": _to_float(row.get("previousClose")),
                "year_high": _to_float(row.get("yearHigh")),
                "year_low": _to_float(row.get("yearLow")),
                "as_of": row.get("lastUpdateTime") or row.get("perved") or None,
                "source": "NSE India (nseindia.com direct)",
                "live": bool(session_open),
                "data_status": "live" if session_open else "eod",
            }
        return out

    return await cache.get_or_set(CACHE_KEY, _ttl_for_now(), fetch)


async def probe() -> dict[str, Any]:
    """Live connectivity test used by the settings page."""
    try:
        rows = await all_indices()
        nifty = next((r for r in rows if r.get("index") == "NIFTY 50"), None)
        return {
            "ok": True,
            "indices_available": len(rows),
            "sample_nifty": {
                "last": _to_float(nifty.get("last")) if nifty else None,
                "percentChange": _to_float(nifty.get("percentChange")) if nifty else None,
            }
            if nifty
            else None,
            "checked_at": market_session()["ist_time"],
        }
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)[:240], "checked_at": market_session()["ist_time"]}
