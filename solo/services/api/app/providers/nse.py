from datetime import datetime

from ..timeutil import iso, utc_now
from .http import ProviderError, fetch_json

PROVIDER = "NSE India"
FII_DII_URL = "https://www.nseindia.com/api/fiidiiTradeReact"
FII_DII_PAGE = "https://www.nseindia.com/market-data/fii-dii"
HEADERS = {
    "Referer": FII_DII_PAGE,
    "Origin": "https://www.nseindia.com",
    "Accept": "application/json, text/plain, */*",
}


def _number(value) -> float | None:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


async def fii_dii(timeout: float = 15) -> dict:
    """Fetch NSE's public FII/DII cash-market provisional flow table.

    This is an undocumented public website endpoint, not an exchange-licensed
    real-time API. It is normal for NSE to reject requests without browser-like
    headers, and callers must surface that failure instead of substituting data.
    """
    payload = await fetch_json(
        PROVIDER,
        FII_DII_URL,
        headers=HEADERS,
        timeout=timeout,
        retries=1,
    )
    if not isinstance(payload, list):
        raise ProviderError("NSE FII/DII response is not a list")
    rows = []
    reported_dates = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "").strip()
        date_text = str(item.get("date") or "").strip()
        buy = _number(item.get("buyValue"))
        sell = _number(item.get("sellValue"))
        net = _number(item.get("netValue"))
        if not category or buy is None or sell is None or net is None:
            continue
        reported_dates.add(date_text)
        rows.append(
            {
                "category": category,
                "date": date_text,
                "buy": buy,
                "sell": sell,
                "net": net,
                "unit": "INR crore",
            }
        )
    if not rows:
        raise ProviderError("NSE FII/DII response contained no usable rows")
    return {
        "rows": rows,
        "reported_date": sorted(reported_dates)[-1] if reported_dates else None,
        "fetched_at": iso(utc_now()),
        "source": PROVIDER,
        "source_url": FII_DII_PAGE,
        "data_origin": "observed_nse_public_fii_dii",
    }
