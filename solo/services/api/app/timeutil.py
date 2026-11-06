from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
UTC = timezone.utc


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def epoch_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def from_epoch_ms(value: int | float) -> datetime:
    return datetime.fromtimestamp(float(value) / 1000, UTC)


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def age_seconds(as_of: datetime | None, now: datetime | None = None) -> int | None:
    if as_of is None:
        return None
    current = now or utc_now()
    return max(0, int((current - as_of.astimezone(UTC)).total_seconds()))


def _next_open(now) -> str | None:
    """Estimate the next regular session open (09:15 IST). Weekends skipped;
    exchange holidays are NOT inferred — see note."""
    candidate = now.replace(hour=9, minute=15, second=0, microsecond=0)
    for _ in range(0, 8):
        if candidate.weekday() < 5 and candidate > now:
            return candidate.isoformat()
        candidate = candidate + timedelta(days=1)
    return None


def market_session() -> dict:
    now = utc_now().astimezone(IST)
    minutes = now.hour * 60 + now.minute
    weekday = now.weekday()
    is_open = weekday < 5 and (9 * 60 + 15) <= minutes <= (15 * 60 + 30)
    if weekday >= 5:
        state = "closed"
        reason = "Weekend"
    elif minutes < 9 * 60 + 15:
        state = "pre_open"
        reason = "Before the 09:15 IST open"
    elif minutes > 15 * 60 + 30:
        state = "closed"
        reason = "After the 15:30 IST close"
    else:
        state = "open"
        reason = "Regular NSE/BSE session"
    return {
        "state": state,
        "is_open": is_open,
        "reason": reason,
        "ist_time": now.isoformat(),
        "timezone": "Asia/Kolkata",
        "next_open_at": _next_open(now),
        "holiday_calendar": "not_configured",
        "note": "Exchange holidays are not inferred. Verify against NSE/BSE notices.",
    }
