import { maxDrawdown, round } from "./indicators.mjs";
import { getIndiaVix, getIntradayBars, INDEXES, UA } from "./market.mjs";

const OPTION_INDEXES = {
  NIFTY: { ...INDEXES.NIFTY, chainSymbol: "NIFTY" },
  BANKNIFTY: { ...INDEXES.BANKNIFTY, chainSymbol: "BANKNIFTY" }
};

const NSE_HEADERS = {
  ...UA,
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://www.nseindia.com/option-chain",
  "X-Requested-With": "XMLHttpRequest"
};

const chainCache = new Map();
const CACHE_MS = 35_000;

async function nseJson(url, timeout = 12000) {
  const res = await fetch(url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  if (!text.trim().startsWith("{")) throw new Error("NSE returned a non-JSON response");
  return JSON.parse(text);
}

export function lotSizeFor(symbol) {
  return OPTION_INDEXES[String(symbol).toUpperCase()]?.lotSize ?? 75;
}

export function optionIndexes() {
  return Object.entries(OPTION_INDEXES).map(([key, value]) => ({
    key,
    name: value.name,
    lotSize: value.lotSize,
    strikeStep: value.strikeStep
  }));
}

function rowOption(leg, side) {
  if (!leg) return null;
  return {
    side,
    ltp: Number(leg.lastPrice) || 0,
    change: Number(leg.change) || 0,
    pChange: Number(leg.pChange) || 0,
    oi: Number(leg.openInterest) || 0,
    oiChange: Number(leg.changeinOpenInterest) || 0,
    volume: Number(leg.totalTradedVolume) || 0,
    iv: Number(leg.impliedVolatility) || 0,
    bid: Number(leg.buyPrice1) || 0,
    ask: Number(leg.sellPrice1) || 0
  };
}

function nearestStrike(spot, step) {
  return Math.round(spot / step) * step;
}

function daysToExpiry(expiry) {
  // NSE expiry string: 27-Oct-2026
  const parsed = new Date(`${expiry} 15:30:00 GMT+0530`);
  if (Number.isNaN(parsed.getTime())) return 1;
  return Math.max(0, (parsed.getTime() - Date.now()) / 86_400_000);
}

function computeMaxPain(rows) {
  if (!rows.length) return null;
  let best = null;
  for (const candidate of rows.map((r) => r.strike)) {
    let pain = 0;
    for (const row of rows) {
      if (row.ce) pain += Math.max(0, candidate - row.strike) * row.ce.oi;
      if (row.pe) pain += Math.max(0, row.strike - candidate) * row.pe.oi;
    }
    if (!best || pain < best.pain) best = { strike: candidate, pain };
  }
  return best?.strike ?? null;
}

function topStrikes(rows, side, spot) {
  const list = rows
    .filter((r) => (side === "support" ? r.strike < spot : r.strike > spot))
    .map((r) => ({
      strike: r.strike,
      oi: side === "support" ? r.pe?.oi ?? 0 : r.ce?.oi ?? 0,
      change: side === "support" ? r.pe?.oiChange ?? 0 : r.ce?.oiChange ?? 0
    }))
    .filter((r) => r.oi > 0)
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 5);
  return list;
}

