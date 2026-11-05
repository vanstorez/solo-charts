import asyncio
from datetime import timedelta
from typing import Literal

from ..provenance import feed_meta, unavailable_meta
from ..timeutil import iso, parse_datetime, utc_now
from ..providers import economic_calendar

IMPORTANCE_RANK = {"low": -1, "medium": 0, "high": 1}

OFFICIAL_CALENDARS = [
    {
        "name": "RBI monetary policy",
        "url": "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx",
        "note": "Official Reserve Bank of India press releases and policy schedule.",
    },
    {
        "name": "US Federal Reserve FOMC",
        "url": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        "note": "Official FOMC meeting calendar and statements.",
    },
    {
        "name": "MOSPI releases",
        "url": "https://mospi.gov.in/",
        "note": "Official Indian statistical releases; verify CPI, IIP and GDP dates here.",
    },
    {
        "name": "NSE market calendar",
        "url": "https://www.nseindia.com/resources/exchange-communication-holidays",
        "note": "Official exchange holidays and market timings.",
    },
]


def _minimum_rank(value: str) -> int:
    return IMPORTANCE_RANK.get(value, 0)


async def get_calendar(
    days: int = 14,
    importance: Literal["all", "medium", "high"] = "medium",
    countries: tuple[str, ...] = ("IN", "US"),
) -> dict:
    now = utc_now()
    minimum = _minimum_rank(importance)
    try:
        rows = await economic_calendar.events(days_back=2, days_forward=days, countries=countries)
    except Exception as exc:
        return {
            "available": False,
            "events": [],
            "next_high_impact": None,
            "meta": unavailable_meta(
                economic_calendar.PROVIDER,
                "economic calendar",
                f"Calendar provider unavailable: {str(exc)[:240]}",
            ),
            "generated_at": iso(now),
            "reason": "The economic calendar provider is unreachable. Event data is not substituted.",
            "official_calendars": OFFICIAL_CALENDARS,
            "disclaimer": "No calendar values are fabricated. Use official sources linked here when the provider is unavailable.",
        }
    events = [event for event in rows if IMPORTANCE_RANK.get(event["importance_label"], -1) >= minimum]
    upcoming = [event for event in events if (parse_datetime(event["date"]) or now) >= now]
    next_high = next(
        (event for event in upcoming if event["importance_label"] == "high"),
        None,
    )
    meta = feed_meta(
        economic_calendar.PROVIDER,
        "economic calendar",
        as_of=now,
        source_type="delayed",
        status="ok" if rows else "degraded",
        detail="Public TradingView calendar endpoint; actual, forecast and previous values are provider-supplied. Verify against the official source before trading.",
        fresh_after=300,
        stale_after=1_800,
    )
    return {
        "available": True,
        "events": events,
        "event_count": len(events),
        "upcoming_count": len(upcoming),
        "next_high_impact": next_high,
        "meta": meta,
        "generated_at": iso(now),
        "window": {
            "days_back": 2,
            "days_forward": days,
            "importance": importance,
            "countries": list(countries),
        },
        "official_calendars": OFFICIAL_CALENDARS,
        "disclaimer": (
            "Calendar events are scheduled releases, not trading signals. Actual-versus-forecast surprises "
            "can be revised or revised away. Verify the official release before acting."
        ),
    }
