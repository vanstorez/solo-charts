/* Macro & event radar: bank dependency, rupee, crude, war risk, policy events and Fed scenarios. */

import { getChart, getQuotes } from "./charts.mjs";
import { getNewsFeed, getNewsSearch } from "./news.mjs";

const MACRO_CACHE_MS = 30_000;
let macroCache = null;
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

function pctChange(values, lookback) {
  if (!Array.isArray(values) || values.length <= lookback) return null;
  const last = values.at(-1);
  const base = values.at(-1 - lookback);
  return base ? round((last / base - 1) * 100, 2) : null;
}

function pctReturns(values, lookback = 90) {
  const slice = values.slice(-(lookback + 1));
  const out = [];
  for (let i = 1; i < slice.length; i += 1) {
    if (slice[i - 1]) out.push(slice[i] / slice[i - 1] - 1);
  }
  return out;
}

function correlation(left, right) {
  const n = Math.min(left.length, right.length);
  if (n < 12) return null;
  const a = left.slice(-n);
  const b = right.slice(-n);
  const ma = a.reduce((sum, value) => sum + value, 0) / n;
  const mb = b.reduce((sum, value) => sum + value, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va && vb ? round(cov / Math.sqrt(va * vb), 2) : null;
}

function beta(assetReturns, marketReturns) {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 12) return null;
  const a = assetReturns.slice(-n);
  const m = marketReturns.slice(-n);
  const ma = a.reduce((sum, value) => sum + value, 0) / n;
  const mm = m.reduce((sum, value) => sum + value, 0) / n;
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - ma) * (m[i] - mm);
    variance += (m[i] - mm) ** 2;
  }
  return variance ? round(cov / variance, 2) : null;
}

function emaLast(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < values.length; i += 1) value = values[i] * k + value * (1 - k);
  return round(value, 4);
}

function closes(result) {
  return (result?.bars || []).map((bar) => bar.c).filter((value) => Number.isFinite(value));
}

function quoteOf(quotes, key) {
  return quotes.find((item) => item.key === key) || null;
}

function compactNews(feed, limit = 4) {
  return (feed?.items || []).slice(0, limit).map((item) => ({
    title: item.title,
    link: item.link,
    source: item.source,
    ago: item.ago,
    sentiment: item.sentiment
  }));
}

function countNegative(items) {
  if (!items?.length) return 0;
  return items.filter((item) => item.sentiment === "negative").length / items.length;
}

