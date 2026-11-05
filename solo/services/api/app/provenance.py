from datetime import datetime
from typing import Literal

from .timeutil import age_seconds, iso, utc_now

Freshness = Literal["fresh", "aging", "stale", "unknown", "unavailable"]
SourceType = Literal["live", "delayed", "eod", "aggregated", "derived", "unavailable", "simulated"]
FeedStatus = Literal["ok", "degraded", "error", "unavailable"]


def feed_meta(
    provider: str,
    dataset: str,
    *,
    as_of: datetime | None = None,
    source_type: SourceType = "delayed",
    status: FeedStatus = "ok",
    detail: str | None = None,
    fresh_after: int = 60,
    stale_after: int = 300,
    delay_seconds: int | None = None,
) -> dict:
    now = utc_now()
    age = age_seconds(as_of, now)
    if status == "unavailable" or source_type == "unavailable":
        freshness: Freshness = "unavailable"
    elif age is None:
        freshness = "unknown"
    elif age <= fresh_after:
        freshness = "fresh"
    elif age <= stale_after:
        freshness = "aging"
    else:
        freshness = "stale"
    return {
        "provider": provider,
        "dataset": dataset,
        "as_of": iso(as_of) if as_of is not None else None,
        "fetched_at": iso(now),
        "age_seconds": age,
        "freshness": freshness,
        "source_type": source_type,
        "status": status,
        "delay_seconds": delay_seconds,
        "detail": detail,
    }


def unavailable_meta(provider: str, dataset: str, detail: str) -> dict:
    return feed_meta(
        provider,
        dataset,
        as_of=None,
        source_type="unavailable",
        status="unavailable",
        detail=detail,
    )
