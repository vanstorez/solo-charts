from ..config import get_settings
from ..db import get_db
from ..providers import binance
from ..providers import globaldatafeeds as gdf
from ..providers import health, nse, polymarket
from ..timeutil import iso, utc_now
from .paper import get_risk_limits


def _health_for(snapshot: list[dict], name: str) -> dict | None:
    for item in snapshot:
        if item["name"].lower() == name.lower():
            return item
    return None


async def get_sources() -> dict:
    settings = get_settings()
    state = health.snapshot()
    prediction_status = await polymarket.status()
    licensed = gdf.status()
    sources = [
        {
            "key": "globaldatafeeds_licensed",
            "name": "Global Datafeeds licensed REST",
            "category": "licensed NSE/BSE quotes and OHLC history",
            "capabilities": licensed["capabilities"],
            "access": "Vendor endpoint + access key, configured server-side in .env. Key is never exposed to the browser.",
            "freshness": (
                licensed["detail"]
                if licensed["configured"]
                else "Not configured. Add SOLO_GDF_BASE_URL and SOLO_GDF_API_KEY to enable the licensed feed."
            ),
            "status": licensed["state"],
            "health": _health_for(state, gdf.PROVIDER),
            "notes": (
                "Licensed for personal local display only. REST polling snapshots; not a tick stream. "
                "No redistribution and no order routing. Confirm the vendor agreement and exchange entitlements before relying on it."
            ),
            "detail": licensed,
        },
        {
            "key": "tradingview_scanner",
            "name": "TradingView scanner",
            "category": "quotes",
            "capabilities": ["index and stock snapshots", "change %", "volume", "RSI", "technical rating"],
            "access": "Public scanner endpoint; no key configured in this build",
            "freshness": "Provider snapshot time and exact delay are not supplied. Never label it exchange-real-time without verification.",
            "status": "available" if _health_for(state, "TradingView scanner") else "not_checked",
            "health": _health_for(state, "TradingView scanner"),
            "notes": "Unofficial public endpoint. Review TradingView terms before production use.",
        },
        {
            "key": "yahoo_finance",
            "name": "Yahoo Finance",
            "category": "candles, delayed quotes, daily history, global markets",
            "capabilities": [
                "OHLCV candles",
                "daily history",
                "global indices",
                "FX",
                "commodities",
                "US yields",
            ],
            "access": "Public chart endpoint; no key configured",
            "freshness": "Delayed/EOD. Exchange delay is not guaranteed by the provider response.",
            "status": "available" if _health_for(state, "Yahoo Finance") else "not_checked",
            "health": _health_for(state, "Yahoo Finance"),
            "notes": (
                "Unofficial public feed. The Global Markets page uses it for broad world coverage, "
                "but those snapshots are delayed/unknown—not a consolidated exchange tape. Suitable "
                "for research and paper trading, not execution pricing."
            ),
        },
        {
            "key": "binance_public",
            "name": "Binance public market data",
            "category": "crypto spot snapshots and live stream",
            "capabilities": [
                "USDT spot 24h tickers",
                "public WebSocket miniTicker stream",
                "exchange event timestamps",
            ],
            "access": "Public REST and WebSocket endpoints; no API key or account",
            "freshness": (
                "The browser WebSocket is live while connected. The REST payload is a starting/fallback "
                "snapshot. Exchange event time and connection state are shown; this is not a consolidated tape."
            ),
            "status": "available" if _health_for(state, binance.PROVIDER) else "not_checked",
            "health": _health_for(state, binance.PROVIDER),
            "notes": (
                "Curated liquid USDT pairs, not every token or venue. Public data can be blocked by a "
                "network or venue; the page shows stream failure and retains the labelled REST snapshot."
            ),
        },
        {
            "key": "google_news_rss",
            "name": "Google News RSS",
            "category": "news aggregation",
            "capabilities": ["category RSS feeds", "source labels", "publication timestamps"],
            "access": "Public RSS; no key configured",
            "freshness": "Aggregated; publication time is not event time. The local first-seen timestamp is recorded separately.",
            "status": "available" if _health_for(state, "Google News RSS") else "not_checked",
            "health": _health_for(state, "Google News RSS"),
            "notes": "A single Google News item is not independent confirmation. Multi-source labels are still not a fact-check.",
        },
        {
            "key": "tradingview_calendar",
            "name": "TradingView economic calendar",
            "category": "economic events",
            "capabilities": ["scheduled releases", "actual", "forecast", "previous", "official source links"],
            "access": "Public calendar endpoint; no key configured",
            "freshness": "Provider-supplied event times and values. Cached briefly; revisions can arrive after first publication.",
            "status": "available" if _health_for(state, "TradingView economic calendar") else "not_checked",
            "health": _health_for(state, "TradingView economic calendar"),
            "notes": "Unofficial public endpoint. Actual and forecast values are not independently verified by Solo. Confirm against the official statistical agency or central bank.",
        },
        {
            "key": "nse_fii_dii",
            "name": "NSE India FII/DII",
            "category": "institutional flows",
            "capabilities": ["FII/FPI provisional cash-market flows", "DII provisional cash-market flows", "buy/sell/net values in INR crore"],
            "access": "Public NSE website endpoint; browser-like Origin/Referer headers required. No key configured.",
            "freshness": "EOD provisional cash-market table for the NSE-supplied trade date. Exact publication time is not supplied.",
            "status": "available" if _health_for(state, nse.PROVIDER) else "not_checked",
            "health": _health_for(state, nse.PROVIDER),
            "notes": "Unofficial public website endpoint using official NSE data. Cash market only; no derivatives positioning. Verify on nseindia.com before relying on a print.",
        },
        {
            "key": "polymarket",
            "name": "Polymarket Gamma / CLOB",
            "category": "prediction markets",
            "capabilities": ["market discovery", "public prices", "order-book access when reachable"],
            "access": "Enabled by configuration; no credentials or trading permissions are present",
            "freshness": "Live prediction-market data if the public API is reachable. Current network status shown below.",
            "status": prediction_status.get("state", "unknown"),
            "health": _health_for(state, "Polymarket Gamma"),
            "notes": prediction_status.get("detail"),
            "detail": prediction_status,
        },
        {
            "key": "nse_option_chain",
            "name": "NSE option chain",
            "category": "options",
            "capabilities": ["option chain", "OI", "Greeks when a permitted provider is configured"],
            "access": "Not configured in this rebuild",
            "freshness": "Unavailable",
            "status": "not_configured",
            "health": None,
            "notes": "The legacy app has an option-chain module, but this new API does not claim a working NSE chain. The options page provides a clearly labelled Black-Scholes calculator only.",
        },
        {
            "key": "broker_execution",
            "name": "Broker execution",
            "category": "execution",
            "capabilities": [],
            "access": "No broker adapter, credentials or approvals are present",
            "freshness": "Not applicable",
            "status": "disabled_by_design",
            "health": None,
            "notes": "Live orders are hard-disabled. Do not enable without broker approval and applicable SEBI/exchange compliance.",
            "live_execution_enabled": False,
        },
        {
            "key": "local_sqlite",
            "name": "Local SQLite audit store",
            "category": "paper trading and audit",
            "capabilities": ["paper trades", "risk settings", "hash-chained audit log"],
            "access": "Local file",
            "freshness": "Local write; not a market-data source",
            "status": "ok",
            "health": None,
            "notes": f"Database: {settings.database_file.name}. A single-node store, not a production multi-user database.",
        },
    ]
    return {
        "sources": sources,
        "provider_health": state,
        "live_execution_enabled": False,
        "risk_limits": get_risk_limits(),
        "audit_chain_valid": get_db().verify_audit_chain(),
        "generated_at": iso(utc_now()),
        "policy": "Missing providers are shown as unavailable. The UI never replaces missing production data with random numbers.",
    }
