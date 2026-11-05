# Solo Trading Charts — research terminal

A local, provenance-first Indian market research terminal for Bank Nifty, Nifty 50 and Sensex. It combines public market data, verified-source news clustering, a global-to-India transmission map, conditional Bank Nifty scenarios, economic events, data-quality checks, local alerts and paper-trading risk controls.

> Research, education and paper trading only. Not investment advice. Live broker execution is hard-disabled in this build.

## What is connected

| Source | What it provides | Current status / limitation |
| --- | --- | --- |
| TradingView public scanner | Index and stock snapshots, changes, volume, RSI, technical rating | Public snapshot endpoint. **No exchange observation timestamp or exact delay is supplied**, so freshness stays `unknown`, never “live”. |
| Global Datafeeds licensed REST (optional) | NSE/BSE index and cash quotes, OHLC history, entitlement delay | Read-only, personal local display only. Requires the vendor endpoint and access key in server-side `.env`. The adapter labels a value `LIVE` only after `GetLimitation` confirms zero declared delay. It is a polled REST snapshot, **not a tick stream**. Missing credentials leave it `not_configured`. |
| TradingView official widget embeds | External TradingView chart and ticker tape | Display-only iframe on the `/tradingview` page. Solo cannot read or export its values. Widget delay/real-time status is controlled by TradingView and is not used by Solo alerts, scenarios, quality checks or paper trading. |
| Yahoo Finance public chart/quote API | Candles, fallback quotes, macro instruments, **global indices/FX/commodities/yields** | Public delayed/undocumented data. Provider timestamp may be absent; it is never inferred. The Global Markets page uses batch snapshots labelled delayed/unknown. |
| Binance public market data | **Spot USDT 24h tickers + public WebSocket stream** for crypto | Public REST snapshot plus a direct browser-to-exchange WebSocket. Exchange event time and browser connection state are shown. Curated liquid pairs only — not every token, venue or consolidated tape. |
| Google News RSS | Headlines across India, global markets, geopolitics, Fed, RBI, policy, GIFT City, commodities, critical minerals | Aggregated headlines, **not independently fact-checked**. The app shows source labels, publication time and local first-seen time separately. |
| NSE India public FII/DII endpoint | FII/FPI and DII provisional cash-market buy/sell/net values in ₹ crore | Unofficial public website endpoint carrying official NSE data. **EOD/provisional cash market only**; derivatives positioning and final revisions are not included. Browser-like headers are required and failures are shown, not filled. |
| TradingView public economic calendar | Scheduled/released IN and US events, importance, actual/forecast/previous | Unofficial public endpoint requiring browser-like headers. Verify against the official source before trading. |
| Polymarket | Prediction-market probabilities | **Fail-closed and visibly unavailable** in this environment. No sample values are substituted. |
| Broker / order APIs | Live execution | **Not connected. Hard-disabled.** There is no SEBI registration, exchange approval or broker integration in this project. |

Every module must display its source, provider timestamp (if any), fetch time, freshness, health and delay/unknown status. Missing data is a first-class state.

## Main capabilities

