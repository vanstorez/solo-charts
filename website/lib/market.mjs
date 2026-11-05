import { atr, ema, maxDrawdown, pivotPoints, rsi, round, sma } from "./indicators.mjs";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

export const INDEXES = {
  NIFTY: {
    key: "NIFTY",
    name: "Nifty 50",
    short: "NIFTY",
    tv: "NSE:NIFTY",
    yahoo: "^NSEI",
    lotSize: 75,
    strikeStep: 50,
    currency: "₹"
  },
  BANKNIFTY: {
    key: "BANKNIFTY",
    name: "Bank Nifty",
    short: "BANKNIFTY",
    tv: "NSE:BANKNIFTY",
    yahoo: "^NSEBANK",
    lotSize: 35,
    strikeStep: 100,
    currency: "₹"
  },
  SENSEX: {
    key: "SENSEX",
    name: "Sensex",
    short: "SENSEX",
    tv: "BSE:SENSEX",
    yahoo: "^BSESN",
    lotSize: 20,
    strikeStep: 100,
    currency: "₹"
  }
};

const LIVE_DEFS = [
  { key: "NIFTY", label: "Nifty 50", ticker: "NSE:NIFTY", market: "india", digits: 2, suffix: "" },
  { key: "BANKNIFTY", label: "Bank Nifty", ticker: "NSE:BANKNIFTY", market: "india", digits: 2, suffix: "" },
  { key: "SENSEX", label: "Sensex", ticker: "BSE:SENSEX", market: "india", digits: 2, suffix: "" },
  { key: "INDIAVIX", label: "India VIX", ticker: "NSE:INDIAVIX", market: "india", digits: 2, suffix: "" },
  { key: "GIFT", label: "GIFT Nifty", ticker: "NSEIX:NIFTY1!", market: "global", digits: 2, suffix: "" },
  { key: "BRENT", label: "Brent crude", ticker: "NYMEX:BZ1!", market: "global", digits: 2, suffix: "" },
  { key: "WTI", label: "WTI crude", ticker: "NYMEX:CL1!", market: "global", digits: 2, suffix: "" },
  { key: "USDINR", label: "USD / INR", ticker: "FX_IDC:USDINR", market: "global", digits: 2, suffix: "" },
  { key: "DXY", label: "Dollar index", ticker: "TVC:DXY", market: "global", digits: 2, suffix: "" },
  { key: "US10Y", label: "US 10-year", ticker: "TVC:US10Y", market: "global", digits: 3, suffix: "%" },
  { key: "ES", label: "S&P futures", ticker: "CME_MINI:ES1!", market: "global", digits: 2, suffix: "" },
  { key: "NQ", label: "Nasdaq futures", ticker: "CME_MINI:NQ1!", market: "global", digits: 2, suffix: "" }
];

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearCache(prefix = "") {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

async function fetchText(url, options = {}, timeoutMs = 15000, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      return text;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 + attempt * 700));
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}, timeoutMs = 15000, retries = 1) {
  const text = await fetchText(url, options, timeoutMs, retries);
  return JSON.parse(text);
}

export async function tvScan(market, tickers, columns) {
  const url = `https://scanner.tradingview.com/${market}/scan`;
  const json = await fetchJson(url, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns })
  }, 12000, 1);
  return (json.data || []).map((row) => {
    const out = { ticker: row.s };
    columns.forEach((col, i) => (out[col] = row.d[i]));
    return out;
  });
}

export function parseYahooResult(json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "No Yahoo chart result");
  const quote = result.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    if (quote.close[i] == null) continue;
    bars.push({
      t: result.timestamp[i] * 1000,
      o: quote.open[i] ?? quote.close[i],
      h: quote.high[i] ?? quote.close[i],
      l: quote.low[i] ?? quote.close[i],
      c: quote.close[i],
      v: quote.volume[i] || 0
    });
  }
  return {
    symbol: result.meta.symbol,
    currency: result.meta.currency,
    exchangeTimezone: result.meta.exchangeTimezoneName,
    regularMarketPrice: result.meta.regularMarketPrice,
    previousClose: result.meta.chartPreviousClose ?? result.meta.previousClose,
    bars
  };
}

