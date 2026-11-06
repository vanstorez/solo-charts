"""Dhan (DhanHQ v2) Data API quotes — the broker-licensed personal live feed.

When the user configures their Dhan access token (SOLO_DHAN_TOKEN +
SOLO_DHAN_CLIENT_ID in solo/services/api/.env), NSE/BSE indices AND stocks get
real-time exchange-licensed values during market hours. Falls back silently to
the public delayed providers whenever Dhan is unconfigured or unreachable.

Personal use only. The token stays server-side and is never exposed to the browser.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import Any

import httpx

from ..config import get_settings
from ..timeutil import iso, market_session, utc_now
from .http import USER_AGENT

BASE_URL = "https://api.dhan.co/v2"

# Our registry key -> (exchange_segment_enum, security_id) from Dhan's master list:
# https://images.dhan.co/api-data/api-scrip-master-detailed.csv
SECURITY_IDS: dict[str, tuple[str, str]] = {
    "NIFTY": ("IDX_I", "13"),
    "BANKNIFTY": ("IDX_I", "25"),
    "INDIAVIX": ("IDX_I", "21"),
    "NIFTY_NEXT50": ("IDX_I", "38"),
    "NIFTY100": ("IDX_I", "17"),
    "NIFTY_MIDCAP50": ("IDX_I", "20"),
    "NIFTY_MIDCAP150": ("IDX_I", "1"),
    "NIFTY_IT": ("IDX_I", "29"),
    "NIFTY_AUTO": ("IDX_I", "14"),
    "NIFTY_PHARMA": ("IDX_I", "32"),
    "NIFTY_FMCG": ("IDX_I", "28"),
    "NIFTY_METAL": ("IDX_I", "31"),
    "NIFTY_ENERGY": ("IDX_I", "42"),
    "NIFTY_INFRA": ("IDX_I", "43"),
    "NIFTY_PSU_BANK": ("IDX_I", "33"),
    "NIFTY_REALTY": ("IDX_I", "34"),
    "NIFTY_PVT_BANK": ("IDX_I", "15"),
    "FINNIFTY": ("IDX_I", "27"),
    "SENSEX": ("IDX_I", "51"),  # BSE indices ride the same IDX segment key
    "RELIANCE": ("NSE_EQ", "2885"),
    "HDFCBANK": ("NSE_EQ", "1333"),
    "ICICIBANK": ("NSE_EQ", "4963"),
    "SBIN": ("NSE_EQ", "3045"),
    "AXISBANK": ("NSE_EQ", "5900"),
    "KOTAKBANK": ("NSE_EQ", "1922"),
    "TCS": ("NSE_EQ", "11536"),
    "INFY": ("NSE_EQ", "1594"),
    "ITC": ("NSE_EQ", "1660"),
    "LT": ("NSE_EQ", "11483"),
    "TATASTEEL": ("NSE_EQ", "3499"),
}

DHAN_ERRORS = {
    804: "too many instruments in one request",
    805: "rate limited — solo is calling too fast; slow the refresh",
    806: "Data APIs not subscribed on the Dhan account",
    807: "access token expired — generate a new Data API token on web.dhan.co",
    808: "client-id or token invalid",
    809: "access token invalid",
    810: "client-id invalid",
    813: "invalid security id",
}

_DHAN_GATE: asyncio.Lock = asyncio.Lock()
_MIN_GAP_SECONDS = 1.2  # documented limit: 1 request/second

# Permanent failures (not subscribed / bad credentials) park the provider so
# every browser refresh doesn't burn a request round-trip on a known dead end.
_STATE: dict[str, float] = {"cooldown_until": 0.0}


def _token() -> str:
    settings = get_settings()
    try:
        return settings.dhan_data_token.get_secret_value().strip()
    except AttributeError:
        return str(settings.dhan_data_token or "").strip()


def _client_id() -> str:
    return (getattr(get_settings(), "dhan_client_id", "") or "").strip()


def _enabled() -> bool:
    settings = get_settings()
    if not bool(getattr(settings, "dhan_enabled", True)) or not _token() or not _client_id():
        return False
    return _STATE["cooldown_until"] <= time.monotonic()


def _park(seconds: float) -> None:
    """Pause the provider after a permanent failure until this instant passes."""
    _STATE["cooldown_until"] = max(_STATE["cooldown_until"], time.monotonic() + seconds)


def status() -> dict[str, Any]:
    session_open = market_session()["is_open"]
    configured = bool(_token()) and bool(_client_id())
    state = "disabled" if not getattr(get_settings(), "dhan_enabled", True) else "not_configured" if not configured else ("live" if session_open else "ready")
    return {
        "provider": "Dhan Data API v2 (broker-licensed real-time)",
        "configured": configured,
        "state": state,
        "symbols_mapped": len(SECURITY_IDS),
        "session_open": session_open,
        "access": "personal brokerage entitlement — server-side only",
        "note": (
            "Real-time exchange-licensed values for NSE/BSE indices and mapped stocks."
            if configured
            else "Add SOLO_DHAN_TOKEN and SOLO_DHAN_CLIENT_ID in solo/services/api/.env to enable."
        ),
    }


def _markets_for(keys: list[str]) -> dict[str, list[str]]:
    markets: dict[str, list[str]] = {}
    for key in keys:
        mapped = SECURITY_IDS.get(key)
        if not mapped:
            continue
        markets.setdefault(mapped[0], []).append(mapped[1])
    return markets


async def _post(endpoint: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    async with _DHAN_GATE:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": _token(),
            "client-id": _client_id(),
        }
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            response = await client.post(f"{BASE_URL}/{endpoint}", json=body)
            if response.status_code in (401, 403):
                raise PermissionError("Dhan rejected credentials (HTTP 401/403) — token expired or wrong client-id")
            try:
                payload = response.json()
            except Exception as exc:
                raise RuntimeError(f"Dhan returned non-JSON (HTTP {response.status_code})") from exc
            if isinstance(payload, dict) and str(payload.get("errorCode", "")).strip():
                code = payload.get("errorCode")
                raise RuntimeError(DHAN_ERRORS.get(code, f"Dhan error {code}"))
            return payload


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_feed(payload: dict[str, Any], requested: list[str]) -> dict[str, dict[str, Any]]:
    """Turn {data: {SEGMENT: {security_id: {...}}}} rows into per-key rows."""
    reverse: dict[tuple[str, str], str] = {}
    for key in requested:
        mapped = SECURITY_IDS.get(key)
        if mapped:
            reverse[(mapped[0], mapped[1])] = key
    out: dict[str, dict[str, Any]] = {}
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return out
    session_open = market_session()["is_open"]
    for segment, rows in data.items():
        if not isinstance(rows, dict):
            continue
        for security_id, row in rows.items():
            key = reverse.get((str(segment), str(security_id)))
            if not key or not isinstance(row, dict):
                continue
            last = _to_float(row.get("last_price"))
            if last is None:
                continue
            ohlc = row.get("ohlc") or {}
            net_change = _to_float(row.get("net_change"))
            previous = _to_float(ohlc.get("close"))
            if net_change is None and previous:
                net_change = last - previous
            volume = _to_float(row.get("volume"))
            quote = {
                "value": last,
                "change": round(net_change, 2) if net_change is not None else None,
                "volume": volume,
                "rsi": None,
                "rating": None,
                "as_of": row.get("last_trade_time"),
                "source": "Dhan Data API (exchange real-time)",
                "data_status": "live" if session_open else "eod",
                "delay_seconds": 0 if session_open else None,
                "open": _to_float(ohlc.get("open")),
                "high": _to_float(ohlc.get("high")),
                "low": _to_float(ohlc.get("low")),
                "previous_close": previous,
            }
            out[key] = quote
    return out


async def quotes(keys: list[str], timeout: float | None = None) -> dict[str, dict[str, Any]]:
    """Live exchange-licensed quotes for keys we have security IDs for."""
    if not _enabled():
        return {}
    settings = get_settings()
    requested = [key for key in keys if key in SECURITY_IDS]
    if not requested:
        return {}
    endpoint = "marketfeed/quote"
    body = _markets_for(requested)
    try:
        payload = await _post(endpoint, body, timeout or settings.http_timeout_seconds)
    except PermissionError:
        _park(30 * 60)  # credentials rejected — park before retrying blindly
        raise
    except RuntimeError as exc:
        message = str(exc).lower()
        if "not subscribed" in message:
            _park(6 * 60 * 60)  # needs the paid Data APIs plan on the account
        elif "expired" in message or "invalid" in message:
            _park(30 * 60)
        raise
    except Exception as exc:
        raise RuntimeError(f"Dhan request failed: {str(exc)[:160]}") from exc
    return _parse_feed(payload, requested)


async def probe() -> dict[str, Any]:
    """Connectivity test used by the settings page."""
    if not _enabled():
        return {
            "ok": False,
            "error": "Dhan not configured — add SOLO_DHAN_TOKEN and SOLO_DHAN_CLIENT_ID to solo/services/api/.env",
        }
    try:
        rows = await quotes(["NIFTY", "SENSEX"], timeout=10.0)
        sample = rows.get("NIFTY")
        sensex = rows.get("SENSEX")
        return {
            "ok": bool(rows),
            "sample_nifty": {"last": sample.get("value") if sample else None, "status": sample.get("data_status") if sample else None},
            "sample_sensex": {"last": sensex.get("value") if sensex else None, "status": sensex.get("data_status") if sensex else None},
            "checked_at": iso(utc_now()),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}
