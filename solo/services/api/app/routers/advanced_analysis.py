from fastapi import APIRouter, Query

from ..cache import cache
from ..services import advanced_analysis

router = APIRouter(prefix="/api/analysis-advanced", tags=["advanced analysis"])


@router.get("")
async def advanced(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    cache_key = f"analysis:{symbol}:{interval}:{range}"

    async def fetch():
        return await advanced_analysis.advanced_analysis(symbol, interval, range)

    return await cache.get_or_set(cache_key, 60, fetch)
