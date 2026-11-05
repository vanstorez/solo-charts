"""Global Datafeeds licensed REST adapter.

This module is intentionally read-only. It never places orders and it never
stores or returns the vendor access key. The endpoint and access key are
supplied by Global Datafeeds to the licensed subscriber and are read from the
server-side environment (``SOLO_GDF_*``).

The adapter supports the documented REST functions:

* ``GetLastQuoteArray`` for up to 25 instruments per exchange.
* ``GetHistory`` for minute/hour/day/week OHLC bars.
* ``GetLimitation`` to verify the account entitlement and data delay.

The feed is a snapshot/polling API. It is not described as a tick stream, even
when the vendor entitlement has zero delay.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

from ..cache import cache
from ..config import get_settings
from ..timeutil import iso
from .health import record_error, record_success
from .http import ProviderError

PROVIDER = "Global Datafeeds"
MAX_INSTRUMENTS_PER_QUOTE_CALL = 25
LIVE_FUNCTIONS = {"GetLastQuoteArray", "GetLastQuote", "GetLastQuoteShort"}

ENTITLEMENT_TTL_SECONDS = 300
ERROR_TTL_SECONDS = 30

_entitlement: dict[str, Any] | None = None
_entitlement_at: float = 0.0
_last_probe_at: float | None = None
_last_error: str | None = None


def _settings():
    return get_settings()


def configured() -> bool:
    settings = _settings()
    return bool(settings.gdf_enabled and _base_url() and _api_key())


def _api_key() -> str:
    try:
        return _settings().gdf_api_key.get_secret_value().strip()
    except AttributeError:
        return str(_settings().gdf_api_key or "").strip()


def _base_url() -> str | None:
    raw = (_settings().gdf_base_url or "").strip()
    if not raw:
        return None
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or "@" in parsed.netloc:
        return None
    return raw if raw.endswith("/") else f"{raw}/"


def _host() -> str | None:
    base = _base_url()
    if not base:
        return None
    parsed = urlparse(base)
    return parsed.netloc or None


def _redact(value: Any) -> str:
    text = str(value or "")
    key = _api_key()
    if key:
        text = text.replace(key, "[redacted]")
    text = re.sub(r"(?i)(accesskey=)[^&\s]+", r"\1[redacted]", text)
    text = re.sub(r"(?i)(api[_-]?key=)[^&\s]+", r"\1[redacted]", text)
    return text[:300]


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric == numeric and abs(numeric) != float("inf") else None


def _timestamp_ms(value: Any) -> int | None:
    numeric = _number(value)
    if numeric is None or numeric <= 0:
        return None
    # GDF documents millisecond timestamps. Accept seconds defensively so a
    # vendor-side format change does not silently produce a 1970 date.
    if numeric > 100_000_000_000:
        return int(numeric)
    if numeric > 1_000_000_000:
        return int(numeric * 1000)
    return None


def _datetime(value: Any) -> datetime | None:
    stamp = _timestamp_ms(value)
    if stamp is None:
        return None
    return datetime.fromtimestamp(stamp / 1000, timezone.utc)


def _upper(record: dict[str, Any]) -> dict[str, Any]:
    return {str(key).upper(): value for key, value in record.items()}


def parse_limitation(payload: Any) -> dict[str, Any]:
    """Normalise the vendor entitlement response and discard unrelated fields."""
    root = payload if isinstance(payload, dict) else {}
    upper = _upper(root)
    allowed_exchanges = []
    for row in upper.get("ALLOWEDEXCHANGES") or upper.get("ALLOWED_EXCHANGES") or []:
        if not isinstance(row, dict):
            continue
        item = _upper(row)
        name = str(item.get("EXCHANGENAME") or item.get("EXCHANGE") or "").upper()
        if not name:
            continue
        delay = _number(item.get("DATADELAY"))
        allowed_exchanges.append(
            {
                "name": name,
                "data_delay_seconds": int(delay) if delay is not None else None,
                "allowed_instruments": item.get("ALLOWEDINSTRUMENTS"),
            }
        )
    functions = []
    for row in upper.get("ALLOWEDFUNCTIONS") or upper.get("ALLOWED_FUNCTIONS") or []:
        if isinstance(row, dict):
            item = _upper(row)
            name = str(item.get("FUNCTIONNAME") or "").strip()
            if name:
                functions.append({"name": name, "enabled": bool(item.get("ISENABLED"))})
    expiry = _datetime(upper.get("EXPIRATIONDATE") or upper.get("EXPIRY"))
    return {
        "enabled": bool(upper.get("ENABLED")),
        "expires_at": iso(expiry) if expiry else None,
        "exchanges": allowed_exchanges,
        "functions": functions,
        "allowed_calls_per_hour": upper.get("ALLOWEDCALLSPERHOUR"),
        "allowed_instruments": upper.get("ALLOWEDINSTRUMENTS"),
    }


def _exchange_delay(exchange: str) -> int | None:
    if not _entitlement:
        return None
    wanted = exchange.upper()
    for row in _entitlement.get("exchanges", []):
        if str(row.get("name", "")).upper() == wanted:
            value = row.get("data_delay_seconds")
            return int(value) if value is not None else None
    return None


def _function_enabled(name: str) -> bool:
    if not _entitlement:
        return False
    wanted = name.lower()
    return any(
        str(row.get("name", "")).lower() == wanted and row.get("enabled")
        for row in _entitlement.get("functions", [])
    )


def is_live_capable(exchange: str) -> bool:
    """True only after GetLimitation confirms zero delay and quote access."""
    if not _entitlement or not _entitlement.get("enabled"):
        return False
    return _exchange_delay(exchange) == 0 and _function_enabled("GetLastQuoteArray")


def verified_delay_seconds() -> int | None:
    """Largest exchange delay across the Indian cash/index exchanges we use."""
    if not _entitlement or not _entitlement.get("enabled"):
        return None
    delays = [
        _exchange_delay(exchange)
        for exchange in ("NSE_IDX", "BSE_IDX", "NSE", "BSE")
    ]
    known = [delay for delay in delays if delay is not None]
    return max(known) if known else None


def status() -> dict[str, Any]:
    """Return a safe, browser-facing status object without making a network call.

    The explicit Live Status endpoint calls :func:`probe` when it needs to query
    the vendor entitlement. This synchronous helper only reports process-local
    state for source catalogs and config responses.
    """
    settings = _settings()
    state: str
    detail: str
    if not settings.gdf_enabled:
        state = "disabled"
        detail = "The licensed feed adapter is disabled by configuration."
    elif not _base_url():
        state = "not_configured"
        detail = "SOLO_GDF_BASE_URL is missing or invalid. Get the REST endpoint from Global Datafeeds."
    elif not _api_key():
        state = "not_configured"
        detail = "SOLO_GDF_API_KEY is missing. Keep the key in solo/services/api/.env, never in source control."
    elif not _entitlement and _last_error:
        state = "error"
        detail = f"Entitlement check failed: {_last_error}"
    elif not _entitlement:
        state = "configured_unverified"
        detail = (
            "Endpoint and key are configured, but the entitlement has not been verified. "
            "Call /api/live/status?probe=true to query GetLimitation."
        )
    elif not _entitlement.get("enabled"):
        state = "license_disabled"
        detail = "Global Datafeeds rejected or disabled the account entitlement. No licensed quotes will be requested."
    else:
        delay = verified_delay_seconds()
        if delay is None:
            state = "verified_no_delay_contract"
            detail = "Entitlement is enabled, but no NSE/BSE exchange delay was supplied. Treat the feed as delayed."
        elif delay == 0:
            state = "verified"
            detail = "Entitlement is enabled with zero declared exchange delay. REST snapshots are licensed for personal local display."
        else:
            state = "verified_delayed"
            detail = f"Entitlement is enabled with a declared {delay}s exchange delay."
    delay = verified_delay_seconds()
    return {
        "vendor": PROVIDER,
        "configured": configured(),
        "enabled": bool(settings.gdf_enabled),
        "state": state,
        "detail": detail,
        "base_host": _host(),
        "has_api_key": bool(_api_key()),
        "license_scope": "personal_local_display_only",
        "transport": "REST polling (GetLastQuoteArray / GetHistory)",
        "source_type": "live" if state == "verified" else "delayed" if delay is not None else "unknown",
        "delay_seconds": delay,
        "live_capable": state == "verified",
        "entitlement": _entitlement,
        "last_checked_at": iso(datetime.fromtimestamp(_last_probe_at, timezone.utc)) if _last_probe_at else None,
        "last_error": _last_error,
        "capabilities": [
            "NSE/BSE cash and index last quotes",
            "NSE/BSE OHLC history",
            "vendor access-key authentication",
            "entitlement and declared delay readout",
        ],
        "limitations": [
            "REST snapshots are polled; this adapter does not claim a tick-by-tick stream.",
            "Personal local display only. Do not redistribute the feed or expose this API to other users.",
            "No order routing or execution permission is implemented.",
            "Data remains subject to the Global Datafeeds and exchange licence.",
        ],
        "live_execution_enabled": False,
    }


async def probe(force: bool = False) -> dict[str, Any]:
    """Query GetLimitation and cache the normalised entitlement."""
    global _entitlement, _entitlement_at, _last_probe_at, _last_error
    if not configured():
        return status()
    now = time.time()
    if not force:
        if _entitlement and now - _entitlement_at < ENTITLEMENT_TTL_SECONDS:
            return status()
        if _last_error and _last_probe_at and now - _last_probe_at < ERROR_TTL_SECONDS:
            return status()
    _last_probe_at = now
    try:
        payload = await _request("GetLimitation/")
        parsed = parse_limitation(payload)
        if not parsed.get("enabled"):
            raise ProviderError("GetLimitation returned an account that is not enabled.")
        _entitlement = parsed
        _entitlement_at = now
        _last_error = None
        return status()
    except Exception as exc:
        _last_error = _redact(exc)
        _entitlement = None
        _entitlement_at = 0.0
        return status()


async def _request(path: str, params: dict[str, Any] | None = None) -> Any:
    settings = _settings()
    base = _base_url()
    key = _api_key()
    if not base or not key:
        raise ProviderError("Global Datafeeds is not configured")
    url = f"{base}{path.lstrip('/')}"
    query = {**(params or {}), "accessKey": key}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=settings.gdf_request_timeout_seconds,
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": "SoloTradingCharts/0.1"},
        ) as client:
            # Let httpx encode the query so the access key is not concatenated
            # into a log message by this adapter.
            response = await client.get(url, params=query)
            response.raise_for_status()
            payload = response.json()
        record_success(PROVIDER, int((time.perf_counter() - started) * 1000))
        return payload
    except Exception as exc:
        message = _redact(exc)
        record_error(PROVIDER, message, int((time.perf_counter() - started) * 1000))
        raise ProviderError(message) from exc


def parse_quote(record: dict[str, Any]) -> dict[str, Any] | None:
    fields = _upper(record)
    value = _number(
        fields.get("LASTTRADEPRICE")
        or fields.get("CLOSE")
        or fields.get("BUYPRICE")
        or fields.get("SELLPRICE")
    )
    if value is None:
        return None
    previous = _number(fields.get("CLOSE"))
    change = _number(fields.get("PRICECHANGEPERCENTAGE"))
    if change is None and previous:
        change = (value / previous - 1) * 100
    as_of = _datetime(fields.get("LASTTRADETIME") or fields.get("SERVERTIME"))
    return {
        "identifier": str(fields.get("INSTRUMENTIDENTIFIER") or fields.get("SYMBOL") or ""),
        "value": round(value, 4),
        "change": round(change, 4) if change is not None else None,
        "volume": _number(fields.get("TOTALQTYTRADED") or fields.get("TRADEDQTY")),
        "open": _number(fields.get("OPEN")),
        "high": _number(fields.get("HIGH")),
        "low": _number(fields.get("LOW")),
        "previous_close": previous,
        "bid": _number(fields.get("BUYPRICE")),
        "ask": _number(fields.get("SELLPRICE")),
        "open_interest": _number(fields.get("OPENINTEREST")),
        "as_of": as_of,
        "exchange": str(fields.get("EXCHANGE") or "").upper() or None,
    }


def _quote_records(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("LASTQUOTE", "LASTQUOTES", "QUOTES", "DATA", "INSTRUMENTS"):
            value = payload.get(key) or payload.get(key.lower())
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        # Some deployments return a single record shaped as the quote itself.
        if any(str(key).upper() in {"LASTTRADEPRICE", "INSTRUMENTIDENTIFIER"} for key in payload):
            return [payload]
    return []


async def quotes(symbols: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Fetch licensed last quotes for mapped symbols.

    Each input symbol must contain ``key``, ``exchange`` and ``identifier``.
    Returns a mapping keyed by the local symbol key.
    """
    rows: dict[str, dict[str, Any]] = {}
    groups: dict[str, list[dict[str, Any]]] = {}
    for symbol in symbols:
        exchange = str(symbol.get("exchange") or "").upper()
        identifier = str(symbol.get("identifier") or "").strip()
        if exchange and identifier:
            groups.setdefault(exchange, []).append(symbol)
    for exchange, items in groups.items():
        identifiers = sorted({str(item["identifier"]) for item in items})
        for offset in range(0, len(identifiers), MAX_INSTRUMENTS_PER_QUOTE_CALL):
            chunk = identifiers[offset : offset + MAX_INSTRUMENTS_PER_QUOTE_CALL]
            cache_key = f"gdf:quotes:{exchange}:{'+'.join(chunk)}"
            payload = cache.get(cache_key)
            if payload is None:
                payload = await _request(
                    "GetLastQuoteArray/",
                    {
                        "exchange": exchange,
                        "instrumentIdentifiers": "+".join(chunk),
                    },
                )
                cache.set(cache_key, payload, _settings().gdf_quote_ttl_seconds)
            returned: dict[str, dict[str, Any]] = {}
            for record in _quote_records(payload):
                parsed = parse_quote(record)
                if parsed and parsed.get("identifier"):
                    returned[parsed["identifier"].upper()] = parsed
            for symbol in items:
                if symbol["identifier"] not in chunk:
                    continue
                parsed = returned.get(str(symbol["identifier"]).upper())
                if not parsed and len(chunk) == 1 and len(returned) == 1:
                    parsed = next(iter(returned.values()))
                if not parsed:
                    continue
                rows[str(symbol["key"])] = {
                    **parsed,
                    "key": symbol["key"],
                    "exchange": exchange,
                    "identifier": symbol["identifier"],
                    "delay_seconds": _exchange_delay(exchange),
                    "live": is_live_capable(exchange),
                    "source": "Global Datafeeds licensed snapshot",
                }
    return rows


