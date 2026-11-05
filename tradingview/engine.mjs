/* ============================================================================
 * TradingView x OpenCode - NSE Strategy Lab
 * ----------------------------------------------------------------------------
 * Data sources
 *   - Live quotes / RSI / technical rating : TradingView scanner API
 *   - Daily OHLCV history                 : Yahoo Finance chart API (.NS)
 *   - Benchmark                           : ^NSEI (NIFTY 50)
 *
 * This file is intentionally dependency-free. It runs:
 *   1) inside OpenCode's Code Mode runtime (paste the file, then call runPipeline)
 *   2) with Node 18+ (`node tradingview/engine.mjs`) if Node is installed
 *
 * Execution model: signals are computed on a bar close and filled at the NEXT
 * bar's open, so there is no look-ahead bias. Costs are charged on both sides.
 * ========================================================================== */

const IS_NODE = typeof process !== "undefined" && !!(process.versions && process.versions.node);

/* ------------------------------- Universe -------------------------------- */

const WATCHLIST = [
  { tv: "NSE:RELIANCE",   yahoo: "RELIANCE.NS",   name: "Reliance Industries" },
  { tv: "NSE:TCS",        yahoo: "TCS.NS",        name: "Tata Consultancy Services" },
  { tv: "NSE:HDFCBANK",   yahoo: "HDFCBANK.NS",   name: "HDFC Bank" },
  { tv: "NSE:ICICIBANK",  yahoo: "ICICIBANK.NS",  name: "ICICI Bank" },
  { tv: "NSE:INFY",       yahoo: "INFY.NS",       name: "Infosys" },
  { tv: "NSE:SBIN",       yahoo: "SBIN.NS",       name: "State Bank of India" },
  { tv: "NSE:BHARTIARTL", yahoo: "BHARTIARTL.NS", name: "Bharti Airtel" },
  { tv: "NSE:ITC",        yahoo: "ITC.NS",        name: "ITC" },
  { tv: "NSE:LT",         yahoo: "LT.NS",         name: "Larsen & Toubro" },
  { tv: "NSE:AXISBANK",   yahoo: "AXISBANK.NS",   name: "Axis Bank" },
  { tv: "NSE:KOTAKBANK",  yahoo: "KOTAKBANK.NS",  name: "Kotak Mahindra Bank" },
  { tv: "NSE:HINDUNILVR", yahoo: "HINDUNILVR.NS", name: "Hindustan Unilever" },
  { tv: "NSE:BAJFINANCE", yahoo: "BAJFINANCE.NS", name: "Bajaj Finance" },
  { tv: "NSE:MARUTI",     yahoo: "MARUTI.NS",     name: "Maruti Suzuki" },
  { tv: "NSE:SUNPHARMA",  yahoo: "SUNPHARMA.NS",  name: "Sun Pharma" },
  { tv: "NSE:TATASTEEL",  yahoo: "TATASTEEL.NS",  name: "Tata Steel" },
  { tv: "NSE:ADANIENT",   yahoo: "ADANIENT.NS",   name: "Adani Enterprises" },
  { tv: "NSE:TITAN",      yahoo: "TITAN.NS",      name: "Titan Company" }
];

const MARKET_TICKER = "NSE:NIFTY";
const BENCHMARK_YAHOO = "^NSEI";

const STRATEGIES = [
  {
    id: "ema-trend",
    name: "EMA Trend",
    label: "EMA 20/50 + 200 filter",
    color: "#22d3ee",
    blurb: "Ride established uptrends: fast EMA above slow EMA and price above the 200 EMA."
  },
  {
    id: "rsi-dip",
    name: "RSI Dip",
    label: "RSI(2) dip in uptrend",
    color: "#a78bfa",
    blurb: "Buy short-term oversold dips while the stock is above its 200-day average; exit on a bounce."
  },
  {
    id: "donchian",
    name: "Donchian",
    label: "20-day breakout / 10-day exit",
    color: "#f59e0b",
    blurb: "Classic turtle-style breakout: buy a 20-day high, exit on a 10-day low."
  }
];

const DEFAULT_OPTIONS = {
  range: "5y",
  costPct: 0.15,          // % charged per side (brokerage + STT + slippage proxy)
  tradeSymbol: "RELIANCE"
};

/* -------------------------------- Helpers -------------------------------- */

