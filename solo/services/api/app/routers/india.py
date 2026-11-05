from fastapi import APIRouter

from ..services import india

router = APIRouter(prefix="/api/india", tags=["india markets"])


@router.get("/markets")
async def markets():
    return await india.indian_markets()


@router.get("/status")
async def status():
    return await india.indian_status()
