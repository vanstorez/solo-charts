from fastapi import APIRouter

from ..schemas import BacktestRequest
from ..services import backtest

router = APIRouter(prefix="/api", tags=["backtest"])


@router.post("/backtest/ema")
async def ema_backtest(request: BacktestRequest):
    return await backtest.run_ema_backtest_async(request)