export async function yahooChart(symbol, interval = "1d", range = "5y") {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&range=${range}&includePrePost=false`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&range=${range}&includePrePost=false`
  ];
  let lastError;
  for (const url of urls) {
    try {
      const json = await fetchJson(url, { headers: UA }, 15000, 0);
      return parseYahooResult(json);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function getDaily(symbolKey, range = "5y") {
  const index = INDEXES[symbolKey];
  if (!index) throw new Error(`Unknown index ${symbolKey}`);
  return cached(`daily:${symbolKey}:${range}`, 5 * 60_000, async () => {
    const data = await yahooChart(index.yahoo, "1d", range);
    return data;
  });
}

export async function getIntraday(symbolKey, interval = "5m", range = "1mo") {
  const index = INDEXES[symbolKey];
  if (!index) throw new Error(`Unknown index ${symbolKey}`);
  return cached(`intra:${symbolKey}:${interval}:${range}`, 90_000, async () => {
    const data = await yahooChart(index.yahoo, interval, range);
    return data;
  });
}

export async function getIndiaVix() {
  return cached("vix:daily", 10 * 60_000, async () => {
    try {
      return await yahooChart("^INDIAVIX", "1d", "2y");
    } catch {
      return { bars: [] };
    }
  });
}

function quoteFromRow(row, def) {
  return {
    key: def.key,
    label: def.label,
    ticker: def.ticker,
    value: row?.close ?? null,
    change: row?.change ?? null,
    open: row?.open ?? null,
    high: row?.high ?? null,
    low: row?.low ?? null,
    digits: def.digits,
    suffix: def.suffix
  };
}

function trendLabel(tech) {
  if (!tech) return "—";
  const above20 = tech.spot > tech.ema20;
  const above50 = tech.spot > tech.ema50;
  const above200 = tech.spot > tech.ema200;
  if (above20 && above50 && above200) return "Above all key DMAs";
  if (!above20 && !above50 && !above200) return "Below all key DMAs";
  const bits = [
    above20 ? "above 20D" : "below 20D",
    above50 ? "above 50D" : "below 50D",
    above200 ? "above 200D" : "below 200D"
  ];
  return bits.join(" · ");
}

function buildLevels(tech, step) {
  if (!tech) return { supports: [], resistances: [] };
  const spot = tech.spot;
  const rawSupports = [tech.pivot.s1, tech.pivot.s2, tech.low20, tech.low52, Math.floor(spot / 500) * 500];
  const rawResistances = [tech.pivot.r1, tech.pivot.r2, tech.high20, tech.high52, Math.ceil(spot / 500) * 500];
  const clean = (arr, side) => {
    const seen = new Set();
    return arr
      .filter((x) => Number.isFinite(x) && x > 0)
      .map((x) => Math.round(x / step) * step)
      .filter((x) => (side === "support" ? x < spot : x > spot))
      .filter((x) => {
        if (seen.has(x)) return false;
        seen.add(x);
        return true;
      })
      .sort((a, b) => (side === "support" ? b - a : a - b))
      .slice(0, 5);
  };
  return { supports: clean(rawSupports, "support"), resistances: clean(rawResistances, "resistance") };
}

function technicalsFromBars(data, step) {
  const bars = data.bars;
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.c);
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const e20 = ema(closes, 20).at(-1);
  const e50 = ema(closes, 50).at(-1);
  const e200 = ema(closes, 200).at(-1);
  const r14 = rsi(closes, 14).at(-1);
  const a14 = atr(bars, 14).at(-1);
  const pivot = pivotPoints(last);
  const last20 = bars.slice(-20);
  const last252 = bars.slice(-252);
  const tech = {
    spot: last.c,
    prevClose: prev.c,
    change: prev.c ? (last.c / prev.c - 1) * 100 : 0,
    date: new Date(last.t).toISOString().slice(0, 10),
    ema20: e20,
    ema50: e50,
    ema200: e200,
    rsi14: r14,
    atr14: a14,
    atrPct: last.c ? (a14 / last.c) * 100 : null,
    pivot,
    high20: Math.max(...last20.map((b) => b.h)),
    low20: Math.min(...last20.map((b) => b.l)),
    high52: Math.max(...last252.map((b) => b.h)),
    low52: Math.min(...last252.map((b) => b.l)),
    spark: bars.slice(-40).map((b) => ({ t: b.t, c: b.c })),
    trend: null
  };
  tech.trend = trendLabel(tech);
  tech.levels = buildLevels(tech, step);
  tech.fromHigh52 = tech.high52 ? (tech.spot / tech.high52 - 1) * 100 : null;
  tech.fromLow52 = tech.low52 ? (tech.spot / tech.low52 - 1) * 100 : null;
  return tech;
}

export function isMarketOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function istTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date) + " IST";
}

