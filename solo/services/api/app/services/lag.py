import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from ..indicators import pearson


@dataclass
class Point:
    t: int
    value: float


def _clean(points: list[dict]) -> list[Point]:
    cleaned: dict[int, Point] = {}
    for point in points:
        try:
            timestamp = int(point["t"])
            value = float(point["value"])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        cleaned[timestamp] = Point(t=timestamp, value=value)
    return sorted(cleaned.values(), key=lambda point: point.t)


def _bucket_series(points: list[Point], bucket_ms: int) -> dict[int, float]:
    buckets: dict[int, float] = {}
    for point in points:
        bucket = (point.t // bucket_ms) * bucket_ms
        buckets[bucket] = point.value
    return buckets


def _forward_fill(buckets: dict[int, float], start: int, end: int, bucket_ms: int, max_gap_buckets: int) -> dict[int, float]:
    filled: dict[int, float] = {}
    last_value = None
    last_bucket = None
    for bucket in range(start, end + 1, bucket_ms):
        if bucket in buckets:
            last_value = buckets[bucket]
            last_bucket = bucket
            filled[bucket] = last_value
        elif last_value is not None and last_bucket is not None and (bucket - last_bucket) / bucket_ms <= max_gap_buckets:
            filled[bucket] = last_value
    return filled


def _returns(levels: dict[int, float], bucket_ms: int) -> dict[int, float]:
    result = {}
    for bucket, value in levels.items():
        previous = levels.get(bucket - bucket_ms)
        if previous is None or previous == 0:
            continue
        result[bucket] = value / previous - 1
    return result


def _fisher_interval(correlation: float, n: int) -> tuple[float | None, float | None]:
    if n <= 3 or abs(correlation) >= 1:
        return None, None
    z = math.atanh(correlation)
    standard_error = 1 / math.sqrt(n - 3)
    return math.tanh(z - 1.96 * standard_error), math.tanh(z + 1.96 * standard_error)


def analyze_lag(
    anchor: list[dict],
    response: list[dict],
    *,
    bucket_seconds: int = 60,
    max_lag_seconds: int = 900,
    min_observations: int = 30,
    origin: Literal["observed", "simulated"] = "observed",
) -> dict:
    bucket_seconds = max(10, min(int(bucket_seconds), 3600))
    max_lag_seconds = max(0, min(int(max_lag_seconds), 86_400))
    min_observations = max(10, min(int(min_observations), 10_000))
    anchor_points = _clean(anchor)
    response_points = _clean(response)
    warnings = [
        "Exploratory lag analysis only. Correlation is not causation and this is not a trading signal.",
        "The test searches multiple lags; the reported interval is not adjusted for multiple comparisons.",
    ]
    if origin == "simulated":
        warnings.insert(0, "SIMULATED DEMONSTRATION DATA. These results do not describe a real market or prediction market.")
    if len(anchor_points) < 10 or len(response_points) < 10:
        return {
            "state": "insufficient_data",
            "reason": "Each series needs at least 10 timestamped observations.",
            "anchor_points": len(anchor_points),
            "response_points": len(response_points),
            "warnings": warnings,
            "origin": origin,
        }
    bucket_ms = bucket_seconds * 1000
    start = math.ceil(max(anchor_points[0].t, response_points[0].t) / bucket_ms) * bucket_ms
    end = math.floor(min(anchor_points[-1].t, response_points[-1].t) / bucket_ms) * bucket_ms
    if end <= start:
        return {
            "state": "insufficient_overlap",
            "reason": "The two series do not overlap in time.",
            "warnings": warnings,
            "origin": origin,
        }
    anchor_levels = _forward_fill(
        _bucket_series(anchor_points, bucket_ms), start, end, bucket_ms, 2
    )
    response_levels = _forward_fill(
        _bucket_series(response_points, bucket_ms), start, end, bucket_ms, 2
    )
    anchor_returns = _returns(anchor_levels, bucket_ms)
    response_returns = _returns(response_levels, bucket_ms)
    common = sorted(set(anchor_returns) & set(response_returns))
    if len(common) < min_observations:
        return {
            "state": "insufficient_data",
            "reason": f"Only {len(common)} aligned return observations; configure at least {min_observations}.",
            "warnings": warnings,
            "origin": origin,
        }
    max_lag_buckets = max(1, int(round(max_lag_seconds / bucket_seconds)))
    profile = []
    for lag_buckets in range(-max_lag_buckets, max_lag_buckets + 1):
        lag_ms = lag_buckets * bucket_ms
        pairs = [
            (anchor_returns[timestamp], response_returns[timestamp + lag_ms])
            for timestamp in common
            if timestamp + lag_ms in response_returns
        ]
        if len(pairs) < min_observations:
            continue
        correlation = pearson([pair[0] for pair in pairs], [pair[1] for pair in pairs])
        if correlation is None:
            continue
        profile.append(
            {
                "lag_seconds": lag_buckets * bucket_seconds,
                "correlation": round(correlation, 4),
                "n": len(pairs),
            }
        )
    if not profile:
        return {
            "state": "insufficient_data",
            "reason": "No lag offset had enough aligned observations.",
            "warnings": warnings,
            "origin": origin,
        }
    best = max(profile, key=lambda item: (abs(item["correlation"]), -abs(item["lag_seconds"])))
    ci_low, ci_high = _fisher_interval(best["correlation"], best["n"])
    stable = abs(best["correlation"]) >= 0.20 and (
        ci_low is None or ci_high is None or ci_low > 0 or ci_high < 0
    )
    state = "exploratory_relationship" if stable else "no_stable_relationship"
    lag_seconds = best["lag_seconds"]
    if lag_seconds > 0:
        interpretation = f"Response series showed its strongest same-bucket association {lag_seconds}s later than the anchor series."
    elif lag_seconds < 0:
        interpretation = f"Response series led the anchor series by {abs(lag_seconds)}s in this sample."
    else:
        interpretation = "The strongest same-bucket association was contemporaneous."
    return {
        "state": state,
        "origin": origin,
        "bucket_seconds": bucket_seconds,
        "max_lag_seconds": max_lag_seconds,
        "best_lag": {
            "anchor_leads_by_seconds": lag_seconds,
            "correlation": best["correlation"],
            "n": best["n"],
            "ci95": [round(ci_low, 4) if ci_low is not None else None, round(ci_high, 4) if ci_high is not None else None],
        },
        "profile": sorted(profile, key=lambda item: abs(item["correlation"]), reverse=True)[:13],
        "aligned_observations": len(common),
        "anchor_points": len(anchor_points),
        "response_points": len(response_points),
        "interpretation": interpretation,
        "warnings": warnings,
        "method": {
            "summary": "Bucket both series, forward-fill only across one missing bucket, compute bucket returns, then compare anchor returns with response returns at each lag offset.",
            "min_observations": min_observations,
            "sample_size_warning": "Results are unstable below 30 aligned returns and can be dominated by a few events.",
        },
    }
