from datetime import datetime, timezone
from urllib.parse import quote

import asyncio

from ..cache import cache
from .http import ProviderError, fetch_json

PROVIDER = "Yahoo Finance"
BASE_URLS = [
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
]
SPARK_URLS = [
    "https://query1.finance.yahoo.com/v7/finance/spark",
    "https://query2.finance.yahoo.com/v7/finance/spark",
]


def _snapshot_from_meta(meta: dict, symbol: str) -> dict:
    """Build one delayed/unknown snapshot from Yahoo's chart metadata."""
    value = meta.get("regularMarketPrice")
    if value is None:
        raise ProviderError(f"No quote returned for {symbol}")
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = meta.get("regularMarketChangePercent")
    if change is None and previous:
        change = (value / previous - 1) * 100
    regular_time = meta.get("regularMarketTime")
    as_of = datetime.fromtimestamp(float(regular_time), timezone.utc) if regular_time else None
    return {
        "value": value,
        "change": round(change, 4) if change is not None else None,
        "previous_close": previous,
        "volume": meta.get("regularMarketVolume"),
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "fifty_two_week_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": meta.get("fiftyTwoWeekLow"),
        "as_of": as_of,
        "name": meta.get("shortName") or meta.get("longName") or symbol,
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "timezone": meta.get("exchangeTimezoneName") or "Asia/Kolkata",
    }


def parse_chart(payload: dict, symbol: str) -> dict:
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        error = (payload.get("chart") or {}).get("error") or {}
        raise ProviderError(error.get("description") or "No Yahoo chart result")
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    quote_rows = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    bars = []
    for index, timestamp in enumerate(timestamps):
        close = (quote_rows.get("close") or [None])[index]
        if close is None:
            continue
        bars.append(
            {
                "t": int(timestamp) * 1000,
                "o": (quote_rows.get("open") or [None])[index] or close,
                "h": (quote_rows.get("high") or [None])[index] or close,
                "l": (quote_rows.get("low") or [None])[index] or close,
                "c": close,
                "v": (quote_rows.get("volume") or [0])[index] or 0,
            }
        )
    regular_time = meta.get("regularMarketTime")
    as_of = (
        datetime.fromtimestamp(float(regular_time), timezone.utc)
        if regular_time
        else (datetime.fromtimestamp(bars[-1]["t"] / 1000, timezone.utc) if bars else None)
    )
    return {
        "symbol": symbol,
        "name": meta.get("shortName") or meta.get("longName") or symbol,
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "timezone": meta.get("exchangeTimezoneName") or "Asia/Kolkata",
        "regular_market_price": meta.get("regularMarketPrice"),
        "previous_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
        "regular_market_change_pct": meta.get("regularMarketChangePercent"),
        "regular_market_volume": meta.get("regularMarketVolume"),
        "regular_market_day_high": meta.get("regularMarketDayHigh"),
        "regular_market_day_low": meta.get("regularMarketDayLow"),
        "fifty_two_week_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": meta.get("fiftyTwoWeekLow"),
        "as_of": as_of,
        "bars": bars,
    }


async def chart(symbol: str, interval: str = "1d", range_value: str = "1y", ttl: int = 90) -> dict:
    key = f"yahoo:{symbol}:{interval}:{range_value}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    encoded = quote(symbol, safe="")
    last_error: Exception | None = None
    for base in BASE_URLS:
        try:
            payload = await fetch_json(
                PROVIDER,
                base.format(symbol=encoded),
                params={
                    "interval": interval,
                    "range": range_value,
                    "includePrePost": "false",
                },
                timeout=16,
                retries=0,
            )
            parsed = parse_chart(payload, symbol)
            if not parsed["bars"]:
                raise ProviderError(f"No candles returned for {symbol}")
            return cache.set(key, parsed, ttl)
        except Exception as exc:  # try the second Yahoo host
            last_error = exc
    raise ProviderError(str(last_error) or f"Yahoo chart unavailable for {symbol}")


