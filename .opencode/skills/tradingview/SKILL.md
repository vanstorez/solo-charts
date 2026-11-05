---
name: TradingView Strategy Lab
description: Analyze NSE (or crypto/US) charts and backtest trading strategies with live TradingView scanner data plus Yahoo/Binance candles. Use when the user asks about TradingView, chart analysis, market scans, technical ratings, indicators, watchlists, or strategy backtests.
---

# TradingView Strategy Lab

A dependency-free research pipeline lives in `tradingview/`. It pulls live quotes and
technical ratings from TradingView's public scanner, downloads daily candles, backtests
strategies bar-by-bar, and writes a self-contained HTML report.

## Run it

From the workspace root:

```bat
tradingview\runtime\node.exe tradingview\engine.mjs --out tradingview\nse-report.html
```

Then show the result with the `browser.preview` tool on `tradingview/nse-report.html`, and
summarise the numbers in chat.

Useful flags: `--range 3y`, `--cost 0.2`, `--symbol TCS`, `--out path.html`.

If `runtime/node.exe` is missing, look for `tradingview/runtime/node-*/node.exe`; if neither
exists, fall back to Code Mode: read `tradingview/engine.mjs`, run it inside `execute`, call
`await runPipeline({ range: "5y" })`, and return `data.html` (write it with the write tool
or preview it).

## Data sources (no key required)

| Purpose | Endpoint |
| --- | --- |
| Live quotes, RSI, rating | `POST https://scanner.tradingview.com/india/scan` (markets: `india`, `america`, `crypto`, `forex`) |
| Daily OHLCV | `GET https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>?interval=1d&range=5y` |
| Crypto history | `GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000` |

TradingView has no public OHLC API. Never automate a logged-in TradingView session or scrape
a paid chart; the scanner + Yahoo combination is the supported path. Browser automation is
only for opening a chart visually or taking a screenshot.

## The engine

`tradingview/engine.mjs` exports (as plain top-level declarations):

- `fetchTVSnapshot(watchlist)` — live quote map keyed by ticker
- `fetchHistory(yahooSymbol, range)` — adjusted OHLCV
- `signalsEmaTrend`, `signalsRsiDip`, `signalsDonchian`
- `backtest(candles, signals, costPct)` — next-open fills
- `metricsFromCurve(curve, trades)` — CAGR, max DD, Sharpe, win rate, PF
- `runPipeline(options)` — everything, returns `{ portfolios, aggregates, perSymbol, tradeLog, html }`
- `renderReport(data)` — full HTML string

Watchlist entries are `{ tv: "NSE:RELIANCE", yahoo: "RELIANCE.NS", name: "..." }`. Keep
`.NS` on Yahoo symbols. NSE renames break Yahoo (e.g. TATAMOTORS.NS 404s after the 2025
demerger) — if a symbol fails, pick the current listed ticker.

## Strategy definitions

| ID | Entry | Exit |
| --- | --- | --- |
| `ema-trend` | EMA20 > EMA50 **and** close > EMA200 | EMA20 < EMA50 |
| `rsi-dip` | RSI(2) < 10 **and** close > SMA200 | RSI(2) > 60 **or** close > SMA5 |
| `donchian` | close > prior 20-bar high | close < prior 10-bar low |

Pine v6 equivalents are in `tradingview/strategies/*.pine` for validation in TradingView's
Strategy Tester. Keep them in sync when changing engine logic.

## Rules for analysis

1. **No look-ahead.** Signals at index `i` use only data up to the close of bar `i` and fill
   at bar `i+1`'s open. Never "improve" a result by filling on the signal bar.
2. **Always report drawdown and trade count**, not just return. A 40% return with a 35% DD
   and 8 trades is not a strategy.
3. **Compare against buy & hold** for the same symbol, and against NIFTY 50.
4. **Flag sample-size problems.** Fewer than ~30 trades is anecdotal.
5. **Say it is research, not advice.** No guaranteed returns, no position-size instructions.
6. **Respect rate limits.** Batch Yahoo calls; do not hammer the scanner.

## Common requests

- *"Scan NSE for momentum"* — add a scanner query with `Recommend.All`, `RSI`, `change`,
  `volume`, sort and filter. Show the top 10 with the timestamp.
- *"Backtest RELIANCE"* — run with a one-symbol watchlist, report both the strategy and
  buy & hold, include the trade log.
- *"Make it intraday"* — Yahoo supports `interval=15m` with `range=60d`; Binance supports
  any interval. Costs must rise (intraday STT and impact are higher).
- *"Add a strategy"* — implement the signal function, register it in `SIGNAL_FUNCS` and
  `STRATEGIES`, add the Pine mirror, re-run the report.
- *"Show the chart"* — open `https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE`
  in a browser tab and screenshot it. Logged-out charts may show a modal; that is fine.

## Output style

Lead with the headline numbers (return, CAGR, max drawdown, Sharpe, trades), then the
per-symbol picture, then the caveats. Currency is INR. Use `+12.3%` / `−8.4%` consistently.
