# TradingView + OpenCode — Solo Trading Charts

A local, provenance-first NSE research workstation built around OpenCode. Everything runs on **one platform** — no external links, no third-party data redistribution.

## What's Inside

| Page | Path | What It Does |
|------|------|--------------|
| **Daily Summary** | `/daily` | All markets in one window — Indian + Global + Crypto daily bias |
| **Advanced Analysis** | `/analysis` | Symbol picker + RSI/MACD/Bollinger/Stochastic/ADX/OBV/VWAP + support/resistance + patterns + risk/reward |
| **Indian Markets** | `/india` | NIFTY, BANKNIFTY, SENSEX + sectors + day trading plan |
| **Global Markets** | `/global` | 79 world instruments (indices/FX/commodities/yields) + 22 crypto pairs |
| **Charts** | `/charts` | Candlesticks with SMA/EMA/Bollinger overlays + structure suite |
| **TradingView** | `/tradingview` | Official TradingView embed (display-only, cannot read values) |

## Honest Data Boundaries

- **No "every market live" claim.** Free public APIs cannot support that. Coverage is curated major instruments only.
- **Delayed/unknown.** Yahoo Finance public snapshots are labelled delayed/unknown — exact exchange delay is not published.
- **Crypto WebSocket.** Binance public stream is live while connected; REST snapshot is fallback.
- **Missing stays missing.** Failed symbols show unavailable — never zero, never fabricated.
- **Live execution hard-disabled.** Paper trading only. No broker credentials, no order endpoints.

## Quick Start

### One-click (Windows) — recommended

Double-click **`START-SOLO.cmd`** in the project root.

It starts the API (port 8000) and the website (port 3000), then opens your browser. Keep the launcher window open; the servers keep running in the background.

- **Desktop:** `http://127.0.0.1:3000`
- **Phone (same WiFi):** `http://<YOUR-PC-IP>:3000` — the launcher prints the exact address
- **Stop everything:** double-click **`STOP-SOLO.cmd`**

The first run builds the website automatically if needed.

### Manual start (advanced)

**API (port 8000)**
```powershell
cd solo\services\api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Web (port 3000)**
```powershell
cd solo\apps\web
npm install
npm run start
```

### 4. Optional: Licensed India feed (Global Datafeeds)
Copy `solo/services/api/.env.example` to `solo/services/api/.env` and add your vendor endpoint and access key. Never commit `.env`.

```env
SOLO_GDF_ENABLED=true
SOLO_GDF_BASE_URL=http://<vendor-endpoint>:<port>/
SOLO_GDF_API_KEY=<vendor-key>
```

Then restart the API and call `GET /api/live/status?probe=true`.

## Run Checks

```powershell
# API tests
cd solo\services\api
.\.venv\Scripts\python.exe -m pytest -q

# Web typecheck + build
cd solo\apps\web
npm run typecheck
npm run build
```

## Push to GitHub

1. **Create a repo** on GitHub.com (do NOT initialize with README)
2. **Initialize locally:**
   ```powershell
   cd C:\Users\Patel Hardik\Documents\TradingView-OpenCode
   git init
   git add .
   git commit -m "Solo Trading Charts - full platform"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. **Never commit `.env`** — it's in `.gitignore`

## Project Structure

```
solo/                     New FastAPI + Next.js research terminal
  services/api/           FastAPI, providers, SQLite, tests
    app/routers/          market, news, macro, calendar, scenarios, paper,
                           options, backtest, lab, alerts, system,
                           analysis, advanced_analysis, india, world
    app/providers/        Global Datafeeds, TradingView, Yahoo,
                           Yahoo snapshots, Binance public, Google News,
                           NSE, calendar, Polymarket
    app/services/         clustering, scenarios, macro, flows, quality,
                           paper risk, alerts, sources, lag analysis,
                           world markets, india markets, advanced analysis
    app/indicators.py       public TA primitives (SAR, swings, structure,
                           OB/FVG, sweeps, premium/discount, Bollinger,
                           Stochastic, OBV, VWAP, ADX)
    tests/                  pytest checks (32 tests)
  apps/web/               Next.js 16 app router
    app/                  pages: daily, analysis, india, global, charts,
                           tradingview, overview, bank-nifty, news,
                           macro, calendar, lag-lab, ai-signals, options,
                           backtest, paper, risk, quality, sources,
                           settings, alerts
    components/           provenance, quote tables, news cards, nav,
                           charts, crypto live board
    lib/                  API client, types, formatting, polling hook
website/                  Legacy Solo Trading Charts terminal (preserved)
scripts/                  daily market archive generator
tradingview/              original engine + Pine Script strategies
```

## License & Disclaimer

> Research, education and paper trading only. **Not investment advice.** No live orders are sent. Live broker execution is hard-disabled. Missing data is a first-class state — never fabricated.

This project lives in `Documents\TradingView-OpenCode` because the original OneDrive placeholder folder rejected writes.
