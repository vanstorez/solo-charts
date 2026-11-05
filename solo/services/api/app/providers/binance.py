"""Public Binance spot-market snapshots.

The REST host below is Binance's public market-data endpoint. It is used for
initial values and fallback snapshots. The browser can subscribe directly to
Binance's public WebSocket for tick updates; this module does not place orders,
hold keys, or claim a consolidated global crypto tape.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from ..cache import cache
from .http import ProviderError, fetch_json

PROVIDER = "Binance public market data"
REST_URL = "https://data-api.binance.vision/api/v3/ticker/24hr"
STREAM_URL = "https://data-stream.binance.vision"
WS_URL = "wss://data-stream.binance.vision"

# Curated liquid USDT pairs. This is coverage, not a claim to list every token.
STREAM_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "DOTUSDT",
    "LTCUSDT",
    "BCHUSDT",
    "TRXUSDT",
    "TONUSDT",
    "SUIUSDT",
    "NEARUSDT",
    "APTUSDT",
    "ARBUSDT",
    "OPUSDT",
    "PEPEUSDT",
    "SHIBUSDT",
    "WIFUSDT",
]


def _number(value: object) -> float | None:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def parse_ticker(record: dict) -> dict | None:
    symbol = str(record.get("symbol") or "").upper()
    if not symbol.endswith("USDT"):
        return None
    price = _number(record.get("lastPrice"))
    if price is None:
        return None
    open_price = _number(record.get("openPrice"))
    change = _number(record.get("priceChangePercent"))
    if change is None and open_price:
        change = (price / open_price - 1) * 100
    close_time = record.get("closeTime")
    as_of = None
    try:
        if close_time:
            as_of = datetime.fromtimestamp(float(close_time) / 1000, timezone.utc)
    except (TypeError, ValueError, OSError):
        as_of = None
    base = symbol.removesuffix("USDT")
    return {
        "symbol": symbol,
        "base": base,
        "quote": "USDT",
        "price": price,
        "change": round(change, 4) if change is not None else None,
        "open": open_price,
        "high": _number(record.get("highPrice")),
        "low": _number(record.get("lowPrice")),
        "volume_base": _number(record.get("volume")),
        "volume_quote": _number(record.get("quoteVolume")),
        "trades": record.get("count"),
        "bid": _number(record.get("bidPrice")),
        "ask": _number(record.get("askPrice")),
        "as_of": as_of,
    }


def parse_stream_message(payload: dict) -> dict | None:
    """Normalise one Binance 24hrMiniTicker stream payload."""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict) or data.get("e") not in {"24hrMiniTicker", "24hrTicker"}:
        return None
    symbol = str(data.get("s") or "").upper()
    if not symbol.endswith("USDT"):
        return None
    price = _number(data.get("c"))
    if price is None:
        return None
    open_price = _number(data.get("o"))
    change = (price / open_price - 1) * 100 if open_price else None
    event_time = data.get("E")
    as_of = None
    try:
        if event_time:
            as_of = datetime.fromtimestamp(float(event_time) / 1000, timezone.utc)
    except (TypeError, ValueError, OSError):
        as_of = None
    return {
        "symbol": symbol,
        "price": price,
        "change": round(change, 4) if change is not None else None,
        "open": open_price,
        "high": _number(data.get("h")),
        "low": _number(data.get("l")),
        "volume_base": _number(data.get("v")),
        "volume_quote": _number(data.get("q")),
        "as_of": as_of,
    }


async def tickers(symbols: list[str] | None = None, ttl: int = 8) -> list[dict]:
    requested = [symbol.upper() for symbol in (symbols or STREAM_SYMBOLS)]
    key = "binance:24hr:" + "+".join(requested)
    cached = cache.get(key)
    if cached is not None:
        return cached
    payload = await fetch_json(
        PROVIDER,
        REST_URL,
        params={"symbols": json.dumps(requested, separators=(",", ":"))},
        timeout=12,
        retries=1,
    )
    if not isinstance(payload, list):
        raise ProviderError("Binance returned an unexpected ticker payload")
    rows = [parsed for record in payload if isinstance(record, dict) if (parsed := parse_ticker(record))]
    if not rows:
        raise ProviderError("Binance returned no spot tickers")
    return cache.set(key, rows, ttl)


def stream_url(symbols: list[str] | None = None) -> str:
    requested = [symbol.lower() for symbol in (symbols or STREAM_SYMBOLS)]
    streams = "/".join(f"{symbol}@miniTicker" for symbol in requested)
    return f"{WS_URL}/stream?streams={streams}"
