from fastapi import APIRouter, HTTPException, Query

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
    rows, meta = await market.get_quotes(requested)
    return {"quotes": rows, "meta": meta}


@router.get("/chart")
async def chart(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    try:
        return await market.get_chart(symbol, interval, range)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Chart provider unavailable: {str(exc)[:240]}") from exc
