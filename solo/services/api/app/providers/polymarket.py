import json
from typing import Any

from ..cache import cache
from ..config import get_settings
from .http import ProviderError, fetch_json

PROVIDER = "Polymarket Gamma"


def _parse_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def _normalise_market(row: dict) -> dict:
    outcomes = _parse_jsonish(row.get("outcomes"))
    prices = _parse_jsonish(row.get("outcomePrices"))
    return {
        "id": str(row.get("id") or row.get("conditionId") or "unknown"),
        "question": row.get("question") or row.get("title") or "Untitled market",
        "slug": row.get("slug"),
        "active": bool(row.get("active")),
        "closed": bool(row.get("closed")),
        "end_date": row.get("endDate") or row.get("end_date"),
        "liquidity": row.get("liquidityNum") or row.get("liquidity"),
        "volume": row.get("volumeNum") or row.get("volume"),
        "outcomes": outcomes,
        "outcome_prices": prices,
        "description": row.get("description"),
        "url": f"https://polymarket.com/event/{row.get('slug')}" if row.get("slug") else None,
    }


async def status() -> dict:
    settings = get_settings()
    if not settings.polymarket_enabled:
        return {
            "available": False,
            "state": "disabled",
            "detail": "Polymarket access is disabled by configuration.",
            "gamma_url": settings.polymarket_gamma_url,
            "clob_url": settings.polymarket_clob_url,
        }
    key = "polymarket:status"
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        payload = await fetch_json(
            PROVIDER,
            f"{settings.polymarket_gamma_url.rstrip('/')}/markets",
            params={"limit": 1, "active": "true", "closed": "false"},
            timeout=6,
            retries=0,
        )
        value = {
            "available": True,
            "state": "connected",
            "detail": "Gamma public API responded. Prediction-market data is research-only.",
            "gamma_url": settings.polymarket_gamma_url,
            "clob_url": settings.polymarket_clob_url,
            "sample_count": len(payload if isinstance(payload, list) else []),
        }
    except Exception as exc:
        value = {
            "available": False,
            "state": "unavailable",
            "detail": f"Public prediction-market API could not be reached from this network: {str(exc)[:220]}",
            "gamma_url": settings.polymarket_gamma_url,
            "clob_url": settings.polymarket_clob_url,
        }
    return cache.set(key, value, 60)


async def markets(limit: int = 12) -> tuple[list[dict], dict]:
    current = await status()
    if not current.get("available"):
        return [], current
    settings = get_settings()
    key = f"polymarket:markets:{limit}"
    cached = cache.get(key)
    if cached is not None:
        return cached, current
    try:
        payload = await fetch_json(
            PROVIDER,
            f"{settings.polymarket_gamma_url.rstrip('/')}/markets",
            params={"limit": min(max(limit, 1), 50), "active": "true", "closed": "false"},
            timeout=10,
            retries=0,
        )
        rows = payload if isinstance(payload, list) else []
        value = [_normalise_market(row) for row in rows if isinstance(row, dict)]
        cache.set(key, value, 45)
        return value, current
    except Exception as exc:
        current = {
            **current,
            "available": False,
            "state": "unavailable",
            "detail": f"Markets request failed: {str(exc)[:220]}",
        }
        return [], current