def parse_history(payload: Any) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if isinstance(payload, list):
        records = [row for row in payload if isinstance(row, dict)]
    elif isinstance(payload, dict):
        for key in ("OHLC", "HISTORY", "CANDLES", "DATA"):
            value = payload.get(key) or payload.get(key.lower())
            if isinstance(value, list):
                records = [row for row in value if isinstance(row, dict)]
                break
        if not records and "TICK" in payload:
            tick_rows = payload.get("TICK") or payload.get("tick") or []
            # A tick payload cannot be treated as OHLC without an explicit
            # aggregation contract. Fail closed rather than inventing candles.
            raise ProviderError("Vendor returned ticks instead of OHLC candles; aggregation is not configured.")
    bars = []
    for record in records:
        fields = _upper(record)
        close = _number(fields.get("CLOSE") or fields.get("LASTTRADEPRICE"))
        if close is None:
            continue
        stamp = _timestamp_ms(fields.get("LASTTRADETIME") or fields.get("TIMESTAMP") or fields.get("SERVERTIME"))
        if stamp is None:
            continue
        bars.append(
            {
                "t": stamp,
                "o": _number(fields.get("OPEN")) or close,
                "h": _number(fields.get("HIGH")) or close,
                "l": _number(fields.get("LOW")) or close,
                "c": close,
                "v": _number(fields.get("TRADEDQTY") or fields.get("TOTALQTYTRADED")) or 0,
            }
        )
    deduped = {bar["t"]: bar for bar in bars}
    return sorted(deduped.values(), key=lambda bar: bar["t"])


