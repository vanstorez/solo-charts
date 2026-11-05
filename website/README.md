# Solo Trading Charts

A local, dependency-free NSE trading workstation: TradingView-style charts, strategy backtests, an intraday options desk, live market news, alerts, notes, reports, watchlists, a paper broker and a deterministic AI trade planner.

> **Research and paper trading only. Not investment advice. No live orders are sent.** Data can be delayed, stale or unavailable. Verify every level and contract with your broker before risking capital.

## Run it

Double-click `website\start.cmd`, or from this folder:

```bat
tradingview\runtime\node.exe website\server.mjs
```

Open <http://localhost:8787>. Stop it with `website\stop.cmd`.

For a silent background start, double-click `website\start-background.vbs` (or run `wscript.exe website\start-background.vbs`). The server stays up with the console hidden. On Windows, `powercfg /change standby-timeout-ac 0` prevents sleep while the machine is plugged in; the monitor can still switch off after its normal timeout. A Startup-folder shortcut named **Solo Trading Charts** can relaunch it hidden after logon; remove that shortcut to disable the behaviour.

The server has no third-party runtime dependencies. It uses the portable Node runtime in `tradingview\runtime\` when present, otherwise `node` from PATH.

## Modules

- **Market pulse** — Nifty, Bank Nifty, Sensex, India VIX, oil, dollar and US yields, plus levels, options positioning and headlines.
- **Solo charts** - candles, Heikin Ashi, line and area charts; 5m to 10Y; EMA 9/20/50/100/200, SMA 20/50/200, Bollinger, Donchian, Keltner, VWAP, Supertrend, Parabolic SAR, RSI, MACD, Stochastic, ATR, ADX and OBV; smart-money structure (BOS/CHoCH), order blocks, fair value gaps, breaker blocks with retest signals and a transparent SMC probability model; live global-news wire and research panel; auto-refreshing chart and watchlist; drawing tools; compare mode; price alerts; screenshot and fullscreen; 30 NSE stocks plus indices and global symbols.
- **Chart scanner** — TradingView-backed NSE scan with trend, EMA stack, RSI, 1-month breakout, relative volume, ATR, score, signals and presets.
- **AI trader** — deterministic chart-reading engine that returns daily bias, entry trigger, hard stop, three targets, risk budget, position size, scenarios, a 10-point checklist and a defined-risk option overlay for Nifty and Bank Nifty.
- **News terminal** — Indian markets, global markets, commodities, economy, corporate, crypto, currencies, geopolitics/oil, Fed, India policy/GIFT City, rare earth metals and World Bank/IMF feeds.
- **Macro radar** — Bank Nifty dependency (correlation/beta/relative strength), rupee pulse, crude and India sensitivity, war/stress gauge, Fed 25 bp scenario playbook, and headline feeds for the Fed, World Bank/IMF, rare earth metals, GIFT City, RBI–Finance Ministry and foreign-investor tax.
- **Options desk** — live NSE chain, OI supports/resistances, max pain, PCR, expected move, payoff builder, paper buy/sell and a modelled intraday option backtest.
- **Calculators** — position sizing, option Black-Scholes/premium planner and charges estimator.
- **Alert centre** — price, percentage and RSI alerts for Sensex, Nifty, Bank Nifty, India VIX, global macro and watchlists, with local browser notifications.
- **Notes** — autosaving trade journal, premarket plan, postmortem and checklist templates with Markdown preview and JSON export.
- **Reports** — daily desk brief and AI plan report generated from live data, printable and downloadable as Markdown.
- **Broker hub** — local paper execution plus clearly gated Zerodha, Upstox, Angel One and Dhan adapter scaffolds. Live orders are disabled unless an adapter is explicitly implemented with server-side credentials.
- **Watchlists** — separate core, global, options and momentum lists with chart and alert shortcuts.
- **Backtest lab** — no-look-ahead EMA Trend, RSI Dip, Donchian Breakout and Momentum 60 tests with equity curve, drawdown, Sharpe, monthly returns and trade log.
- **Paper book** — simulated option positions with marks and close/export workflow.

## Data sources

- TradingView scanner for live NSE/global quotes, technicals and the chart universe.
- Yahoo Finance for index candles, VIX history and backtest data.
- NSE option-chain v3 for Nifty and Bank Nifty chains.
- Google News RSS for the news terminal and the chart-side global-news wire.

Historical option premiums are **modelled with Black-Scholes**, not exchange fills. The options desk labels these results accordingly.

## Daily archive and GitHub updates

`scripts/daily-update.mjs` writes a dated market brief and JSON snapshot into `website/public/data/daily/`:

```bat
tradingview\runtime\node.exe scripts\daily-update.mjs
```

It updates `latest.json`, `latest.md` and `index.json`. The server exposes:

- `GET /api/daily/latest`
- `GET /api/daily/index`

The included GitHub Actions workflow (`.github/workflows/daily-market.yml`) runs the same script at 08:00 IST on weekdays and commits the new archive. It needs a GitHub repository with Actions enabled and `contents: write` permission. If the machine or runner cannot reach a data provider, the snapshot is written with warnings instead of failing silently.

On this Windows host, a user-level Task Scheduler job named **Solo Trading Charts Daily Archive** also runs the same script every day at 08:00, so the local archive keeps updating without GitHub. Remove it with:

```bat
schtasks /Delete /TN "Solo Trading Charts Daily Archive" /F
```

The workflow cannot publish until the repository has been created and authenticated:

```bat
gh auth login
gh repo create solo-trading-charts --private --source . --remote origin --push
```

## Architecture

```text
website/
  server.mjs              HTTP server, API routes, static files
  lib/
    market.mjs            live snapshot, Yahoo candles, VIX, market context
    charts.mjs            chart API, symbol quotes, watchlist
    symbols.mjs           symbol universe and search
    backtest.mjs          strategy engine
    options.mjs           NSE chain, Black-Scholes, payoff, option backtest
    scanner.mjs           TradingView NSE scanner
    news.mjs              Google News categories and targeted searches
    macro.mjs             bank dependency, rupee, crude, war risk, Fed/policy events
    ai.mjs                deterministic trade-plan engine
    broker.mjs            paper broker and adapter status
  public/
    index.html            single-page terminal shell
    app.js                dashboard, charts boot, backtest, options, paper book
    chart.js              Lightweight Charts engine
    terminal.js           AI, scanner, news, alerts, notes, reports, broker, watchlists
    styles.css            terminal styling and print layout
    vendor/               vendored Lightweight Charts
scripts/
  daily-update.mjs        daily archive generator
```

## Notes and limits

- Browser data (alerts, notes, reports, watchlists, paper trades and paper tickets) is stored in `localStorage`. It is local to the browser profile and is not synced.
- Broker credentials are never collected by this build. Live order methods are intentionally unimplemented.
- The AI planner is a transparent rule engine, not a language model. It describes its bias and risk; it does not predict the future.
- The Smart Money tools (structure, order blocks, FVGs, breakers and probability) are original clean-room implementations of widely used SMC/ICT concepts. They are not copies of, or affiliated with, the Expo, GainzAlgo or LuxAlgo scripts. The probability figure is a heuristic research estimate, not a forecast or advice.
- Chart and watchlist auto-refresh use polling. The "LIVE" badge means the terminal is refreshing; it does not guarantee exchange real-time data. Headlines and quotes can be delayed or unavailable.
- NSE option data can be stale outside market hours or blocked by the exchange. The desk falls back to the last successful chain when possible.
- Nifty/TATAMOTORS history can occasionally fail at the upstream provider; the app degrades rather than crashing.

Research tooling, not investment advice.

