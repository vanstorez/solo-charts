from fastapi import APIRouter, Query

from ..services import analysis

router = APIRouter(prefix="/api", tags=["chart analysis"])


@router.get("/analysis")
async def chart_analysis(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    return await analysis.get_analysis(symbol, interval, range)
