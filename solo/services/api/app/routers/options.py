from fastapi import APIRouter

from ..schemas import BlackScholesRequest
from ..services import options

router = APIRouter(prefix="/api", tags=["options"])


@router.post("/options/black-scholes")
async def black_scholes(payload: BlackScholesRequest):
    return options.calculate_black_scholes(payload)
