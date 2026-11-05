import asyncio

from ..db import get_db
from ..provenance import unavailable_meta
from ..providers import globaldatafeeds as gdf
from ..providers import health, yahoo
from ..timeutil import iso, utc_now
from .market import SYMBOLS, get_quotes

COMPARE_KEYS = ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX"]


def _difference_pct(left: float | None, right: float | None) -> float | None:
    if left is None or right in (None, 0):
        return None
    return round((left - right) / right * 100, 3)


def _comparison_state(diff: float | None) -> str:
    if diff is None:
        return "unavailable"
    if abs(diff) <= 0.25:
        return "consistent"
    if abs(diff) <= 1.0:
        return "watch"
    return "mismatch"


async def _yahoo_snapshot(key: str) -> dict:
    symbol = SYMBOLS.get(key)
    if not symbol or not symbol.get("yahoo"):
        return {"available": False, "reason": "No Yahoo cross-check mapping"}
    try:
        data = await yahoo.chart(symbol["yahoo"], "1d", "5d", ttl=45)
        price = data.get("regular_market_price")
        if price is None and data.get("bars"):
            price = data["bars"][-1]["c"]
        return {
            "available": price is not None,
            "value": round(float(price), 4) if price is not None else None,
            "as_of": data.get("as_of"),
            "source": "Yahoo Finance chart metadata",
            "reason": None if price is not None else "No Yahoo price returned",
        }
    except Exception as exc:
        return {
            "available": False,
            "value": None,
            "as_of": None,
            "source": "Yahoo Finance chart metadata",
            "reason": str(exc)[:240],
        }


def _check(key: str, label: str, status: str, detail: str) -> dict:
    return {"key": key, "label": label, "status": status, "detail": detail}


async def get_quality() -> dict:
    now = utc_now()
    # This monitor deliberately compares the two public feeds. The licensed
    # feed's entitlement and timestamp contract are reported separately below.
    quotes, quote_meta = await get_quotes(COMPARE_KEYS, prefer_licensed=False)
    licensed = gdf.status()
    by_key = {quote["key"]: quote for quote in quotes}
    yahoo_rows = await asyncio.gather(*(_yahoo_snapshot(key) for key in COMPARE_KEYS))
    cross_checks = []
    for key, yahoo_row in zip(COMPARE_KEYS, yahoo_rows):
        quote = by_key.get(key)
        tv_value = quote.get("value") if quote else None
        difference = _difference_pct(tv_value, yahoo_row.get("value"))
        cross_checks.append(
            {
                "key": key,
                "name": SYMBOLS[key]["name"],
                "tradingview": {
                    "value": tv_value,
                    "as_of": None,
                    "source": quote.get("source") if quote else "unavailable",
                    "freshness": quote_meta.get("freshness"),
                },
                "yahoo": yahoo_row,
                "difference_pct": difference,
                "state": _comparison_state(difference),
                "note": (
                    "TradingView does not supply an exchange timestamp, so this is a value cross-check, "
                    "not a synchronized tick comparison."
                    if tv_value is not None and yahoo_row.get("value") is not None
                    else "One side of the cross-check is unavailable."
                ),
            }
        )

    mismatches = [row for row in cross_checks if row["state"] == "mismatch"]
    watches = [row for row in cross_checks if row["state"] == "watch"]
    provider_rows = health.snapshot()
    quote_freshness = quote_meta.get("freshness")
    checks = [
        _check(
            "quote_timestamp",
            "Quote exchange timestamp",
            "warn" if quote_freshness == "unknown" else "ok",
            "TradingView scanner does not provide an exchange timestamp. The receipt time is recorded, but the quote time is unknown.",
        ),
        _check(
            "quote_availability",
            "Quote availability",
            "ok" if len(quotes) == len(COMPARE_KEYS) else "warn",
            f"{len(quotes)} of {len(COMPARE_KEYS)} index snapshots returned.",
        ),
        _check(
            "cross_source",
            "Cross-source price agreement",
            "error" if mismatches else "warn" if watches or not any(row["state"] == "consistent" for row in cross_checks) else "ok",
            f"{len(mismatches)} mismatch, {len(watches)} watch and {sum(1 for row in cross_checks if row['state'] == 'consistent')} consistent value comparisons against Yahoo.",
        ),
        _check(
            "provider_health",
            "Provider health register",
            "error" if any(row.get("status") == "error" for row in provider_rows) else "ok" if provider_rows else "warn",
            f"{len(provider_rows)} provider(s) observed in this process. Health resets when the API restarts.",
        ),
        _check(
            "licensed_feed",
            "Licensed feed entitlement",
            "ok"
            if licensed.get("state") == "verified"
            else "error"
            if licensed.get("state") in {"license_disabled", "error"}
            else "warn",
            licensed.get("detail")
            or ("Licensed vendor feed is not configured; public feeds only."),
        ),
        _check(
            "audit_chain",
            "Local audit integrity",
            "ok" if get_db().verify_audit_chain() else "error",
            "SHA-256 chain over the local paper-trading and risk audit log."
            if get_db().verify_audit_chain()
            else "The local audit hash chain is broken. Investigate before trusting trade records.",
        ),
    ]
    if not quotes:
        overall = "unavailable"
    elif mismatches or any(check["status"] == "error" for check in checks):
        overall = "degraded"
    elif any(check["status"] == "warn" for check in checks):
        overall = "watch"
    else:
        overall = "ok"
    return {
        "overall": overall,
        "generated_at": iso(now),
        "live_execution_enabled": False,
        "quote_meta": quote_meta,
        "licensed_feed": licensed,
        "cross_checks": cross_checks,
        "checks": checks,
        "provider_health": provider_rows,
        "warnings": [
            "TradingView scanner values have no exchange timestamp; treat them as snapshots, not synchronized real-time ticks.",
            "Yahoo Finance is a delayed public chart feed. A value cross-check is not an authorized consolidated feed.",
            (
                "Global Datafeeds is configured. Its REST snapshots are licensed for personal local display only; "
                "they are not a tick stream and are not an execution-grade consolidated tape."
                if licensed.get("configured")
                else "No licensed exchange feed is configured. All quoted prices remain public/delayed or timestamp-unknown."
            ),
            "Provider health is process-local and does not replace external monitoring or alerting.",
        ],
        "note": (
            "This monitor compares two public research feeds and separately reports the licensed vendor entitlement. "
            "It cannot certify execution-grade prices."
        ),
        "unavailable_meta": unavailable_meta(
            "TradingView scanner / Yahoo Finance",
            "cross-source quality",
            "Quality monitor partial failure.",
        )
        if not quotes
        else None,
    }