function dedupeNews(groups, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const item of groups.flat()) {
    const key = String(item.title || "").toLowerCase().slice(0, 90);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function buildWarRisk({ vix, brent, goldChange, usdinrMonth, headlines }) {
  const negativeShare = countNegative(headlines);
  const warWords = headlines.filter((item) => /war|strike|attack|missile|sanction|hormuz|conflict|military/i.test(item.title)).length;
  let score = 8;
  const drivers = [];
  if (Number.isFinite(vix) && vix > 15) {
    score += Math.min(25, (vix - 15) * 4);
    drivers.push(`India VIX at ${round(vix, 2)}`);
  }
  if (Number.isFinite(brent) && brent > 90) {
    score += Math.min(22, (brent - 90) * 0.8);
    drivers.push(`Brent at $${round(brent, 2)}`);
  }
  if (Number.isFinite(usdinrMonth) && usdinrMonth > 0.5) {
    score += Math.min(12, usdinrMonth * 5);
    drivers.push(`Rupee ${usdinrMonth > 0 ? "weaker" : "stronger"} ${Math.abs(usdinrMonth).toFixed(2)}% in 1M`);
  }
  if (Number.isFinite(goldChange) && goldChange > 0.5) {
    score += Math.min(10, goldChange * 3);
    drivers.push(`Gold +${goldChange.toFixed(2)}% today`);
  }
  if (negativeShare > 0.35) {
    score += Math.min(16, (negativeShare - 0.35) * 30);
    drivers.push(`${Math.round(negativeShare * 100)}% negative geopolitical headlines`);
  }
  if (warWords) {
    score += Math.min(12, warWords * 3);
    drivers.push(`${warWords} conflict headline${warWords > 1 ? "s" : ""} in feed`);
  }
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const label = value >= 75 ? "Severe" : value >= 55 ? "Elevated" : value >= 35 ? "Watch" : "Calm";
  return { score: value, label, negativeShare: round(negativeShare * 100, 0), warHeadlines: warWords, drivers };
}

function buildFedScenarios(context) {
  const scenarios = [
    {
      key: "cut25",
      label: "Cut 25 bps",
      tone: "positive",
      summary: "Liquidity-positive if the cut is accompanied by a dovish tone; often partly priced before the meeting.",
      rows: [
        ["USD / INR", "Rupee supportive", "Softer dollar usually pulls USD/INR lower; importers get relief."],
        ["Nifty 50", "Mild positive", "Rate-sensitive banks, realty and autos lead; watch the press conference for sell-the-news."],
        ["Bank Nifty", "Positive bias", "Lower funding costs and risk-on sentiment help banks, but the move can fade if credit growth guidance is weak."],
        ["Gold", "Positive", "Lower real yields and a softer dollar are tailwinds."],
        ["Crude", "Mixed", "Demand optimism supports crude; a weaker dollar is also supportive."]
      ]
    },
    {
      key: "hold",
      label: "Hold / hawkish pause",
      tone: "neutral",
      summary: "The statement and dot plot matter more than the decision; volatility can rise into the press conference.",
      rows: [
        ["USD / INR", "Range", "Dollar steadier; rupee tracks oil and portfolio flows."],
        ["Nifty 50", "Choppy", "Index heavyweights may consolidate until the next inflation or payroll print."],
        ["Bank Nifty", "Neutral", "No fresh liquidity impulse; relative strength depends on credit growth."],
        ["Gold", "Soft", "Higher-for-longer real yields can cap gold."],
        ["Crude", "Range", "Policy uncertainty keeps a risk premium in the barrel."]
      ]
    },
    {
      key: "hike25",
      label: "Hike 25 bps",
      tone: "negative",
      summary: "A surprise hike is the risk-off case: stronger dollar, weaker rupee and pressure on rate-sensitive sectors.",
      rows: [
        ["USD / INR", "Rupee under pressure", "Higher US yields can pull portfolio flows out of India."],
        ["Nifty 50", "Negative", "Valuation compression hits long-duration growth and rate-sensitive pockets."],
        ["Bank Nifty", "Mixed / negative", "Higher net interest margins help, but credit-cost and mark-to-market worries dominate first."],
        ["Gold", "Pressure", "Higher real yields and a stronger dollar weigh on gold."],
        ["Crude", "Pressure", "Demand concerns can outweigh dollar moves."]
      ]
    }
  ];
  return {
    event: "US Fed decision — 25 bp scenarios",
    context: {
      vix: context.vix,
      usdinr: context.usdinr,
      dxy: context.dxy,
      us10y: context.us10y,
      niftyChange: context.niftyChange,
      bankNiftyChange: context.bankNiftyChange
    },
    pricedIn: Number.isFinite(context.vix) && context.vix < 15
      ? "VIX is low: part of a benign outcome may already be priced in. A hawkish surprise can move markets more than the headline decision."
      : "VIX is not complacent: the market is already charging some event risk. Confirm direction with DXY, US 10Y and USD/INR.",
    scenarios
  };
}

export async function getMacroRadar() {
  if (macroCache && Date.now() - macroCache.at < MACRO_CACHE_MS) return macroCache.value;
  const quoteKeys = [
    "NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX", "USDINR", "BRENT", "WTI", "GOLD", "DXY", "US10Y",
    "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "BAJFINANCE"
  ];
  const [quotes, niftyChart, bankChart, dollarChart, brentChart, hdfcChart, iciciChart, sbiChart, kotakChart, axisChart, fedFeed, giftFeed, rbiFeed, pmFeed, rareFeed, wbFeed, geoFeed] = await Promise.all([
    getQuotes(quoteKeys).catch(() => []),
    getChart("NIFTY", "1d", "2y").catch(() => null),
    getChart("BANKNIFTY", "1d", "2y").catch(() => null),
    getChart("USDINR", "1d", "1y").catch(() => null),
    getChart("BRENT", "1d", "1y").catch(() => null),
    getChart("HDFCBANK", "1d", "1y").catch(() => null),
    getChart("ICICIBANK", "1d", "1y").catch(() => null),
    getChart("SBIN", "1d", "1y").catch(() => null),
    getChart("KOTAKBANK", "1d", "1y").catch(() => null),
    getChart("AXISBANK", "1d", "1y").catch(() => null),
    getNewsFeed("fed").catch(() => ({ items: [] })),
    getNewsSearch('"GIFT City" OR IFSC OR "foreign investors tax" India when:14d', "GIFT City & FPI tax", "IN", 5).catch(() => ({ items: [] })),
    getNewsSearch('"RBI Governor" OR "Finance Minister" India markets when:14d', "RBI Governor & Finance Minister", "IN", 5).catch(() => ({ items: [] })),
    getNewsSearch('"Prime Minister" foreign investors OR tax India when:14d', "PM meeting & foreign-investor tax", "IN", 5).catch(() => ({ items: [] })),
    getNewsFeed("rareearth").catch(() => ({ items: [] })),
    getNewsFeed("worldbank").catch(() => ({ items: [] })),
    getNewsFeed("geopolitics").catch(() => ({ items: [] }))
  ]);

  const q = Object.fromEntries(quotes.map((item) => [item.key, item]));
  const niftyCloses = closes(niftyChart);
  const bankCloses = closes(bankChart);
  const niftyReturns = pctReturns(niftyCloses, 90);
  const bankReturns = pctReturns(bankCloses, 90);
  const bankCorrelation = correlation(niftyReturns, bankReturns);
  const bankBeta = beta(bankReturns, niftyReturns);
  const niftyMonth = pctChange(niftyCloses, 21);
  const bankMonth = pctChange(bankCloses, 21);
  const rsMonth = Number.isFinite(niftyMonth) && Number.isFinite(bankMonth) ? round(bankMonth - niftyMonth, 2) : null;

  const componentCharts = { HDFCBANK: hdfcChart, ICICIBANK: iciciChart, SBIN: sbiChart, KOTAKBANK: kotakChart, AXISBANK: axisChart };
  const bankMovers = quotes
    .filter((item) => ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "BAJFINANCE"].includes(item.key))
    .filter((item) => Number.isFinite(item.change))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .map((item) => {
      const componentReturns = pctReturns(closes(componentCharts[item.key]), 90);
      return {
        key: item.key,
        name: item.name,
        value: item.value,
        change: item.change,
        rsi: item.rsi,
        correlation: correlation(componentReturns, bankReturns),
        beta: beta(componentReturns, bankReturns)
      };
    });

  const dollarCloses = closes(dollarChart);
  const dollarEma20 = emaLast(dollarCloses, 20);
  const dollarEma50 = emaLast(dollarCloses, 50);
  const dollarMonth = pctChange(dollarCloses, 21);
  const dollarWeek = pctChange(dollarCloses, 5);
  const dollarQuarter = pctChange(dollarCloses, 63);
  const dollarLast20Bars = (dollarChart?.bars || []).slice(-20);
  const dollarSupport = dollarLast20Bars.length ? Math.min(...dollarLast20Bars.map((bar) => bar.l)) : null;
  const dollarResistance = dollarLast20Bars.length ? Math.max(...dollarLast20Bars.map((bar) => bar.h)) : null;
  const rupeeTrend = dollarCloses.length
    ? (dollarCloses.at(-1) > (dollarEma20 || Infinity) && (dollarEma20 || 0) > (dollarEma50 || 0)
      ? "Weakening"
      : dollarCloses.at(-1) < (dollarEma20 || 0) && (dollarEma20 || Infinity) < (dollarEma50 || Infinity)
        ? "Stabilising"
        : "Range / choppy")
    : "Data unavailable";

  const brentCloses = closes(brentChart);
  const brentEma20 = emaLast(brentCloses, 20);
  const brentMonth = pctChange(brentCloses, 21);
  const brentWeek = pctChange(brentCloses, 5);
  const brentLast20 = (brentChart?.bars || []).slice(-20);
  const brentSupport = brentLast20.length ? Math.min(...brentLast20.map((bar) => bar.l)) : null;
  const brentResistance = brentLast20.length ? Math.max(...brentLast20.map((bar) => bar.h)) : null;
  const oilRisk = Number.isFinite(q.BRENT?.value) && q.BRENT.value > 100 ? "High" : Number.isFinite(q.BRENT?.value) && q.BRENT.value > 85 ? "Elevated" : "Normal";

  const geoHeadlines = compactNews(geoFeed, 6);
  const war = buildWarRisk({
    vix: q.INDIAVIX?.value,
    brent: q.BRENT?.value,
    goldChange: q.GOLD?.change,
    usdinrMonth: dollarMonth,
    headlines: geoHeadlines
  });

  const relevantPolicy = (feed, pattern) => {
    const items = feed?.items || [];
    const matched = items.filter((item) => pattern.test(item.title));
    return (matched.length ? matched : items).slice(0, 3);
  };
  const policyBuckets = {
    giftCity: relevantPolicy(giftFeed, /gift city|ifsc|foreign investor|fund|tax|sez/i),
    rbiFinance: relevantPolicy(rbiFeed, /rbi|reserve bank|governor|finance minister|liquidity|rate/i),
    pmTax: relevantPolicy(pmFeed, /tax|foreign|invest|capital gains|gift city|reform/i)
  };
  const policyItems = dedupeNews([policyBuckets.giftCity, policyBuckets.rbiFinance, policyBuckets.pmTax], 7);

  const vix = q.INDIAVIX?.value;
  const regime = !Number.isFinite(vix)
    ? "Mixed"
    : vix >= 20 || war.score >= 70
      ? "Risk-off tilt"
      : vix <= 14 && war.score < 40
        ? "Risk-on"
        : "Event-driven / mixed";

  const summary = `${regime}. Bank Nifty–Nifty correlation is ${bankCorrelation ?? "n/a"} with beta ${bankBeta ?? "n/a"}. The rupee is ${rupeeTrend.toLowerCase()} (1M ${dollarMonth == null ? "n/a" : `${dollarMonth > 0 ? "+" : ""}${dollarMonth}%`}), Brent is $${round(q.BRENT?.value, 2) ?? "n/a"} and the war-risk gauge is ${war.score}/100 (${war.label}).`;

  const result = {
    generatedAt: new Date().toISOString(),
    regime,
    summary,
    market: {
      nifty: q.NIFTY || null,
      bankNifty: q.BANKNIFTY || null,
      sensex: q.SENSEX || null,
      vix: q.INDIAVIX || null,
      usdinr: q.USDINR || null,
      brent: q.BRENT || null,
      wti: q.WTI || null,
      gold: q.GOLD || null,
      dxy: q.DXY || null,
      us10y: q.US10Y || null
    },
    bankNifty: {
      quote: q.BANKNIFTY || null,
      niftyQuote: q.NIFTY || null,
      correlation: bankCorrelation,
      beta: bankBeta,
      niftyMonth,
      bankMonth,
      relativeStrength1m: rsMonth,
      dependency: bankCorrelation == null ? "Unknown" : bankCorrelation >= 0.85 ? "Very high" : bankCorrelation >= 0.7 ? "High" : bankCorrelation >= 0.5 ? "Moderate" : "Low",
      movers: bankMovers,
      note: "Bank Nifty is the high-beta domestic-cyclical index. A correlation above 0.8 means Nifty direction and Bank Nifty direction are usually the same trade; the beta tells you how much more Bank Nifty tends to move."
    },
    rupee: {
      quote: q.USDINR || null,
      trend: rupeeTrend,
      weekChange: dollarWeek,
      monthChange: dollarMonth,
      quarterChange: dollarQuarter,
      ema20: dollarEma20,
      ema50: dollarEma50,
      support: round(dollarSupport, 2),
      resistance: round(dollarResistance, 2),
      stress: dollarMonth == null ? "Unknown" : dollarMonth >= 1.5 ? "Rupee under pressure" : dollarMonth >= 0.5 ? "Rupee weakening" : dollarMonth <= -1 ? "Rupee strengthening" : dollarMonth <= -0.3 ? "Mild rupee strength" : "Stable",
      winners: ["IT exporters", "Pharma exporters", "GIFT City / dollar earners"],
      losers: ["Importers", "Aviation", "Paints", "Oil marketing companies", "Electronics"],
      note: "USD/INR up means the rupee is falling. A weaker rupee helps dollar earners and hurts import-heavy sectors; it also raises the imported cost of crude."
    },
    crude: {
      brent: q.BRENT || null,
      wti: q.WTI || null,
      weekChange: brentWeek,
      monthChange: brentMonth,
      ema20: brentEma20,
      support: round(brentSupport, 2),
      resistance: round(brentResistance, 2),
      risk: oilRisk,
      sensitivity: "Rule of thumb: a sustained $10/bbl rise in crude is roughly a $15–18 bn annual headwind for India's oil import bill. Treat this as an estimate, not a forecast.",
      winners: ["Upstream producers (ONGC, Oil India)", "Defence / energy security"],
      losers: ["Oil marketing companies", "Aviation", "Paints", "Tyres", "Consumers of crude derivatives"],
      note: "Crude is the fastest transmission channel from a war or Middle East headline into Indian inflation, the rupee and the Nifty."
    },
    war: {
      ...war,
      headlines: geoHeadlines,
      playbook: [
        "Do not chase a gap on the first headline; wait for the second candle and the crude/VIX response.",
        "Defensive order: gold and dollar strength first, crude second, equities third.",
        "If Brent and India VIX both rise, cut position size rather than averaging into weakness.",
        "Keep stop-losses wider than the headline noise only if size is reduced proportionally."
      ]
    },
    events: {
      fed: { label: "Fed & FOMC", items: compactNews(fedFeed, 4) },
      policy: { label: "India policy / GIFT City", items: compactNews({ items: policyItems }, 4), buckets: policyBuckets },
      rareEarth: {
        label: "Rare earth metals",
        note: "China's export controls can move magnets, EV, electronics and defence supply chains. In India, track strategic-metal policy and listed producers/processors; headlines are catalysts, not a recommendation.",
        items: compactNews(rareFeed, 4)
      },
      worldBank: {
        label: "World Bank & IMF",
        note: "Growth forecasts, funding costs and global trade language matter for FPI flows and the rupee. Watch the India growth commentary and any climate/energy financing announcements.",
        items: compactNews(wbFeed, 4)
      }
    },
    fed: buildFedScenarios({
      vix,
      usdinr: q.USDINR?.value,
      dxy: q.DXY?.value,
      us10y: q.US10Y?.value,
      niftyChange: q.NIFTY?.change,
      bankNiftyChange: q.BANKNIFTY?.change
    }),
    policyWatch: {
      giftCity: {
        title: "GIFT City & foreign-investor tax",
        explainer: "GIFT City / IFSC tax changes alter the cost of routing foreign capital into India. Lower taxes can support FPI flows, broking, asset management and rupee sentiment; implementation details matter more than the headline.",
        items: compactNews({ items: policyBuckets.giftCity.length ? policyBuckets.giftCity : policyItems }, 3)
      },
      rbiFinance: {
        title: "RBI Governor + Finance Minister",
        explainer: "Coordination between the RBI and the Finance Ministry matters for liquidity, the bond market and the rupee. Watch for comments on inflation, rate direction, FPI rules and G-Sec demand.",
        items: compactNews({ items: policyBuckets.rbiFinance.length ? policyBuckets.rbiFinance : policyItems }, 3)
      },
      pmTax: {
        title: "PM meeting / foreign-investor tax",
        explainer: "A policy signal on foreign-investor taxation can move banks, capital-market intermediaries and the rupee before the fine print is published. Treat political headlines as catalysts, not as trades by themselves.",
        items: compactNews({ items: policyBuckets.pmTax.length ? policyBuckets.pmTax : policyItems }, 3)
      }
    },
    disclaimer: "Macro radar is research and paper-trading context, not investment advice. News headlines are third-party and may be incomplete or delayed. Scenario impacts are tendencies, not predictions."
  };
  macroCache = { at: Date.now(), value: result };
  return result;
}