const sum = (a) => a.reduce((x, y) => x + y, 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function mean(a) {
  return a.length ? sum(a) / a.length : 0;
}

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) * (x - m))) / (a.length - 1));
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dateKey(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function fmtPct(x, digits = 2) {
  if (x == null || !isFinite(x)) return "&mdash;";
  const s = (x * 100).toFixed(digits);
  return (x > 0 ? "+" : "") + s + "%";
}

function fmtPctPlain(x, digits = 1) {
  if (x == null || !isFinite(x)) return "&mdash;";
  return (x * 100).toFixed(digits) + "%";
}

function fmtNum(x, digits = 2) {
  if (x == null || !isFinite(x)) return "&mdash;";
  return x.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------- Indicators ------------------------------ */

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= n) acc -= values[i - n];
    if (i >= n - 1) out[i] = acc / n;
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += values[j];
      prev = s / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function rsi(values, n) {
  const out = new Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= n) {
      avgGain += gain / n;
      avgLoss += loss / n;
      if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n;
      avgLoss = (avgLoss * (n - 1) + loss) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

// Highest value of the n bars BEFORE index i (no look-ahead)
function priorHigh(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - n; j < i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

function priorLow(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - n; j < i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

/* ------------------------------ Data fetching ---------------------------- */

async function fetchJson(url, options = {}, tries = 2) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ...(options.headers || {}) }
      });
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Live TradingView snapshot: price, day change, RSI(14), technical rating.
 * Endpoint used by TradingView's own screener - no key required.
 */
async function fetchTVSnapshot(watchlist = WATCHLIST, marketTicker = MARKET_TICKER) {
  const tickers = [...watchlist.map((w) => w.tv), marketTicker];
  const body = {
    symbols: { tickers, query: { types: [] } },
    columns: ["name", "description", "close", "change", "volume", "RSI", "Recommend.All"]
  };
  const json = await fetchJson("https://scanner.tradingview.com/india/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const quotes = {};
  for (const row of json.data || []) {
    const [name, description, close, change, volume, rsi14, rating] = row.d;
    quotes[row.s] = { ticker: row.s, name, description, close, changePct: change, volume, rsi14, rating };
  }
  return quotes;
}

/**
 * Daily candles from Yahoo Finance, adjusted for splits and dividends so that
 * returns are total-return and OHLC stays internally consistent.
 */
async function fetchHistory(yahooSymbol, range = "5y") {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(yahooSymbol) +
    "?interval=1d&range=" + encodeURIComponent(range) +
    "&events=div%2Csplits&includeAdjustedClose=true";

  const json = await fetchJson(url);
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.timestamp) throw new Error("No candles for " + yahooSymbol);

  const q = result.indicators.quote[0];
  const adj = result.indicators.adjclose && result.indicators.adjclose[0]
    ? result.indicators.adjclose[0].adjclose
    : null;

  const candles = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    if (q.close[i] == null || q.open[i] == null) continue;
    const ratio = adj && adj[i] != null && q.close[i] ? adj[i] / q.close[i] : 1;
    candles.push({
      t: result.timestamp[i],
      o: q.open[i] * ratio,
      h: q.high[i] * ratio,
      l: q.low[i] * ratio,
      c: q.close[i] * ratio,
      v: q.volume[i] || 0
    });
  }
  if (candles.length < 260) throw new Error("Too few candles for " + yahooSymbol + " (" + candles.length + ")");
  return candles;
}

/* ------------------------------- Strategies ------------------------------ */
/*
 * Every strategy returns an array of target positions (1 = long, 0 = flat)
 * aligned with the candle index. A value at index i is known at the CLOSE of
 * bar i and is executed at the OPEN of bar i + 1.
 */

function signalsEmaTrend(candles) {
  const close = candles.map((c) => c.c);
  const fast = ema(close, 20);
  const slow = ema(close, 50);
  const trend = ema(close, 200);
  return close.map((_, i) => {
    if (fast[i] == null || slow[i] == null || trend[i] == null) return null;
    return fast[i] > slow[i] && close[i] > trend[i] ? 1 : 0;
  });
}

function signalsRsiDip(candles) {
  const close = candles.map((c) => c.c);
  const rsi2 = rsi(close, 2);
  const trend = sma(close, 200);
  const exitMa = sma(close, 5);
  const out = new Array(close.length).fill(null);
  let pos = 0;

  for (let i = 0; i < close.length; i++) {
    if (rsi2[i] == null || trend[i] == null || exitMa[i] == null) continue;
    if (pos === 0 && rsi2[i] < 10 && close[i] > trend[i]) pos = 1;
    else if (pos === 1 && (rsi2[i] > 60 || close[i] > exitMa[i])) pos = 0;
    out[i] = pos;
  }
  return out;
}

