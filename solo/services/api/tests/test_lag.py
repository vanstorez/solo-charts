import random

from app.services.lag import analyze_lag


def make_series(bucket_seconds=60, points=240, lag_buckets=1):
    rng = random.Random(7)
    bucket_ms = bucket_seconds * 1000
    anchor_returns = [rng.gauss(0, 0.002) for _ in range(points)]
    response_returns = []
    for index in range(points):
        delayed = anchor_returns[index - lag_buckets] if index >= lag_buckets else 0
        response_returns.append(0.8 * delayed + 0.2 * rng.gauss(0, 0.002))
    anchor_level = 100.0
    response_level = 100.0
    anchor = []
    response = []
    for index in range(points):
        anchor_level *= 1 + anchor_returns[index]
        response_level *= 1 + response_returns[index]
        timestamp = 1_700_000_000_000 + index * bucket_ms
        anchor.append({"t": timestamp, "value": anchor_level})
        response.append({"t": timestamp, "value": response_level})
    return anchor, response


def test_lag_detects_planted_delay_with_simulated_label():
    anchor, response = make_series(lag_buckets=2)
    result = analyze_lag(
        anchor,
        response,
        bucket_seconds=60,
        max_lag_seconds=300,
        min_observations=30,
        origin="simulated",
    )
    assert result["state"] == "exploratory_relationship"
    assert result["best_lag"]["anchor_leads_by_seconds"] == 120
    assert result["origin"] == "simulated"
    assert any("SIMULATED" in warning for warning in result["warnings"])


def test_lag_rejects_insufficient_overlap():
    anchor, _ = make_series(points=20, lag_buckets=1)
    response = [{"t": point["t"] + 10_000_000, "value": point["value"]} for point in anchor]
    result = analyze_lag(anchor, response, bucket_seconds=60, max_lag_seconds=60)
    assert result["state"] in {"insufficient_data", "insufficient_overlap"}
    assert result["origin"] == "observed"
