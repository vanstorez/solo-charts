import { atr, ema, maxDrawdown, pivotPoints, round, rsi, sma, stdev } from "./indicators.mjs";
import { tvScan, yahooChart } from "./market.mjs";
import { defaultWatchlist, publicSymbol, resolveSymbol, tvChartLink, tvMarket } from "./symbols.mjs";

const chartCache = new Map();
const quoteCache = new Map();

const INTERVAL_MAP = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "1d": "1d",
  "1D": "1d",
  "1wk": "1wk",
  "1W": "1wk"
};

const ALLOWED_RANGES = {
  "5m": ["1d", "5d", "1mo"],
  "15m": ["1d", "5d", "1mo"],
  "30m": ["1d", "5d", "1mo"],
  "1h": ["1mo", "3mo", "6mo", "1y", "2y"],
  "1d": ["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"],
  "1wk": ["1y", "5y", "10y", "max"]
};

const RANGE_LABELS = {
  "1d": "1D",
  "5d": "5D",
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y": "1Y",
  "2y": "2Y",
  "5y": "5Y",
  "10y": "10Y",
  max: "MAX"
};

const DEFAULT_RANGE = {
  "5m": "5d",
  "15m": "5d",
  "30m": "5d",
  "1h": "1mo",
  "1d": "1y",
  "1wk": "5y"
};

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return null;
}

async function cachedYahoo(symbol, interval, range, ttl = 90_000) {
  const key = `${symbol}|${interval}|${range}`;
  const hit = cacheGet(chartCache, key, ttl);
  if (hit) return hit;
  const value = await yahooChart(symbol, interval, range);
  chartCache.set(key, { at: Date.now(), value });
  return value;
}

async function tvQuote(symbol) {
  if (!symbol?.tv) return null;
  const key = symbol.tv;
  const hit = cacheGet(quoteCache, key, 12_000);
  if (hit) return hit;
  try {
    const rows = await tvScan(tvMarket(symbol.tv), [symbol.tv], ["close", "change", "open", "high", "low", "volume"]);
    const row = rows[0];
    if (!row) return null;
    const value = {
      last: row.close ?? null,
      changePct: row.change ?? null,
      open: row.open ?? null,
      high: row.high ?? null,
      low: row.low ?? null,
      volume: row.volume ?? null
    };
    quoteCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

function macdSeries(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macd = closes.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null));
  const nonNull = macd.filter((x) => x != null);
  const signalNonNull = ema(nonNull, 9);
  const signal = new Array(closes.length).fill(null);
  let offset = closes.length - nonNull.length;
  for (let i = 0; i < nonNull.length; i++) signal[i + offset] = signalNonNull[i];
  const hist = macd.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd, signal, hist };
}

function ratingLabel(score) {
  if (score >= 5) return "Strong buy";
  if (score === 4) return "Buy";
  if (score === 3) return "Neutral";
  if (score === 2) return "Sell";
  return "Strong sell";
}