function signalsDonchian(candles) {
  const close = candles.map((c) => c.c);
  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const upper = priorHigh(high, 20);
  const lower = priorLow(low, 10);
  const out = new Array(close.length).fill(null);
  let pos = 0;

  for (let i = 0; i < close.length; i++) {
    if (upper[i] == null || lower[i] == null) continue;
    if (pos === 0 && close[i] > upper[i]) pos = 1;
    else if (pos === 1 && close[i] < lower[i]) pos = 0;
    out[i] = pos;
  }
  return out;
}

const SIGNAL_FUNCS = {
  "ema-trend": signalsEmaTrend,
  "rsi-dip": signalsRsiDip,
  "donchian": signalsDonchian
};

/* -------------------------------- Backtest ------------------------------- */

function backtest(candles, signals, costPct = 0.15) {
  const cost = costPct / 100;
  let cash = 1;
  let units = 0;
  let entry = null;
  const curve = [];
  const trades = [];

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    // Execute yesterday's signal at today's open
    if (i > 0 && signals[i - 1] != null) {
      const target = signals[i - 1];
      if (target === 1 && units === 0) {
        const px = bar.o * (1 + cost);
        units = cash / px;
        cash = 0;
        entry = { i, date: dateKey(bar.t), px };
      } else if (target === 0 && units > 0 && entry) {
        const px = bar.o * (1 - cost);
        cash = units * px;
        units = 0;
        const ret = px / entry.px - 1;
        trades.push({
          entryDate: entry.date,
          exitDate: dateKey(bar.t),
          entryPx: entry.px,
          exitPx: px,
          bars: i - entry.i,
          ret,
          open: false
        });
        entry = null;
      }
    }

    const equity = cash + units * bar.c;
    curve.push({ t: bar.t, v: equity, inPos: units > 0 });
  }

  let openTrade = null;
  if (units > 0 && entry) {
    const last = candles[candles.length - 1];
    openTrade = {
      entryDate: entry.date,
      exitDate: null,
      entryPx: entry.px,
      exitPx: last.c,
      bars: candles.length - 1 - entry.i,
      ret: last.c / entry.px - 1,
      open: true
    };
  }

  return { curve, trades, openTrade };
}

function metricsFromCurve(curve, trades = [], openTrade = null) {
  if (!curve.length) return null;
  const start = curve[0];
  const end = curve[curve.length - 1];
  const totalReturn = end.v / start.v - 1;

  const years = (end.t - start.t) / (365.25 * 86400);
  const cagr = years > 0 ? Math.pow(end.v / start.v, 1 / years) - 1 : 0;

  let peak = -Infinity;
  let maxDD = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.v);
    maxDD = Math.max(maxDD, 1 - p.v / peak);
  }

  const daily = [];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1].v > 0) daily.push(curve[i].v / curve[i - 1].v - 1);
  }
  const sd = stdev(daily);
  const sharpe = sd > 0 ? (mean(daily) / sd) * Math.sqrt(252) : 0;
  const downside = Math.sqrt(mean(daily.filter((r) => r < 0).map((r) => r * r))) || 0;
  const sortino = downside > 0 ? (mean(daily) / downside) * Math.sqrt(252) : 0;

  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.ret > 0);
  const losses = closed.filter((t) => t.ret <= 0);
  const grossProfit = sum(wins.map((t) => t.ret));
  const grossLoss = Math.abs(sum(losses.map((t) => t.ret)));
  const exposure = curve.filter((p) => p.inPos).length / curve.length;

  return {
    totalReturn,
    cagr,
    maxDD,
    sharpe,
    sortino,
    trades: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgTrade: closed.length ? mean(closed.map((t) => t.ret)) : 0,
    avgBars: closed.length ? mean(closed.map((t) => t.bars)) : 0,
    exposure,
    openTrade
  };
}

function buyHold(candles, costPct = 0.15) {
  const signals = candles.map(() => 1);
  const bt = backtest(candles, signals, costPct);
  return { curve: bt.curve, trades: bt.trades, openTrade: bt.openTrade };
}

/* ------------------------------ Aggregation ------------------------------ */

function combineCurves(curves) {
  const maps = curves.map((c) => new Map(c.map((p) => [p.t, p.v])));
  const dates = [...new Set(curves.flatMap((c) => c.map((p) => p.t)))].sort((a, b) => a - b);
  const last = curves.map(() => 1);
  const out = [];

  for (const t of dates) {
    let acc = 0;
    for (let j = 0; j < maps.length; j++) {
      const v = maps[j].get(t);
      if (v != null) last[j] = v;
      acc += last[j];
    }
    out.push({ t, v: acc / maps.length, inPos: true });
  }
  return out;
}

/* -------------------------------- Pipeline ------------------------------- */

