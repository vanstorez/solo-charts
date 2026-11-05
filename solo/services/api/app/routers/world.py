from fastapi import APIRouter

from ..services import world

router = APIRouter(prefix="/api/global", tags=["global markets"])


@router.get("/markets")
async def markets():
    return await world.global_markets()


@router.get("/crypto")
async def crypto():
    return await world.global_crypto()


@router.get("/status")
async def status():
    return await world.global_status()