export async function getOptionChain(symbol = "NIFTY", expiry = null) {
  const key = String(symbol).toUpperCase();
  const config = OPTION_INDEXES[key];
  if (!config) throw new Error(`Options chain is not available for ${symbol}`);
  const cacheKey = `${key}:${expiry || "nearest"}`;
  const hit = chainCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let contract;
  let raw;
  try {
    contract = await nseJson(`https://www.nseindia.com/api/option-chain-contract-info?symbol=${encodeURIComponent(config.chainSymbol)}`);
    const expiries = contract.expiryDates || [];
    const selected = expiry && expiries.includes(expiry) ? expiry : expiries[0];
    if (!selected) throw new Error("No option expiry available from NSE");
    raw = await nseJson(`https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=${encodeURIComponent(config.chainSymbol)}&expiry=${encodeURIComponent(selected)}`);
    contract.selected = selected;
    contract.expiries = expiries;
  } catch (error) {
    if (hit?.value) {
      return { ...hit.value, stale: true, warning: `NSE refresh failed; showing the last successful chain. ${error?.message || error}` };
    }
    throw error;
  }
  const selected = contract.selected;
  const expiries = contract.expiries || [];
  const records = raw.records || {};
  const spot = Number(records.underlyingValue) || 0;
  const rows = (records.data || [])
    .filter((r) => r.CE || r.PE)
    .map((r) => ({
      strike: Number(r.strikePrice),
      ce: rowOption(r.CE, "CE"),
      pe: rowOption(r.PE, "PE")
    }))
    .filter((r) => Number.isFinite(r.strike))
    .sort((a, b) => a.strike - b.strike);

  const atm = nearestStrike(spot, config.strikeStep);
  const atmRow = rows.find((r) => r.strike === atm);
  const atmIVs = [atmRow?.ce?.iv, atmRow?.pe?.iv].filter((x) => x > 0);
  const atmIV = atmIVs.length ? atmIVs.reduce((a, b) => a + b, 0) / atmIVs.length : null;
  const totalCeOi = rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0);
  const totalPeOi = rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0);
  const pcr = totalCeOi ? totalPeOi / totalCeOi : null;
  const dte = daysToExpiry(selected);
  const expectedMove = atmIV && spot ? spot * (atmIV / 100) * Math.sqrt(Math.max(dte, 0.25) / 365) : null;
  const atmStraddle = (atmRow?.ce?.ltp ?? 0) + (atmRow?.pe?.ltp ?? 0);
  const maxPain = computeMaxPain(rows);

  // Keep the visible chain compact but include enough strikes for spreads.
  const visible = rows.filter((r) => r.strike >= atm - config.strikeStep * 12 && r.strike <= atm + config.strikeStep * 12);

  const value = {
    symbol: key,
    name: config.name,
    lotSize: config.lotSize,
    strikeStep: config.strikeStep,
    expiry: selected,
    expiries,
    spot: round(spot, 2),
    timestamp: records.timestamp || null,
    atm,
    atmIV: round(atmIV, 2),
    atmStraddle: round(atmStraddle, 2),
    expectedMove: round(expectedMove, 2),
    pcr: round(pcr, 3),
    maxPain,
    totalCeOi,
    totalPeOi,
    supports: topStrikes(rows, "support", spot),
    resistances: topStrikes(rows, "resistance", spot),
    rows: visible,
    stale: records.timestamp ? /15:40:00/.test(records.timestamp) : false,
    source: "NSE option chain v3"
  };
  chainCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/* ---------------------------- Black-Scholes ----------------------------- */

function normCdf(x) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

export function blackScholes(spot, strike, years, iv, type = "CE", rate = 0.065) {
  const S = Math.max(0, Number(spot));
  const K = Math.max(0, Number(strike));
  const T = Math.max(Number(years) || 0, 1 / 365 / 24);
  const sigma = Math.max(Number(iv) / 100, 0.01);
  const r = rate;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "CE") return Math.max(0, S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2));
  return Math.max(0, K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1));
}

