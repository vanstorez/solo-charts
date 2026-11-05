from typing import Literal

from fastapi import APIRouter, Query

from ..services import calendar

router = APIRouter(prefix="/api", tags=["calendar"])


@router.get("/calendar")
async def economic_calendar(
    days: int = Query(default=14, ge=1, le=45),
    importance: Literal["all", "medium", "high"] = Query(default="medium"),
    countries: str = Query(default="IN,US", description="Comma-separated country codes"),
):
    selected = tuple(country.strip().upper() for country in countries.split(",") if country.strip())[:10]
    return await calendar.get_calendar(days=days, importance=importance, countries=selected or ("IN", "US"))
