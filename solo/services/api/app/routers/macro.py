from fastapi import APIRouter, Query

from ..services import flows, macro

router = APIRouter(prefix="/api", tags=["macro"])


@router.get("/macro")
async def macro_dashboard(include_correlations: bool = Query(default=True)):
    return await macro.get_macro(include_correlations=include_correlations)


@router.get("/flows")
async def institutional_flows():
    return await flows.get_flows()
