from datetime import timedelta

from ..cache import cache
from ..timeutil import iso, parse_datetime, utc_now
from .http import ProviderError, fetch_json

PROVIDER = "TradingView economic calendar"
CALENDAR_URL = "https://economic-calendar.tradingview.com/events"

# The public endpoint rejects requests without a normal browser Origin/Referer.
# This is still an unofficial public feed, not a licensed exchange data product.
HEADERS = {
    "Accept": "application/json",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}


def _importance_label(value) -> str:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return "low"
    if numeric >= 1:
        return "high"
    if numeric == 0:
        return "medium"
    return "low"


def _number_or_none(value):
    if value is None or value == "":
        return None
    return value


def _normalise(event: dict, now) -> dict | None:
    event_time = parse_datetime(event.get("date"))
    if event_time is None:
        return None
    actual = _number_or_none(event.get("actual"))
    return {
        "id": str(event.get("id") or f"{event.get('country')}:{event.get('title')}:{event.get('date')}"),
        "title": (event.get("title") or event.get("indicator") or "Economic event").strip(),
        "indicator": event.get("indicator"),
        "country": (event.get("country") or "").upper() or "—",
        "category": event.get("category"),
        "period": event.get("period"),
        "importance": int(event.get("importance") or 0),
        "importance_label": _importance_label(event.get("importance")),
        "date": iso(event_time),
        "reference_date": event.get("referenceDate"),
        "actual": actual,
        "forecast": _number_or_none(event.get("forecast")),
        "previous": _number_or_none(event.get("previous")),
        "unit": event.get("unit"),
        "scale": event.get("scale"),
        "currency": event.get("currency"),
        "source": event.get("source"),
        "source_url": event.get("source_url"),
        "comment": (event.get("comment") or "")[:600] or None,
        "status": "released" if actual is not None or event_time <= now else "scheduled",
        "ticker": event.get("ticker"),
    }


async def events(days_back: int = 2, days_forward: int = 21, countries: tuple[str, ...] = ("IN", "US")) -> list[dict]:
    now = utc_now()
    days_back = max(0, min(days_back, 30))
    days_forward = max(1, min(days_forward, 60))
    country_text = ",".join(sorted({country.upper() for country in countries if country}))
    key = f"calendar:{country_text}:{days_back}:{days_forward}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    params = {
        "from": (now - timedelta(days=days_back)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "to": (now + timedelta(days=days_forward)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "countries": country_text,
    }
    payload = await fetch_json(
        PROVIDER,
        CALENDAR_URL,
        params=params,
        headers=HEADERS,
        timeout=18,
        retries=1,
    )
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        raise ProviderError("Economic calendar returned an invalid response")
    rows = []
    for event in payload.get("result") or []:
        normalised = _normalise(event, now)
        if normalised:
            rows.append(normalised)
    rows.sort(key=lambda event: (event["date"], -event["importance"], event["country"]))
    return cache.set(key, rows, 300)