function buildSummary(bars, dailyBars) {
  const closes = bars.map((b) => b.c);
  const e20 = ema(closes, 20).at(-1);
  const e50 = ema(closes, 50).at(-1);
  const e200 = ema(closes, 200).at(-1);
  const r14 = rsi(closes, 14).at(-1);
  const a14 = atr(bars, 14).at(-1);
  const macd = macdSeries(closes);
  const hist = macd.hist.at(-1);
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const dailyCloses = (dailyBars || bars).map((b) => b.c);
  const dE20 = ema(dailyCloses, 20).at(-1);
  const dE50 = ema(dailyCloses, 50).at(-1);
  const dE200 = ema(dailyCloses, 200).at(-1);
  const dRsi = rsi(dailyCloses, 14).at(-1);
  const dMacd = macdSeries(dailyCloses).hist.at(-1);
  const score = [
    dE20 != null && last.c > dE20,
    dE50 != null && last.c > dE50,
    dE200 != null && last.c > dE200,
    dE20 != null && dE50 != null && dE20 > dE50,
    dRsi != null && dRsi >= 50,
    dMacd != null && dMacd > 0
  ].filter(Boolean).length;
  const dailyBars252 = (dailyBars || bars).slice(-252);
  const high52 = dailyBars252.length ? Math.max(...dailyBars252.map((b) => b.h)) : null;
  const low52 = dailyBars252.length ? Math.min(...dailyBars252.map((b) => b.l)) : null;
  const avgVol20 = bars.slice(-20).reduce((a, b) => a + (b.v || 0), 0) / Math.max(1, Math.min(20, bars.length));
  return {
    rating: ratingLabel(score),
    score: round((score / 6) * 100, 1),
    scoreRaw: score,
    ema20: round(e20, 2),
    ema50: round(e50, 2),
    ema200: round(e200, 2),
    rsi14: round(r14, 2),
    atr14: round(a14, 2),
    atrPct: last?.c ? round((a14 / last.c) * 100, 2) : null,
    macd: round(macd.macd.at(-1), 2),
    macdSignal: round(macd.signal.at(-1), 2),
    macdHist: round(hist, 2),
    change: prev?.c ? round((last.c / prev.c - 1) * 100, 2) : null,
    high52: round(high52, 2),
    low52: round(low52, 2),
    avgVolume20: round(avgVol20, 0),
    signals: [
      `Price ${last.c > (dE20 ?? last.c) ? "above" : "below"} 20-DMA`,
      `Price ${last.c > (dE200 ?? last.c) ? "above" : "below"} 200-DMA`,
      `RSI ${round(dRsi, 1)}`,
      `MACD histogram ${hist == null ? "—" : hist > 0 ? "positive" : "negative"}`
    ]
  };
}

function buildLevels(bars, dailyBars) {
  const source = dailyBars?.length ? dailyBars : bars;
  const last = source.at(-1);
  const pivot = pivotPoints(last);
  const last20 = source.slice(-20);
  const spot = last.c;
  const supports = [pivot.s1, pivot.s2, Math.min(...last20.map((b) => b.l))]
    .filter((x) => Number.isFinite(x) && x < spot)
    .sort((a, b) => b - a)
    .slice(0, 3);
  const resistances = [pivot.r1, pivot.r2, Math.max(...last20.map((b) => b.h))]
    .filter((x) => Number.isFinite(x) && x > spot)
    .sort((a, b) => a - b)
    .slice(0, 3);
  return { pivot: round(pivot.p, 2), supports: supports.map((x) => round(x, 2)), resistances: resistances.map((x) => round(x, 2)) };
}

export async function getChart(symbolInput, intervalInput = "1d", rangeInput = "1y") {
  const symbol = resolveSymbol(symbolInput);
  if (!symbol) throw new Error(`Symbol not found: ${symbolInput}`);
  const canonicalInterval = intervalInput === "1D" ? "1d" : intervalInput === "1W" ? "1wk" : intervalInput;
  const interval = INTERVAL_MAP[canonicalInterval] ? canonicalInterval : "1d";
  const allowed = ALLOWED_RANGES[interval];
  const range = allowed.includes(rangeInput) ? rangeInput : DEFAULT_RANGE[interval];
  const yahooInterval = INTERVAL_MAP[interval];
  const key = `${symbol.key}|${interval}|${range}`;
  const hit = cacheGet(chartCache, key, 55_000);
  if (hit) return hit;

  const [data, daily] = await Promise.all([
    cachedYahoo(symbol.yahoo, yahooInterval, range, 55_000),
    cachedYahoo(symbol.yahoo, "1d", "2y", 10 * 60_000).catch(() => null)
  ]);
  const bars = (data.bars || []).filter((b) => Number.isFinite(b.c));
  if (!bars.length) throw new Error(`No candles returned for ${symbol.key}`);
  const quote = await tvQuote(symbol).catch(() => null);
  const last = bars.at(-1);
  const summary = buildSummary(bars, daily?.bars || []);
  const levels = buildLevels(bars, daily?.bars || []);
  const meta = {
    ...publicSymbol(symbol),
    tvLink: tvChartLink(symbol),
    interval,
    range,
    allowedRanges: allowed.map((r) => ({ value: r, label: RANGE_LABELS[r] || r.toUpperCase() })),
    timezone: data.exchangeTimezone || "Asia/Kolkata",
    exchangeTimezone: data.exchangeTimezone || "Asia/Kolkata",
    yahooSymbol: symbol.yahoo,
    regularMarketPrice: quote?.last ?? data.regularMarketPrice ?? last.c,
    previousClose: data.previousClose ?? bars.at(-2)?.c ?? null,
    source: "Yahoo Finance candles + TradingView live quote"
  };
  const value = {
    symbol: symbol.key,
    name: symbol.name,
    exchange: symbol.exchange,
    type: symbol.type,
    currency: symbol.currency,
    interval,
    range,
    meta,
    quote: quote || {
      last: data.regularMarketPrice ?? last.c,
      changePct: data.previousClose ? round((last.c / data.previousClose - 1) * 100, 2) : null,
      open: last.o,
      high: last.h,
      low: last.l,
      volume: last.v
    },
    bars,
    summary,
    levels,
    stats: {
      high52: summary.high52,
      low52: summary.low52,
      fromHigh52: summary.high52 ? round((last.c / summary.high52 - 1) * 100, 2) : null,
      fromLow52: summary.low52 ? round((last.c / summary.low52 - 1) * 100, 2) : null,
      maxDrawdown2y: daily?.bars?.length ? round(maxDrawdown(daily.bars.slice(-504).map((b) => b.c)).dd * 100, 2) : null
    },
    asOf: new Date().toISOString()
  };
  chartCache.set(key, { at: Date.now(), value });
  return value;
}

