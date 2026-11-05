from fastapi import APIRouter, Query

from ..services import advanced_analysis

router = APIRouter(prefix="/api/analysis-advanced", tags=["advanced analysis"])


@router.get("")
async def advanced(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    return await advanced_analysis.advanced_analysis(symbol, interval, range)
