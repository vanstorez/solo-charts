import { atr, ema, maxDrawdown, monthlyReturns, rsi, sma, round } from "./indicators.mjs";
import { getBacktestBars, INDEXES } from "./market.mjs";

export const STRATEGIES = [
  {
    id: "ema-trend",
    name: "EMA Trend",
    tag: "Swing · long only",
    description: "Buy when EMA20 is above EMA50 and price is above EMA200. Exit when the fast EMA crosses down or price loses EMA200.",
    params: []
  },
  {
    id: "rsi-dip",
    name: "RSI Dip",
    tag: "Swing · mean reversion",
    description: "Buy short-term oversold dips (RSI(2) below 10) while price is above SMA200. Exit on an RSI bounce above 60 or after five sessions.",
    params: []
  },
  {
    id: "donchian",
    name: "Donchian Breakout",
    tag: "Swing · trend following",
    description: "Buy a close above the prior 20-day high. Exit on a close below the prior 10-day low.",
    params: []
  },
  {
    id: "momentum",
    name: "Momentum 60",
    tag: "Swing · relative strength",
    description: "Buy when the 60-day return is positive and price is above EMA200. Exit when the 20-day return turns negative.",
    params: []
  }
];

function maxConsecutiveLosses(trades) {
  let cur = 0;
  let worst = 0;
  for (const t of trades) {
    if (t.pnl < 0) {
      cur++;
      worst = Math.max(worst, cur);
    } else {
      cur = 0;
    }
  }
  return worst;
}

function dailyReturns(equity) {
  const out = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) out.push(equity[i].equity / prev - 1);
  }
  return out;
}