- **Overview** — Indian indices, macro tape, headlines, scenario summary, provenance and session state on one screen.
- **Charts** — candles and levels from the licensed Global Datafeeds feed when configured, otherwise Yahoo Finance, with source and timestamp shown.
- **Solo Chart Structure Suite** — original, explainable calculations on the chart page: Parabolic SAR, BOS/CHoCH market structure, order blocks and breaker blocks, fair-value gaps, liquidity sweeps, premium/discount range position, and a six-timeframe trend table (5m → 1D) with an alignment score. These are independent local implementations of public technical-analysis concepts, not copies of LuxAlgo, AlgoAlpha, GainzAlgo, Zeierman, TradeVision Pro or VuManChu scripts, and none of them are a trade signal or a probability.
- **Global Markets** — a separate world tape covering curated global indices by region (Americas, Europe, Asia-Pacific, Middle East & Africa), FX crosses, commodities and US yields from Yahoo Finance public snapshots (labelled delayed/unknown), plus a dedicated Binance spot crypto stream (REST snapshot with a direct browser WebSocket while connected). Missing instruments stay visibly unavailable; no value is fabricated. Live broker execution remains disabled.
- **TradingView embed** — official TradingView chart/ticker-tape iframes for visual reference, clearly separated from Solo's verified data and analysis.
- **Bank Nifty scenario desk** — multi-factor bias (trend, RSI, MACD, ATR, macro tilt, headline tilt), confidence as research confidence (not probability), conditional scenarios, invalidation levels, event risk and no-trade gates.
- **Price-confirmation gate** — a directional CALL/PUT candidate needs alignment of the current snapshot, daily close versus 20-DMA, RSI regime and MACD histogram. A headline alone cannot open the gate. This is a research heuristic, not proof of causation.
- **News intelligence** — deterministic event classification and clustering, source diversity, attention score, affected assets, transmission channels and **current quote snapshots** for price confirmation. The card states that the snapshot is not an event-time reaction.
- **Global macro transmission** — dollar, rupee, US yields, crude, metals, global equities, GIFT Nifty, descriptive 90-session correlations with sample size, and explicit confirmation/invalidation conditions. Correlation is not causation.
- **Institutional flows** — NSE provisional FII/FPI and DII cash-market flows with trade date, unit and source link.
- **Economic calendar** — India/US scheduled and released events, importance and provenance.
- **Event-Lag Lab** — tests the claim that Indian indices reprice 30–90 seconds after an event; reports sample size, uncertainty and measured feed latency. No lag is assumed.
- **AI Signals** — a transparent gate checklist for the Bank Nifty scenario. It is a rules-based explanation layer, not an autonomous trader.
- **Options** — Black–Scholes price and Greeks calculator with explicit assumptions.
- **Paper trading** — simulated orders with costs, slippage, fees, position/exposure limits, duplicate-order checks, kill switch and hash-chained audit log.
- **Backtesting** — cost-aware EMA research with explicit assumptions and sample caveats.
- **Data Quality** — cross-source checks, timestamp/freshness semantics, audit integrity and current provider health.
- **Alert Center** — local browser/SQLite price and keyword rules. No server-side worker, email, SMS, Telegram or push provider is claimed. Browser notifications are optional and permission-gated.
- **Data Sources** — the honest connection map, including what is not configured.

## Run locally

### 1. API