export async function getQuotes(symbolInputs = []) {
  const list = String(symbolInputs || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 80);
  const symbols = list.map((value) => resolveSymbol(value)).filter(Boolean);
  const key = `quotes:${symbols.map((symbol) => symbol.key).sort().join(",")}`;
  const hit = cacheGet(quoteCache, key, 15_000);
  if (hit) return hit;
  const india = symbols.filter((symbol) => symbol.tv && tvMarket(symbol.tv) === "india");
  const global = symbols.filter((symbol) => symbol.tv && tvMarket(symbol.tv) === "global");
  const [indiaRows, globalRows] = await Promise.all([
    india.length ? tvScan("india", india.map((symbol) => symbol.tv), ["close", "change", "RSI", "Recommend.All", "volume"]).catch(() => []) : [],
    global.length ? tvScan("global", global.map((symbol) => symbol.tv), ["close", "change", "RSI", "Recommend.All", "volume"]).catch(() => []) : []
  ]);
  const map = new Map([...indiaRows, ...globalRows].map((row) => [row.ticker, row]));
  const value = symbols.map((symbol) => {
    const row = map.get(symbol.tv);
    return {
      ...publicSymbol(symbol),
      value: row?.close ?? null,
      change: row?.change ?? null,
      rsi: row?.RSI ?? null,
      rating: row?.["Recommend.All"] ?? null,
      volume: row?.volume ?? null
    };
  });
  quoteCache.set(key, { at: Date.now(), value });
  return value;
}
export async function getWatchlist() {
  const key = "watchlist:main";
  const hit = cacheGet(quoteCache, key, 18_000);
  if (hit) return hit;
  const symbols = defaultWatchlist();
  const tickers = symbols.filter((s) => s.tv).map((s) => s.tv);
  let rows = [];
  try {
    rows = await tvScan("india", tickers, ["close", "change", "RSI", "Recommend.All", "volume"]);
  } catch {
    rows = [];
  }
  const map = new Map(rows.map((row) => [row.ticker, row]));
  const value = symbols.map((s) => {
    const row = map.get(s.tv);
    return {
      ...publicSymbol(s),
      value: row?.close ?? null,
      change: row?.change ?? null,
      rsi: row?.RSI ?? null,
      rating: row?.Recommend?.All ?? row?.["Recommend.All"] ?? null,
      volume: row?.volume ?? null
    };
  });
  quoteCache.set(key, { at: Date.now(), value });
  return value;
}

export { ALLOWED_RANGES, DEFAULT_RANGE, RANGE_LABELS };
