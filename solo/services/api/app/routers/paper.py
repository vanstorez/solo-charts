from fastapi import APIRouter, HTTPException, Query

from ..schemas import KillSwitchRequest, PaperOrderRequest, RiskSettingsUpdate
from ..services import paper

router = APIRouter(prefix="/api", tags=["paper-risk"])


@router.get("/paper/trades")
async def trades(status: str = Query(default="ALL")):
    return {
        "trades": paper.get_trades(status),
        "mode": "paper",
        "live_execution_enabled": False,
        "note": "No broker order is transmitted by this service.",
    }


@router.post("/paper/trades")
async def open_trade(order: PaperOrderRequest):
    try:
        return await paper.open_paper_trade(order)
    except paper.PaperRejected as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "reasons": exc.reasons}) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Paper order could not be simulated: {str(exc)[:240]}") from exc


@router.post("/paper/trades/{trade_id}/close")
async def close_trade(trade_id: int):
    try:
        return await paper.close_paper_trade(trade_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Paper exit could not be simulated: {str(exc)[:240]}") from exc


@router.get("/risk")
async def risk():
    return await paper.get_risk_snapshot()


@router.get("/risk/settings")
async def risk_settings():
    return {
        "limits": paper.get_risk_limits(),
        "editable": [
            "max_open_positions",
            "max_trade_notional",
            "max_total_exposure",
            "daily_loss_limit",
            "max_drawdown",
            "paper_slippage_bps",
            "paper_fee_bps",
        ],
        "live_execution_enabled": False,
        "note": "Live execution cannot be enabled from this endpoint.",
    }


@router.post("/risk/kill-switch")
async def kill_switch(update: KillSwitchRequest):
    return {
        "limits": paper.update_kill_switch(update),
        "live_execution_enabled": False,
        "note": "This switch blocks new paper orders only. It cannot open, close or route live broker orders.",
    }


@router.put("/risk/settings")
async def update_risk_settings(update: RiskSettingsUpdate):
    return {
        "limits": paper.update_risk_limits(update),
        "live_execution_enabled": False,
        "note": "Updated local paper-risk limits. This does not enable broker execution.",
    }


@router.get("/audit")
async def audit(limit: int = Query(default=100, ge=1, le=500)):
    return paper.get_audit(limit)
