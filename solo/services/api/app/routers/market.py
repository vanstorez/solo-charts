import asyncio

from fastapi import APIRouter, HTTPException, Query

from ..cache import cache
from ..providers import nseindia
from ..services import market
from ..timeutil import market_session

router = APIRouter(prefix="/api", tags=["market"])


@router.get("/overview")
async def overview():
    return await market.overview()


@router.get("/market/session")
async def session():
    return market_session()


@router.get("/symbols")
async def symbols():
    return {
        "symbols": [
            {
                "key": key,
                "name": value["name"],
                "short": value["short"],
                "exchange": value["exchange"],
                "type": value["type"],
                "currency": value["currency"],
            }
            for key, value in market.SYMBOLS.items()
        ],
        "intervals": market.INTERVALS,
        "allowed_ranges": market.ALLOWED_RANGES,
    }


@router.get("/quotes")
async def quotes(
    keys: str = Query(default="NIFTY,BANKNIFTY,SENSEX,INDIAVIX", description="Comma-separated symbol keys"),
):
    requested = [key.strip() for key in keys.split(",") if key.strip()][:24]
    cache_key = "quotes:" + ",".join(requested)
    # During the open session refresh aggressively (near-live free data);
    # outside hours the last close doesn't change, so cache longer.
    session_open = market_session()["is_open"]  # noqa: F841
    ttl = 15 if session_open else 60

    async def fetch():
        rows, meta = await market.get_quotes(requested)
        # Public providers (TradingView/Yahoo) occasionally fail transiently.
        # Retry once when the batch comes back incomplete instead of surfacing
        # missing rows as a hard failure.
        if len(rows) < len(requested):
            await asyncio.sleep(1.0)
            retry_rows, retry_meta = await market.get_quotes(requested)
            if len(retry_rows) > len(rows):
                rows, meta = retry_rows, retry_meta
        return {"quotes": rows, "meta": meta}

    try:
        return await cache.get_or_set(cache_key, ttl, fetch)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Quote provider unavailable: {str(exc)[:240]}") from exc


@router.get("/quote-live")
async def quote_live(
    key: str = Query(..., description="NSE equity symbol key, e.g. RELIANCE, TCS"),
):
    """
    Free on-demand quote for an NSE stock.

    Tries the exchange's own page first (live during market hours); when NSE's
    reverse proxy blocks the network it falls back to the best free public
    snapshot, always with its honest label.
    Cached session-aware (15s open / 60s closed).
    """
    symbol = market.SYMBOLS.get(key.strip().upper())
    if not symbol:
        raise HTTPException(status_code=404, detail=f"Unknown symbol key: {key}")
    if symbol.get("exchange") != "NSE" or symbol.get("type") != "stock":
        raise HTTPException(
            status_code=400,
            detail=f"{key} is not an NSE equity — live lookups cover NSE stocks only",
        )

    session_open = market_session()["is_open"]
    ttl = 15 if session_open else 60
    cache_key = f"quote-live:{key}"

    async def fetch():
        row = await nseindia.stock_quote(key.strip().upper())
        if row is not None:
            return {
                "key": key.strip().upper(),
                "name": symbol["name"],
                "short": symbol["short"],
                "exchange": symbol["exchange"],
                "type": symbol["type"],
                "currency": symbol["currency"],
                **{k: v for k, v in row.items() if k not in ("nse_name",)},
                "live_attempt": "nse-direct",
                "note": None,
            }
        # NSE's public equity page refuses this network (Akamai 403). Fall back to
        # the best FREE public snapshot — always honestly labelled as delayed.
        rows, _meta = await market.get_quotes([key.strip().upper()])
        if not rows:
            raise ValueError("No quote available right now")
        delayed = rows[0] if isinstance(rows, list) and rows else None
        if not delayed:
            raise ValueError("No quote available right now")
        last = delayed.get("value")
        # TV scanner rows store the PERCENT change in `change` (see provider
        # columns: close, change, volume) — mirror that existing convention.
        change = delayed.get("change")
        pchange = delayed.get("change_pct") if delayed.get("change_pct") is not None else change
        if isinstance(pchange, (int, float)):
            pchange = round(pchange, 2)
        return {
            "key": delayed.get("key", key.strip().upper()),
            "name": symbol["name"],
            "short": symbol["short"],
            "exchange": symbol["exchange"],
            "type": symbol["type"],
            "currency": symbol["currency"],
            "value": last,
            "change": change,
            "change_pct": pchange,
            "open": delayed.get("open"),
            "high": delayed.get("high"),
            "low": delayed.get("low"),
            "previous_close": delayed.get("previous_close"),
            "year_high": delayed.get("year_high"),
            "year_low": delayed.get("year_low"),
            "volume": delayed.get("volume"),
            "as_of": delayed.get("as_of"),
            "source": delayed.get("source"),
            "data_status": delayed.get("data_status", "delayed"),
            "live_attempt": "fallback-delayed",
            "note": "NSE equity page refuses this network (reverse-proxy block) — value is the best free public snapshot, honestly delayed",
        }

    try:
        return await cache.get_or_set(cache_key, ttl, fetch)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"NSE live provider unavailable: {str(exc)[:160]}") from exc


@router.get("/chart")
async def chart(
    symbol: str = Query(default="NIFTY"),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
):
    cache_key = f"chart:{symbol}:{interval}:{range}"

    async def fetch():
        return await market.get_chart(symbol, interval, range)

    try:
        return await cache.get_or_set(cache_key, 60, fetch)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Chart provider unavailable: {str(exc)[:240]}") from exc
