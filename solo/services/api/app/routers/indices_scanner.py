from fastapi import APIRouter, HTTPException

from ..cache import cache
from ..services import indian_indices

router = APIRouter(prefix="/api", tags=["scanner"])


@router.get("/indices-scanner")
async def indices_scanner() -> dict:
    """Every available Indian index scanned over the previous year of daily candles."""
    # Historical daily data — long cache keeps repeat loads instant; provider
    # bursts (19 concurrent symbol pulls) happen at most every 15 minutes.
    try:
        return await cache.get_or_set("indices-scanner:1y", 900, indian_indices.scan_indices)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Index scanner unavailable: {str(exc)[:240]}") from exc