export function intrinsic(spot, strike, type) {
  return type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

/* ----------------------------- Payoff sheet ----------------------------- */

export function simulatePayoff(input = {}) {
  const symbol = String(input.symbol || "NIFTY").toUpperCase();
  const config = OPTION_INDEXES[symbol] || INDEXES[symbol];
  const lotSize = Number(input.lotSize || config?.lotSize || 75);
  const spot = Number(input.spot);
  const legs = Array.isArray(input.legs) ? input.legs : [];
  if (!Number.isFinite(spot) || spot <= 0) throw new Error("A valid spot price is required");
  if (!legs.length) throw new Error("Add at least one option leg");

  const clean = legs.map((leg) => {
    const lots = Math.max(1, Number(leg.lots) || 1);
    const premium = Math.max(0, Number(leg.premium) || 0);
    const strike = Math.max(0, Number(leg.strike) || 0);
    const type = leg.type === "PE" ? "PE" : "CE";
    const action = leg.action === "sell" ? "sell" : "buy";
    return { ...leg, lots, premium, strike, type, action, qty: lots * lotSize };
  });

  const range = Math.max(0.03, Math.min(0.5, Number(input.rangePct ?? 0.15)));
  const low = spot * (1 - range);
  const high = spot * (1 + range);
  const points = 161;
  const series = [];
  for (let i = 0; i < points; i++) {
    const s = low + ((high - low) * i) / (points - 1);
    let pnl = 0;
    for (const leg of clean) {
      const value = intrinsic(s, leg.strike, leg.type);
      pnl += (leg.action === "buy" ? value - leg.premium : leg.premium - value) * leg.qty;
    }
    series.push({ spot: round(s, 2), pnl: round(pnl, 2) });
  }

  let netPremium = 0;
  let shortQty = 0;
  let longQty = 0;
  for (const leg of clean) {
    netPremium += (leg.action === "sell" ? 1 : -1) * leg.premium * leg.qty;
    if (leg.action === "sell") shortQty += leg.qty;
    else longQty += leg.qty;
  }

  const values = series.map((p) => p.pnl);
  const maxProfit = Math.max(...values);
  const maxLoss = Math.min(...values);
  const breakevens = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
      const denom = b.pnl - a.pnl;
      const x = denom === 0 ? a.spot : a.spot + ((0 - a.pnl) / denom) * (b.spot - a.spot);
      if (!breakevens.some((v) => Math.abs(v - x) < 1)) breakevens.push(round(x, 2));
    }
  }

  const payoffAt = (price) => clean.reduce((pnl, leg) => {
    const value = intrinsic(price, leg.strike, leg.type);
    return pnl + (leg.action === "buy" ? value - leg.premium : leg.premium - value) * leg.qty;
  }, 0);

  const shortCalls = clean.filter((leg) => leg.action === "sell" && leg.type === "CE");
  const longCalls = clean.filter((leg) => leg.action === "buy" && leg.type === "CE")
    .map((leg) => ({ strike: leg.strike, remaining: leg.qty }))
    .sort((a, b) => a.strike - b.strike);
  const hasNakedShortCall = [...shortCalls].sort((a, b) => b.strike - a.strike).some((short) => {
    let uncovered = short.qty;
    for (const long of longCalls) {
      if (long.remaining <= 0 || long.strike < short.strike) continue;
      const used = Math.min(uncovered, long.remaining);
      long.remaining -= used;
      uncovered -= used;
      if (uncovered <= 0) break;
    }
    return uncovered > 0;
  });
  const marginEstimate = shortQty > 0 ? (spot * shortQty * 0.13) : Math.max(0, -netPremium);
  const maxLossAtRange = maxLoss;
  const unboundedRisk = hasNakedShortCall;
  const stressSpots = [0, low, spot, high, ...clean.map((leg) => leg.strike)];
  const theoreticalLoss = Math.min(...stressSpots.map((price) => payoffAt(price)));
  const theoreticalProfit = Math.max(...stressSpots.map((price) => payoffAt(price)));

  return {
    symbol,
    lotSize,
    spot,
    legs: clean,
    series,
    netPremium: round(netPremium, 2),
    netCredit: netPremium >= 0 ? round(netPremium, 2) : 0,
    netDebit: netPremium < 0 ? round(-netPremium, 2) : 0,
    maxProfit: round(Math.max(maxProfit, theoreticalProfit), 2),
    maxLoss: unboundedRisk ? null : round(theoreticalLoss, 2),
    maxLossWithinRange: round(maxLossAtRange, 2),
    breakevens,
    marginEstimate: round(marginEstimate, 2),
    returnOnMargin: marginEstimate > 0 ? round((netPremium / marginEstimate) * 100, 2) : null,
    unboundedRisk,
    rangePct: range,
    note: "Expiry payoff using exchange premiums where supplied. Margin is an estimate, not a broker SPAN file."
  };
}

/* --------------------------- Option backtest ---------------------------- */

