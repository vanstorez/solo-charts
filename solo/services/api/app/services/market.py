import asyncio
from datetime import datetime

from ..config import get_settings
from ..indicators import atr, ema, macd, max_drawdown, pivot_points, round_values, rsi
from ..provenance import feed_meta, unavailable_meta
from ..providers import globaldatafeeds as gdf
from ..providers import nseindia, tradingview, yahoo
from ..timeutil import market_session, utc_now


def nseindia_enabled() -> bool:
    """Direct provider flag from settings (nseindia.status() also reports it)."""
    return bool(getattr(get_settings(), "nse_direct_enabled", True))

SYMBOLS: dict[str, dict] = {
    "NIFTY": {"name": "Nifty 50", "short": "NIFTY", "tv": "NSE:NIFTY", "yahoo": "^NSEI", "exchange": "NSE", "type": "index", "currency": "INR"},
    "BANKNIFTY": {"name": "Bank Nifty", "short": "BANKNIFTY", "tv": "NSE:BANKNIFTY", "yahoo": "^NSEBANK", "exchange": "NSE", "type": "index", "currency": "INR"},
    "SENSEX": {"name": "Sensex", "short": "SENSEX", "tv": "BSE:SENSEX", "yahoo": "^BSESN", "exchange": "BSE", "type": "index", "currency": "INR"},
    "INDIAVIX": {"name": "India VIX", "short": "INDIAVIX", "tv": "NSE:INDIAVIX", "yahoo": "^INDIAVIX", "exchange": "NSE", "type": "index", "currency": "INR"},
    "GIFT": {"name": "GIFT Nifty", "short": "GIFT", "tv": "NSEIX:NIFTY1!", "yahoo": None, "exchange": "NSE IX", "type": "index", "currency": "USD"},
    "SPX": {"name": "S&P 500", "short": "SPX", "tv": "TVC:SPX", "yahoo": "^GSPC", "exchange": "SP", "type": "global", "currency": "USD"},
    "NDX": {"name": "Nasdaq 100", "short": "NDX", "tv": "TVC:NDX", "yahoo": "^NDX", "exchange": "NASDAQ", "type": "global", "currency": "USD"},
    "DJI": {"name": "Dow Jones", "short": "DJI", "tv": "TVC:DJI", "yahoo": "^DJI", "exchange": "DJ", "type": "global", "currency": "USD"},
    "BRENT": {"name": "Brent crude", "short": "BRENT", "tv": "NYMEX:BZ1!", "yahoo": "BZ=F", "exchange": "NYMEX", "type": "global", "currency": "USD"},
    "WTI": {"name": "WTI crude", "short": "WTI", "tv": "NYMEX:CL1!", "yahoo": "CL=F", "exchange": "NYMEX", "type": "global", "currency": "USD"},
    "GOLD": {"name": "Gold futures", "short": "GOLD", "tv": "COMEX:GC1!", "yahoo": "GC=F", "exchange": "COMEX", "type": "global", "currency": "USD"},
    "SILVER": {"name": "Silver futures", "short": "SILVER", "tv": "COMEX:SI1!", "yahoo": "SI=F", "exchange": "COMEX", "type": "global", "currency": "USD"},
    "USDINR": {"name": "USD / INR", "short": "USDINR", "tv": "FX_IDC:USDINR", "yahoo": "INR=X", "exchange": "FX", "type": "global", "currency": "INR"},
    "DXY": {"name": "US Dollar Index", "short": "DXY", "tv": "TVC:DXY", "yahoo": "DX-Y.NYB", "exchange": "ICE", "type": "global", "currency": "USD"},
    "US10Y": {"name": "US 10Y yield", "short": "US10Y", "tv": "TVC:US10Y", "yahoo": "^TNX", "exchange": "CBOT", "type": "global", "currency": "%"},
    "RELIANCE": {"name": "Reliance Industries", "short": "RELIANCE", "tv": "NSE:RELIANCE", "yahoo": "RELIANCE.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "HDFCBANK": {"name": "HDFC Bank", "short": "HDFCBANK", "tv": "NSE:HDFCBANK", "yahoo": "HDFCBANK.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "ICICIBANK": {"name": "ICICI Bank", "short": "ICICIBANK", "tv": "NSE:ICICIBANK", "yahoo": "ICICIBANK.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "SBIN": {"name": "State Bank of India", "short": "SBIN", "tv": "NSE:SBIN", "yahoo": "SBIN.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "AXISBANK": {"name": "Axis Bank", "short": "AXISBANK", "tv": "NSE:AXISBANK", "yahoo": "AXISBANK.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "KOTAKBANK": {"name": "Kotak Mahindra Bank", "short": "KOTAKBANK", "tv": "NSE:KOTAKBANK", "yahoo": "KOTAKBANK.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "TCS": {"name": "Tata Consultancy Services", "short": "TCS", "tv": "NSE:TCS", "yahoo": "TCS.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "INFY": {"name": "Infosys", "short": "INFY", "tv": "NSE:INFY", "yahoo": "INFY.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "ITC": {"name": "ITC", "short": "ITC", "tv": "NSE:ITC", "yahoo": "ITC.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "LT": {"name": "Larsen & Toubro", "short": "LT", "tv": "NSE:LT", "yahoo": "LT.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    "TATASTEEL": {"name": "Tata Steel", "short": "TATASTEEL", "tv": "NSE:TATASTEEL", "yahoo": "TATASTEEL.NS", "exchange": "NSE", "type": "stock", "currency": "INR"},
    # --- Indian index universe (public Yahoo daily history; quotes use Yahoo fallback) ---
    "NIFTY_NEXT50": {"name": "Nifty Next 50", "short": "NEXT50", "tv": None, "yahoo": "^NSMIDCP", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY100": {"name": "Nifty 100", "short": "N100", "tv": None, "yahoo": "^CNX100", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_MIDCAP50": {"name": "Nifty Midcap 50", "short": "MID50", "tv": None, "yahoo": "^CRSLDX", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_MIDCAP150": {"name": "Nifty Midcap 150", "short": "MID150", "tv": None, "yahoo": "NIFTYMIDCAP150.NS", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_IT": {"name": "Nifty IT", "short": "NIFTYIT", "tv": None, "yahoo": "^CNXIT", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_AUTO": {"name": "Nifty Auto", "short": "NIFTYAUTO", "tv": None, "yahoo": "^CNXAUTO", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_PHARMA": {"name": "Nifty Pharma", "short": "NIFTYPHARMA", "tv": None, "yahoo": "^CNXPHARMA", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_FMCG": {"name": "Nifty FMCG", "short": "NIFTYFMCG", "tv": None, "yahoo": "^CNXFMCG", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_METAL": {"name": "Nifty Metal", "short": "NIFTYMETAL", "tv": None, "yahoo": "^CNXMETAL", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_ENERGY": {"name": "Nifty Energy", "short": "NIFTYENERGY", "tv": None, "yahoo": "^CNXENERGY", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_INFRA": {"name": "Nifty Infrastructure", "short": "NIFTYINFRA", "tv": None, "yahoo": "^CNXINFRA", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_PSU_BANK": {"name": "Nifty PSU Bank", "short": "PSUBANK", "tv": None, "yahoo": "^CNXPSUBANK", "exchange": "NSE", "type": "index", "currency": "INR"},
    "NIFTY_REALTY": {"name": "Nifty Realty", "short": "NIFTYREALTY", "tv": None, "yahoo": "^CNXREALTY", "exchange": "NSE", "type": "index", "currency": "INR"},
    "BSE100": {"name": "S&P BSE 100", "short": "BSE100", "tv": None, "yahoo": "BSE-100.BO", "exchange": "BSE", "type": "index", "currency": "INR"},
    "BSE500": {"name": "S&P BSE 500", "short": "BSE500", "tv": None, "yahoo": "BSE-500.BO", "exchange": "BSE", "type": "index", "currency": "INR"},
}

INTERVALS = ["5m", "15m", "30m", "1h", "1d", "1wk"]
INTERVAL_MAP = {"5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "1d": "1d", "1wk": "1wk"}
ALLOWED_RANGES = {
    "5m": ["1d", "5d", "1mo"],
    "15m": ["1d", "5d", "1mo"],
    "30m": ["1d", "5d", "1mo"],
    "1h": ["1mo", "3mo", "6mo", "1y"],
    "1d": ["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"],
    "1wk": ["1y", "5y", "10y", "max"],
}
DEFAULT_RANGE = {"5m": "5d", "15m": "5d", "30m": "5d", "1h": "1mo", "1d": "1y", "1wk": "5y"}
CHART_COLUMNS = ["close", "change", "volume"]

# Global Datafeeds uses separate exchange codes for cash and index instruments.
# Only symbols with an explicit mapping are requested from the licensed feed;
# global instruments continue to use public delayed providers.
GDF_INDEX_MAP: dict[str, dict[str, str]] = {
    "NIFTY": {"exchange": "NSE_IDX", "identifier": "NIFTY"},
    "BANKNIFTY": {"exchange": "NSE_IDX", "identifier": "BANKNIFTY"},
    "INDIAVIX": {"exchange": "NSE_IDX", "identifier": "INDIAVIX"},
    "SENSEX": {"exchange": "BSE_IDX", "identifier": "SENSEX"},
}


def _gdf_mapping(key: str, symbol: dict) -> dict[str, str] | None:
    if key in GDF_INDEX_MAP:
        return dict(GDF_INDEX_MAP[key])
    if symbol.get("exchange") == "NSE" and symbol.get("type") == "stock":
        return {"exchange": "NSE", "identifier": key}
    return None


def resolve_symbol(value: str | None) -> dict | None:
    key = str(value or "NIFTY").strip().upper()
    if key in SYMBOLS:
        symbol = {"key": key, **SYMBOLS[key]}
        symbol["gdf"] = _gdf_mapping(key, symbol)
        return symbol
    if key.startswith("Y:") or any(char in value for char in ".=^"):
        yahoo_symbol = str(value)[2:] if key.startswith("Y:") else str(value)
        return {
            "key": f"Y:{yahoo_symbol}",
            "name": yahoo_symbol,
            "short": yahoo_symbol,
            "tv": None,
            "yahoo": yahoo_symbol,
            "exchange": "Global",
            "type": "global",
            "currency": "USD",
            "gdf": None,
        }
    return None


async def _yahoo_quote(symbol: dict) -> dict | None:
    if not symbol.get("yahoo"):
        return None
    try:
        data = await yahoo.chart(symbol["yahoo"], "1d", "5d", ttl=60)
        last = data["bars"][-1]
        previous = data["bars"][-2]["c"] if len(data["bars"]) > 1 else data.get("previous_close")
        return {
            "value": data.get("regular_market_price") or last["c"],
            "change": ((last["c"] / previous - 1) * 100) if previous else None,
            "volume": last.get("v"),
            "as_of": data.get("as_of") or datetime.fromtimestamp(last["t"] / 1000),
            "source": "Yahoo Finance",
        }
    except Exception:
        return None


async def get_quotes(keys: list[str], prefer_licensed: bool = True) -> tuple[list[dict], dict]:
    symbols = [resolve_symbol(key) for key in keys]
    symbols = [symbol for symbol in symbols if symbol]
    if not symbols:
        return [], feed_meta(
            "TradingView scanner", "quotes", status="unavailable", source_type="unavailable", detail="No valid symbols."
        )

    licensed_symbols = [
        symbol for symbol in symbols if prefer_licensed and symbol.get("gdf") and gdf.configured()
    ]
    licensed_rows: dict[str, dict] = {}
    licensed_error: Exception | None = None
    if licensed_symbols:
        try:
            licensed_rows = await gdf.quotes(
                [
                    {
                        "key": symbol["key"],
                        "exchange": symbol["gdf"]["exchange"],
                        "identifier": symbol["gdf"]["identifier"],
                    }
                    for symbol in licensed_symbols
                ]
            )
        except Exception as exc:
            licensed_error = exc

    remaining = [symbol for symbol in symbols if symbol["key"] not in licensed_rows]
    tickers = [symbol["tv"] for symbol in remaining if symbol.get("tv")]
    rows: dict[str, dict] = {}
    provider_error: Exception | None = None
    if tickers:
        try:
            rows = await tradingview.quotes(tickers, CHART_COLUMNS + ["RSI", "Recommend.All"])
        except Exception as exc:
            provider_error = exc

    # NSE direct (exchange's own public site, personal use only): best available
    # free source for NSE indices. Uses a single allIndices request per window.
    nse_rows: dict[str, dict] = {}
    if nseindia_enabled():
        nse_keys = [
            symbol["key"]
            for symbol in remaining
            if symbol.get("key") in nseindia.NSE_INDEX_NAMES
            and symbol.get("exchange") == "NSE"
            and symbol.get("type") == "index"
        ]
        if nse_keys:
            try:
                nse_rows = await nseindia.quotes(nse_keys)
            except Exception:
                nse_rows = {}

    quote_rows = []
    used_sources: set[str] = set()
    licensed_count = 0
    public_count = 0
    licensed_as_of: list[datetime] = []
    for symbol in symbols:
        licensed = licensed_rows.get(symbol["key"])
        if licensed:
            licensed_count += 1
            as_of = licensed.get("as_of")
            if isinstance(as_of, datetime):
                licensed_as_of.append(as_of)
            data_status = "live" if licensed.get("live") else "delayed"
            quote_rows.append(
                {
                    "key": symbol["key"],
                    "name": symbol["name"],
                    "short": symbol["short"],
                    "exchange": symbol["exchange"],
                    "type": symbol["type"],
                    "currency": symbol["currency"],
                    "value": licensed.get("value"),
                    "change": licensed.get("change"),
                    "volume": licensed.get("volume"),
                    "rsi": None,
                    "rating": None,
                    "as_of": as_of.isoformat() if isinstance(as_of, datetime) else None,
                    "source": licensed.get("source") or "Global Datafeeds licensed snapshot",
                    "data_status": data_status,
                    "delay_seconds": licensed.get("delay_seconds"),
                    "open": licensed.get("open"),
                    "high": licensed.get("high"),
                    "low": licensed.get("low"),
                    "previous_close": licensed.get("previous_close"),
                    "bid": licensed.get("bid"),
                    "ask": licensed.get("ask"),
                    "open_interest": licensed.get("open_interest"),
                }
            )
            used_sources.add("Global Datafeeds")
            continue

        nse = nse_rows.get(symbol["key"])
        if nse:
            public_count += 1
            quote_rows.append(
                {
                    "key": symbol["key"],
                    "name": symbol["name"],
                    "short": symbol["short"],
                    "exchange": symbol["exchange"],
                    "type": symbol["type"],
                    "currency": symbol["currency"],
                    "value": nse.get("value"),
                    "change": nse.get("change"),
                    "volume": None,
                    "rsi": None,
                    "rating": None,
                    "as_of": nse.get("as_of"),
                    "source": nse.get("source", "NSE India (nseindia.com direct)"),
                    "data_status": nse.get("data_status", "delayed"),
                    "delay_seconds": None,
                    "open": nse.get("open"),
                    "high": nse.get("high"),
                    "low": nse.get("low"),
                    "previous_close": nse.get("previous_close"),
                    "bid": None,
                    "ask": None,
                    "open_interest": None,
                }
            )
            used_sources.add("NSE India direct")
            continue

        row = rows.get(symbol.get("tv") or "")
        if row and row.get("close") is not None:
            public_count += 1
            quote_rows.append(
                {
                    "key": symbol["key"],
                    "name": symbol["name"],
                    "short": symbol["short"],
                    "exchange": symbol["exchange"],
                    "type": symbol["type"],
                    "currency": symbol["currency"],
                    "value": row.get("close"),
                    "change": row.get("change"),
                    "volume": row.get("volume"),
                    "rsi": row.get("RSI"),
                    "rating": row.get("Recommend.All"),
                    "as_of": None,
                    "source": "TradingView scanner snapshot",
                    "data_status": "delayed",
                    "delay_seconds": None,
                }
            )
            used_sources.add("TradingView scanner")
        else:
            fallback = await _yahoo_quote(symbol)
            if fallback:
                public_count += 1
                quote_rows.append(
                    {
                        "key": symbol["key"],
                        "name": symbol["name"],
                        "short": symbol["short"],
                        "exchange": symbol["exchange"],
                        "type": symbol["type"],
                        "currency": symbol["currency"],
                        "value": fallback["value"],
                        "change": fallback["change"],
                        "volume": fallback.get("volume"),
                        "rsi": None,
                        "rating": None,
                        "as_of": fallback["as_of"].isoformat() if fallback.get("as_of") else None,
                        "source": fallback["source"],
                        "data_status": "delayed",
                        "delay_seconds": None,
                    }
                )
                used_sources.add("Yahoo Finance fallback")
            else:
                public_count += 1
                quote_rows.append(
                    {
                        "key": symbol["key"],
                        "name": symbol["name"],
                        "short": symbol["short"],
                        "exchange": symbol["exchange"],
                        "type": symbol["type"],
                        "currency": symbol["currency"],
                        "value": None,
                        "change": None,
                        "volume": None,
                        "rsi": None,
                        "rating": None,
                        "as_of": None,
                        "source": "unavailable",
                        "data_status": "unavailable",
                        "delay_seconds": None,
                    }
                )

    status = "ok" if any(row["value"] is not None for row in quote_rows) else "unavailable"
    all_values = [row for row in quote_rows if row["value"] is not None]
    all_live = bool(all_values) and all(row.get("data_status") == "live" for row in all_values)
    if licensed_count and public_count:
        provider = "Global Datafeeds + public fallback"
        source_type = "live" if all_live else "delayed"
        detail = (
            f"Licensed Global Datafeeds for {licensed_count} symbol(s); "
            f"public delayed fallback for {public_count} symbol(s). Personal local display only."
        )
    elif licensed_count:
        provider = "Global Datafeeds"
        source_type = "live" if all_live else "delayed"
        detail = (
            "Licensed Global Datafeeds REST snapshot. Personal local display only. "
            + (
                "Vendor entitlement declares zero exchange delay; this is still a polled snapshot, not a tick stream."
                if all_live
                else "Entitlement is unverified or delayed; treat it as delayed until GetLimitation confirms the contract."
            )
        )
    else:
        provider = "TradingView scanner" if "TradingView scanner" in used_sources else "Yahoo Finance"
        source_type = "delayed"
        detail = "; ".join(sorted(used_sources)) or str(provider_error or "No quotes returned")[:260]
        detail += ". Exchange timestamp and exact delay are not supplied by the public provider."
        if licensed_error:
            detail += f" Licensed feed failed: {str(licensed_error)[:160]}"
    as_of = max(licensed_as_of) if licensed_as_of else None
    meta = feed_meta(
        provider,
        "quotes",
        as_of=as_of,
        source_type=source_type,
        status=status,
        detail=detail,
        fresh_after=15 if source_type == "live" else 20,
        stale_after=90 if source_type == "live" else 120,
        delay_seconds=gdf.verified_delay_seconds() if licensed_count else None,
    )
    return quote_rows, meta


async def get_quote(key: str) -> tuple[dict | None, dict]:
    rows, meta = await get_quotes([key])
    return (rows[0] if rows else None), meta


def _summary(bars: list[dict], daily_bars: list[dict]) -> dict:
    closes = [bar["c"] for bar in bars]
    daily_closes = [bar["c"] for bar in (daily_bars or bars)]
    ema20 = ema(closes, 20)[-1]
    ema50 = ema(closes, 50)[-1]
    ema200 = ema(closes, 200)[-1]
    daily_ema20 = ema(daily_closes, 20)[-1]
    daily_ema50 = ema(daily_closes, 50)[-1]
    daily_ema200 = ema(daily_closes, 200)[-1]
    daily_rsi = rsi(daily_closes, 14)[-1]
    daily_macd = macd(daily_closes)
    macd_hist = daily_macd["hist"][-1]
    atr14 = atr(bars, 14)[-1]
    last = bars[-1]
    previous = bars[-2] if len(bars) > 1 else None
    score = sum(
        [
            bool(daily_ema20 and last["c"] > daily_ema20),
            bool(daily_ema50 and last["c"] > daily_ema50),
            bool(daily_ema200 and last["c"] > daily_ema200),
            bool(daily_ema20 and daily_ema50 and daily_ema20 > daily_ema50),
            bool(daily_rsi and daily_rsi >= 50),
            bool(macd_hist and macd_hist > 0),
        ]
    )
    rating = (
        "strong_buy"
        if score >= 5
        else "buy"
        if score == 4
        else "neutral"
        if score == 3
        else "sell"
        if score == 2
        else "strong_sell"
    )
    daily252 = (daily_bars or bars)[-252:]
    high52 = max((bar["h"] for bar in daily252), default=None)
    low52 = min((bar["l"] for bar in daily252), default=None)
    return {
        "rating": rating,
        "score": round(score / 6 * 100, 1),
        "ema20": round_values(ema20),
        "ema50": round_values(ema50),
        "ema200": round_values(ema200),
        "rsi14": round_values(rsi(closes, 14)[-1]),
        "atr14": round_values(atr14),
        "atr_pct": round_values((atr14 / last["c"] * 100) if atr14 and last["c"] else None),
        "change": round_values((last["c"] / previous["c"] - 1) * 100) if previous else None,
        "high52": round_values(high52),
        "low52": round_values(low52),
        "max_drawdown_2y": max_drawdown([bar["c"] for bar in (daily_bars or bars)[-504:]]) if daily_bars or bars else None,
        "signals": [
            f"Price {'above' if daily_ema20 and last['c'] > daily_ema20 else 'below'} 20-DMA",
            f"Price {'above' if daily_ema200 and last['c'] > daily_ema200 else 'below'} 200-DMA",
            f"RSI {round_values(daily_rsi, 1) if daily_rsi is not None else 'unavailable'}",
            f"MACD histogram {'positive' if macd_hist and macd_hist > 0 else 'negative'}",
        ],
    }


def _levels(bars: list[dict], daily_bars: list[dict]) -> dict:
    source = daily_bars if daily_bars else bars
    last = source[-1]
    pivot = pivot_points(last)
    last20 = source[-20:]
    spot = last["c"]
    supports = sorted(
        [value for value in [pivot["s1"], pivot["s2"], min(bar["l"] for bar in last20)] if value < spot],
        reverse=True,
    )[:3]
    resistances = sorted(
        [value for value in [pivot["r1"], pivot["r2"], max(bar["h"] for bar in last20)] if value > spot]
    )[:3]
    return {
        "pivot": round_values(pivot["p"]),
        "supports": [round_values(value) for value in supports],
        "resistances": [round_values(value) for value in resistances],
    }


def _range_bar_estimate(interval: str, range_value: str) -> int:
    """Approximate the number of bars needed to cover a UI range.

    The licensed REST API accepts a record limit (``max``), not a range. The
    estimate is deliberately generous and is capped by SOLO_GDF_HISTORY_MAX.
    Truncation is surfaced in the chart provenance rather than hidden.
    """
    per_day = {"5m": 75, "15m": 25, "30m": 13, "1h": 7}.get(interval)
    if per_day:
        sessions = {"1d": 1, "5d": 5, "1mo": 22, "3mo": 66, "6mo": 132, "1y": 252}.get(range_value, 5)
        return min(5000, max(80, per_day * sessions + 20))
    if interval == "1d":
        return {
            "1mo": 40,
            "3mo": 80,
            "6mo": 160,
            "1y": 280,
            "2y": 540,
            "5y": 1300,
            "10y": 2600,
            "max": 5000,
        }.get(range_value, 280)
    if interval == "1wk":
        return {"1y": 60, "5y": 280, "10y": 540, "max": 1000}.get(range_value, 280)
    return 280


async def get_chart(symbol_input: str = "NIFTY", interval_input: str = "1d", range_input: str = "1y") -> dict:
    symbol = resolve_symbol(symbol_input)
    if not symbol:
        raise ValueError(f"Chart unavailable for {symbol_input}")
    interval = interval_input if interval_input in INTERVALS else "1d"
    allowed = ALLOWED_RANGES[interval]
    range_value = range_input if range_input in allowed else DEFAULT_RANGE[interval]

    bars: list[dict] = []
    daily_bars: list[dict] = []
    primary_as_of = None
    licensed_used = False
    licensed_live = False
    licensed_delay: int | None = None
    licensed_truncated = False
    licensed_error: Exception | None = None

    if symbol.get("gdf") and gdf.configured():
        mapped = {
            "exchange": symbol["gdf"]["exchange"],
            "identifier": symbol["gdf"]["identifier"],
        }
        primary_result, daily_result = await asyncio.gather(
            gdf.history(mapped, interval, _range_bar_estimate(interval, range_value)),
            gdf.history(mapped, "1d", _range_bar_estimate("1d", "2y")),
            return_exceptions=True,
        )
        if isinstance(primary_result, Exception):
            licensed_error = primary_result
        else:
            bars = primary_result.get("bars") or []
            primary_as_of = primary_result.get("as_of")
            licensed_live = bool(primary_result.get("live"))
            licensed_delay = primary_result.get("delay_seconds")
            licensed_truncated = bool(primary_result.get("truncated"))
            licensed_used = bool(bars)
        if isinstance(daily_result, Exception):
            daily_bars = bars
        else:
            daily_bars = daily_result.get("bars") or bars

    if not bars:
        if not symbol.get("yahoo"):
            detail = f"Licensed chart unavailable for {symbol['key']}"
            if licensed_error:
                detail += f": {str(licensed_error)[:220]}"
            raise ValueError(detail)
        yahoo_interval = INTERVAL_MAP[interval]
        primary, daily = await asyncio.gather(
            yahoo.chart(symbol["yahoo"], yahoo_interval, range_value, ttl=90),
            yahoo.chart(symbol["yahoo"], "1d", "2y", ttl=600),
        )
        bars = [bar for bar in primary["bars"] if bar.get("c") is not None]
        daily_bars = [bar for bar in daily.get("bars", []) if bar.get("c") is not None]
        primary_as_of = primary.get("as_of")
        if not bars:
            raise ValueError(f"No candles returned for {symbol['key']}")

    if not daily_bars:
        daily_bars = bars
    quote_rows, quote_meta = await get_quotes([symbol["key"]])
    quote = quote_rows[0] if quote_rows else None
    last = bars[-1]
    last_daily = daily_bars[-1] if daily_bars else last
    summary = _summary(bars, daily_bars)
    levels = _levels(bars, daily_bars)
    if licensed_used:
        source_type = (
            "live"
            if licensed_live and interval not in {"1d", "1wk"}
            else "eod"
            if interval in {"1d", "1wk"}
            else "delayed"
        )
        detail = (
            "Licensed Global Datafeeds REST OHLC history for personal local display. "
            "This is a polled snapshot, not a tick stream; do not use it for broker execution pricing."
        )
        if licensed_truncated:
            detail += " The provider record limit truncated the requested range; only the returned bars are shown."
        if licensed_delay is not None:
            detail += f" Declared exchange delay: {licensed_delay}s."
        meta = feed_meta(
            "Global Datafeeds",
            f"OHLCV {interval}",
            as_of=primary_as_of,
            source_type=source_type,
            status="ok",
            detail=detail,
            fresh_after=15 if source_type == "live" else 6 * 3600 if source_type == "eod" else 90,
            stale_after=90 if source_type == "live" else 4 * 86_400 if source_type == "eod" else 600,
            delay_seconds=licensed_delay,
        )
    else:
        detail = "Public Yahoo Finance chart feed. Exchange delay is not guaranteed; verify with broker data."
        if licensed_error:
            detail += f" Licensed feed failed and Yahoo fallback was used: {str(licensed_error)[:180]}"
        meta = feed_meta(
            "Yahoo Finance",
            f"OHLCV {interval}",
            as_of=primary_as_of,
            source_type="delayed",
            status="ok",
            detail=detail,
            fresh_after=6 * 3600 if interval in {"1d", "1wk"} else 90,
            stale_after=4 * 86_400 if interval in {"1d", "1wk"} else 600,
        )
    return {
        "symbol": symbol["key"],
        "name": symbol["name"],
        "exchange": symbol["exchange"],
        "type": symbol["type"],
        "currency": symbol["currency"],
        "interval": interval,
        "range": range_value,
        "allowed_ranges": allowed,
        "bars": bars,
        "quote": quote,
        "summary": summary,
        "levels": levels,
        "daily_close": last_daily["c"],
        "meta": meta,
        "quote_meta": quote_meta,
        "as_of": meta["as_of"],
    }


async def overview() -> dict:
    core_keys = ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX"]
    macro_keys = ["USDINR", "DXY", "BRENT", "GOLD", "US10Y", "SPX"]
    quotes, quote_meta = await get_quotes(core_keys + macro_keys)
    by_key = {row["key"]: row for row in quotes}
    return {
        "market_session": market_session(),
        "indices": [by_key[key] for key in core_keys if key in by_key],
        "macro": [by_key[key] for key in macro_keys if key in by_key],
        "quote_meta": quote_meta,
        "as_of": utc_now().isoformat(),
    }


def quote_unavailable(detail: str) -> dict:
    return unavailable_meta("TradingView scanner", "quotes", detail)
