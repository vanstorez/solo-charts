import { round } from "./indicators.mjs";
import { getChart } from "./charts.mjs";
import { getLiveSnapshot } from "./market.mjs";
import { blackScholes, getOptionChain } from "./options.mjs";

const OPTION_SYMBOLS = new Set(["NIFTY", "BANKNIFTY"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value, digits = 2) {
  return value == null || !Number.isFinite(value) ? null : round(value * 100, digits);
}

function labelForScore(score) {
  if (score >= 5) return "Strong bullish";
  if (score === 4) return "Bullish";
  if (score === 3) return "Neutral";
  if (score === 2) return "Bearish";
  return "Strong bearish";
}

function nearestStrike(spot, step) {
  return Math.round(spot / step) * step;
}

function optionPremium(chain, strike, type) {
  const row = chain?.rows?.find((item) => item.strike === strike);
  const leg = type === "CE" ? row?.ce : row?.pe;
  if (leg?.ltp > 0) return leg;
  if (!chain?.atmIV) return null;
  const dte = 1;
  const premium = blackScholes(chain.spot, strike, dte / 365, chain.atmIV, type);
  return { ltp: round(premium, 2), iv: chain.atmIV, oi: 0, bid: null, ask: null, modelled: true };
}

function buildOptionPlan({ side, chart, chain, riskAmount, style }) {
  if (!chain) return null;
  const spot = chain.spot || chart.quote?.last;
  const step = chain.strikeStep;
  const atm = nearestStrike(spot, step);
  const isLong = side === "LONG";
  const isShort = side === "SHORT";
  const type = isLong ? "CE" : "PE";
  const biasText = isLong ? "bullish" : isShort ? "bearish" : "range-bound";

  if (side === "RANGE") {
    const shortCallStrike = atm + step;
    const longCallStrike = atm + step * 3;
    const shortPutStrike = atm - step;
    const longPutStrike = atm - step * 3;
    const legs = [
      { action: "sell", type: "CE", strike: shortCallStrike, premium: optionPremium(chain, shortCallStrike, "CE")?.ltp ?? 0 },
      { action: "buy", type: "CE", strike: longCallStrike, premium: optionPremium(chain, longCallStrike, "CE")?.ltp ?? 0 },
      { action: "sell", type: "PE", strike: shortPutStrike, premium: optionPremium(chain, shortPutStrike, "PE")?.ltp ?? 0 },
      { action: "buy", type: "PE", strike: longPutStrike, premium: optionPremium(chain, longPutStrike, "PE")?.ltp ?? 0 }
    ];
    const credit = legs.reduce((sum, leg) => sum + (leg.action === "sell" ? leg.premium : -leg.premium), 0);
    const width = step * 2;
    const maxLoss = Math.max(0, width - credit) * chain.lotSize;
    return {
      available: true,
      strategy: "Defined-risk iron condor",
      side: "RANGE",
      expiry: chain.expiry,
      spot,
      atm,
      lotSize: chain.lotSize,
      legs,
      netCredit: round(credit, 2),
      maxLoss: round(maxLoss, 0),
      maxProfit: round(credit * chain.lotSize, 0),
      breakeven: [round(shortPutStrike - credit, 2), round(shortCallStrike + credit, 2)],
      iv: chain.atmIV,
      pcr: chain.pcr,
      maxPain: chain.maxPain,
      note: "Use only if you understand defined-risk spreads. A short strangle has unlimited risk and is not recommended here.",
      rationale: [
        `Spot ${spot} is between the sold strikes ${shortPutStrike} and ${shortCallStrike}.`,
        `ATM IV ${chain.atmIV ?? "—"}% and PCR ${chain.pcr ?? "—"} suggest a ${biasText} options tape.`,
        "The long wings cap the maximum loss if the index breaks the range."
      ]
    };
  }

  const strike = atm;
  const leg = optionPremium(chain, strike, type);
  if (!leg || !leg.ltp) return null;
  const premium = leg.ltp;
  const premiumStopPct = style === "intraday" ? 0.28 : 0.35;
  const premiumTargetPct = style === "intraday" ? 0.55 : 0.75;
  const riskPerLot = premium * chain.lotSize * premiumStopPct;
  const budgetLots = Math.floor(riskAmount / Math.max(1, riskPerLot));
  const lots = Math.max(1, Math.min(8, budgetLots));
  const riskExceedsBudget = budgetLots < 1;
  const stopPremium = Math.max(0.05, premium * (1 - premiumStopPct));
  const targetPremium = premium * (1 + premiumTargetPct);
  const breakeven = isLong ? strike + premium : strike - premium;
  const deltaNote = isLong
    ? "A call buy needs spot to move above strike + premium before expiry."
    : "A put buy needs spot to move below strike − premium before expiry.";
  return {
    available: true,
    strategy: isLong ? "Long call (ATM)" : "Long put (ATM)",
    side: isLong ? "LONG" : "SHORT",
    expiry: chain.expiry,
    spot,
    atm,
    strike,
    type,
    lotSize: chain.lotSize,
    lots,
    premium: round(premium, 2),
    stopPremium: round(stopPremium, 2),
    targetPremium: round(targetPremium, 2),
    premiumStopPct: round(premiumStopPct * 100, 0),
    premiumTargetPct: round(premiumTargetPct * 100, 0),
    breakeven: round(breakeven, 2),
    maxLoss: round(premium * chain.lotSize * lots, 0),
    riskAtStop: round((premium - stopPremium) * chain.lotSize * lots, 0),
    riskPerLot: round(riskPerLot, 0),
    budgetLots: Math.max(0, budgetLots),
    riskExceedsBudget,
    rewardAtTarget: round((targetPremium - premium) * chain.lotSize * lots, 0),
    iv: leg.iv || chain.atmIV,
    oi: leg.oi || 0,
    pcr: chain.pcr,
    maxPain: chain.maxPain,
    expectedMove: chain.expectedMove,
    rationale: [
      `${chain.name} is ${biasText}; the plan buys the ATM ${type} expiring ${chain.expiry}.`,
      `Premium ${premium}, IV ${leg.iv || chain.atmIV}%, PCR ${chain.pcr ?? "—"}, max pain ${chain.maxPain ?? "—"}.`,
      deltaNote
    ],
    alternatives: [
      chain.atmIV > 18
        ? `IV is elevated. A defined-risk ${isLong ? "bull put" : "bear call"} spread may offer better theta than an outright ${type}.`
        : `If IV stays low, a debit ${isLong ? "call" : "put"} is cleaner than selling premium.`,
      "Avoid averaging down on a losing option; respect the premium stop."
    ]
  };
}

export async function getAiPlan({ symbol = "NIFTY", style = "intraday", capital = 100000, riskPct = 1, direction = "auto" } = {}) {
  const capitalNum = clamp(Number(capital) || 100000, 1000, 100000000);
  const riskNum = clamp(Number(riskPct) || 1, 0.1, 5);
  const riskAmount = capitalNum * (riskNum / 100);
  const intraday = style !== "swing";
  const chart = await getChart(symbol, intraday ? "15m" : "1d", intraday ? "5d" : "1y");
  const dailyChart = intraday ? await getChart(symbol, "1d", "1y") : chart;
  const summary = chart.summary || {};
  const dailySummary = dailyChart.summary || {};
  const levels = dailyChart.levels || {};
  const bars = chart.bars || [];
  const spot = chart.quote?.last ?? chart.meta?.regularMarketPrice ?? bars.at(-1)?.c;
  if (!Number.isFinite(spot) || !bars.length) throw new Error("Not enough chart data to build a plan.");

  const closes = bars.map((bar) => bar.c);
  const last20 = bars.slice(-20);
  const swingLow = Math.min(...last20.map((bar) => bar.l));
  const swingHigh = Math.max(...last20.map((bar) => bar.h));
  const recentHigh = Math.max(...bars.slice(-5).map((bar) => bar.h));
  const recentLow = Math.min(...bars.slice(-5).map((bar) => bar.l));
  const score = dailySummary.scoreRaw ?? 3;
  const rawBias = labelForScore(score);
  let side = score >= 4 ? "LONG" : score <= 2 ? "SHORT" : "RANGE";
  if (direction === "long") side = "LONG";
  if (direction === "short") side = "SHORT";
  if (direction === "range") side = "RANGE";

  let live = null;
  try { live = await getLiveSnapshot(); } catch {}
  const vix = live?.regime?.vix?.value ?? null;
  const marketOpen = live?.marketOpen ?? null;
  const atr = (intraday ? summary.atr14 : dailySummary.atr14) ?? Math.abs(spot * 0.01);
  const atrPct = (intraday ? summary.atrPct : dailySummary.atrPct) ?? Math.abs((atr / spot) * 100);
  const minRiskPct = intraday ? 0.0025 : 0.006;
  const maxRiskPct = intraday ? 0.012 : 0.045;
  const riskDistance = clamp(atr * 1.15, spot * minRiskPct, spot * maxRiskPct);
  const trigger = side === "LONG" ? Math.max(spot, recentHigh) * 1.0005 : side === "SHORT" ? Math.min(spot, recentLow) * 0.9995 : null;
  const entryPrice = side === "RANGE" ? spot : trigger ?? spot;
  const stop = side === "LONG" ? entryPrice - riskDistance : side === "SHORT" ? entryPrice + riskDistance : null;
  const riskPerUnit = stop == null ? riskDistance : Math.abs(entryPrice - stop);
  const targetMultiples = [1.25, 2, 3];
  const targets = side === "RANGE"
    ? [levels.resistances?.[0], levels.resistances?.[1] ?? levels.resistances?.[0], levels.supports?.[0]].filter((v) => Number.isFinite(v))
    : targetMultiples.map((multiple) => side === "LONG" ? entryPrice + riskDistance * multiple : entryPrice - riskDistance * multiple);
  const riskReward = side === "RANGE" ? null : round(2, 2);
  const optionChain = OPTION_SYMBOLS.has(String(symbol).toUpperCase()) ? await getOptionChain(String(symbol).toUpperCase()).catch(() => null) : null;
  const optionPlan = buildOptionPlan({ side, chart, chain: optionChain, riskAmount, style: intraday ? "intraday" : "swing" });
  const lotSize = chart.meta?.lotSize || optionChain?.lotSize || null;
  const qtyByRisk = riskPerUnit > 0 ? Math.floor(riskAmount / riskPerUnit) : 0;
  const maxNotionalLots = lotSize && entryPrice > 0 ? Math.floor((capitalNum * 4) / (entryPrice * lotSize)) : null;
  const indexLots = lotSize ? Math.max(0, Math.min(qtyByRisk, maxNotionalLots ?? qtyByRisk)) : null;
  const lots = optionPlan ? optionPlan.lots : indexLots;
  const qty = optionPlan ? optionPlan.lots * optionPlan.lotSize : lotSize ? indexLots : qtyByRisk;
  const notional = optionPlan
    ? optionPlan.premium * optionPlan.lotSize * optionPlan.lots
    : lotSize ? (indexLots || 0) * lotSize * entryPrice : (qty || 0) * entryPrice;
  const maxLossAtStop = optionPlan ? optionPlan.riskAtStop : riskAmount;

  const alignment = [
    dailySummary.ema20 != null && spot > dailySummary.ema20,
    dailySummary.ema50 != null && spot > dailySummary.ema50,
    dailySummary.ema200 != null && spot > dailySummary.ema200,
    dailySummary.rsi14 != null && dailySummary.rsi14 > 50,
    dailySummary.macdHist != null && dailySummary.macdHist > 0
  ].filter(Boolean).length;
  const confidence = clamp(
    Math.round(38 + Math.abs(score - 3) * 12 + (side === "LONG" ? alignment : 5 - alignment) * 3 + (vix != null && vix > 22 ? -6 : 0) + (optionPlan ? 4 : 0)),
    32,
    88
  );

  const keyResistance = levels.resistances?.[0] ?? swingHigh;
  const keySupport = levels.supports?.[0] ?? swingLow;
  const narrative = [
    `${chart.name} is trading at ${spot.toFixed(2)} with a ${rawBias.toLowerCase()} daily bias. Price is ${spot > dailySummary.ema20 ? "above" : "below"} the 20-DMA, ${spot > dailySummary.ema50 ? "above" : "below"} the 50-DMA, and daily RSI(14) is ${dailySummary.rsi14?.toFixed(1) ?? "—"}.`,
    `The ${intraday ? "intraday" : "swing"} plan uses a ${riskDistance.toFixed(2)}-point stop (${pct(riskDistance / spot)}% of spot) and targets ${targets.map((target) => target?.toFixed(2)).filter(Boolean).join(" / ")}. Risk budget is ₹${Math.round(riskAmount).toLocaleString("en-IN")} (${riskNum}% of capital).`,
    optionPlan
      ? `Options overlay: ${optionPlan.strategy} on ${optionPlan.expiry}. ${optionPlan.rationale?.[0] || ""}`
      : `Options overlay unavailable for ${symbol}. Use the cash/index plan or open the options desk for NIFTY / BANKNIFTY.`
  ];

  const checklist = [
    { text: "Daily trend and 20/50/200 EMA structure checked", status: score >= 4 || score <= 2 ? "pass" : "watch" },
    { text: "Entry trigger is defined before the trade", status: trigger != null || side === "RANGE" ? "pass" : "watch" },
    { text: "Hard stop is placed beyond the noise level", status: "pass" },
    { text: "Risk is 0.1%–2% of capital", status: riskNum <= 2 ? "pass" : "fail" },
    { text: "Position size is based on stop distance, not conviction", status: qty > 0 || optionPlan ? "pass" : "fail" },
    { text: "Volatility regime is acceptable", status: vix == null || vix < 22 ? "pass" : "watch" },
    { text: "No major event inside the holding window", status: "watch" },
    { text: "Option premium and breakeven are understood", status: optionPlan ? "pass" : "watch" },
    { text: "Trade is logged in the paper book first", status: "watch" },
    { text: "Stop and target are written in the journal", status: "watch" }
  ];

  const skills = [
    { key: "structure", label: "Chart structure", value: dailySummary.ema20 != null && spot > dailySummary.ema20 ? "Higher than 20-DMA" : "Below 20-DMA", note: "Daily trend skeleton" },
    { key: "trend", label: "Trend alignment", value: `${alignment}/5 bullish checks`, note: "Daily EMA + RSI + MACD" },
    { key: "momentum", label: "Momentum", value: `RSI ${dailySummary.rsi14?.toFixed(1) ?? "—"}`, note: `MACD hist ${dailySummary.macdHist ?? "—"}` },
    { key: "volatility", label: "Volatility", value: `ATR ${atrPct.toFixed(2)}%`, note: vix != null ? `India VIX ${vix}` : "VIX unavailable" },
    { key: "levels", label: "Key levels", value: `${keySupport?.toFixed?.(2) ?? "—"} / ${keyResistance?.toFixed?.(2) ?? "—"}`, note: "Support / resistance" },
    { key: "volume", label: "Volume", value: summary.avgVolume20 ? `${(summary.avgVolume20 / 100000).toFixed(2)}L avg` : "—", note: "20-bar average" },
    { key: "risk", label: "Risk budget", value: `₹${Math.round(riskAmount).toLocaleString("en-IN")}`, note: `${riskNum}% of capital` },
    { key: "sizing", label: "Position sizing", value: optionPlan ? `${optionPlan.lots} lot${optionPlan.lots > 1 ? "s" : ""}` : qty ? `${qty} unit${qty > 1 ? "s" : ""}` : "No size", note: "Stop-based" },
    { key: "options", label: "Options edge", value: optionPlan ? `${optionPlan.strategy}` : "Not an option symbol", note: optionChain ? `PCR ${optionChain.pcr ?? "—"} · IV ${optionChain.atmIV ?? "—"}%` : "No chain" },
    { key: "journal", label: "Journal", value: "Not logged", note: "Use Notes / Reports" }
  ];

  const warnings = [];
  if (marketOpen === false) warnings.push("Indian cash market is closed. Levels are based on the last close and can gap on the next open.");
  if (vix != null && vix >= 22) warnings.push(`India VIX is elevated at ${vix}. Option premiums and whipsaw risk are high.`);
  if (optionChain?.stale) warnings.push("NSE option-chain snapshot is stale; refresh before using the option plan.");
  if (riskNum > 2) warnings.push("Risk per trade is above 2% of capital. Reduce size or risk.");
  if (optionPlan?.riskExceedsBudget) warnings.push(`One option lot risks about ₹${Math.round(optionPlan.riskAtStop).toLocaleString("en-IN")} at the premium stop, above your ₹${Math.round(riskAmount).toLocaleString("en-IN")} budget. Skip the trade, use a spread, or raise capital.`);
  if (side === "RANGE") warnings.push("Range plans need patience. Do not force a directional trade inside the range.");
  warnings.push("This is a research plan, not investment advice. Markets can gap through stops.");

  return {
    version: "Solo AI Trader · multi-factor rule engine v1",
    generatedAt: new Date().toISOString(),
    symbol: chart.symbol,
    name: chart.name,
    style: intraday ? "intraday" : "swing",
    horizon: intraday ? "Intraday / 1–3 sessions" : "Swing / 2–8 weeks",
    market: {
      spot: round(spot, 2),
      changePct: chart.quote?.changePct ?? dailySummary.change ?? null,
      interval: chart.interval,
      range: chart.range,
      marketOpen,
      vix: round(vix, 2),
      vixRegime: live?.regime?.vix?.label ?? null,
      bias: live?.bias ?? null
    },
    bias: {
      label: rawBias,
      side,
      score: summary.score ?? null,
      confidence,
      reasons: [
        `Price ${spot > dailySummary.ema20 ? "above" : "below"} 20-DMA`,
        `Price ${spot > dailySummary.ema50 ? "above" : "below"} 50-DMA`,
        `RSI ${dailySummary.rsi14?.toFixed(1) ?? "—"} · MACD hist ${dailySummary.macdHist ?? "—"}`,
        `Daily EMA alignment ${alignment}/5`
      ]
    },
    structure: {
      ema20: dailySummary.ema20,
      ema50: dailySummary.ema50,
      ema200: dailySummary.ema200,
      rsi14: dailySummary.rsi14,
      macdHist: dailySummary.macdHist,
      intradayEma20: intraday ? summary.ema20 : null,
      intradayEma50: intraday ? summary.ema50 : null,
      atr: round(atr, 2),
      atrPct: round(atrPct, 2),
      swingHigh: round(swingHigh, 2),
      swingLow: round(swingLow, 2),
      recentHigh: round(recentHigh, 2),
      recentLow: round(recentLow, 2)
    },
    levels: {
      pivot: levels.pivot,
      supports: levels.supports || [],
      resistances: levels.resistances || [],
      high52: dailyChart.stats?.high52,
      low52: dailyChart.stats?.low52,
      keySupport: round(keySupport, 2),
      keyResistance: round(keyResistance, 2)
    },
    trade: {
      side,
      instrument: optionPlan ? `Option · ${optionPlan.strategy}` : chart.type === "stock" ? "Cash equity" : "Index / futures equivalent",
      entry: round(entryPrice, 2),
      entryZone: side === "RANGE" ? [round(keySupport, 2), round(keyResistance, 2)] : [round(entryPrice * 0.998, 2), round(entryPrice * 1.002, 2)],
      trigger: trigger == null ? null : round(trigger, 2),
      stop: stop == null ? null : round(stop, 2),
      stopDistance: round(riskDistance, 2),
      stopPct: round((riskDistance / spot) * 100, 2),
      targets: targets.map((target) => round(target, 2)),
      riskReward: riskReward,
      capital: capitalNum,
      riskPct: riskNum,
      riskAmount: round(riskAmount, 0),
      qty,
      lots,
      lotSize,
      notional: round(notional, 0),
      maxLossAtStop: round(maxLossAtStop, 0),
      rewardAtT2: side === "RANGE" || targets.length < 2 ? null : round(riskAmount * 2, 0),
      summary: side === "RANGE"
        ? `Wait for a break outside ${round(keySupport, 2)}–${round(keyResistance, 2)}. The defined-risk options expression is an iron condor, not a naked short.`
        : `${side === "LONG" ? "Buy" : "Sell"} only after ${trigger?.toFixed(2)} holds. Stop ${stop?.toFixed(2)}. Book partials at T1 and trail the rest.`
    },
    option: optionPlan,
    scenarios: [
      {
        name: side === "LONG" ? "Bull continuation" : side === "SHORT" ? "Bear continuation" : "Range holds",
        condition: side === "LONG" ? `Above ${trigger?.toFixed(2)}` : side === "SHORT" ? `Below ${trigger?.toFixed(2)}` : `Inside ${keySupport?.toFixed(2)}–${keyResistance?.toFixed(2)}`,
        action: side === "RANGE" ? "Keep the defined-risk condor; avoid adding directional risk." : "Hold with a trailing stop after T1.",
        target: side === "RANGE" ? "Theta / range midpoint" : `T2 ${targets[1]?.toFixed(2) ?? "—"}`
      },
      {
        name: "Stop-out / invalidation",
        condition: side === "LONG" ? `Below ${stop?.toFixed(2)}` : side === "SHORT" ? `Above ${stop?.toFixed(2)}` : `Break of ${keySupport?.toFixed(2)} or ${keyResistance?.toFixed(2)}`,
        action: "Exit without averaging. Reassess only after a fresh close.",
        target: `Risk capped at ₹${Math.round(riskAmount).toLocaleString("en-IN")}`
      },
      {
        name: "Chop / no follow-through",
        condition: "Price stalls near entry for 2–3 bars",
        action: "Cut to half size or move to breakeven. Do not pay theta for a dead setup.",
        target: "Capital preservation"
      }
    ],
    checklist,
    skills,
    narrative,
    warnings,
    optionChainAvailable: !!optionChain,
    disclaimer: "Solo AI Trader is a deterministic research engine using live quotes, Yahoo candles, NSE option-chain data and rule-based risk logic. It is not a licensed investment adviser and does not place live orders."
  };
}
