from __future__ import annotations

from typing import Any

from ..cache import cache
from . import market

PROVIDER = "Solo watchlist"

WATCHLIST_KEY = "solo:watchlist"
WATCHLIST_CACHE_TTL = 24 * 60 * 60 * 1000  # 24 hours


def _get_watchlist() -> list[dict]:
    cached = cache.get(WATCHLIST_KEY)
    if cached is not None:
        return cached
    return []


def _save_watchlist(items: list[dict]) -> None:
    cache.set(WATCHLIST_KEY, items, WATCHLIST_CACHE_TTL)


async def get_watchlist() -> dict:
    """Return the user's watchlist with current quotes for each symbol."""
    items = _get_watchlist()
    enriched: list[dict] = []
    for item in items:
        symbol_key = item.get("key", item.get("symbol", ""))
        try:
            symbol = market.resolve_symbol(symbol_key)
            if symbol:
                from ..providers import yahoo

                snap = await yahoo.snapshot(symbol["yahoo"], ttl=90)
                enriched.append(
                    {
                        "key": symbol["key"],
                        "name": symbol["name"],
                        "short": symbol["short"],
                        "exchange": symbol["exchange"],
                        "currency": symbol["currency"],
                        "value": snap.get("value"),
                        "change": snap.get("change"),
                        "as_of": snap.get("as_of"),
                        "added_at": item.get("added_at"),
                        "note": item.get("note", ""),
                    }
                )
            else:
                enriched.append(
                    {
                        "key": symbol_key,
                        "name": symbol_key,
                        "short": symbol_key,
                        "exchange": "",
                        "currency": "",
                        "value": None,
                        "change": None,
                        "as_of": None,
                        "added_at": item.get("added_at"),
                        "note": item.get("note", ""),
                        "error": "Unknown symbol",
                    }
                )
        except Exception as exc:
            enriched.append(
                {
                    "key": symbol_key,
                    "name": symbol_key,
                    "short": symbol_key,
                    "exchange": "",
                    "currency": "",
                    "value": None,
                    "change": None,
                    "as_of": None,
                    "added_at": item.get("added_at"),
                    "note": item.get("note", ""),
                    "error": str(exc)[:200],
                }
            )
    return {"watchlist": enriched, "count": len(enriched)}


async def add_to_watchlist(symbol_key: str, note: str = "") -> dict:
    """Add a symbol to the watchlist if not already present."""
    items = _get_watchlist()
    if any(item.get("key") == symbol_key or item.get("symbol") == symbol_key for item in items):
        return {"added": False, "reason": "Already in watchlist", "watchlist": items}
    symbol = market.resolve_symbol(symbol_key)
    if not symbol:
        return {"added": False, "reason": f"Unknown symbol: {symbol_key}", "watchlist": items}
    items.append(
        {
            "key": symbol["key"],
            "symbol": symbol["key"],
            "name": symbol["name"],
            "short": symbol["short"],
            "exchange": symbol["exchange"],
            "note": note,
            "added_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        }
    )
    _save_watchlist(items)
    return {"added": True, "symbol": symbol["key"], "watchlist": items}


async def remove_from_watchlist(symbol_key: str) -> dict:
    """Remove a symbol from the watchlist."""
    items = _get_watchlist()
    filtered = [item for item in items if item.get("key") != symbol_key and item.get("symbol") != symbol_key]
    if len(filtered) == len(items):
        return {"removed": False, "reason": "Not in watchlist", "watchlist": items}
    _save_watchlist(filtered)
    return {"removed": True, "symbol": symbol_key, "watchlist": filtered}


async def clear_watchlist() -> dict:
    """Clear the entire watchlist."""
    _save_watchlist([])
    return {"cleared": True, "watchlist": []}
