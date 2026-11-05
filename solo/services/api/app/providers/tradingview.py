from typing import Any

from ..cache import cache
from .http import post_json

PROVIDER = "TradingView scanner"
SCANNER_URL = "https://scanner.tradingview.com/{market}/scan"


def market_for_ticker(ticker: str) -> str:
    return "india" if ticker.upper().startswith(("NSE:", "BSE:")) else "global"


async def scan(market: str, tickers: list[str], columns: list[str]) -> dict[str, dict[str, Any]]:
    unique = sorted({ticker for ticker in tickers if ticker})
    if not unique:
        return {}
    key = f"tv:{market}:{','.join(unique)}:{','.join(columns)}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    payload = {
        "symbols": {"tickers": unique, "query": {"types": []}},
        "columns": columns,
    }
    response = await _post_scan(market, payload)
    rows: dict[str, dict[str, Any]] = {}
    for row in response.get("data") or []:
        item = {"ticker": row.get("s")}
        for index, column in enumerate(columns):
            values = row.get("d") or []
            item[column] = values[index] if index < len(values) else None
        rows[item["ticker"]] = item
    return cache.set(key, rows, 12)


async def _post_scan(market: str, payload: dict) -> dict:
    from .http import post_json

    return await post_json(
        PROVIDER,
        SCANNER_URL.format(market=market),
        payload=payload,
        headers={"Content-Type": "application/json"},
        timeout=12,
    )


async def quotes(tickers: list[str], columns: list[str] | None = None) -> dict[str, dict[str, Any]]:
    selected = columns or ["close", "change", "volume", "RSI", "Recommend.All"]
    india = sorted({ticker for ticker in tickers if market_for_ticker(ticker) == "india"})
    global_tickers = sorted({ticker for ticker in tickers if market_for_ticker(ticker) == "global"})
    result: dict[str, dict[str, Any]] = {}
    if india:
        result.update(await scan("india", india, selected))
    if global_tickers:
        result.update(await scan("global", global_tickers, selected))
    return result
