from fastapi import APIRouter, HTTPException

from ..schemas import AlertRuleRequest
from ..services import alerts

router = APIRouter(prefix="/api", tags=["alerts"])


@router.get("/alerts")
async def alert_rules():
    return {
        "rules": alerts.list_rules(),
        "live_execution_enabled": False,
        "note": "Local research alerts only. No background worker or external notification channel is configured.",
    }


@router.post("/alerts")
async def create_alert(rule: AlertRuleRequest):
    try:
        return {"rule": alerts.create_rule(rule)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/alerts/{rule_id}")
async def delete_alert(rule_id: int):
    try:
        return alerts.delete_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/alerts/check")
async def check_alerts():
    return await alerts.evaluate_rules()