export async function getLiveSnapshot() {
  return cached("live:snapshot", 20_000, async () => {
    const [indiaRows, globalRows, niftyDaily, bankDaily, sensexDaily, vixData] = await Promise.all([
      tvScan("india", LIVE_DEFS.filter((d) => d.market === "india").map((d) => d.ticker), [
        "close", "change", "open", "high", "low", "RSI", "Recommend.All", "ATR", "EMA20", "EMA50", "EMA200"
      ]).catch(() => []),
      tvScan("global", LIVE_DEFS.filter((d) => d.market === "global").map((d) => d.ticker), [
        "close", "change", "open", "high", "low", "RSI", "Recommend.All"
      ]).catch(() => []),
      getDaily("NIFTY", "2y").catch(() => null),
      getDaily("BANKNIFTY", "2y").catch(() => null),
      getDaily("SENSEX", "2y").catch(() => null),
      getIndiaVix().catch(() => null)
    ]);

    const rowMap = new Map();
    for (const row of [...indiaRows, ...globalRows]) rowMap.set(row.ticker, row);
    const quotes = LIVE_DEFS.map((def) => quoteFromRow(rowMap.get(def.ticker), def));

    const indexes = {
      NIFTY: niftyDaily ? technicalsFromBars(niftyDaily, INDEXES.NIFTY.strikeStep) : null,
      BANKNIFTY: bankDaily ? technicalsFromBars(bankDaily, INDEXES.BANKNIFTY.strikeStep) : null,
      SENSEX: sensexDaily ? technicalsFromBars(sensexDaily, INDEXES.SENSEX.strikeStep) : null
    };

    // Fill missing technicals from TradingView when Yahoo history is unavailable.
    for (const key of Object.keys(indexes)) {
      if (indexes[key]) continue;
      const row = rowMap.get(INDEXES[key].tv);
      if (!row) continue;
      const fake = {
        spot: row.close,
        prevClose: row.close - (row.change / 100) * row.close,
        change: row.change,
        ema20: row.EMA20,
        ema50: row.EMA50,
        ema200: row.EMA200,
        rsi14: row.RSI,
        atr14: row.ATR,
        atrPct: row.close ? (row.ATR / row.close) * 100 : null,
        pivot: pivotPoints({ h: row.high, l: row.low, c: row.close }),
        high20: row.high,
        low20: row.low,
        high52: row.close,
        low52: row.close,
        spark: [],
        trend: null,
        levels: { supports: [], resistances: [] },
        fromHigh52: null,
        fromLow52: null
      };
      fake.trend = trendLabel(fake);
      fake.levels = buildLevels(fake, INDEXES[key].strikeStep);
      indexes[key] = fake;
    }

    const vixQuote = quotes.find((q) => q.key === "INDIAVIX");
    const brentQuote = quotes.find((q) => q.key === "BRENT");
    const giftQuote = quotes.find((q) => q.key === "GIFT");
    const niftyTech = indexes.NIFTY;
    let score = 0;
    if (niftyTech) {
      score += niftyTech.spot > niftyTech.ema200 ? 1 : -1;
      score += niftyTech.rsi14 >= 50 ? 1 : -1;
      score += niftyTech.spot > niftyTech.ema20 ? 1 : -1;
    }
    if (brentQuote?.value != null) score += brentQuote.value < 100 ? 1 : -1;
    if (vixQuote?.value != null) score += vixQuote.value < 18 ? 1 : -1;
    if (giftQuote?.change != null) score += giftQuote.change > 0 ? 1 : -1;
    const bias = score >= 2 ? "Bullish" : score <= -2 ? "Bearish" : "Neutral";

    const vixBars = vixData?.bars || [];
    const vixLast = vixBars.at(-1)?.c ?? vixQuote?.value ?? null;
    const vixRegime = vixLast == null ? "Unknown" : vixLast < 14 ? "Calm" : vixLast < 18 ? "Normal" : vixLast < 22 ? "Elevated" : "Panic";
    const oilRegime = brentQuote?.value == null ? "Unknown" : brentQuote.value > 110 ? "Oil shock" : brentQuote.value > 90 ? "Elevated" : "Calm";

    return {
      asOf: istTime(),
      asOfIso: new Date().toISOString(),
      marketOpen: isMarketOpen(),
      quotes,
      indexes,
      bias,
      score,
      regime: {
        vix: { value: vixLast, label: vixRegime },
        oil: { value: brentQuote?.value ?? null, label: oilRegime }
      },
      source: "TradingView scanner · Yahoo Finance daily candles",
      warnings: [
        !niftyTech ? "Nifty daily history unavailable" : null,
        !brentQuote?.value ? "Brent quote unavailable" : null
      ].filter(Boolean)
    };
  });
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function googleNews(query, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await fetchText(url, { headers: UA }, 12000, 0);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((m) => {
    const block = m[1];
    return {
      title: decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
      source: decodeEntities((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || ""),
      published: ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").replace(" GMT", "").slice(0, 22)
    };
  });
}

export async function getNews() {
  return cached("news:tape", 10 * 60_000, async () => {
    const queries = [
      "Brent crude oil price when:2d",
      "Iran Hormuz oil when:2d",
      "Sensex Nifty market when:2d"
    ];
    const groups = await Promise.all(queries.map((q) => googleNews(q, 4).catch(() => [])));
    const seen = new Set();
    const items = [];
    for (const group of groups) {
      for (const item of group) {
        const key = item.title.toLowerCase().slice(0, 80);
        if (!item.title || seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
    return items.slice(0, 9);
  });
}

export async function getMarketContext() {
  const [live, news] = await Promise.all([getLiveSnapshot(), getNews().catch(() => [])]);
  return { ...live, headlines: news };
}

export async function getBacktestBars(symbolKey, range = "5y") {
  const daily = await getDaily(symbolKey, range);
  return daily.bars;
}

export async function getIntradayBars(symbolKey, interval = "5m", range = "1mo") {
  const data = await getIntraday(symbolKey, interval, range);
  return data.bars;
}

export async function getBenchmarkBars(range = "5y") {
  const data = await getDaily("NIFTY", range);
  return data.bars;
}

export function summarizeSeries(equityCurve, initial) {
  const final = equityCurve.at(-1)?.equity ?? initial;
  const totalReturn = initial > 0 ? final / initial - 1 : 0;
  const days = equityCurve.length;
  const years = days / 252;
  const cagr = years > 0 && final > 0 ? (final / initial) ** (1 / years) - 1 : 0;
  const dd = maxDrawdown(equityCurve.map((p) => p.equity));
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push(equityCurve[i].equity / prev - 1);
  }
  const avg = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sd = returns.length > 1 ? Math.sqrt(returns.reduce((a, b) => a + (b - avg) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpe = sd ? (avg / sd) * Math.sqrt(252) : 0;
  return {
    final: round(final, 2),
    totalReturn: round(totalReturn * 100, 2),
    cagr: round(cagr * 100, 2),
    maxDrawdown: round(dd.dd * 100, 2),
    sharpe: round(sharpe, 2),
    days
  };
}

export { cache, cached, fetchJson, fetchText, UA };