async function runPipeline(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const watchlist = opts.watchlist || WATCHLIST;
  const costPct = opts.costPct;
  const errors = [];

  // 1. Live TradingView snapshot
  let snapshot = {};
  try {
    snapshot = await fetchTVSnapshot(watchlist);
  } catch (err) {
    errors.push("TradingView snapshot: " + err.message);
  }

  // 2. History (sequential batches to stay friendly to the endpoint)
  const histories = {};
  for (let i = 0; i < watchlist.length; i += 4) {
    const batch = watchlist.slice(i, i + 4);
    await Promise.all(
      batch.map(async (w) => {
        try {
          histories[w.tv] = await fetchHistory(w.yahoo, opts.range);
        } catch (err) {
          errors.push(w.tv + ": " + err.message);
        }
      })
    );
  }

  // 3. Benchmark
  let benchmarkCurve = null;
  try {
    const candles = await fetchHistory(BENCHMARK_YAHOO, opts.range);
    const bt = backtest(candles, candles.map(() => 1), 0);
    benchmarkCurve = bt.curve;
  } catch (err) {
    errors.push("Benchmark: " + err.message);
  }

  // 4. Run every strategy on every symbol
  const perSymbol = {};

  for (const w of watchlist) {
    const candles = histories[w.tv];
    if (!candles) continue;

    const entry = {
      name: w.name,
      tv: w.tv,
      candles,
      buyHold: null,
      strategies: {}
    };

    const bh = buyHold(candles, costPct);
    entry.buyHold = { ...metricsFromCurve(bh.curve, bh.trades, bh.openTrade), curve: bh.curve };

    for (const strategy of STRATEGIES) {
      const signals = SIGNAL_FUNCS[strategy.id](candles);
      const bt = backtest(candles, signals, costPct);
      entry.strategies[strategy.id] = {
        ...metricsFromCurve(bt.curve, bt.trades, bt.openTrade),
        curve: bt.curve,
        tradeList: bt.trades
      };
    }

    perSymbol[w.tv] = entry;
  }

  // 5. Equal-capital portfolio per strategy
  const symbols = Object.keys(perSymbol);
  const portfolios = STRATEGIES.map((strategy) => {
    const curves = symbols.map((s) => perSymbol[s].strategies[strategy.id].curve);
    const curve = combineCurves(curves);
    return { ...strategy, curve, metrics: metricsFromCurve(curve) };
  });

  const benchmarkMetrics = benchmarkCurve ? metricsFromCurve(benchmarkCurve) : null;

  // 6. Aggregates across symbols
  const aggregates = STRATEGIES.map((strategy) => {
    const rows = symbols.map((s) => perSymbol[s].strategies[strategy.id]);
    const bhRows = symbols.map((s) => perSymbol[s].buyHold);
    const returns = rows.map((r) => r.totalReturn);
    return {
      ...strategy,
      avgReturn: mean(returns),
      medianReturn: median(returns),
      avgDD: mean(rows.map((r) => r.maxDD)),
      avgSharpe: mean(rows.map((r) => r.sharpe)),
      avgWinRate: mean(rows.map((r) => r.winRate).filter((x) => isFinite(x))),
      avgPF: mean(rows.map((r) => (isFinite(r.profitFactor) ? r.profitFactor : 3))),
      trades: sum(rows.map((r) => r.trades)),
      beatBH: rows.filter((r, i) => r.totalReturn > bhRows[i].totalReturn).length,
      avgExposure: mean(rows.map((r) => r.exposure))
    };
  });

  // 7. Trade log: best portfolio strategy on the chosen symbol
  const best = [...portfolios].sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn)[0];
  const logSymbol = watchlist.find((w) => w.tv.endsWith(":" + opts.tradeSymbol)) || watchlist[0];
  const logEntry = perSymbol[logSymbol.tv];
  const tradeLog = {
    symbol: logSymbol.tv,
    name: logSymbol.name,
    strategy: best.name,
    strategyId: best.id,
    rows: logEntry ? logEntry.strategies[best.id].tradeList.slice(-8) : []
  };

  const data = {
    generatedAt: new Date(),
    range: opts.range,
    costPct,
    watchlist,
    snapshot,
    benchmarkQuote: snapshot[MARKET_TICKER] || null,
    benchmarkMetrics,
    benchmarkCurve,
    portfolios,
    aggregates,
    perSymbol,
    tradeLog,
    errors
  };

  data.html = renderReport(data);
  return data;
}

/* ------------------------------ SVG charting ----------------------------- */

