import random

from fastapi import APIRouter, HTTPException, Query

from ..provenance import feed_meta, unavailable_meta
from ..providers import polymarket
from ..schemas import LagRequest
from ..services import lag
from ..timeutil import utc_now

router = APIRouter(prefix="/api", tags=["research"])


@router.post("/lag/analyze")
async def analyze(payload: LagRequest):
    if len(payload.anchor) > 20_000 or len(payload.response) > 20_000:
        raise HTTPException(status_code=422, detail="Each series is limited to 20,000 observations.")
    return lag.analyze_lag(
        [point.model_dump() for point in payload.anchor],
        [point.model_dump() for point in payload.response],
        bucket_seconds=payload.bucket_seconds,
        max_lag_seconds=payload.max_lag_seconds,
        min_observations=payload.min_observations,
        origin=payload.origin,
    )


@router.get("/lag/demo")
def demo(
    lag_seconds: int = Query(default=90, ge=0, le=3600),
    bucket_seconds: int = Query(default=60, ge=10, le=300),
    points: int = Query(default=240, ge=60, le=1200),
):
    """Deterministic synthetic data for testing the method. Never presented as market evidence."""
    bucket_ms = bucket_seconds * 1000
    lag_buckets = max(0, lag_seconds // bucket_seconds)
    rng = random.Random(42042 + lag_buckets)
    anchor_returns = [rng.gauss(0, 0.0012) for _ in range(points)]
    response_returns = []
    for index in range(points):
        delayed = anchor_returns[index - lag_buckets] if index >= lag_buckets else 0.0
        response_returns.append(0.78 * delayed + 0.22 * rng.gauss(0, 0.0012))
    now = int(utc_now().timestamp() * 1000)
    start = now - points * bucket_ms
    anchor_level = 100.0
    response_level = 24000.0
    anchor = []
    response = []
    for index, ret in enumerate(anchor_returns):
        anchor_level *= 1 + ret
        response_level *= 1 + response_returns[index]
        anchor.append({"t": start + index * bucket_ms, "value": round(anchor_level, 4)})
        response.append({"t": start + index * bucket_ms, "value": round(response_level, 2)})
    return {
        "origin": "simulated",
        "anchor_label": "Synthetic anchor series",
        "response_label": "Synthetic response series",
        "anchor": anchor,
        "response": response,
        "bucket_seconds": bucket_seconds,
        "planted_lag_seconds": lag_buckets * bucket_seconds,
        "requested_lag_seconds": lag_seconds,
        "warning": "SIMULATED METHOD DEMO. This is not Polymarket data, not a news event and not trading evidence.",
    }


@router.get("/polymarket/status")
async def polymarket_status():
    return await polymarket.status()


@router.get("/polymarket/markets")
async def polymarket_markets(limit: int = Query(default=12, ge=1, le=50)):
    rows, state = await polymarket.markets(limit)
    if not state.get("available"):
        return {
            "markets": [],
            "status": state,
            "meta": unavailable_meta("Polymarket Gamma", "prediction markets", state.get("detail") or "Unavailable"),
        }
    return {
        "markets": rows,
        "status": state,
        "meta": feed_meta(
            "Polymarket Gamma",
            "prediction markets",
            source_type="live",
            status="ok",
            detail="Public prediction-market metadata. Prices are market-implied, not objective probabilities.",
            fresh_after=60,
            stale_after=300,
        ),
        "note": "Prediction-market probabilities are not equivalent to objective probabilities or Bank Nifty direction.",
    }