function istDate(ms) {
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function istHour(ms) {
  const d = new Date(ms + 5.5 * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function groupSessions(bars) {
  const map = new Map();
  for (const bar of bars) {
    const key = istDate(bar.t);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(bar);
  }
  return [...map.entries()]
    .map(([date, rows]) => ({ date, bars: rows.sort((a, b) => a.t - b.t) }))
    .filter((s) => s.bars.length >= 20);
}

function vixByDate(vixData) {
  const map = new Map();
  for (const bar of vixData?.bars || []) map.set(new Date(bar.t).toISOString().slice(0, 10), bar.c);
  return map;
}

function premiumAt(spot, strike, type, iv, expiryDays, ms) {
  const hour = istHour(ms);
  const hoursLeft = Math.max(0.2, 15.5 - hour);
  const T = Math.max((expiryDays * 24 + hoursLeft) / 24 / 365, 1 / 365 / 24);
  return blackScholes(spot, strike, T, iv, type);
}

function optionCost(entryPremium, exitPremium, lotSize, costPct) {
  return ((entryPremium + exitPremium) * lotSize * costPct) / 100;
}

export async function runOptionBacktest(options = {}) {
  const symbol = String(options.symbol || "NIFTY").toUpperCase();
  const mode = options.mode === "sell" ? "sell" : "buy";
  const strategy = String(options.strategy || (mode === "buy" ? "buy-orb" : "short-straddle"));
  const lots = Math.max(1, Number(options.lots) || 1);
  const lotSize = Number(options.lotSize || lotSizeFor(symbol));
  const expiryDays = Math.max(0, Number(options.expiryDays ?? 2));
  const stopPct = Math.max(1, Number(options.stopPct ?? 35));
  const targetPct = Math.max(1, Number(options.targetPct ?? 60));
  const costPct = Math.max(0, Number(options.costPct ?? 0.5));
  const widthPct = Math.max(0.3, Number(options.widthPct ?? 1));
  const ivOverride = options.iv == null || options.iv === "" ? null : Number(options.iv);

  const config = INDEXES[symbol];
  if (!config) throw new Error(`Unknown index ${symbol}`);
  const bars = await getIntradayBars(symbol, "5m", "1mo");
  const vix = await getIndiaVix().catch(() => ({ bars: [] }));
  const vixMap = vixByDate(vix);
  const sessions = groupSessions(bars);
  if (!sessions.length) throw new Error("No intraday sessions available");

  const referenceSpot = sessions[0].bars[3]?.o ?? sessions[0].bars[0].o;
  const marginPerLot = referenceSpot * lotSize * 0.13;
  const initialCapital = mode === "sell" ? Math.max(100000, marginPerLot * lots * 1.25) : 100000;
  const trades = [];
  let equity = initialCapital;
  const curve = [{
    date: sessions[0].date,
    t: new Date(`${sessions[0].date}T09:15:00+05:30`).getTime(),
    equity: round(initialCapital, 2),
    pnl: 0
  }];

  for (const session of sessions) {
    const dayBars = session.bars;
    const vixValue = ivOverride ?? vixMap.get(session.date) ?? 14;
    const iv = Math.max(8, Math.min(60, vixValue));
    const firstThree = dayBars.slice(0, 3);
    const orHigh = Math.max(...firstThree.map((b) => b.h));
    const orLow = Math.min(...firstThree.map((b) => b.l));
    const entryBarIndex = 3;
    const exitBar = dayBars.at(-1);

    let trade = null;

    if (mode === "buy" && strategy === "buy-orb") {
      let signal = null;
      for (let i = entryBarIndex; i < dayBars.length - 2; i++) {
        const bar = dayBars[i];
        if (bar.c > orHigh) { signal = { type: "CE", at: i + 1, reason: "Opening-range breakout" }; break; }
        if (bar.c < orLow) { signal = { type: "PE", at: i + 1, reason: "Opening-range breakdown" }; break; }
      }
      if (signal && signal.at < dayBars.length - 1) {
        const entryBar = dayBars[signal.at];
        const strike = nearestStrike(entryBar.o, config.strikeStep);
        const entryPremium = premiumAt(entryBar.o, strike, signal.type, iv, expiryDays, entryBar.t);
        let exitPremium = null;
        let exitAt = exitBar;
        let exitReason = "Time exit";
        for (let j = signal.at + 1; j < dayBars.length; j++) {
          const bar = dayBars[j];
          const p = premiumAt(bar.c, strike, signal.type, iv, expiryDays, bar.t);
          if (p <= entryPremium * (1 - stopPct / 100)) {
            exitPremium = p; exitAt = bar; exitReason = "Premium stop"; break;
          }
          if (p >= entryPremium * (1 + targetPct / 100)) {
            exitPremium = p; exitAt = bar; exitReason = "Premium target"; break;
          }
        }
        if (exitPremium == null) exitPremium = premiumAt(exitAt.c, strike, signal.type, iv, expiryDays, exitAt.t);
        const gross = (exitPremium - entryPremium) * lotSize * lots;
        const costs = optionCost(entryPremium, exitPremium, lotSize * lots, costPct);
        const pnl = gross - costs;
        trade = {
          date: session.date,
          strategy: "Buy ORB ATM option",
          side: signal.type === "CE" ? "Long call" : "Long put",
          strike,
          entryTime: new Date(entryBar.t + 5.5 * 3600_000).toISOString().slice(11, 16),
          exitTime: new Date(exitAt.t + 5.5 * 3600_000).toISOString().slice(11, 16),
          entrySpot: round(entryBar.o, 2),
          exitSpot: round(exitAt.c, 2),
          entryPremium: round(entryPremium, 2),
          exitPremium: round(exitPremium, 2),
          lots,
          lotSize,
          pnl: round(pnl, 2),
          returnPct: round((pnl / (entryPremium * lotSize * lots)) * 100, 2),
          reason: signal.reason,
          exitReason,
          iv: round(iv, 2)
        };
      }
    }

    if (mode === "sell") {
      const entryBar = dayBars[entryBarIndex] || dayBars[0];
      const spot = entryBar.o;
      const shortStrike = nearestStrike(spot, config.strikeStep);
      const callStrike = strategy === "short-strangle" ? nearestStrike(spot * (1 + widthPct / 100), config.strikeStep) : shortStrike;
      const putStrike = strategy === "short-strangle" ? nearestStrike(spot * (1 - widthPct / 100), config.strikeStep) : shortStrike;
      const entryCall = premiumAt(spot, callStrike, "CE", iv, expiryDays, entryBar.t);
      const entryPut = premiumAt(spot, putStrike, "PE", iv, expiryDays, entryBar.t);
      const entryCredit = entryCall + entryPut;
      let exitCall = premiumAt(exitBar.c, callStrike, "CE", iv, expiryDays, exitBar.t);
      let exitPut = premiumAt(exitBar.c, putStrike, "PE", iv, expiryDays, exitBar.t);
      let exitAt = exitBar;
      let exitReason = "Time exit";
      for (let j = entryBarIndex + 1; j < dayBars.length; j++) {
        const bar = dayBars[j];
        const c = premiumAt(bar.c, callStrike, "CE", iv, expiryDays, bar.t);
        const p = premiumAt(bar.c, putStrike, "PE", iv, expiryDays, bar.t);
        const mark = c + p;
        if (mark >= entryCredit * (1 + stopPct / 100)) {
          exitCall = c; exitPut = p; exitAt = bar; exitReason = "Combined premium stop"; break;
        }
        if (mark <= entryCredit * (1 - targetPct / 100)) {
          exitCall = c; exitPut = p; exitAt = bar; exitReason = "Premium decay target"; break;
        }
      }
      const exitCost = exitCall + exitPut;
      const gross = (entryCredit - exitCost) * lotSize * lots;
      const costs = optionCost(entryCredit, exitCost, lotSize * lots, costPct);
      const pnl = gross - costs;
      const margin = spot * lotSize * lots * 0.13;
      trade = {
        date: session.date,
        strategy: strategy === "short-strangle" ? "Short strangle" : "Short straddle",
        side: "Short premium",
        strikes: strategy === "short-strangle" ? `${putStrike}P / ${callStrike}C` : shortStrike,
        entryTime: new Date(entryBar.t + 5.5 * 3600_000).toISOString().slice(11, 16),
        exitTime: new Date(exitAt.t + 5.5 * 3600_000).toISOString().slice(11, 16),
        entrySpot: round(spot, 2),
        exitSpot: round(exitAt.c, 2),
        entryPremium: round(entryCredit, 2),
        exitPremium: round(exitCost, 2),
        lots,
        lotSize,
        pnl: round(pnl, 2),
        returnPct: round((pnl / margin) * 100, 2),
        reason: strategy === "short-strangle" ? `${widthPct}% OTM strangle` : "ATM straddle",
        exitReason,
        iv: round(iv, 2),
        margin: round(margin, 2)
      };
    }

    if (trade) {
      trades.push(trade);
      equity += trade.pnl;
      curve.push({ date: session.date, t: new Date(`${session.date}T15:30:00+05:30`).getTime(), equity: round(equity, 2), pnl: trade.pnl });
    }
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const dd = maxDrawdown(curve.map((p) => p.equity));
  const avgPnl = trades.length ? trades.reduce((a, b) => a + b.pnl, 0) / trades.length : 0;

  return {
    symbol,
    name: config.name,
    mode,
    strategy,
    lots,
    lotSize,
    from: sessions[0].date,
    to: sessions.at(-1).date,
    sessions: sessions.length,
    trades: trades.slice().reverse(),
    curve,
    initialCapital: round(initialCapital, 2),
    marginPerLot: round(marginPerLot, 2),
    metrics: {
      totalPnl: round(equity - initialCapital, 2),
      totalReturn: round((equity / initialCapital - 1) * 100, 2),
      returnOnMargin: marginPerLot > 0 ? round(((equity - initialCapital) / (marginPerLot * lots)) * 100, 2) : null,
      winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? 99 : 0,
      trades: trades.length,
      avgPnl: round(avgPnl, 2),
      bestTrade: trades.length ? round(Math.max(...trades.map((t) => t.pnl)), 2) : 0,
      worstTrade: trades.length ? round(Math.min(...trades.map((t) => t.pnl)), 2) : 0,
      maxDrawdown: round(dd.dd * 100, 2),
      finalEquity: round(equity, 2)
    },
    assumptions: {
      iv: ivOverride == null ? "India VIX daily close" : `Override ${ivOverride}%`,
      expiryDays,
      stopPct,
      targetPct,
      costPct: `${costPct}% of premium per side`,
      pricing: "Black-Scholes synthetic premiums — not historical exchange option prices",
      sample: "Yahoo 5-minute index bars · last ~1 month"
    },
    note: "This is a modelled intraday option backtest. It does not use historical option ticks, bid/ask, or SPAN margin."
  };
}
