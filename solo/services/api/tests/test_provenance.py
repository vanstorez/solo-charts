from datetime import datetime, timedelta, timezone

from app.provenance import feed_meta


def test_feed_meta_marks_fresh_and_stale():
    now = datetime.now(timezone.utc)
    fresh = feed_meta("test", "quotes", as_of=now - timedelta(seconds=5), fresh_after=20, stale_after=120)
    stale = feed_meta("test", "quotes", as_of=now - timedelta(seconds=500), fresh_after=20, stale_after=120)
    assert fresh["freshness"] == "fresh"
    assert fresh["status"] == "ok"
    assert stale["freshness"] == "stale"
    assert stale["age_seconds"] >= 499


def test_unavailable_source_is_never_labelled_fresh():
    meta = feed_meta("test", "news", source_type="unavailable", status="unavailable", detail="offline")
    assert meta["freshness"] == "unavailable"
    assert meta["status"] == "unavailable"
    assert meta["delay_seconds"] is None


def test_unknown_timestamp_is_not_labelled_fresh():
    meta = feed_meta("test", "snapshot", as_of=None, fresh_after=60, stale_after=300)
    assert meta["freshness"] == "unknown"
    assert meta["as_of"] is None
    assert meta["age_seconds"] is None
    assert meta["fetched_at"] is not None