function lineChart(series, opts = {}) {
  const width = opts.width || 1000;
  const height = opts.height || 360;
  const pad = { l: 54, r: 18, t: 18, b: 34 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;

  const all = series.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return "";
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 0.05; max += 0.05; }
  const span = max - min;
  min -= span * 0.04;
  max += span * 0.04;

  const xs = series.flatMap((s) => s.points.map((p) => p.t));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  const X = (t) => pad.l + ((t - minX) / (maxX - minX || 1)) * W;
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * H;

  const ticks = 5;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = Y(v);
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + W}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`;
    grid += `<text x="${pad.l - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="11">${v.toFixed(2)}x</text>`;
  }

  const years = [...new Set(series[0].points.map((p) => new Date(p.t * 1000).getFullYear()))];
  let xLabels = "";
  for (const yr of years) {
    const ts = Date.UTC(yr, 0, 1) / 1000;
    if (ts < minX || ts > maxX) continue;
    const x = X(ts);
    xLabels += `<text x="${x.toFixed(1)}" y="${height - 12}" text-anchor="middle" fill="#64748b" font-size="11">${yr}</text>`;
  }

  const paths = series
    .map((s) => {
      const pts = s.points;
      const step = Math.max(1, Math.floor(pts.length / 700));
      const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
      const d = sampled.map((p, i) => (i === 0 ? "M" : "L") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.1}" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Equity curves">
    ${grid}${paths}${xLabels}
  </svg>`;
}

/* --------------------------------- Report -------------------------------- */

const REPORT_CSS = `
:root{
  --bg:#070d18; --panel:#0e1727; --panel2:#0b1422; --line:#1c2a40;
  --text:#e6edf7; --muted:#8ba0bb; --dim:#5f7695;
  --up:#34d399; --down:#fb7185; --accent:#22d3ee; --amber:#fbbf24;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#10243b 0%,var(--bg) 55%) no-repeat,var(--bg);color:var(--text);font-family:"Segoe UI",Inter,system-ui,-apple-system,sans-serif;line-height:1.5}
.wrap{max-width:1180px;margin:0 auto;padding:34px 22px 60px}
.eyebrow{font-size:11px;letter-spacing:.22em;color:var(--accent);font-weight:700}
h1{font-size:40px;line-height:1.1;margin:8px 0 6px;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:14px;margin:0 0 18px}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px}
.pill{font-size:12px;color:#b9cbe3;background:#101d30;border:1px solid var(--line);padding:5px 10px;border-radius:999px}
.pill b{color:var(--text)}
section{margin:34px 0}
h2{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}
.sec-sub{color:var(--dim);font-size:13px;margin:0 0 14px}
.card{background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,0)),var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:14px}
.strat-card{position:relative;overflow:hidden}
.strat-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c)}
.strat-name{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 12px var(--c)}
.strat-label{color:var(--dim);font-size:12px;margin:2px 0 14px}
.big{font-size:30px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.big.up{color:var(--up)} .big.down{color:var(--down)}
.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;border-top:1px solid var(--line);padding-top:12px}
.stat small{display:block;color:var(--dim);font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.stat span{font-size:13px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th{text-align:right;color:var(--dim);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td{padding:8px 10px;border-bottom:1px solid rgba(28,42,64,.55);text-align:right;white-space:nowrap}
tbody tr:hover{background:rgba(34,211,238,.04)}
.sym{font-weight:650} .sym small{display:block;color:var(--dim);font-weight:400;font-size:10.5px;letter-spacing:.02em}
.pos{color:var(--up)} .neg{color:var(--down)} .flat{color:var(--muted)}
.tag{display:inline-block;font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:#a9bdd8;background:#101d30}
.tag.buy{color:#6ee7b7;border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
.tag.sell{color:#fda4af;border-color:rgba(251,113,133,.35);background:rgba(251,113,133,.08)}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 10px;font-size:12px;color:var(--muted)}
.legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.heat td{font-weight:600}
.hm{display:inline-block;min-width:64px;padding:4px 6px;border-radius:6px;text-align:center;color:#fff}
.note{color:var(--dim);font-size:12px;margin-top:10px}
.grid2{display:grid;grid-template-columns:1.55fr 1fr;gap:14px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}h1{font-size:31px}}
.foot{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:16px;margin-top:40px}
.err{color:var(--amber);font-size:12px}
ul.tight{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:13px}
ul.tight li{margin:4px 0}
code{background:#0a1422;border:1px solid var(--line);padding:1px 5px;border-radius:5px;font-size:12px;color:#bfe7f2}
`;

function ratingTag(rating) {
  if (rating == null || !isFinite(rating)) return '<span class="tag">n/a</span>';
  if (rating >= 0.5) return '<span class="tag buy">Strong Buy</span>';
  if (rating >= 0.1) return '<span class="tag buy">Buy</span>';
  if (rating > -0.1) return '<span class="tag">Neutral</span>';
  if (rating > -0.5) return '<span class="tag sell">Sell</span>';
  return '<span class="tag sell">Strong Sell</span>';
}

function retClass(x) {
  return x > 0 ? "pos" : x < 0 ? "neg" : "flat";
}

function heatStyle(pct) {
  const t = clamp(pct / 30, -1, 1);
  const hue = t >= 0 ? 152 : 355;
  const alpha = 0.18 + Math.abs(t) * 0.62;
  return `background:hsla(${hue},72%,42%,${alpha.toFixed(2)});border:1px solid hsla(${hue},72%,55%,.25)`;
}

function renderReport(data) {
  const {
    generatedAt, range, costPct, watchlist, snapshot, benchmarkQuote,
    benchmarkMetrics, benchmarkCurve, portfolios, aggregates, perSymbol, tradeLog, errors
  } = data;

  const asOf = new Date(generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  const upCount = watchlist.filter((w) => (snapshot[w.tv]?.changePct ?? 0) > 0).length;
  const dnCount = watchlist.filter((w) => (snapshot[w.tv]?.changePct ?? 0) < 0).length;
  const avgChg = mean(watchlist.map((w) => snapshot[w.tv]?.changePct ?? 0));

  const bestPortfolio = [...portfolios].sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn)[0];
  const bestAgg = aggregates.find((a) => a.id === bestPortfolio.id);

  const chartSeries = [
    ...portfolios.map((p) => ({ name: p.name, color: p.color, points: p.curve })),
    benchmarkCurve ? { name: "NIFTY 50 B&H", color: "#64748b", points: benchmarkCurve, width: 1.6 } : null
  ].filter(Boolean);

  const chartLegend = chartSeries
    .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
    .join("");

  const snapshotRows = watchlist
    .map((w) => {
      const q = snapshot[w.tv];
      if (!q) return `<tr><td class="sym">${esc(w.name)}<small>${esc(w.tv)}</small></td><td colspan="5" class="flat">no live quote</td></tr>`;
      return `<tr>
        <td class="sym">${esc(w.name)}<small>${esc(w.tv)}</small></td>
        <td>${fmtNum(q.close, 2)}</td>
        <td class="${retClass(q.changePct)}">${fmtPct((q.changePct || 0) / 100)}</td>
        <td>${fmtNum(q.rsi14, 1)}</td>
        <td>${ratingTag(q.rating)}</td>
        <td class="flat">${q.volume ? (q.volume / 1e6).toFixed(1) + "M" : "&mdash;"}</td>
      </tr>`;
    })
    .join("");

  const stratCards = portfolios
    .map((p) => {
      const m = p.metrics;
      const agg = aggregates.find((a) => a.id === p.id);
      return `<div class="card strat-card" style="--c:${p.color}">
        <div class="strat-name"><span class="dot"></span>${esc(p.name)}</div>
        <div class="strat-label">${esc(p.label)}</div>
        <div class="big ${retClass(m.totalReturn)}">${fmtPct(m.totalReturn)}</div>
        <div class="note" style="margin-top:2px">equal-weight portfolio, ${range}</div>
        <div class="stat-row">
          <div class="stat"><small>CAGR</small><span class="${retClass(m.cagr)}">${fmtPct(m.cagr, 1)}</span></div>
          <div class="stat"><small>Max DD</small><span class="neg">${fmtPct(-m.maxDD, 1)}</span></div>
          <div class="stat"><small>Sharpe</small><span>${fmtNum(m.sharpe, 2)}</span></div>
        </div>
        <div class="stat-row">
          <div class="stat"><small>Win rate</small><span>${fmtPctPlain(agg.avgWinRate, 1)}</span></div>
          <div class="stat"><small>Avg PF</small><span>${fmtNum(agg.avgPF, 2)}</span></div>
          <div class="stat"><small>Beat B&amp;H</small><span>${agg.beatBH}/${Object.keys(perSymbol).length}</span></div>
        </div>
      </div>`;
    })
    .join("");

  const heatRows = Object.entries(perSymbol)
    .map(([sym, e]) => {
      const cells = STRATEGIES.map((s) => {
        const m = e.strategies[s.id];
        return `<td><span class="hm" style="${heatStyle(m.totalReturn * 100)}">${fmtPct(m.totalReturn, 1)}</span></td>`;
      }).join("");
      return `<tr>
        <td class="sym">${esc(e.name)}<small>${esc(sym)}</small></td>
        ${cells}
        <td class="${retClass(e.buyHold.totalReturn)}">${fmtPct(e.buyHold.totalReturn, 1)}</td>
        <td class="${retClass(e.buyHold.cagr)}">${fmtPct(e.buyHold.cagr, 1)}</td>
      </tr>`;
    })
    .join("");

  const detailRows = aggregates
    .map((a) => `<tr>
      <td class="sym"><span class="dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${a.color};margin-right:7px"></span>${esc(a.name)}</td>
      <td class="${retClass(a.avgReturn)}">${fmtPct(a.avgReturn, 1)}</td>
      <td>${fmtPct(a.medianReturn, 1)}</td>
      <td class="neg">${fmtPct(-a.avgDD, 1)}</td>
      <td>${fmtNum(a.avgSharpe, 2)}</td>
      <td>${fmtPctPlain(a.avgWinRate, 1)}</td>
      <td>${fmtNum(a.avgPF, 2)}</td>
      <td>${fmtPctPlain(a.avgExposure, 0)}</td>
      <td>${a.trades}</td>
    </tr>`)
    .join("");

  const tradeRows = tradeLog.rows.length
    ? tradeLog.rows
        .map((t) => `<tr>
          <td>${esc(t.entryDate)}</td>
          <td>${esc(t.exitDate || "open")}</td>
          <td>${fmtNum(t.entryPx, 2)}</td>
          <td>${fmtNum(t.exitPx, 2)}</td>
          <td>${t.bars}</td>
          <td class="${retClass(t.ret)}">${fmtPct(t.ret, 2)}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="6" class="flat">No closed trades in this window.</td></tr>`;

  const benchCard = benchmarkMetrics
    ? `<div class="card strat-card" style="--c:#64748b">
        <div class="strat-name"><span class="dot"></span>NIFTY 50</div>
        <div class="strat-label">Buy &amp; hold benchmark</div>
        <div class="big ${retClass(benchmarkMetrics.totalReturn)}">${fmtPct(benchmarkMetrics.totalReturn)}</div>
        <div class="note" style="margin-top:2px">no timing, no costs</div>
        <div class="stat-row">
          <div class="stat"><small>CAGR</small><span>${fmtPct(benchmarkMetrics.cagr, 1)}</span></div>
          <div class="stat"><small>Max DD</small><span class="neg">${fmtPct(-benchmarkMetrics.maxDD, 1)}</span></div>
          <div class="stat"><small>Sharpe</small><span>${fmtNum(benchmarkMetrics.sharpe, 2)}</span></div>
        </div>
      </div>`
    : "";

  const errorBlock = errors.length
    ? `<div class="card" style="margin-top:14px"><div class="err">Data notes (${errors.length})</div><div class="note">${errors.map(esc).join("<br>")}</div></div>`
    : "";

  const niftyText = benchmarkQuote
    ? `<b>${fmtNum(benchmarkQuote.close, 2)}</b> <span class="${retClass(benchmarkQuote.changePct)}">${fmtPct((benchmarkQuote.changePct || 0) / 100)}</span>`
    : "&mdash;";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NSE Strategy Lab - TradingView x OpenCode</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">TRADINGVIEW &times; OPENCODE</div>
  <h1>NSE Strategy Lab</h1>
  <p class="sub">Live TradingView snapshot + ${esc(range)} of daily candles, backtested bar-by-bar with next-open fills and ${costPct}% cost per side.</p>
  <div class="pills">
    <span class="pill">NIFTY 50 ${niftyText}</span>
    <span class="pill"><b>${watchlist.length}</b> symbols</span>
    <span class="pill"><b>${upCount}</b> up / <b>${dnCount}</b> down</span>
    <span class="pill">Avg move <b class="${retClass(avgChg)}">${fmtPct(avgChg / 100)}</b></span>
    <span class="pill">As of ${esc(asOf)}</span>
  </div>

  <section>
    <h2>Strategy scoreboard</h2>
    <p class="sec-sub">Equal capital split across ${watchlist.length} NSE names, no rebalancing.${bestAgg ? ` Best run: <b>${esc(bestPortfolio.name)}</b>.` : ""}</p>
    <div class="cards">${stratCards}${benchCard}</div>
  </section>

  <section class="card">
    <h2>Growth of &#8377;1</h2>
    <p class="sec-sub">Average equity of every symbol under each rule, versus NIFTY 50 buy &amp; hold.</p>
    <div class="legend">${chartLegend}</div>
    ${lineChart(chartSeries)}
    <div class="note">A rising line is not a promise. Costs are modelled; taxes, impact and dividends are approximated.</div>
  </section>

  <section>
    <h2>Per-symbol results</h2>
    <p class="sec-sub">Total return over ${esc(range)}. Green beats red; the B&amp;H column is the same stock held outright.</p>
    <div class="card" style="padding:4px 10px 8px">
      <table class="heat">
        <thead><tr><th>Symbol</th>${STRATEGIES.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th>Buy &amp; hold</th><th>B&amp;H CAGR</th></tr></thead>
        <tbody>${heatRows}</tbody>
      </table>
    </div>
  </section>

  <section class="grid2">
    <div class="card">
      <h2>Aggregate by strategy</h2>
      <p class="sec-sub">Averaged across symbols. Exposure = share of days invested.</p>
      <table>
        <thead><tr><th>Strategy</th><th>Avg ret</th><th>Median</th><th>Avg DD</th><th>Sharpe</th><th>Win</th><th>PF</th><th>Expo</th><th>Trades</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Trade log</h2>
      <p class="sec-sub">${esc(tradeLog.name)} &middot; ${esc(tradeLog.strategy)} &middot; last closed trades</p>
      <table>
        <thead><tr><th>Entry</th><th>Exit</th><th>In</th><th>Out</th><th>Days</th><th>P&amp;L</th></tr></thead>
        <tbody>${tradeRows}</tbody>
      </table>
      <div class="note">Fills are at the next bar's open, so the log matches what a daily workflow could realistically execute.</div>
    </div>
  </section>

  <section class="card">
    <h2>Live TradingView snapshot</h2>
    <p class="sec-sub">Quotes, RSI(14) and TradingView's aggregated technical rating, pulled at generation time.</p>
    <table>
      <thead><tr><th>Symbol</th><th>Last</th><th>Day</th><th>RSI 14</th><th>TV rating</th><th>Volume</th></tr></thead>
      <tbody>${snapshotRows}</tbody>
    </table>
    ${errorBlock}
  </section>

  <section class="card">
    <h2>Method &amp; guardrails</h2>
    <ul class="tight">
      <li><b>Signals:</b> EMA 20/50 with a 200-EMA regime filter; RSI(2) &lt; 10 dip buys above the 200-SMA, exit on RSI &gt; 60 or a close above the 5-SMA; 20-day Donchian breakout with a 10-day low exit.</li>
      <li><b>Fills:</b> decided on a close, executed at the next open. No same-bar or look-ahead fills.</li>
      <li><b>Costs:</b> ${costPct}% per side, approximating brokerage, STT and slippage for NSE delivery trades. Intraday costs and taxes are higher.</li>
      <li><b>Data:</b> TradingView scanner for live quotes/ratings; Yahoo Finance adjusted daily OHLC for history. Adjusted prices include dividends.</li>
      <li><b>Reality check:</b> survivorship bias is present because the universe is today's large caps. Position sizing is 100% of capital per symbol, which is aggressive.</li>
      <li><b>Next:</b> add a walk-forward test, cap position size, and paper-trade before risking capital. This is research tooling, not investment advice.</li>
    </ul>
  </section>

  <div class="foot">
    Generated ${esc(new Date(generatedAt).toISOString().replace("T", " ").slice(0, 19))} UTC &middot; range ${esc(range)} &middot; ${watchlist.length} symbols &middot; ${STRATEGIES.length} strategies &middot; TradingView + OpenCode.
  </div>
</div>
</body>
</html>`;
}

/* ---------------------------------- CLI ---------------------------------- */

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    range: args.range || DEFAULT_OPTIONS.range,
    costPct: args.cost != null ? Number(args.cost) : DEFAULT_OPTIONS.costPct,
    tradeSymbol: args.symbol || DEFAULT_OPTIONS.tradeSymbol
  };

  console.log("Fetching TradingView snapshot + Yahoo candles (" + opts.range + ")...");
  const data = await runPipeline(opts);

  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const out = path.resolve(process.cwd(), args.out || "trade-report.html");
  await fs.writeFile(out, data.html, "utf8");

  console.log("");
  for (const p of data.portfolios) {
    const m = p.metrics;
    console.log(
      p.name.padEnd(12) +
      " ret " + (m.totalReturn * 100).toFixed(1).padStart(6) + "%" +
      "  cagr " + (m.cagr * 100).toFixed(1).padStart(5) + "%" +
      "  maxDD " + (m.maxDD * 100).toFixed(1).padStart(5) + "%" +
      "  sharpe " + m.sharpe.toFixed(2)
    );
  }
  if (data.benchmarkMetrics) {
    const m = data.benchmarkMetrics;
    console.log("NIFTY 50 B&H ret " + (m.totalReturn * 100).toFixed(1).padStart(6) + "%  maxDD " + (m.maxDD * 100).toFixed(1) + "%");
  }
  console.log("\nReport written to " + out);
}

if (IS_NODE) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
