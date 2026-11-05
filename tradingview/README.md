# NSE Strategy Lab — TradingView × OpenCode

A local research desk for NSE stocks. It pulls **live TradingView quotes and technical
ratings**, downloads daily candles, runs three rules-based strategies bar by bar, and
renders an HTML report with equity curves, drawdowns and trade logs.

No account, API key or TradingView subscription is required for any of this. It reads the
same public scanner endpoint TradingView's own screener uses.

---

## Quick start

**Easiest:** ask OpenCode in this folder:

> Backtest the NSE watchlist and show me the report.

**Or run it yourself:** double-click `run.cmd` (uses the portable Node runtime bundled in
`runtime/`). The report appears at `nse-report.html` and opens in your browser.

**Or from a terminal:**

```bat
tradingview\runtime\node.exe tradingview\engine.mjs --out tradingview\nse-report.html
```

Options:

```bat
... engine.mjs --range 3y --cost 0.2 --symbol TCS --out my-report.html
```

| Flag       | Meaning                                              | Default     |
| ---------- | ---------------------------------------------------- | ----------- |
| `--range`  | Yahoo history window (`1y`, `3y`, `5y`, `10y`)       | `5y`        |
| `--cost`   | Cost per side in percent (brokerage + STT + slippage) | `0.15`      |
| `--symbol` | Symbol used for the trade log                        | `RELIANCE`  |
| `--out`    | Output HTML path                                     | `trade-report.html` |

---

## What's in here

```
tradingview/
├── engine.mjs              data + indicators + backtester + report (dependency-free)
├── run.cmd                 one-click Windows launcher
├── watchlist.json          human-readable copy of the universe
├── nse-report.html         generated report
├── runtime/                portable Node.js (no system install)
└── strategies/
    ├── ema-trend.pine      TradingView Strategy Tester version
    ├── rsi-dip.pine
    └── donchian.pine
.opencode/skills/tradingview/SKILL.md   tells OpenCode how to run and extend this
```

---

## How the TradingView connection works

Three independent layers, so you are never blocked by a missing API:

1. **Live market data — TradingView scanner.**
   `POST https://scanner.tradingview.com/india/scan` returns last price, day change,
   volume, RSI(14) and the aggregated `Recommend.All` technical rating for any NSE ticker.
   This powers the live snapshot table and the market breadth pills at the top of the report.

2. **Historical candles — Yahoo Finance.**
   TradingView does not expose a public OHLC API, so history comes from
   `query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>.NS`. Prices are adjusted for splits
   and dividends, so returns are total-return. Everything is cached only in memory; no data
   leaves your machine.

3. **Chart-side validation — Pine Script.**
   The `strategies/*.pine` files mirror the engine's logic inside TradingView. Load one on
   an NSE chart and the Strategy Tester gives you TradingView's own fills, commission model
   and deep backtest report. Use this to sanity-check the local numbers on the exact chart
   you trade.

The engine also runs inside OpenCode's Code Mode runtime, so a session can backtest without
Python, Node or any setup at all.

---

## The three strategies

| ID | Rule | Entry | Exit |
| --- | --- | --- | --- |
| `ema-trend` | EMA 20/50 + 200 filter | EMA20 crosses above EMA50 **and** close > EMA200 | EMA20 crosses below EMA50 |
| `rsi-dip` | RSI(2) dip in uptrend | RSI(2) < 10 **and** close > SMA200 | RSI(2) > 60 **or** close > SMA5 |
| `donchian` | 20-day breakout | close > highest high of prior 20 bars | close < lowest low of prior 10 bars |

**Execution model**

- Signals are evaluated on the **close** of a bar and filled at the **next bar's open**.
  This removes look-ahead bias.
- 100% of capital per symbol, long only, no leverage, no shorting.
- `0.15%` cost per side by default.
- Portfolio line = equal capital across symbols, no rebalancing (a simple average of the
  per-symbol equity curves).
- Benchmark = NIFTY 50 (`^NSEI`) buy & hold.

### Reading the report

- **Strategy scoreboard** — equal-weight portfolio return, CAGR, max drawdown, Sharpe.
- **Growth of ₹1** — the four equity curves. A smoother line with a smaller drawdown can be
  more useful than a higher but violent one.
- **Per-symbol heatmap** — where each rule works and where it bleeds. This is the most
  actionable table: no rule works on every stock.
- **Aggregate table** — win rate, profit factor, exposure and number of trades per rule.
- **Trade log** — the last closed trades for one symbol, with actual fill dates.

---

## Using the Pine Scripts in TradingView

1. Open any NSE chart, e.g. `NSE:RELIANCE`, on the **Daily** timeframe.
2. Bottom panel → **Pine Editor** → **Open** → **New blank indicator/strategy**.
3. Paste the contents of `strategies/ema-trend.pine` (or another file). Replace everything.
4. **Add to chart**, then open the **Strategy Tester** tab at the bottom.
5. Set the date range in the strategy inputs (default start: 1 Jan 2021).
6. Compare its net profit / max drawdown with the local report for the same symbol.

The scripts use the same 0.15% commission and 1-tick slippage assumptions. TradingView's
fill engine is more precise than the local approximation, so expect small differences.

To turn a signal into a phone notification: right-click the chart → **Add alert** →
Condition = the strategy → choose **Once per bar close**. On paid plans you can add a
webhook URL instead, which is the hook for automating execution later.

---

## Customising

**Change the universe** — edit `WATCHLIST` at the top of `tradingview/engine.mjs`
(`tv` is the TradingView ticker, `yahoo` is the Yahoo symbol, usually the same with `.NS`).
Keep `watchlist.json` in sync if you want a readable copy.

**Add a strategy** — write a function that returns an array of `0`/`1` targets aligned with
the candles, add it to `SIGNAL_FUNCS` and `STRATEGIES`. The backtester handles fills, costs,
metrics and the report automatically. No look-ahead: values at index `i` must only use data
available at the close of bar `i`.

**Different market** — replace the Yahoo symbols with `BTC-USD` / `ETH-USD` (crypto) or
`EURUSD=X` / `GC=F` (forex/gold). The TradingView scanner endpoint changes with the market:
`india`, `america`, `crypto`, `forex`, etc.

---

## Honest limitations

- **Survivorship bias.** The universe is today's large caps. Stocks that fell out of favour
  are not represented, which flatters long-only results.
- **Daily bars only.** Intraday behaviour, gaps and circuit limits are not modelled.
- **Approximate costs.** STT, exchange charges, stamp duty and impact cost vary by broker
  and order size. `0.15%` per side is a reasonable delivery-trade proxy, not exact.
- **No position sizing.** 100% of capital in one name is aggressive. Real portfolios need
  risk-based sizing and correlation limits.
- **In-sample tuning.** These are classic default parameters, not optimised. Optimising on
  the same 5 years you report would overstate the edge; use walk-forward testing.
- **Not investment advice.** Research tooling only. Paper-trade before risking capital.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `node is not recognized` | Use `tradingview\runtime\node.exe` or double-click `run.cmd`. |
| Yahoo returns 404 for a symbol | The NSE ticker changed (demerger/rename). Update the `yahoo` field. |
| Report shows "no live quote" | TradingView scanner briefly rate-limited you. Re-run in a minute. |
| Fewer symbols than the watchlist | Check the "Data notes" box at the bottom of the report; failed symbols are listed. |
| OneDrive folder can't be written | This project was moved to `Documents\TradingView-OpenCode` because the old `Default Project` folder was a cloud placeholder. |

---

Built for OpenCode. Data: TradingView scanner + Yahoo Finance. No warranty, no advice.