async def snapshot(symbol: str, ttl: int = 60) -> dict:
    """Return one public quote snapshot with Yahoo's provider timestamp.

    The value is intentionally labelled as a delayed/unknown public feed by the
    service layer. Yahoo's chart metadata is used because the public quote
    endpoint requires a cookie/crumb and is not a dependable server-side path.
    A symbol with metadata but no candles (common for some frontier indices)
    still produces a timestamped snapshot.
    """
    key = f"yahoo:snapshot:{symbol}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    encoded = quote(symbol, safe="")
    last_error: Exception | None = None
    for base in BASE_URLS:
        try:
            payload = await fetch_json(
                PROVIDER,
                base.format(symbol=encoded),
                params={"interval": "1d", "range": "5d", "includePrePost": "false"},
                timeout=16,
                retries=0,
            )
            data = parse_chart(payload, symbol)
            last = data["bars"][-1] if data.get("bars") else None
            value = data.get("regular_market_price") or (last["c"] if last else None)
            if value is None:
                raise ProviderError(f"No quote returned for {symbol}")
            previous = data.get("previous_close") or (
                data["bars"][-2]["c"] if len(data.get("bars") or []) > 1 else None
            )
            change = data.get("regular_market_change_pct")
            if change is None and previous:
                change = (value / previous - 1) * 100
            result = {
                "value": value,
                "change": round(change, 4) if change is not None else None,
                "previous_close": previous,
                "volume": data.get("regular_market_volume") or (last.get("v") if last else None),
                "day_high": data.get("regular_market_day_high"),
                "day_low": data.get("regular_market_day_low"),
                "fifty_two_week_high": data.get("fifty_two_week_high"),
                "fifty_two_week_low": data.get("fifty_two_week_low"),
                "as_of": data.get("as_of"),
                "name": data.get("name") or symbol,
                "currency": data.get("currency"),
                "exchange": data.get("exchange"),
                "timezone": data.get("timezone"),
            }
            return cache.set(key, result, ttl)
        except Exception as exc:  # try the second Yahoo host
            last_error = exc
    raise ProviderError(str(last_error) or f"Yahoo snapshot unavailable for {symbol}")


async def snapshots(symbols: list[str], ttl: int = 75) -> list[dict]:
    """Fetch a batch of public snapshots through Yahoo's spark endpoint.

    Yahoo's per-symbol chart endpoint is reliable but expensive for a world
    page. The spark response carries the same relevant metadata
    (regularMarketPrice, regularMarketTime, change, day range and exchange) for
    many symbols in one request. Individual chart requests remain the fallback
    for anything the batch does not return.
    """
    ordered_symbols = list(dict.fromkeys(symbols))
    key = "yahoo:snapshots:" + ",".join(ordered_symbols)
    cached = cache.get(key)
    if cached is not None:
        return cached

    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    chunk_size = 45
    for offset in range(0, len(ordered_symbols), chunk_size):
        chunk = ordered_symbols[offset : offset + chunk_size]
        payload = None
        last_error: Exception | None = None
        for url in SPARK_URLS:
            try:
                payload = await fetch_json(
                    PROVIDER,
                    url,
                    params={
                        "symbols": ",".join(chunk),
                        "range": "5d",
                        "interval": "1d",
                        "includePrePost": "false",
                    },
                    timeout=20,
                    retries=0,
                )
                break
            except Exception as exc:
                last_error = exc
        if payload is None:
            for symbol in chunk:
                errors[symbol] = str(last_error or "Yahoo spark unavailable")[:200]
            continue
        items = ((payload.get("spark") or {}).get("result") or [])
        for item in items:
            symbol = item.get("symbol")
            if not symbol or symbol not in chunk:
                continue
            responses = item.get("response") or []
            meta = (responses[0].get("meta") if responses else None) or {}
            try:
                row = _snapshot_from_meta(meta, symbol)
                results[symbol] = row
                cache.set(f"yahoo:snapshot:{symbol}", row, ttl)
            except Exception as exc:
                errors[symbol] = str(exc)[:200]

    missing = [symbol for symbol in ordered_symbols if symbol not in results]
    if missing:
        semaphore = asyncio.Semaphore(8)

        async def fill(symbol: str) -> tuple[str, dict | None]:
            async with semaphore:
                try:
                    return symbol, await snapshot(symbol, ttl=ttl)
                except Exception as exc:
                    errors[symbol] = str(exc)[:200]
                    return symbol, None

        filled = await asyncio.gather(*(fill(symbol) for symbol in missing))
        for symbol, row in filled:
            if row:
                results[symbol] = row

    payload_rows = [
        results.get(symbol) or {"error": errors.get(symbol, "No Yahoo snapshot returned")}
        for symbol in ordered_symbols
    ]
    return cache.set(key, payload_rows, ttl)

