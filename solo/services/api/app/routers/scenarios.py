from fastapi import APIRouter

from ..services import scenarios

router = APIRouter(prefix="/api", tags=["scenarios"])


@router.get("/scenarios/banknifty")
async def banknifty_scenarios():
    return await scenarios.get_banknifty_scenarios()