```powershell
cd solo\services\api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The default SQLite database and settings are local to the API process. `GET /` returns the mode and confirms `live_execution_enabled: false`.

### Optional licensed feed

Copy `solo/services/api/.env.example` to `solo/services/api/.env` and add the endpoint and access key supplied by Global Datafeeds:

```env
SOLO_GDF_ENABLED=true
SOLO_GDF_BASE_URL=http://<vendor-endpoint>:<port>/
SOLO_GDF_API_KEY=<vendor-key>
```

Keep the key server-side. Never commit it or paste it into the browser. Restart the API, then open `/quality` or call `GET /api/live/status?probe=true` to verify the entitlement. The terminal will not claim `LIVE` unless the vendor's `GetLimitation` response confirms zero declared exchange delay and the required quote function. The integration is read-only and personal-local-display only.

### 2. Web

```powershell
cd solo\apps\web
npm install
npm run build
npm start
```

Open <http://127.0.0.1:3000>. The Next.js rewrite proxies `/backend/*` to `http://127.0.0.1:8000/*`; set `SOLO_API_URL` to change the API base.

### Checks

```powershell
# API tests
cd solo\services\api
.\.venv\Scripts\python.exe -m pytest -q

# Web typecheck and production build
cd solo\apps\web
npm run typecheck
npm run build
```

The legacy `website/` terminal remains separately runnable at <http://localhost:8787>; this rebuild does not replace or delete it.

## Architecture

```text
solo/
  apps/web/                     Next.js 16 app router
    app/                        pages: overview, charts, tradingview, global, bank-nifty,
                                news, macro, calendar, lag-lab, ai-signals, options,
                                backtest, paper, risk, quality, sources, settings,
                                alerts
    components/                 provenance, quote tables, news cards, nav, charts, crypto live board
    lib/                        API client, types, formatting, polling hook
  services/api/
    app/main.py                 FastAPI app, CORS, WebSocket, mode
    app/routers/                market, news, macro, calendar, scenarios, paper,
                                options, backtest, lab, alerts, system, analysis, world
    app/providers/              Global Datafeeds (licensed, optional), TradingView,
                                Yahoo, Yahoo snapshots/batch, Binance public,
                                Google News, NSE, calendar, Polymarket
                                (fail-closed), HTTP/health helpers
    app/services/               clustering, scenarios, macro, flows, quality,
                                paper risk, alerts, sources, lag analysis, world markets,
                                chart structure analysis
    app/db.py                   SQLite schema, audit hash chain, local settings
    app/indicators.py           public TA primitives (SAR, swings, structure, OB/FVG,
                                sweeps, premium/discount, resampling)
    tests/                      pytest checks
```

## Data-status vocabulary

- `FRESH` — received inside the provider-specific local freshness window. This does **not** mean exchange-real-time.
- `AGING` — older than the preferred window but inside the stale threshold.
- `STALE` — beyond the stale threshold; not an execution price.
- `TIMESTAMP N/A` — a value exists but the provider did not supply an observation time. The app does not invent one.
- `UNAVAILABLE` — no usable value; the affected feature fails closed and shows the reason.
- `LIVE` is only legitimate when a provider supplies an exchange timestamp and the delay contract is known and satisfied. The optional Global Datafeeds adapter uses `LIVE` only after `GetLimitation` confirms zero declared delay. It still describes a polled REST snapshot, not a tick-by-tick stream. Without that verification, values remain delayed/unknown.

## Risk, security and compliance limits

- **No live execution.** The API reports `live_execution_enabled: false`; no broker credentials or order endpoints are present. Enabling live trading would require explicit authorization, a broker integration, and applicable SEBI/NSE requirements, risk controls and independently verified compliance. It is intentionally not implemented.
- **No authentication.** Bind the API and web app to localhost only. Do not expose them to a network or the public internet.
- **SQLite and in-process cache.** Suitable for a single local user, not a multi-user or high-availability deployment. PostgreSQL/TimescaleDB, Redis and Docker are not integrated.
- **Alerts are local.** Rules are stored in SQLite and evaluated when the browser polls the API. There is no background worker and no guarantee of delivery while the browser is closed.
- **Audit hash chain is tamper-evident, not tamper-proof.** It detects edits to the audit rows; someone with full database and code access could rebuild the chain. It is not a signed, externally anchored ledger.
- **Licensed data is optional and scoped.** Global Datafeeds is not bundled; the subscriber must supply the endpoint and key and comply with the vendor/exchange licence. It is read-only and personal-local-display only. Public endpoints can also change, rate-limit or reject requests. The UI surfaces failures rather than substituting plausible-looking values.
- **TradingView embeds are not data access.** The `/tradingview` page is an official iframe. Solo cannot read its values, does not redistribute them and cannot use them in alerts or paper trading.
- **News is not fact-checked.** Source labels and clustering are evidence of reporting, not verification of truth. Headline tone is not a trade signal.
- **Price confirmation is descriptive.** Quote snapshots are current-at-fetch, not event-time reactions. The app does not claim causality, predictive accuracy or a measurable edge from this check.
- **Not investment advice.** Options, scenarios, confidence scores, backtests and paper results are research artifacts with assumptions and failure modes.

## Planned / not implemented

- Tick-by-tick WebSocket streaming from the licensed vendor. The current adapter polls documented REST snapshots; it does not claim a streaming feed.
- Broker integration, live order routing, exchange permissions and SEBI compliance work.
- Background alert delivery (email/SMS/Telegram/push).
- PostgreSQL/TimescaleDB/Redis deployment and horizontal scaling.
- Claimed 30–90 second repricing edge as a validated production signal.
- Prediction-market probabilities while Polymarket remains unreachable.
- Full worldwide exchange coverage. Public free endpoints cannot support a literal "all markets live" claim; the Global Markets page ships broad curated coverage with visible gaps and delay labels instead.

## Known limitations

- **TradingView NSE symbols.** The official TradingView chart/ticker iframes load, but at least `NSE:NIFTY` reports that the symbol is unavailable on this embed. Some NSE/BSE symbols may be restricted by TradingView's entitlement or symbol mapping. The `/tradingview` page remains a display-only reference and is not used for Solo quotes, alerts, scenarios or paper trading. Alternative symbol mappings or an explicit UI limitation should be reviewed before relying on Indian symbols in the embed.
- **Global data is not a consolidated tape.** Yahoo Finance public snapshots are delayed/unknown (no exact exchange delay published) and the Binance crypto stream covers only curated USDT spot pairs. Coverage is broad but not exhaustive; failures are shown, never substituted with plausible-looking values.