function annualizedVol(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function buildSignals(strategy, bars, params = {}) {
  const closes = bars.map((b) => b.c);
  const out = {
    entry: new Array(bars.length).fill(false),
    exit: new Array(bars.length).fill(false),
    meta: {}
  };

  if (strategy === "ema-trend") {
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    for (let i = 1; i < bars.length; i++) {
      if (e20[i] == null || e50[i] == null || e200[i] == null) continue;
      out.entry[i] = e20[i] > e50[i] && bars[i].c > e200[i];
      out.exit[i] = e20[i] < e50[i] || bars[i].c < e200[i];
    }
    out.meta = { ema20: e20, ema50: e50, ema200: e200 };
  } else if (strategy === "rsi-dip") {
    const r2 = rsi(closes, 2);
    const s200 = sma(closes, 200);
    for (let i = 1; i < bars.length; i++) {
      if (r2[i] == null || s200[i] == null) continue;
      out.entry[i] = r2[i] < 10 && bars[i].c > s200[i];
      out.exit[i] = r2[i] > 60;
    }
    out.meta = { rsi2: r2, sma200: s200 };
  } else if (strategy === "donchian") {
    const look = Number(params.lookback || 20);
    const exitLook = Number(params.exitLookback || 10);
    for (let i = look; i < bars.length; i++) {
      const priorHigh = Math.max(...bars.slice(i - look, i).map((b) => b.h));
      const priorLow = Math.min(...bars.slice(i - exitLook, i).map((b) => b.l));
      out.entry[i] = bars[i].c > priorHigh;
      out.exit[i] = bars[i].c < priorLow;
    }
    out.meta = { look, exitLook };
  } else if (strategy === "momentum") {
    const e200 = ema(closes, 200);
    for (let i = 60; i < bars.length; i++) {
      const ret60 = bars[i].c / bars[i - 60].c - 1;
      const ret20 = bars[i].c / bars[i - 20].c - 1;
      out.entry[i] = ret60 > 0 && bars[i].c > e200[i];
      out.exit[i] = ret20 < 0;
    }
    out.meta = { ema200: e200 };
  } else {
    throw new Error(`Unknown strategy ${strategy}`);
  }
  return out;
}

export async function runBacktest(options = {}) {
  const symbol = String(options.symbol || "NIFTY").toUpperCase();
  const strategy = String(options.strategy || "ema-trend");
  const range = String(options.range || "5y");
  const costPct = Number(options.costPct ?? 0.05);
  const params = options.params || {};
  const config = INDEXES[symbol];
  if (!config) throw new Error(`Unknown symbol ${symbol}`);
  if (!STRATEGIES.some((s) => s.id === strategy)) throw new Error(`Unknown strategy ${strategy}`);

  const bars = await getBacktestBars(symbol, range);
  if (bars.length < 60) throw new Error("Not enough history for this backtest");

  const signals = buildSignals(strategy, bars, params);
  const initial = 100000;
  const cost = Math.max(0, costPct) / 100;
  let cash = initial;
  let units = 0;
  let pending = null;
  let entry = null;
  const trades = [];
  const equity = [];

  // Benchmark: buy at the first tradable open, hold to the end.
  const benchEntry = bars[0].o * (1 + cost);
  const benchUnits = initial / benchEntry;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // Execute decisions from the previous close at today's open.
    if (pending === "entry" && units === 0) {
      const fill = bar.o * (1 + cost);
      const equityAtEntry = cash;
      units = cash / fill;
      cash = 0;
      entry = {
        entryIndex: i,
        entryDate: new Date(bar.t).toISOString().slice(0, 10),
        entryPrice: fill,
        entryRaw: bar.o,
        units,
        equityAtEntry
      };
    } else if (pending === "exit" && units > 0) {
      const fill = bar.o * (1 - cost);
      cash = units * fill;
      const entryEquity = entry?.equityAtEntry ?? initial;
      const pnl = cash - entryEquity;
      trades.push({
        entryDate: entry?.entryDate,
        exitDate: new Date(bar.t).toISOString().slice(0, 10),
        entryPrice: round(entry?.entryRaw ?? 0, 2),
        exitPrice: round(bar.o, 2),
        grossReturn: entry?.entryRaw ? round((bar.o / entry.entryRaw - 1) * 100, 2) : null,
        returnPct: entry?.entryPrice ? round((fill / entry.entryPrice - 1) * 100, 2) : null,
        pnl: round(pnl, 2),
        pnlPct: round((pnl / Math.max(1, entryEquity)) * 100, 2),
        barsHeld: i - (entry?.entryIndex ?? i),
        reason: "Signal"
      });
      units = 0;
      entry = null;
    }
    pending = null;

    const mark = units > 0 ? units * bar.c : cash;
    const benchMark = benchUnits * bar.c;
    equity.push({
      t: bar.t,
      date: new Date(bar.t).toISOString().slice(0, 10),
      equity: round(mark, 2),
      benchmark: round(benchMark, 2)
    });

    if (units === 0 && signals.entry[i]) pending = "entry";
    else if (units > 0 && signals.exit[i]) pending = "exit";
    else if (units > 0 && strategy === "rsi-dip") {
      const held = i - (entry?.entryIndex ?? i);
      if (held >= 5) pending = "exit";
    }
  }

  // Close any open position at the final close, applying exit cost.
  if (units > 0) {
    const bar = bars.at(-1);
    const fill = bar.c * (1 - cost);
    cash = units * fill;
    const entryEquity = entry?.equityAtEntry ?? initial;
    const pnl = cash - entryEquity;
    trades.push({
      entryDate: entry?.entryDate,
      exitDate: new Date(bar.t).toISOString().slice(0, 10),
      entryPrice: round(entry?.entryRaw ?? 0, 2),
      exitPrice: round(bar.c, 2),
      grossReturn: entry?.entryRaw ? round((bar.c / entry.entryRaw - 1) * 100, 2) : null,
      returnPct: entry?.entryPrice ? round((fill / entry.entryPrice - 1) * 100, 2) : null,
      pnl: round(pnl, 2),
      pnlPct: round((pnl / Math.max(1, entryEquity)) * 100, 2),
      barsHeld: bars.length - 1 - (entry?.entryIndex ?? bars.length - 1),
      reason: "End of data"
    });
    units = 0;
    entry = null;
    equity[equity.length - 1].equity = round(cash, 2);
  }

  const eq = equity.map((p) => p.equity);
  const benchEq = equity.map((p) => p.benchmark);
  const final = eq.at(-1) ?? initial;
  const totalReturn = final / initial - 1;
  const years = bars.length / 252;
  const cagr = years > 0 ? (final / initial) ** (1 / years) - 1 : 0;
  const dd = maxDrawdown(eq);
  const benchDd = maxDrawdown(benchEq);
  const rets = dailyReturns(equity);
  const winTrades = trades.filter((t) => t.pnl > 0);
  const lossTrades = trades.filter((t) => t.pnl < 0);
  const grossProfit = winTrades.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(lossTrades.reduce((a, b) => a + b.pnl, 0));
  const avgTrade = trades.length ? trades.reduce((a, b) => a + b.returnPct, 0) / trades.length : 0;
  const exposure = bars.length ? (trades.reduce((a, b) => a + b.barsHeld, 0) / bars.length) * 100 : 0;
  const benchFinal = benchEq.at(-1) ?? initial;

  return {
    symbol,
    name: config.name,
    strategy: STRATEGIES.find((s) => s.id === strategy),
    range,
    costPct,
    params,
    from: new Date(bars[0].t).toISOString().slice(0, 10),
    to: new Date(bars.at(-1).t).toISOString().slice(0, 10),
    bars: bars.length,
    initial,
    metrics: {
      totalReturn: round(totalReturn * 100, 2),
      cagr: round(cagr * 100, 2),
      maxDrawdown: round(dd.dd * 100, 2),
      sharpe: round(rets.length > 1 ? (rets.reduce((a, b) => a + b, 0) / rets.length) / Math.sqrt(rets.reduce((a, b) => a + (b - rets.reduce((x, y) => x + y, 0) / rets.length) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) : 0, 2),
      volatility: round(annualizedVol(rets), 2),
      winRate: trades.length ? round((winTrades.length / trades.length) * 100, 1) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? 99 : 0,
      trades: trades.length,
      avgTrade: round(avgTrade, 2),
      exposure: round(exposure, 1),
      bestTrade: trades.length ? round(Math.max(...trades.map((t) => t.returnPct)), 2) : 0,
      worstTrade: trades.length ? round(Math.min(...trades.map((t) => t.returnPct)), 2) : 0,
      maxConsecutiveLosses: maxConsecutiveLosses(trades)
    },
    benchmark: {
      totalReturn: round((benchFinal / initial - 1) * 100, 2),
      cagr: round((years > 0 ? (benchFinal / initial) ** (1 / years) - 1 : 0) * 100, 2),
      maxDrawdown: round(benchDd.dd * 100, 2)
    },
    alpha: round(((benchFinal / initial - 1) - totalReturn) * -100, 2),
    equity,
    monthly: monthlyReturns(equity),
    trades: trades.slice().reverse()
  };
}

export { maxConsecutiveLosses };