async def history(
    symbol: dict[str, Any],
    interval: str,
    max_bars: int,
) -> dict[str, Any]:
    """Fetch licensed OHLC history for one mapped symbol."""
    exchange = str(symbol.get("exchange") or "").upper()
    identifier = str(symbol.get("identifier") or "").strip()
    if not exchange or not identifier:
        raise ProviderError("Missing Global Datafeeds symbol mapping")
    mapping = {
        "5m": ("Minute", "5"),
        "15m": ("Minute", "15"),
        "30m": ("Minute", "30"),
        "1h": ("Hour", "1"),
        "1d": ("Day", "1"),
        "1wk": ("Week", "1"),
    }
    if interval not in mapping:
        raise ProviderError(f"Unsupported Global Datafeeds interval: {interval}")
    periodicity, period = mapping[interval]
    limit = max(20, min(int(max_bars), int(_settings().gdf_history_max or 1000)))
    cache_key = f"gdf:history:{exchange}:{identifier}:{periodicity}:{period}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    payload = await _request(
        "GetHistory/",
        {
            "exchange": exchange,
            "instrumentIdentifier": identifier,
            "periodicity": periodicity,
            "period": period,
            "max": limit,
        },
    )
    bars = parse_history(payload)
    if not bars:
        raise ProviderError(f"No OHLC candles returned for {identifier}")
    result = {
        "bars": bars,
        "as_of": datetime.fromtimestamp(bars[-1]["t"] / 1000, timezone.utc),
        "delay_seconds": _exchange_delay(exchange),
        "live": is_live_capable(exchange),
        "exchange": exchange,
        "identifier": identifier,
        "requested_max": limit,
        "truncated": len(bars) >= limit,
    }
    return cache.set(cache_key, result, _settings().gdf_history_ttl_seconds)


def reset_for_tests() -> None:
    global _entitlement, _entitlement_at, _last_probe_at, _last_error
    _entitlement = None
    _entitlement_at = 0.0
    _last_probe_at = None
    _last_error = None
    cache.clear("gdf:")
