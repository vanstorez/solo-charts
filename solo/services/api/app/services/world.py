"""Global market coverage with explicit, per-source provenance.

Equities, FX, commodities and yields use Yahoo Finance's public chart metadata.
That path is broad but delayed/unknown. Crypto uses Binance's public exchange
data: the REST response is a snapshot and the browser stream is the live feed.
This module never turns a missing provider into a zero or a sample value.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..provenance import feed_meta
from ..providers import binance, yahoo
from ..timeutil import iso, utc_now

PROVIDER = "Yahoo Finance global snapshots"


def _instrument(
    key: str,
    name: str,
    short: str,
    yahoo_symbol: str,
    exchange: str,
    currency: str,
    asset_class: str,
    region: str,
    country: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "short": short,
        "yahoo": yahoo_symbol,
        "exchange": exchange,
        "currency": currency,
        "asset_class": asset_class,
        "region": region,
        "country": country,
        "type": "index" if asset_class == "indices" else asset_class,
    }


INDICES = [
    # Americas
    _instrument("US500", "S&P 500", "SPX", "^GSPC", "SNP", "USD", "indices", "Americas", "United States"),
    _instrument("US100", "Nasdaq 100", "NDX", "^NDX", "NASDAQ", "USD", "indices", "Americas", "United States"),
    _instrument("US30", "Dow Jones Industrial Average", "DJI", "^DJI", "NYSE", "USD", "indices", "Americas", "United States"),
    _instrument("US2000", "Russell 2000", "RUT", "^RUT", "NYSE", "USD", "indices", "Americas", "United States"),
    _instrument("VIX", "CBOE Volatility Index", "VIX", "^VIX", "CBOE", "USD", "indices", "Americas", "United States"),
    _instrument("TSX", "S&P/TSX Composite", "TSX", "^GSPTSE", "TSX", "CAD", "indices", "Americas", "Canada"),
    _instrument("BVSP", "Bovespa", "IBOV", "^BVSP", "B3", "BRL", "indices", "Americas", "Brazil"),
    _instrument("IPC", "S&P/BMV IPC", "IPC", "^MXX", "BMV", "MXN", "indices", "Americas", "Mexico"),
    _instrument("MERVAL", "S&P Merval", "MERVAL", "^MERV", "BYMA", "ARS", "indices", "Americas", "Argentina"),
    # Europe
    _instrument("FTSE100", "FTSE 100", "UKX", "^FTSE", "LSE", "GBP", "indices", "Europe", "United Kingdom"),
    _instrument("DAX", "DAX 40", "DAX", "^GDAXI", "XETRA", "EUR", "indices", "Europe", "Germany"),
    _instrument("CAC40", "CAC 40", "CAC", "^FCHI", "Euronext Paris", "EUR", "indices", "Europe", "France"),
    _instrument("SX5E", "Euro Stoxx 50", "SX5E", "^STOXX50E", "Eurex", "EUR", "indices", "Europe", "Eurozone"),
    _instrument("FTSEMIB", "FTSE MIB", "FTSEMIB", "FTSEMIB.MI", "Borsa Italiana", "EUR", "indices", "Europe", "Italy"),
    _instrument("IBEX35", "IBEX 35", "IBEX", "^IBEX", "BME", "EUR", "indices", "Europe", "Spain"),
    _instrument("AEX", "AEX", "AEX", "^AEX", "Euronext Amsterdam", "EUR", "indices", "Europe", "Netherlands"),
    _instrument("SMI", "Swiss Market Index", "SMI", "^SSMI", "SIX", "CHF", "indices", "Europe", "Switzerland"),
    _instrument("OMX30", "OMX Stockholm 30", "OMX30", "^OMX", "Nasdaq Stockholm", "SEK", "indices", "Europe", "Sweden"),
    _instrument("WIG20", "WIG20", "WIG20", "WIG20.WA", "GPW Warsaw", "PLN", "indices", "Europe", "Poland"),
    _instrument("BEL20", "BEL 20", "BEL20", "^BFX", "Euronext Brussels", "EUR", "indices", "Europe", "Belgium"),
    # Asia-Pacific
    _instrument("NIKKEI", "Nikkei 225", "N225", "^N225", "Tokyo Stock Exchange", "JPY", "indices", "Asia-Pacific", "Japan"),
    _instrument("HSI", "Hang Seng", "HSI", "^HSI", "HKEX", "HKD", "indices", "Asia-Pacific", "Hong Kong"),
    _instrument("SSE", "Shanghai Composite", "SSE", "000001.SS", "Shanghai Stock Exchange", "CNY", "indices", "Asia-Pacific", "China"),
    _instrument("SZSE", "Shenzhen Component", "SZSE", "399001.SZ", "Shenzhen Stock Exchange", "CNY", "indices", "Asia-Pacific", "China"),
    _instrument("KOSPI", "KOSPI", "KOSPI", "^KS11", "KRX", "KRW", "indices", "Asia-Pacific", "South Korea"),
    _instrument("KOSDAQ", "KOSDAQ", "KOSDAQ", "^KQ11", "KRX", "KRW", "indices", "Asia-Pacific", "South Korea"),
    _instrument("ASX200", "S&P/ASX 200", "ASX200", "^AXJO", "ASX", "AUD", "indices", "Asia-Pacific", "Australia"),
    _instrument("NIFTY", "Nifty 50", "NIFTY", "^NSEI", "NSE", "INR", "indices", "Asia-Pacific", "India"),
    _instrument("BANKNIFTY", "Bank Nifty", "BANKNIFTY", "^NSEBANK", "NSE", "INR", "indices", "Asia-Pacific", "India"),
    _instrument("SENSEX", "Sensex", "SENSEX", "^BSESN", "BSE", "INR", "indices", "Asia-Pacific", "India"),
    _instrument("STI", "Straits Times", "STI", "^STI", "SGX", "SGD", "indices", "Asia-Pacific", "Singapore"),
    _instrument("TAIEX", "TAIEX", "TAIEX", "^TWII", "TWSE", "TWD", "indices", "Asia-Pacific", "Taiwan"),
    _instrument("JKSE", "IDX Composite", "JKSE", "^JKSE", "IDX", "IDR", "indices", "Asia-Pacific", "Indonesia"),
    _instrument("KLCI", "FTSE Bursa Malaysia KLCI", "KLCI", "^KLSE", "Bursa Malaysia", "MYR", "indices", "Asia-Pacific", "Malaysia"),
    _instrument("SET", "SET Index", "SET", "^SET.BK", "SET", "THB", "indices", "Asia-Pacific", "Thailand"),
    _instrument("PSEI", "PSEi", "PSEI", "PSEI.PS", "PSE", "PHP", "indices", "Asia-Pacific", "Philippines"),
    _instrument("NZX50", "S&P/NZX 50", "NZX50", "^NZ50", "NZX", "NZD", "indices", "Asia-Pacific", "New Zealand"),
    # Middle East and Africa
    _instrument("TASI", "Tadawul All Share", "TASI", "^TASI.SR", "Saudi Exchange", "SAR", "indices", "Middle East & Africa", "Saudi Arabia"),
    _instrument("BIST100", "BIST 100", "BIST100", "XU100.IS", "Borsa Istanbul", "TRY", "indices", "Middle East & Africa", "Turkey"),
    _instrument("TA125", "TA-125", "TA125", "^TA125.TA", "Tel Aviv Stock Exchange", "ILS", "indices", "Middle East & Africa", "Israel"),
    _instrument("DFMGI", "DFM General Index", "DFMGI", "DFMGI.AE", "Dubai Financial Market", "AED", "indices", "Middle East & Africa", "UAE"),
    _instrument("JSE40", "JSE Top 40", "JSE40", "^J200.JO", "JSE", "ZAR", "indices", "Middle East & Africa", "South Africa"),
    _instrument("EGX30", "EGX 30", "EGX30", "^EGX30.CA", "Egyptian Exchange", "EGP", "indices", "Middle East & Africa", "Egypt"),
]

FX = [
    _instrument("EURUSD", "Euro / US Dollar", "EUR/USD", "EURUSD=X", "FX", "USD", "fx", "Global", "Eurozone / United States"),
    _instrument("GBPUSD", "British Pound / US Dollar", "GBP/USD", "GBPUSD=X", "FX", "USD", "fx", "Global", "United Kingdom / United States"),
    _instrument("USDJPY", "US Dollar / Japanese Yen", "USD/JPY", "USDJPY=X", "FX", "JPY", "fx", "Global", "United States / Japan"),
    _instrument("USDCHF", "US Dollar / Swiss Franc", "USD/CHF", "USDCHF=X", "FX", "CHF", "fx", "Global", "United States / Switzerland"),
    _instrument("AUDUSD", "Australian Dollar / US Dollar", "AUD/USD", "AUDUSD=X", "FX", "USD", "fx", "Global", "Australia / United States"),
    _instrument("USDCAD", "US Dollar / Canadian Dollar", "USD/CAD", "USDCAD=X", "FX", "CAD", "fx", "Global", "United States / Canada"),
    _instrument("NZDUSD", "New Zealand Dollar / US Dollar", "NZD/USD", "NZDUSD=X", "FX", "USD", "fx", "Global", "New Zealand / United States"),
    _instrument("USDCNY", "US Dollar / Chinese Yuan", "USD/CNY", "USDCNY=X", "FX", "CNY", "fx", "Global", "United States / China"),
    _instrument("USDINR", "US Dollar / Indian Rupee", "USD/INR", "USDINR=X", "FX", "INR", "fx", "Global", "United States / India"),
    _instrument("USDKRW", "US Dollar / Korean Won", "USD/KRW", "USDKRW=X", "FX", "KRW", "fx", "Global", "United States / South Korea"),
    _instrument("USDSGD", "US Dollar / Singapore Dollar", "USD/SGD", "USDSGD=X", "FX", "SGD", "fx", "Global", "United States / Singapore"),
    _instrument("USDBRL", "US Dollar / Brazilian Real", "USD/BRL", "USDBRL=X", "FX", "BRL", "fx", "Global", "United States / Brazil"),
    _instrument("USDZAR", "US Dollar / South African Rand", "USD/ZAR", "USDZAR=X", "FX", "ZAR", "fx", "Global", "United States / South Africa"),
    _instrument("USDMXN", "US Dollar / Mexican Peso", "USD/MXN", "USDMXN=X", "FX", "MXN", "fx", "Global", "United States / Mexico"),
    _instrument("DXY", "US Dollar Index", "DXY", "DX-Y.NYB", "ICE", "USD", "fx", "Global", "United States"),
    _instrument("EURINR", "Euro / Indian Rupee", "EUR/INR", "EURINR=X", "FX", "INR", "fx", "Global", "Eurozone / India"),
    _instrument("GBPINR", "British Pound / Indian Rupee", "GBP/INR", "GBPINR=X", "FX", "INR", "fx", "Global", "United Kingdom / India"),
    _instrument("JPYINR", "Japanese Yen / Indian Rupee", "JPY/INR", "JPYINR=X", "FX", "INR", "fx", "Global", "Japan / India"),
]

COMMODITIES = [
    _instrument("WTI", "WTI Crude", "WTI", "CL=F", "NYMEX", "USD", "commodities", "Global", "United States"),
    _instrument("BRENT", "Brent Crude", "BRENT", "BZ=F", "ICE", "USD", "commodities", "Global", "United Kingdom"),
    _instrument("NATGAS", "Natural Gas", "NG", "NG=F", "NYMEX", "USD", "commodities", "Global", "United States"),
    _instrument("GOLD", "Gold", "XAU", "GC=F", "COMEX", "USD", "commodities", "Global", "United States"),
    _instrument("SILVER", "Silver", "XAG", "SI=F", "COMEX", "USD", "commodities", "Global", "United States"),
    _instrument("COPPER", "Copper", "HG", "HG=F", "COMEX", "USD", "commodities", "Global", "United States"),
    _instrument("PLATINUM", "Platinum", "PL", "PL=F", "NYMEX", "USD", "commodities", "Global", "United States"),
    _instrument("CORN", "Corn", "ZC", "ZC=F", "CBOT", "USD", "commodities", "Global", "United States"),
    _instrument("WHEAT", "Wheat", "ZW", "ZW=F", "CBOT", "USD", "commodities", "Global", "United States"),
    _instrument("SOYBEAN", "Soybean", "ZS", "ZS=F", "CBOT", "USD", "commodities", "Global", "United States"),
    _instrument("COFFEE", "Coffee", "KC", "KC=F", "ICE", "USD", "commodities", "Global", "United States"),
    _instrument("SUGAR", "Sugar", "SB", "SB=F", "ICE", "USD", "commodities", "Global", "United States"),
    _instrument("COTTON", "Cotton", "CT", "CT=F", "ICE", "USD", "commodities", "Global", "United States"),
    _instrument("COCOA", "Cocoa", "CC", "CC=F", "ICE", "USD", "commodities", "Global", "United States"),
]

RATES = [
    _instrument("US10Y", "US 10-Year Treasury Yield", "US10Y", "^TNX", "CBOT", "%", "rates", "Global", "United States"),
    _instrument("US5Y", "US 5-Year Treasury Yield", "US5Y", "^FVX", "CBOT", "%", "rates", "Global", "United States"),
    _instrument("US30Y", "US 30-Year Treasury Yield", "US30Y", "^TYX", "CBOT", "%", "rates", "Global", "United States"),
    _instrument("US13W", "US 13-Week Bill Yield", "US13W", "^IRX", "CBOT", "%", "rates", "Global", "United States"),
]

ALL_INSTRUMENTS = [*INDICES, *FX, *COMMODITIES, *RATES]
BY_KEY = {item["key"]: item for item in ALL_INSTRUMENTS}
REGION_ORDER = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"]

CRYPTO_NAMES = {
    "BTCUSDT": "Bitcoin",
    "ETHUSDT": "Ethereum",
    "BNBUSDT": "BNB",
    "SOLUSDT": "Solana",
    "XRPUSDT": "XRP",
    "ADAUSDT": "Cardano",
    "DOGEUSDT": "Dogecoin",
    "AVAXUSDT": "Avalanche",
    "LINKUSDT": "Chainlink",
    "DOTUSDT": "Polkadot",
    "LTCUSDT": "Litecoin",
    "BCHUSDT": "Bitcoin Cash",
    "TRXUSDT": "TRON",
    "TONUSDT": "Toncoin",
    "SUIUSDT": "Sui",
    "NEARUSDT": "NEAR Protocol",
    "APTUSDT": "Aptos",
    "ARBUSDT": "Arbitrum",
    "OPUSDT": "Optimism",
    "PEPEUSDT": "Pepe",
    "SHIBUSDT": "Shiba Inu",
    "WIFUSDT": "dogwifhat",
}


def _row(item: dict, snapshot: dict | None) -> dict:
    failed = not snapshot or snapshot.get("error") or snapshot.get("value") is None
    as_of = snapshot.get("as_of") if snapshot and not failed else None
    return {
        "key": item["key"],
        "name": item["name"],
        "short": item["short"],
        "exchange": item["exchange"],
        "currency": item["currency"],
        "type": item["type"],
        "asset_class": item["asset_class"],
        "region": item["region"],
        "country": item["country"],
        "value": None if failed else snapshot.get("value"),
        "change": None if failed else snapshot.get("change"),
        "volume": None if failed else snapshot.get("volume"),
        "open": None,
        "high": None if failed else snapshot.get("day_high"),
        "low": None if failed else snapshot.get("day_low"),
        "previous_close": None if failed else snapshot.get("previous_close"),
        "fifty_two_week_high": None if failed else snapshot.get("fifty_two_week_high"),
        "fifty_two_week_low": None if failed else snapshot.get("fifty_two_week_low"),
        "as_of": iso(as_of) if as_of else None,
        "source": "unavailable" if failed else "Yahoo Finance public chart metadata",
        "data_status": "unavailable" if failed else "delayed",
        "delay_seconds": None,
        "error": snapshot.get("error") if failed and snapshot else None,
    }


async def _fetch_instruments(items: list[dict]) -> tuple[list[dict], dict[str, str], datetime | None]:
    snapshots = await yahoo.snapshots([item["yahoo"] for item in items], ttl=75)
    rows: list[dict] = []
    errors: dict[str, str] = {}
    timestamps: list[datetime] = []
    for item, snapshot in zip(items, snapshots):
        row = _row(item, snapshot)
        rows.append(row)
        if row["value"] is None:
            errors[item["key"]] = (snapshot or {}).get("error") or "No public quote returned"
        elif snapshot and snapshot.get("as_of"):
            timestamps.append(snapshot["as_of"])
    return rows, errors, max(timestamps) if timestamps else None


async def global_markets() -> dict:
    rows, errors, latest = await _fetch_instruments(ALL_INSTRUMENTS)
    returned = sum(1 for row in rows if row["value"] is not None)
    failed = len(rows) - returned
    status = "ok" if failed == 0 else "degraded" if returned > 0 else "unavailable"
    meta = feed_meta(
        PROVIDER,
        "global indices, FX, commodities and US yields",
        as_of=latest,
        source_type="delayed",
        status=status,
        detail=(
            f"{returned}/{len(rows)} public snapshots returned. Yahoo Finance does not publish an exact "
            "exchange delay here, so these values are delayed/unknown and are not synchronized with "
            "licensed data. Broad curated coverage, not every world exchange or instrument."
        ),
        fresh_after=6 * 3600,
        stale_after=36 * 3600,
    )
    indices_by_region = []
    for region in REGION_ORDER:
        region_rows = [row for row in rows if row["asset_class"] == "indices" and row["region"] == region]
        if region_rows:
            indices_by_region.append({"key": region.lower().replace(" ", "-"), "label": region, "quotes": region_rows})
    return {
        "indices": indices_by_region,
        "fx": [row for row in rows if row["asset_class"] == "fx"],
        "commodities": [row for row in rows if row["asset_class"] == "commodities"],
        "rates": [row for row in rows if row["asset_class"] == "rates"],
        "meta": meta,
        "coverage": {
            "requested": len(rows),
            "returned": returned,
            "failed": failed,
            "sources": ["Yahoo Finance public chart metadata"],
            "asset_classes": {
                "indices": sum(1 for row in rows if row["asset_class"] == "indices"),
                "fx": sum(1 for row in rows if row["asset_class"] == "fx"),
                "commodities": sum(1 for row in rows if row["asset_class"] == "commodities"),
                "rates": sum(1 for row in rows if row["asset_class"] == "rates"),
            },
            "errors": errors,
            "note": "Curated coverage across major world venues. It is not a consolidated tape and excludes many listings.",
        },
        "as_of": meta["as_of"],
        "note": (
            "Global equities, FX, commodities and yields are public delayed/unknown snapshots. "
            "Crypto has a separate exchange-pushed stream on the Global Markets page. "
            "No value here enables live execution."
        ),
    }


async def global_crypto() -> dict:
    rows: list[dict] = []
    errors: dict[str, str] = {}
    latest = None
    try:
        tickers = await binance.tickers(ttl=8)
    except Exception as exc:
        tickers = []
        for symbol in binance.STREAM_SYMBOLS:
            errors[symbol] = str(exc)[:200]
    by_symbol = {row["symbol"]: row for row in tickers}
    for symbol in binance.STREAM_SYMBOLS:
        tick = by_symbol.get(symbol)
        base = symbol.removesuffix("USDT")
        if not tick:
            errors.setdefault(symbol, "No 24h ticker returned")
            rows.append(
                {
                    "key": symbol,
                    "symbol": symbol,
                    "name": CRYPTO_NAMES.get(symbol, base),
                    "short": f"{base}/USDT",
                    "price": None,
                    "change": None,
                    "open": None,
                    "high": None,
                    "low": None,
                    "volume_base": None,
                    "volume_quote": None,
                    "as_of": None,
                    "source": "unavailable",
                    "data_status": "unavailable",
                }
            )
            continue
        if tick.get("as_of"):
            latest = max(latest, tick["as_of"]) if latest else tick["as_of"]
        rows.append(
            {
                **tick,
                "key": symbol,
                "name": CRYPTO_NAMES.get(symbol, base),
                "short": f"{base}/USDT",
                "source": "Binance public REST 24h ticker",
                "data_status": "live_snapshot",
                "delay_seconds": None,
            }
        )
    returned = sum(1 for row in rows if row["price"] is not None)
    failed = len(rows) - returned
    status = "ok" if failed == 0 else "degraded" if returned > 0 else "unavailable"
    meta = feed_meta(
        binance.PROVIDER,
        "spot USDT 24-hour tickers",
        as_of=latest,
        source_type="live",
        status=status,
        detail=(
            f"{returned}/{len(rows)} public exchange snapshots returned. The REST snapshot is paired with "
            "a separate Binance 24hrMiniTicker WebSocket stream in the browser. This is spot-market "
            "coverage, not every token, venue or consolidated global crypto tape."
        ),
        fresh_after=90,
        stale_after=300,
    )
    return {
        "quotes": rows,
        "meta": meta,
        "stream": {
            "provider": "Binance",
            "transport": "WebSocket",
            "url": binance.stream_url(),
            "host": binance.WS_URL,
            "symbols": binance.STREAM_SYMBOLS,
            "update_mode": "24hrMiniTicker",
            "note": (
                "Browser-to-exchange public stream without an API key. Exchange event times and the "
                "browser connection state are shown. If the stream is blocked, the REST snapshot remains."
            ),
        },
        "coverage": {
            "requested": len(rows),
            "returned": returned,
            "failed": failed,
            "errors": errors,
            "asset_class": "crypto spot",
            "quote_asset": "USDT",
            "note": "Curated liquid pairs, not a full exchange listing or a consolidated crypto tape.",
        },
        "as_of": meta["as_of"],
        "note": (
            "Crypto trades continuously; the browser WebSocket is the live path. The REST values on this "
            "payload are only a starting/fallback snapshot. No order routing is implemented."
        ),
    }


async def global_status() -> dict:
    """Small, inexpensive status object for the Sources page."""
    return {
        "provider": PROVIDER,
        "transport": "Public Yahoo Finance chart metadata",
        "freshness": "delayed/unknown",
        "coverage": {
            "indices": len(INDICES),
            "fx": len(FX),
            "commodities": len(COMMODITIES),
            "rates": len(RATES),
        },
        "crypto": {
            "provider": binance.PROVIDER,
            "transport": "REST snapshot + public WebSocket stream",
            "symbols": len(binance.STREAM_SYMBOLS),
            "quote_asset": "USDT",
        },
        "as_of": iso(utc_now()),
        "note": "Curated world coverage. Not every exchange, listing or instrument is included.",
    }
