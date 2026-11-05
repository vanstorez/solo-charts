from datetime import datetime, timezone

from ..provenance import feed_meta
from ..providers import nse
from ..timeutil import utc_now


def _as_of(reported_date: str | None) -> datetime | None:
    if not reported_date:
        return None
    for pattern in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(reported_date, pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _summary(rows: list[dict]) -> list[dict]:
    by_category = {row["category"].upper(): row for row in rows}
    out = []
    for key, label in (("FII/FPI", "FII / FPI"), ("DII", "DII")):
        row = by_category.get(key)
        if not row:
            continue
        out.append(
            {
                "category": label,
                "net": row["net"],
                "buy": row["buy"],
                "sell": row["sell"],
                "unit": row["unit"],
                "direction": "net buying" if row["net"] > 0 else "net selling" if row["net"] < 0 else "flat",
            }
        )
    return out


def _meta(reported_date: str | None, rows: list[dict], error: Exception | None = None) -> dict:
    if error is not None:
        from ..provenance import unavailable_meta

        return unavailable_meta(nse.PROVIDER, "FII/DII provisional cash-market flows", str(error)[:260])
    return feed_meta(
        nse.PROVIDER,
        "FII/DII provisional cash-market flows",
        as_of=_as_of(reported_date),
        source_type="eod",
        status="ok",
        detail="NSE public FII/DII provisional cash-market table. Trade date is supplied; exact publication time is not. Values are in INR crore.",
        fresh_after=20 * 3600,
        stale_after=72 * 3600,
    )


async def get_flows() -> dict:
    try:
        payload = await nse.fii_dii()
        rows = payload["rows"]
        reported_date = payload.get("reported_date")
        return {
            "available": True,
            "rows": rows,
            "summary": _summary(rows),
            "reported_date": reported_date,
            "unit": "INR crore",
            "source_url": payload.get("source_url"),
            "meta": _meta(reported_date, rows),
            "note": (
                "Cash-market provisional flows only. Derivatives positioning and final exchange revisions are not included. "
                "A single day's flow is context, not a Bank Nifty direction signal."
            ),
            "fetched_at": utc_now().isoformat(),
        }
    except Exception as exc:
        return {
            "available": False,
            "rows": [],
            "summary": [],
            "reported_date": None,
            "unit": "INR crore",
            "source_url": nse.FII_DII_PAGE,
            "meta": _meta(None, [], exc),
            "note": "The NSE feed is unavailable. No flow values are substituted.",
            "fetched_at": utc_now().isoformat(),
        }
