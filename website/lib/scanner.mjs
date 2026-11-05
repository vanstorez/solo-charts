import { round } from "./indicators.mjs";
import { tvScan } from "./market.mjs";
import { SYMBOLS } from "./symbols.mjs";

const SCAN_CACHE = new Map();
const COLUMNS = [
  "close", "change", "volume", "RSI", "Recommend.All",
  "EMA20", "EMA50", "EMA200", "SMA20", "SMA50", "SMA200",
  "ATR", "High.1M", "Low.1M", "relative_volume_10d_calc", "Volatility.D"
];

function ratingFromRecommend(value) {
  if (value == null) return "Neutral";
  if (value >= 0.5) return "Strong buy";
  if (value >= 0.15) return "Buy";
  if (value <= -0.5) return "Strong sell";
  if (value <= -0.15) return "Sell";
  return "Neutral";
}

function buildRow(symbol, row) {
  if (!row) {
    return {
      ...symbol,
      value: null,
      change: null,
      rsi: null,
      rating: "—",
      trend: "No data",
      score: null,
      signals: [],
      error: "Quote unavailable"
    };
  }
  const price = row.close;
  const ema20 = row.EMA20;
  const ema50 = row.EMA50;
  const ema200 = row.EMA200;
  const rsi = row.RSI;
  const atr = row.ATR;
  const high1m = row["High.1M"];
  const low1m = row["Low.1M"];
  const relVol = row.relative_volume_10d_calc;
  const vol = row["Volatility.D"];
  const signals = [];
  let score = 50;

  const above20 = price != null && ema20 != null && price > ema20;
  const above50 = price != null && ema50 != null && price > ema50;
  const above200 = price != null && ema200 != null && price > ema200;
  const stackUp = ema20 != null && ema50 != null && ema200 != null && ema20 > ema50 && ema50 > ema200;
  const stackDown = ema20 != null && ema50 != null && ema200 != null && ema20 < ema50 && ema50 < ema200;

  if (stackUp) { signals.push("EMA stack up"); score += 15; }
  if (stackDown) { signals.push("EMA stack down"); score -= 15; }
  if (above20) { score += 4; } else { score -= 4; }
  if (above50) { score += 5; } else { score -= 5; }
  if (above200) { score += 6; } else { score -= 6; }
  if (rsi != null && rsi >= 55 && rsi <= 70) { signals.push("RSI momentum"); score += 10; }
  if (rsi != null && rsi < 30) { signals.push("RSI oversold"); score += 3; }
  if (rsi != null && rsi > 75) { signals.push("RSI overbought"); score -= 3; }
  if (high1m != null && price != null && price >= high1m * 0.995) { signals.push("1M breakout"); score += 10; }
  if (low1m != null && price != null && price <= low1m * 1.005) { signals.push("1M breakdown"); score -= 10; }
  if (relVol != null && relVol >= 1.25) { signals.push(`Volume ${relVol.toFixed(2)}x`); score += 6; }
  if (price != null && ema50 != null && Math.abs(price / ema50 - 1) < 0.015 && above50) { signals.push("Near 50-EMA"); }
  if (atr != null && price) {
    const atrPct = (atr / price) * 100;
    if (atrPct > 4.5) { signals.push("High volatility"); score -= 4; }
    if (atrPct < 1.2) { signals.push("Low volatility"); score += 2; }
  }

  const trend = stackUp && above200 ? "Strong uptrend" : stackDown && !above200 ? "Strong downtrend" : above50 && above200 ? "Uptrend" : !above50 && !above200 ? "Downtrend" : "Mixed";
  return {
    ...symbol,
    value: round(price, 2),
    change: round(row.change, 2),
    rsi: round(rsi, 1),
    ema20: round(ema20, 2),
    ema50: round(ema50, 2),
    ema200: round(ema200, 2),
    atr: round(atr, 2),
    atrPct: price ? round((atr / price) * 100, 2) : null,
    high1m: round(high1m, 2),
    low1m: round(low1m, 2),
    relVolume: round(relVol, 2),
    volatility: round(vol, 2),
    rating: ratingFromRecommend(row["Recommend.All"]),
    recommend: round(row["Recommend.All"], 2),
    trend,
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals: signals.slice(0, 4)
  };
}

export async function getScan() {
  const hit = SCAN_CACHE.get("main");
  if (hit && Date.now() - hit.at < 30_000) return hit.value;

  const universe = SYMBOLS.filter((symbol) => symbol.type === "index" || symbol.type === "stock");
  let rows = [];
  try {
    rows = await tvScan("india", universe.map((symbol) => symbol.tv), COLUMNS);
  } catch {
    rows = [];
  }
  const rowMap = new Map(rows.map((row) => [row.ticker, row]));
  const items = universe.map((symbol) => buildRow(symbol, rowMap.get(symbol.tv)));
  const withData = items.filter((item) => item.value != null);
  const value = {
    items,
    asOf: new Date().toISOString(),
    summary: {
      count: withData.length,
      advancing: withData.filter((item) => item.change > 0).length,
      declining: withData.filter((item) => item.change < 0).length,
      above20: withData.filter((item) => item.value > item.ema20).length,
      above50: withData.filter((item) => item.value > item.ema50).length,
      above200: withData.filter((item) => item.value > item.ema200).length,
      oversold: withData.filter((item) => item.rsi < 30).length,
      overbought: withData.filter((item) => item.rsi > 70).length,
      breakouts: withData.filter((item) => item.signals.includes("1M breakout")).length,
      avgRsi: withData.length ? round(withData.reduce((sum, item) => sum + (item.rsi || 0), 0) / withData.length, 1) : null
    },
    presets: [
      { key: "all", label: "All" },
      { key: "momentum", label: "Momentum" },
      { key: "breakout", label: "Breakout" },
      { key: "trend", label: "Trend" },
      { key: "oversold", label: "Oversold" },
      { key: "bearish", label: "Bearish" },
      { key: "volume", label: "Volume surge" }
    ],
    source: "TradingView scanner"
  };
  SCAN_CACHE.set("main", { at: Date.now(), value });
  return value;
}
