import asyncio

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..services import market
from ..timeutil import market_session

router = APIRouter(prefix="/api", tags=["market"])


@router.get("/overview")
async def overview():
    return await market.overview()


@router.get("/market/session")
async def session():
    return market_session()


@router.get("/symbols")
async def symbols():
    return {
        "symbols": [
            {
                "key": key,
                "name": value["name"],
                "short": value["short"],
                "exchange": value["exchange"],
                "type": value["type"],
                "currency": value["currency"],
            }
            for key, value in market.SYMBOLS.items()
        ],
        "intervals": market.INTERVALS,
        "allowed_ranges": market.ALLOWED_RANGES,
    }


@router.get("/quotes")
async def quotes(
    keys: str = Query(default="NIFTY,BANKNIFTY,SENSEX,INDIAVIX", description="Comma-separated symbol keys"),
):
    requested = [key.strip() for key in keys.split(",") if key.strip()][:24]
    cache_key = "quotes:" + ",".join(requested)

    async def fetch():
        rows, meta = await market.get_quotes(requested)
        # Public providers (TradingView/Yahoo) occasionally fail transiently.
        # Retry once when the batch comes back incomplete instead of surfacing
        # missing rows as a hard failure.
        if len(rows) < len(requested):
            await asyncio.sleep(1.0)
            retry_rows, retry_meta = await market.get_quotes(requested)
            if len(retry_rows) > len(rows):
                rows, meta = retry_rows, retry_meta
        return {"quotes": rows, "meta": meta}

    try:
        return await cache.get_or_set(cache_key, 60, fetch)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Quote provider unavailable: {str(exc)[:240]}") from exc


@router.get("/chart")
async def chart(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    cache_key = f"chart:{symbol}:{interval}:{range}"

    async def fetch():
        return await market.get_chart(symbol, interval, range)

    try:
        return await cache.get_or_set(cache_key, 60, fetch)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Chart provider unavailable: {str(exc)[:240]}") from exc
