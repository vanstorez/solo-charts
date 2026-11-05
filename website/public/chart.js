/* Solo Trading Charts — TradingView-style chart workspace built on Lightweight Charts. */

const $ = (id) => document.getElementById(id);
const IST_OFFSET = 19_800;
const COLORS = {
  cyan: "#2dd4bf",
  amber: "#fbbf24",
  purple: "#a78bfa",
  blue: "#60a5fa",
  red: "#fb7185",
  green: "#34d399",
  muted: "#8da9b8",
  faint: "#5d7b8a",
  grid: "rgba(27,53,69,0.55)",
  bg: "#081722"
};
const COMPARE_COLORS = { NIFTY: "#2dd4bf", BANKNIFTY: "#fbbf24", SENSEX: "#a78bfa", SPX: "#60a5fa", BRENT: "#fb7185" };
const INTERVALS = [
  ["5m", "5m"], ["15m", "15m"], ["30m", "30m"], ["1h", "1H"], ["1d", "1D"], ["1wk", "1W"]
];
const RANGE_SETS = {
  "5m": [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"]],
  "15m": [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"]],
  "30m": [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"]],
  "1h": [["1mo", "1M"], ["3mo", "3M"], ["6mo", "6M"], ["1y", "1Y"], ["2y", "2Y"]],
  "1d": [["1mo", "1M"], ["3mo", "3M"], ["6mo", "6M"], ["1y", "1Y"], ["5y", "5Y"], ["10y", "10Y"], ["max", "MAX"]],
  "1wk": [["1y", "1Y"], ["5y", "5Y"], ["10y", "10Y"], ["max", "MAX"]]
};
const DEFAULT_RANGES = { "5m": "5d", "15m": "5d", "30m": "5d", "1h": "1mo", "1d": "1y", "1wk": "5y" };

const state = {
  symbol: "NIFTY",
  symbolName: "Nifty 50",
  interval: "1d",
  range: "1y",
  chartType: "candles",
  subIndicator: "rsi",
  indicators: { ema9: false, ema20: true, ema50: true, ema100: false, ema200: false, sma20: false, sma50: false, sma200: false, bb: false, donchian: false, keltner: false, vwap: false, supertrend: false, psar: false, volume: true },
  compare: [],
  compareData: new Map(),
  data: null,
  bars: [],
  barMap: new Map(),
  tool: "cursor",
  draft: null,
  drawings: [],
  alerts: [],
  chart: null,
  mainSeries: null,
  overlays: [],
  volumeSeries: null,
  subChart: null,
  subSeries: [],
  subSyncing: false,
  active: false,
  loaded: false,
  loading: false,
  pendingReload: false,
  watchlist: [],
  watchlistTimer: null,
  searchTimer: null,
  lastPrice: null,
  crosshairBar: null,
  smc: { structure: true, orderBlocks: true, fvg: true, breakers: true, probability: true, swings: false },
  smcData: null,
  lastLoadedAt: 0,
  lastLoadAttemptAt: 0,
  liveTimer: null,
  liveNewsTimer: null,
  liveNewsRotateTimer: null,
  liveNews: null,
  liveNewsCategory: "global",
  liveNewsIndex: 0,
  liveNewsLoading: false
};

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPct(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function cls(value) {
  if (value == null || !Number.isFinite(Number(value))) return "flat";
  return Number(value) > 0 ? "up" : Number(value) < 0 ? "down" : "flat";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(message, ok = false) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("ok", ok);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3800);
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

function toLwTime(ms) {
  return Math.floor(Number(ms) / 1000) + IST_OFFSET;
}

function fromLwTime(sec) {
  return (Number(sec) - IST_OFFSET) * 1000;
}

function formatAxisTime(sec, interval) {
  const d = new Date(Number(sec) * 1000);
  if (!Number.isFinite(d.getTime())) return "";
  if (interval === "5m" || interval === "15m" || interval === "30m" || interval === "1h") {
    return d.toLocaleTimeString("en-IN", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (interval === "1wk") {
    return d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short" });
}

function formatFullTime(sec, interval) {
  const d = new Date(Number(sec) * 1000);
  if (interval === "1d" || interval === "1wk") {
    return d.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }
  return d.toLocaleString("en-IN", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev == null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= period) acc -= values[i - period];
    if (i >= period - 1) out[i] = acc / period;
  }
  return out;
}

function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    out[i] = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = Math.max(diff, 0);
    const down = Math.max(-diff, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
      if (i === period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null));
  const nonNull = line.filter((v) => v != null);
  const sig = ema(nonNull, 9);
  const signal = new Array(values.length).fill(null);
  const offset = values.length - nonNull.length;
  for (let i = 0; i < nonNull.length; i++) signal[i + offset] = sig[i];
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

function trueRange(bars) {
  return bars.map((bar, i) => {
    if (i === 0) return bar.h - bar.l;
    const prev = bars[i - 1];
    return Math.max(bar.h - bar.l, Math.abs(bar.h - prev.c), Math.abs(bar.l - prev.c));
  });
}

function atr(bars, period = 14) {
  const tr = trueRange(bars);
  const out = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  let prev = tr.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  const k = new Array(bars.length).fill(null);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map((bar) => bar.h));
    const low = Math.min(...slice.map((bar) => bar.l));
    k[i] = high === low ? 50 : ((bars[i].c - low) / (high - low)) * 100;
  }
  const nonNull = k.filter((value) => value != null);
  const d = sma(nonNull, dPeriod);
  const dAligned = new Array(bars.length).fill(null);
  const offset = bars.length - nonNull.length;
  for (let i = 0; i < d.length; i++) dAligned[i + offset] = d[i];
  return { k, d: dAligned };
}

function adx(bars, period = 14) {
  const plusDM = new Array(bars.length).fill(0);
  const minusDM = new Array(bars.length).fill(0);
  const tr = trueRange(bars);
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const smooth = (values) => {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let sum = values.slice(1, period + 1).reduce((acc, value) => acc + value, 0);
    out[period] = sum;
    for (let i = period + 1; i < values.length; i++) {
      sum = sum - sum / period + values[i];
      out[i] = sum;
    }
    return out;
  };
  const trSmooth = smooth(tr);
  const plusSmooth = smooth(plusDM);
  const minusSmooth = smooth(minusDM);
  const plusDI = new Array(bars.length).fill(null);
  const minusDI = new Array(bars.length).fill(null);
  const dx = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (trSmooth[i]) {
      plusDI[i] = (plusSmooth[i] / trSmooth[i]) * 100;
      minusDI[i] = (minusSmooth[i] / trSmooth[i]) * 100;
      const sum = plusDI[i] + minusDI[i];
      dx[i] = sum ? (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100 : 0;
    }
  }
  const adxValues = new Array(bars.length).fill(null);
  const first = dx.findIndex((value) => value != null);
  if (first >= 0 && first + period < bars.length) {
    let value = dx.slice(first, first + period).reduce((sum, item) => sum + item, 0) / period;
    adxValues[first + period - 1] = value;
    for (let i = first + period; i < bars.length; i++) {
      if (dx[i] == null) continue;
      value = (value * (period - 1) + dx[i]) / period;
      adxValues[i] = value;
    }
  }
  return { adx: adxValues, plusDI, minusDI };
}

function obv(bars) {
  const out = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const volume = bars[i].v || 0;
    out[i] = out[i - 1] + (bars[i].c > bars[i - 1].c ? volume : bars[i].c < bars[i - 1].c ? -volume : 0);
  }
  return out;
}

function supertrend(bars, period = 10, multiplier = 3) {
  const atrValues = atr(bars, period);
  const out = [];
  let finalUpper = null;
  let finalLower = null;
  let trend = 1;
  for (let i = 0; i < bars.length; i++) {
    if (atrValues[i] == null) {
      out.push({ value: null, trend: 1 });
      continue;
    }
    const mid = (bars[i].h + bars[i].l) / 2;
    let upper = mid + multiplier * atrValues[i];
    let lower = mid - multiplier * atrValues[i];
    if (i > 0 && finalUpper != null && bars[i - 1].c <= finalUpper) upper = Math.min(upper, finalUpper);
    if (i > 0 && finalLower != null && bars[i - 1].c >= finalLower) lower = Math.max(lower, finalLower);
    if (i > 0) {
      if (trend === 1 && bars[i].c < finalLower) trend = -1;
      else if (trend === -1 && bars[i].c > finalUpper) trend = 1;
    }
    finalUpper = upper;
    finalLower = lower;
    out.push({ value: trend === 1 ? lower : upper, trend });
  }
  return out;
}

function psar(bars, step = 0.02, max = 0.2) {
  const out = new Array(bars.length).fill(null);
  if (!bars.length) return out;
  let up = true;
  let sar = bars[0].l;
  let ep = bars[0].h;
  let af = step;
  out[0] = sar;
  for (let i = 1; i < bars.length; i++) {
    sar += af * (ep - sar);
    if (up) {
      if (bars[i].l < sar) {
        up = false;
        sar = ep;
        ep = bars[i].l;
        af = step;
      } else if (bars[i].h > ep) {
        ep = bars[i].h;
        af = Math.min(max, af + step);
      }
    } else if (bars[i].h > sar) {
      up = true;
      sar = ep;
      ep = bars[i].h;
      af = step;
    } else if (bars[i].l < ep) {
      ep = bars[i].l;
      af = Math.min(max, af + step);
    }
    out[i] = sar;
  }
  return out;
}

function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.o + b.h + b.l + b.c) / 4;
    const open = i === 0 ? (b.o + b.c) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: toLwTime(b.t),
      open,
      high: Math.max(b.h, open, close),
      low: Math.min(b.l, open, close),
      close
    });
  }
  return out;
}

function vwapSeries(bars, interval) {
  if (!["5m", "15m", "30m", "1h"].includes(interval)) return [];
  const out = [];
  let day = null;
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const key = new Date(b.t + IST_OFFSET * 1000).toISOString().slice(0, 10);
    if (key !== day) {
      day = key;
      pv = 0;
      vol = 0;
    }
    const typical = (b.h + b.l + b.c) / 3;
    const v = b.v || 1;
    pv += typical * v;
    vol += v;
    out.push({ time: toLwTime(b.t), value: pv / vol });
  }
  return out;
}

/* ---------------------------- smart money model -------------------------- */

function findSwingPivots(bars, look) {
  const pivots = [];
  for (let i = look; i < bars.length - look; i++) {
    const bar = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - look; j <= i + look; j++) {
      if (j === i) continue;
      if (bars[j].h >= bar.h) isHigh = false;
      if (bars[j].l <= bar.l) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: bar.t, price: bar.h, type: "H" });
    else if (isLow) pivots.push({ index: i, time: bar.t, price: bar.l, type: "L" });
  }
  let lastHigh = null;
  let lastLow = null;
  for (const pivot of pivots) {
    if (pivot.type === "H") {
      pivot.label = lastHigh == null ? "H" : pivot.price > lastHigh ? "HH" : "LH";
      lastHigh = pivot.price;
    } else {
      pivot.label = lastLow == null ? "L" : pivot.price > lastLow ? "HL" : "LL";
      lastLow = pivot.price;
    }
  }
  return pivots;
}

function makeOrderBlock(bars, breakIndex, dir, pivotIndex) {
  const start = Math.max(0, breakIndex - 16);
  for (let j = breakIndex - 1; j >= start; j--) {
    const bar = bars[j];
    if (dir === "bull" && bar.c < bar.o) {
      return { type: "bull", top: bar.h, bottom: bar.l, startIndex: j, pivotIndex, createdIndex: breakIndex, failedIndex: null, endIndex: bars.length - 1 };
    }
    if (dir === "bear" && bar.c > bar.o) {
      return { type: "bear", top: bar.h, bottom: bar.l, startIndex: j, pivotIndex, createdIndex: breakIndex, failedIndex: null, endIndex: bars.length - 1 };
    }
  }
  return null;
}

function computeFvgs(bars) {
  const gaps = [];
  const minGap = (bar) => Math.max(0.02, Math.abs(bar.c) * 0.00012);
  for (let i = 2; i < bars.length; i++) {
    const left = bars[i - 2];
    const right = bars[i];
    if (right.l > left.h && right.l - left.h > minGap(right)) {
      gaps.push({ type: "bull", top: right.l, bottom: left.h, startIndex: i - 2, createdIndex: i, filledIndex: null });
    } else if (left.l > right.h && left.l - right.h > minGap(right)) {
      gaps.push({ type: "bear", top: left.l, bottom: right.h, startIndex: i - 2, createdIndex: i, filledIndex: null });
    }
  }
  for (const gap of gaps) {
    for (let j = gap.createdIndex + 1; j < bars.length; j++) {
      const bar = bars[j];
      if (gap.type === "bull" && bar.l <= gap.bottom) {
        gap.filledIndex = j;
        break;
      }
      if (gap.type === "bear" && bar.h >= gap.top) {
        gap.filledIndex = j;
        break;
      }
    }
    if (gap.filledIndex != null && gap.filledIndex <= gap.createdIndex + 2) gap.hidden = true;
  }
  return gaps.filter((gap) => !gap.hidden).slice(-9);
}

function computeSmartMoney(bars, interval) {
  const result = {
    pivots: [],
    structure: [],
    orderBlocks: [],
    fvgs: [],
    breakers: [],
    signals: [],
    trend: "range",
    probability: null
  };
  if (!bars || bars.length < 40) return result;

  const look = ["5m", "15m", "30m", "1h"].includes(interval) ? 3 : 4;
  const pivots = findSwingPivots(bars, look);
  result.pivots = pivots;
  const pivotByIndex = new Map(pivots.map((pivot) => [pivot.index, pivot]));
  let lastHigh = null;
  let lastLow = null;
  let trend = "range";
  const structure = [];
  const orderBlocks = [];

  for (let i = look; i < bars.length; i++) {
    const confirmed = pivotByIndex.get(i - look);
    if (confirmed) {
      if (confirmed.type === "H") lastHigh = { ...confirmed, broken: bars[i].c > confirmed.price };
      else lastLow = { ...confirmed, broken: bars[i].c < confirmed.price };
    }
    const bar = bars[i];
    if (lastHigh && !lastHigh.broken && bar.c > lastHigh.price) {
      const event = {
        index: i,
        fromIndex: lastHigh.index,
        price: lastHigh.price,
        dir: "bull",
        type: trend === "bear" ? "CHoCH" : "BOS",
        swingLabel: lastHigh.label
      };
      structure.push(event);
      lastHigh.broken = true;
      trend = "bull";
      const ob = makeOrderBlock(bars, i, "bull", lastHigh.index);
      if (ob && !orderBlocks.some((item) => item.type === ob.type && item.startIndex === ob.startIndex)) orderBlocks.push(ob);
    }
    if (lastLow && !lastLow.broken && bar.c < lastLow.price) {
      const event = {
        index: i,
        fromIndex: lastLow.index,
        price: lastLow.price,
        dir: "bear",
        type: trend === "bull" ? "CHoCH" : "BOS",
        swingLabel: lastLow.label
      };
      structure.push(event);
      lastLow.broken = true;
      trend = "bear";
      const ob = makeOrderBlock(bars, i, "bear", lastLow.index);
      if (ob && !orderBlocks.some((item) => item.type === ob.type && item.startIndex === ob.startIndex)) orderBlocks.push(ob);
    }
  }

  const breakers = [];
  const signals = [];
  for (const ob of orderBlocks) {
    for (let j = ob.createdIndex + 1; j < bars.length; j++) {
      const bar = bars[j];
      if (ob.type === "bull" && bar.c < ob.bottom) {
        ob.failedIndex = j;
        break;
      }
      if (ob.type === "bear" && bar.c > ob.top) {
        ob.failedIndex = j;
        break;
      }
    }
    if (ob.failedIndex != null) {
      ob.endIndex = ob.failedIndex;
      const breaker = {
        type: ob.type === "bull" ? "bear" : "bull",
        top: ob.top,
        bottom: ob.bottom,
        startIndex: ob.startIndex,
        failedIndex: ob.failedIndex,
        signalIndex: null,
        endIndex: bars.length - 1
      };
      for (let j = ob.failedIndex + 1; j < bars.length; j++) {
        const bar = bars[j];
        if (breaker.type === "bull" && bar.l <= breaker.top && bar.c > breaker.top && bar.c > bar.o) {
          breaker.signalIndex = j;
          break;
        }
        if (breaker.type === "bear" && bar.h >= breaker.bottom && bar.c < breaker.bottom && bar.c < bar.o) {
          breaker.signalIndex = j;
          break;
        }
      }
      breakers.push(breaker);
      if (breaker.signalIndex != null) {
        signals.push({
          index: breaker.signalIndex,
          dir: breaker.type,
          price: breaker.type === "bull" ? breaker.top : breaker.bottom,
          label: breaker.type === "bull" ? "BREAKER BUY" : "BREAKER SELL"
        });
      }
    }
  }

  const fvgs = computeFvgs(bars);
  signals.sort((a, b) => a.index - b.index);
  result.pivots = pivots;
  result.structure = structure.slice(-10);
  result.orderBlocks = orderBlocks.slice(-10);
  result.fvgs = fvgs;
  result.breakers = breakers.slice(-6);
  result.signals = signals.slice(-5);
  result.trend = trend;

  const price = bars.at(-1).c;
  const closes = bars.map((bar) => bar.c);
  const ema20 = ema(closes, 20).at(-1);
  const ema50 = ema(closes, 50).at(-1);
  const rsi14 = rsi(closes, 14).at(-1);
  const atr14 = atr(bars, 14).at(-1) || price * 0.01;
  const lastEvent = structure.at(-1) || null;
  const eventAge = lastEvent ? bars.length - 1 - lastEvent.index : null;
  const lastSignal = signals.at(-1) || null;
  const lastPivotHigh = [...pivots].reverse().find((pivot) => pivot.type === "H");
  const lastPivotLow = [...pivots].reverse().find((pivot) => pivot.type === "L");

  const activeObs = orderBlocks.filter((ob) => ob.failedIndex == null);
  let demand = null;
  let supply = null;
  for (const ob of activeObs) {
    if (ob.type === "bull" && ob.bottom <= price && (!demand || ob.top > demand.top)) demand = ob;
    if (ob.type === "bear" && ob.top >= price && (!supply || ob.bottom < supply.bottom)) supply = ob;
  }

  let score = 0;
  const reasons = [];
  const addReason = (text, dir) => reasons.push({ text, dir: dir > 0 ? "up" : dir < 0 ? "down" : "" });
  if (trend === "bull") {
    score += 18;
    addReason("Structure trend bullish", 1);
  } else if (trend === "bear") {
    score -= 18;
    addReason("Structure trend bearish", -1);
  }
  if (lastEvent && eventAge != null && eventAge <= 25) {
    const weight = lastEvent.type === "CHoCH" ? 13 : 10;
    const dir = lastEvent.dir === "bull" ? 1 : -1;
    score += dir * weight;
    addReason(`${lastEvent.type} ${lastEvent.dir === "bull" ? "up" : "down"} @ ${fmt(lastEvent.price)}`, dir);
  }
  if (ema20 != null) {
    const dir = price > ema20 ? 1 : -1;
    score += dir * 5;
    addReason(`Price ${dir > 0 ? "above" : "below"} EMA20`, dir);
  }
  if (ema50 != null) {
    const dir = price > ema50 ? 1 : -1;
    score += dir * 5;
    addReason(`Price ${dir > 0 ? "above" : "below"} EMA50`, dir);
  }
  if (rsi14 != null) {
    if (rsi14 > 55) {
      score += 4;
      addReason(`RSI ${rsi14.toFixed(1)} momentum`, 1);
    } else if (rsi14 < 45) {
      score -= 4;
      addReason(`RSI ${rsi14.toFixed(1)} weak`, -1);
    }
    if (rsi14 > 72) {
      score -= 4;
      addReason("RSI overbought", -1);
    } else if (rsi14 < 28) {
      score += 4;
      addReason("RSI oversold", 1);
    }
  }
  if (demand && price - demand.top <= atr14 * 1.5) {
    score += 5;
    addReason(`Demand OB ${fmt(demand.top)}`, 1);
  }
  if (supply && supply.bottom - price <= atr14 * 1.5) {
    score -= 5;
    addReason(`Supply OB ${fmt(supply.bottom)}`, -1);
  }
  const activeFvgs = fvgs.filter((gap) => gap.filledIndex == null);
  if (activeFvgs.some((gap) => gap.type === "bull" && gap.top <= price + atr14 && gap.bottom <= price)) {
    score += 3;
    addReason("Bullish FVG support", 1);
  }
  if (activeFvgs.some((gap) => gap.type === "bear" && gap.bottom >= price - atr14 && gap.top >= price)) {
    score -= 3;
    addReason("Bearish FVG resistance", -1);
  }
  if (lastSignal && bars.length - 1 - lastSignal.index <= 8) {
    const dir = lastSignal.dir === "bull" ? 1 : -1;
    score += dir * 7;
    addReason(lastSignal.label, dir);
  }
  const recentBars = bars.slice(-21);
  const avgVolume = recentBars.reduce((sum, bar) => sum + (bar.v || 0), 0) / Math.max(1, recentBars.length);
  const volumeRatio = avgVolume > 0 ? (bars.at(-1).v || 0) / avgVolume : 1;
  if (volumeRatio > 1.35) {
    const dir = bars.at(-1).c >= bars.at(-1).o ? 1 : -1;
    score += dir * 4;
    addReason(`Volume ${volumeRatio.toFixed(1)}x`, dir);
  }
  score = Math.max(-60, Math.min(60, score));

  const neutral = Math.max(0, Math.round(24 - Math.abs(score) * 0.35));
  const bullShare = Math.max(4, Math.min(96, 50 + score * 0.85));
  const directional = 100 - neutral;
  const bull = Math.round((directional * bullShare) / 100);
  const bear = directional - bull;
  const bias = score >= 10 ? "Bullish" : score <= -10 ? "Bearish" : "Neutral";
  const confidence = Math.round(Math.min(94, 35 + Math.abs(score) * 1.1 + (eventAge != null && eventAge <= 5 ? 6 : 0)));

  let invalidation = null;
  let target = null;
  if (bias === "Bullish") {
    const lows = [lastPivotLow?.price, demand?.bottom].filter((value) => Number.isFinite(value) && value < price);
    invalidation = lows.length ? Math.max(...lows) : price - atr14 * 1.5;
    const highs = [lastPivotHigh?.price, supply?.bottom].filter((value) => Number.isFinite(value) && value > price);
    target = highs.length ? Math.min(...highs) : price + atr14 * 1.5;
  } else if (bias === "Bearish") {
    const highs = [lastPivotHigh?.price, supply?.top].filter((value) => Number.isFinite(value) && value > price);
    invalidation = highs.length ? Math.min(...highs) : price + atr14 * 1.5;
    const lows = [lastPivotLow?.price, demand?.top].filter((value) => Number.isFinite(value) && value < price);
    target = lows.length ? Math.max(...lows) : price - atr14 * 1.5;
  } else {
    invalidation = lastPivotLow?.price ?? price - atr14 * 1.5;
    target = lastPivotHigh?.price ?? price + atr14 * 1.5;
  }

  result.probability = {
    score,
    bias,
    bull,
    bear,
    neutral,
    confidence,
    reasons: reasons.slice(0, 6),
    activeFvgs: activeFvgs.length,
    breakerSignals: signals.length,
    lastEvent,
    eventAge,
    ema20,
    ema50,
    rsi14,
    atr14,
    demand,
    supply,
    invalidation,
    target,
    structureLabel: trend === "bull" ? "Bullish" : trend === "bear" ? "Bearish" : "Range"
  };
  return result;
}

function chartOptions(width, height, interval) {
  const intraday = ["5m", "15m", "30m", "1h"].includes(interval);
  return {
    width,
    height,
    layout: {
      background: { type: LightweightCharts.ColorType?.Solid || "solid", color: COLORS.bg },
      textColor: COLORS.muted,
      fontFamily: "Cascadia Code, JetBrains Mono, monospace",
      fontSize: 10
    },
    grid: {
      vertLines: { color: COLORS.grid },
      horzLines: { color: COLORS.grid }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode?.Normal ?? 0,
      vertLine: { color: "#6f8fa0", width: 1, style: 2, labelBackgroundColor: "#132b3a" },
      horzLine: { color: "#6f8fa0", width: 1, style: 2, labelBackgroundColor: "#132b3a" }
    },
    rightPriceScale: { borderColor: "#1b3545", scaleMargins: { top: 0.08, bottom: 0.07 } },
    timeScale: {
      borderColor: "#1b3545",
      timeVisible: intraday,
      secondsVisible: false,
      rightOffset: 5,
      barSpacing: intraday ? 7 : 8,
      lockVisibleTimeRangeOnResize: true
    },
    localization: { timeFormatter: (time) => formatAxisTime(time, interval) },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
  };
}

function subChartOptions(width, height) {
  return {
    width,
    height,
    layout: {
      background: { type: LightweightCharts.ColorType?.Solid || "solid", color: COLORS.bg },
      textColor: COLORS.faint,
      fontFamily: "Cascadia Code, JetBrains Mono, monospace",
      fontSize: 9
    },
    grid: {
      vertLines: { color: "rgba(27,53,69,0.35)" },
      horzLines: { color: "rgba(27,53,69,0.55)" }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode?.Normal ?? 0,
      vertLine: { color: "#6f8fa0", width: 1, style: 2, labelBackgroundColor: "#132b3a" },
      horzLine: { color: "#6f8fa0", width: 1, style: 2, labelBackgroundColor: "#132b3a" }
    },
    rightPriceScale: { borderColor: "#1b3545", scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { visible: false, borderVisible: false, rightOffset: 5 },
    localization: { timeFormatter: (time) => formatAxisTime(time, state.interval) },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
  };
}

/* ------------------------------- lifecycle ------------------------------- */

export function initCharts() {
  if (typeof LightweightCharts === "undefined") {
    console.error("Lightweight Charts failed to load.");
    const loading = $("chartLoading");
    if (loading) {
      loading.textContent = "Chart engine failed to load. Refresh the page.";
      loading.classList.add("show");
    }
    return { activate() {}, refresh() {} };
  }

  state.alerts = loadAlerts();
  bindChartEvents();
  renderIntervals();
  renderRanges();
  renderTypes();
  renderTool();
  renderAlerts();
  renderSmcControls();
  renderChartNewsTabs();
  loadWatchlist();
  startWatchlistTimer();
  startChartLiveTimers();

  const resizeObserver = new ResizeObserver(() => {
    if (!state.active) return;
    resizeCharts();
    drawOverlay();
  });
  const stage = $("chartStage");
  const subPanel = $("subChartPanel");
  if (stage) resizeObserver.observe(stage);
  if (subPanel) resizeObserver.observe(subPanel);
  window.addEventListener("resize", () => {
    if (!state.active) return;
    resizeCharts();
    drawOverlay();
  });

  return {
    activate() {
      state.active = true;
      startChartLiveTimers();
      if (!state.liveNews) loadChartNews();
      else renderChartNews();
      if (!state.loaded) {
        loadChart({ reset: true });
      } else {
        requestAnimationFrame(() => {
          ensureChart();
          resizeCharts();
          if (state.chart) rebuildMain();
          rebuildSub();
          drawOverlay();
          renderSmcDesk();
        });
      }
    },
    deactivate() {
      state.active = false;
    },
    refresh() {
      loadChart({ reset: false });
      loadWatchlist();
      loadChartNews(true);
    },
    open(symbol) {
      state.active = true;
      startChartLiveTimers();
      if (!state.liveNews) loadChartNews();
      selectSymbol(symbol);
    }
  };
}

function startWatchlistTimer() {
  clearInterval(state.watchlistTimer);
  state.watchlistTimer = setInterval(() => {
    if (!state.active || document.visibilityState !== "visible") return;
    loadWatchlist({ silent: true });
    if (state.lastPrice != null) checkAlerts(state.lastPrice);
  }, 15_000);
}

function startChartLiveTimers() {
  clearInterval(state.liveTimer);
  clearInterval(state.liveNewsTimer);
  clearInterval(state.liveNewsRotateTimer);
  state.liveTimer = setInterval(() => {
    if (!state.active || document.visibilityState !== "visible" || state.loading || state.tool !== "cursor") return;
    const threshold = isIntraday() ? 30_000 : 180_000;
    const lastAttempt = Math.max(state.lastLoadedAt || 0, state.lastLoadAttemptAt || 0);
    if (Date.now() - lastAttempt >= threshold) loadChart({ reset: false, silent: true });
  }, 15_000);
  state.liveNewsTimer = setInterval(() => {
    if (!state.active || document.visibilityState !== "visible") return;
    loadChartNews(true);
  }, 60_000);
  state.liveNewsRotateTimer = setInterval(() => {
    if (state.active) rotateLiveHeadline();
  }, 7_000);
}

/* -------------------------------- bindings ------------------------------- */

function bindChartEvents() {
  $("chartAiBtn")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("solo:open-ai", { detail: { symbol: state.symbol } }));
  });
  $("chartIntervals")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-interval]");
    if (!btn) return;
    const interval = btn.dataset.interval;
    if (interval === state.interval) return;
    state.interval = interval;
    state.range = DEFAULT_RANGES[interval] || "1y";
    state.loaded = false;
    state.smcData = null;
    state.compareData.clear();
    renderIntervals();
    loadChart({ reset: true });
  });

  $("chartRanges")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-range]");
    if (!btn) return;
    const range = btn.dataset.range;
    if (range === state.range) return;
    state.range = range;
    state.smcData = null;
    state.compareData.clear();
    renderRanges();
    loadChart({ reset: true });
  });

  $("chartTypes")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-chart-type]");
    if (!btn) return;
    state.chartType = btn.dataset.chartType;
    renderTypes();
    rebuildMain();
    drawOverlay();
  });

  $("chartRefresh")?.addEventListener("click", () => {
    loadChart({ reset: false });
    loadWatchlist();
    toast("Chart and watchlist refreshed.");
  });

  $("chartTvLink")?.addEventListener("click", (event) => {
    if (!state.data?.meta?.tvLink) event.preventDefault();
  });

  $("chartScreenshot")?.addEventListener("click", downloadScreenshot);
  $("chartFullscreen")?.addEventListener("click", toggleFullscreen);

  $("drawToolBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover("drawMenu");
  });
  $("indicatorBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover("indicatorMenu");
  });
  $("compareBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover("compareMenu");
  });
  $("alertBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover("alertMenu");
    renderAlerts();
  });
  $("smcBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePopover("smcMenu");
  });

  $("smcMenu")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-smc]");
    if (!input) return;
    state.smc[input.dataset.smc] = input.checked;
    renderSmcControls();
    drawOverlay();
    renderSmcDesk();
    renderLegend();
  });

  $("smcMenu")?.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-smc-preset]");
    if (!preset) return;
    const mode = preset.dataset.smcPreset;
    if (mode === "off") {
      Object.keys(state.smc).forEach((key) => (state.smc[key] = false));
    } else if (mode === "structure") {
      Object.keys(state.smc).forEach((key) => (state.smc[key] = key === "structure" || key === "swings"));
    } else {
      Object.keys(state.smc).forEach((key) => (state.smc[key] = true));
    }
    renderSmcControls();
    drawOverlay();
    renderSmcDesk();
    renderLegend();
  });

  $("chartNewsTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-news-category]");
    if (!button) return;
    state.liveNewsCategory = button.dataset.newsCategory;
    state.liveNewsIndex = 0;
    state.liveNews = null;
    renderChartNewsTabs();
    renderChartNews();
    loadChartNews(true);
  });

  $("drawMenu")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-draw]");
    if (!btn) return;
    const tool = btn.dataset.draw;
    if (tool === "clear") {
      state.drawings = [];
      state.draft = null;
      saveDrawings();
      drawOverlay();
      toast("Drawings cleared.");
      return;
    }
    state.tool = tool;
    state.draft = null;
    renderTool();
    closePopovers();
    if (tool !== "cursor") toast(tool === "hline" ? "Click the chart to place a horizontal line." : "Click twice on the chart to draw.");
    drawOverlay();
  });

  $("indicatorMenu")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-indicator]");
    if (!input) return;
    state.indicators[input.dataset.indicator] = input.checked;
    rebuildMain();
    drawOverlay();
  });

  $("subIndicator")?.addEventListener("change", (event) => {
    state.subIndicator = event.target.value;
    rebuildSub();
  });

  $("compareMenu")?.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-compare]");
    if (!input) return;
    const symbol = input.dataset.compare;
    if (input.checked) {
      if (!state.compare.includes(symbol)) state.compare.push(symbol);
    } else {
      state.compare = state.compare.filter((s) => s !== symbol);
    }
    await hydrateCompare();
    rebuildMain();
    drawOverlay();
    renderSmcDesk();
  });

  $("clearCompare")?.addEventListener("click", () => {
    state.compare = [];
    document.querySelectorAll("[data-compare]").forEach((input) => (input.checked = false));
    rebuildMain();
    drawOverlay();
    renderSmcDesk();
  });

  $("addAlert")?.addEventListener("click", addAlert);
  $("alertPrice")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addAlert();
  });
  $("alertList")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-alert]");
    if (!btn) return;
    state.alerts = state.alerts.filter((alert) => alert.id !== btn.dataset.removeAlert);
    saveAlerts();
    renderAlerts();
  });

  $("watchlist")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-symbol]");
    if (!row) return;
    selectSymbol(row.dataset.symbol);
  });

  $("symbolSearch")?.addEventListener("input", onSearchInput);
  $("symbolSearch")?.addEventListener("focus", () => {
    if ($("symbolSearch").value.trim()) onSearchInput();
  });
  $("searchResults")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-symbol]");
    if (!row) return;
    selectSymbol(row.dataset.symbol);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".popover") || event.target.closest("#drawToolBtn, #indicatorBtn, #compareBtn, #alertBtn, #smcBtn")) return;
    closePopovers();
    if (!event.target.closest(".symbol-search")) hideSearch();
  });

  $("drawCanvas")?.addEventListener("click", onOverlayClick);
  $("drawCanvas")?.addEventListener("pointermove", onOverlayMove);
  $("drawCanvas")?.addEventListener("pointerleave", () => {
    if (!state.draft) drawOverlay();
  });

  document.addEventListener("keydown", (event) => {
    if (!state.active) return;
    if (event.key === "Escape") {
      state.draft = null;
      state.tool = "cursor";
      renderTool();
      closePopovers();
      drawOverlay();
    }
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "+" || event.key === "=") {
      const range = state.chart?.timeScale().getVisibleLogicalRange();
      if (range) {
        const mid = (range.from + range.to) / 2;
        const half = Math.max(8, (range.to - range.from) / 2 / 1.25);
        state.chart.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half });
      }
    }
    if (event.key === "-") {
      const range = state.chart?.timeScale().getVisibleLogicalRange();
      if (range) {
        const mid = (range.from + range.to) / 2;
        const half = Math.min(state.bars.length, (range.to - range.from) / 2 * 1.25);
        state.chart.timeScale().setVisibleLogicalRange({ from: mid - half, to: mid + half });
      }
    }
  });

  document.addEventListener("fullscreenchange", () => {
    setTimeout(() => {
      resizeCharts();
      drawOverlay();
    }, 80);
  });
}

function togglePopover(id) {
  const popover = $(id);
  if (!popover) return;
  const isOpen = popover.classList.contains("show");
  closePopovers();
  if (!isOpen) popover.classList.add("show");
}

function closePopovers() {
  document.querySelectorAll(".popover").forEach((popover) => popover.classList.remove("show"));
}

function toggleFullscreen() {
  const workspace = document.querySelector(".chart-workspace");
  if (!document.fullscreenElement) {
    workspace?.requestFullscreen?.().catch(() => toast("Fullscreen is not available."));
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

/* ------------------------------- toolbar ui ------------------------------ */

function renderIntervals() {
  const host = $("chartIntervals");
  if (!host) return;
  host.innerHTML = INTERVALS.map(([value, label]) => `<button class="chart-tab ${state.interval === value ? "active" : ""}" data-interval="${value}">${label}</button>`).join("");
}

function renderRanges() {
  const host = $("chartRanges");
  if (!host) return;
  const ranges = RANGE_SETS[state.interval] || RANGE_SETS["1d"];
  host.innerHTML = ranges.map(([value, label]) => `<button class="chart-tab ${state.range === value ? "active" : ""}" data-range="${value}">${label}</button>`).join("");
}

function renderTypes() {
  const host = $("chartTypes");
  if (!host) return;
  const types = [["candles", "Candles"], ["ha", "HA"], ["line", "Line"], ["area", "Area"]];
  host.innerHTML = types.map(([value, label]) => `<button class="chart-tab ${state.chartType === value ? "active" : ""}" data-chart-type="${value}">${label}</button>`).join("");
}

function renderTool() {
  const stage = $("chartStage");
  if (stage) stage.classList.toggle("drawing-active", state.tool !== "cursor");
  document.querySelectorAll("[data-draw]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.draw === state.tool);
  });
  $("drawToolBtn")?.classList.toggle("active", state.tool !== "cursor");
}

/* ------------------------------- data load ------------------------------- */

async function loadChart({ reset = true, silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.lastLoadAttemptAt = Date.now();
  showLoading(!silent);
  const previousPrice = state.lastPrice;
  const request = { symbol: state.symbol, interval: state.interval, range: state.range };
  try {
    const query = new URLSearchParams(request);
    const data = await api(`/api/chart?${query}`);
    if (request.symbol !== state.symbol || request.interval !== state.interval || request.range !== state.range) {
      state.pendingReload = true;
      return;
    }
    state.data = data;
    state.symbol = data.symbol;
    state.symbolName = data.name;
    state.interval = data.interval;
    state.range = data.range;
    state.bars = data.bars || [];
    state.barMap = new Map();
    state.bars.forEach((bar, index) => state.barMap.set(toLwTime(bar.t), { bar, index }));
    state.lastPrice = data.quote?.last ?? data.meta?.regularMarketPrice ?? state.bars.at(-1)?.c ?? null;
    state.smcData = computeSmartMoney(state.bars, state.interval);
    state.lastLoadedAt = Date.now();
    state.fitNext = reset || !state.loaded;
    state.loaded = true;
    state.drawings = loadDrawings();
    state.draft = null;
    updateHeader();
    renderIntervals();
    renderRanges();
    renderTypes();
    ensureChart();
    if (state.chart) {
      rebuildMain();
      rebuildSub();
    }
    renderInfo();
    renderSmcDesk();
    renderLegend();
    updateLiveStamp();
    checkAlerts(state.lastPrice, previousPrice);
    if (state.compare.length) {
      await hydrateCompare();
      rebuildMain();
      drawOverlay();
    }
  } catch (error) {
    if (silent) console.warn("Chart refresh skipped:", error.message);
    else console.error(error);
    if (!silent) toast(error.message || "Could not load chart.");
    if (!state.data) {
      const legend = $("chartLegend");
      if (legend) legend.innerHTML = `<span class="legend-symbol">Chart unavailable</span>`;
    }
  } finally {
    state.loading = false;
    showLoading(false);
    if (state.pendingReload) {
      state.pendingReload = false;
      loadChart({ reset: true, silent: true });
    }
  }
}

function showLoading(show) {
  const el = $("chartLoading");
  if (el) el.classList.toggle("show", !!show);
}

function updateHeader() {
  const data = state.data;
  if (!data) return;
  const quote = data.quote || {};
  const last = quote.last ?? data.meta?.regularMarketPrice ?? state.bars.at(-1)?.c;
  const change = quote.changePct;
  const nameEl = $("chartName");
  const metaEl = $("chartMeta");
  const markEl = $("chartMark");
  const lastEl = $("chartLast");
  const changeEl = $("chartChange");
  const link = $("chartTvLink");
  if (nameEl) nameEl.textContent = data.name;
  if (metaEl) {
    const type = data.type === "index" ? "INDEX" : data.type === "stock" ? "NSE STOCK" : String(data.type || "GLOBAL").toUpperCase();
    metaEl.textContent = `${data.exchange} · ${type} · ${state.interval.toUpperCase()} · ${state.range.toUpperCase()}`;
  }
  if (markEl) markEl.textContent = String(data.name || "S").slice(0, 1).toUpperCase();
  if (lastEl) lastEl.textContent = fmt(last, last >= 1000 ? 2 : 2);
  if (changeEl) {
    changeEl.textContent = `${fmtPct(change)} today`;
    changeEl.className = `chart-change ${cls(change)}`;
  }
  if (link && data.meta?.tvLink) link.href = data.meta.tvLink;
  else if (link) link.href = "#";
}

function updateLiveStamp() {
  const stamp = $("chartLiveStamp");
  if (stamp) stamp.textContent = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const badge = $("chartLiveStatus");
  if (badge) badge.title = `Auto-refresh ${isIntraday() ? "30s" : "3m"} · data may be delayed · last update ${stamp?.textContent || "--"}`;
}

/* ------------------------------- live news ------------------------------- */

const CHART_NEWS_TABS = [
  ["global", "Global"],
  ["india", "India"],
  ["geopolitics", "Geopolitics"],
  ["commodities", "Commodities"],
  ["fed", "Fed"],
  ["rareearth", "Rare earth"]
];

function safeHref(link) {
  try {
    const url = new URL(String(link || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function cleanNewsTitle(item) {
  const title = String(item?.title || "");
  const source = String(item?.source || "");
  const suffix = source ? ` - ${source}` : "";
  return suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function renderChartNewsTabs() {
  const host = $("chartNewsTabs");
  if (!host) return;
  host.innerHTML = CHART_NEWS_TABS.map(([key, label]) =>
    `<button type="button" class="${state.liveNewsCategory === key ? "active" : ""}" data-news-category="${key}">${label}</button>`
  ).join("");
}

function renderChartNews() {
  const host = $("chartNewsList");
  const stamp = $("chartNewsStamp");
  if (!host) return;
  const items = state.liveNews?.items || [];
  if (!items.length) {
    host.innerHTML = `<div class="tiny">${state.liveNewsLoading ? "Loading headlines..." : "No headlines returned right now."}</div>`;
    return;
  }
  host.innerHTML = items.slice(0, 8).map((item, index) => `
    <a class="chart-news-item" href="${esc(safeHref(item.link))}" target="_blank" rel="noopener noreferrer">
      <span class="news-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="news-copy">
        <strong>${esc(cleanNewsTitle(item))}</strong>
        <small>${esc(item.source || item.categoryLabel || "News")} · ${esc(item.ago || "")}</small>
      </span>
      <span class="news-live"></span>
    </a>`).join("");
  if (stamp) {
    stamp.textContent = state.liveNews?.asOf
      ? new Date(state.liveNews.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "--";
  }
  renderLiveHeadline();
}

function renderLiveHeadline() {
  const link = $("chartLiveHeadline");
  const source = $("chartLiveSource");
  const stamp = $("chartLiveNewsStamp");
  const label = $("chartLiveLabel");
  if (label) {
    const current = CHART_NEWS_TABS.find(([key]) => key === state.liveNewsCategory);
    const currentLabel = `${(current?.[1] || "Global").toUpperCase()} NEWS`;
    label.textContent = currentLabel;
    const title = $("chartNewsTitle");
    if (title) title.textContent = `${currentLabel} WIRE`;
  }
  if (!link) return;
  const items = state.liveNews?.items || [];
  if (!items.length) {
    const current = CHART_NEWS_TABS.find(([key]) => key === state.liveNewsCategory);
    link.textContent = state.liveNewsLoading ? `Loading ${current?.[1] || "global"} headlines...` : "Headlines unavailable right now.";
    link.href = "#";
    if (source) source.textContent = "";
    return;
  }
  const item = items[state.liveNewsIndex % items.length];
  link.textContent = cleanNewsTitle(item);
  link.href = safeHref(item.link);
  if (source) source.textContent = `${item.source || item.categoryLabel || "News"} · ${item.ago || ""}`;
  if (stamp && state.liveNews?.asOf) {
    stamp.textContent = new Date(state.liveNews.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

function rotateLiveHeadline() {
  const items = state.liveNews?.items || [];
  if (items.length < 2) return;
  state.liveNewsIndex = (state.liveNewsIndex + 1) % items.length;
  renderLiveHeadline();
}

async function loadChartNews(force = false) {
  if (state.liveNewsLoading) return;
  if (!force && state.liveNews && Date.now() - Date.parse(state.liveNews.asOf || 0) < 30_000) {
    renderChartNews();
    return;
  }
  state.liveNewsLoading = true;
  const requested = state.liveNewsCategory;
  renderChartNews();
  renderLiveHeadline();
  try {
    const data = await api(`/api/news/feed?category=${encodeURIComponent(requested)}`);
    if (requested !== state.liveNewsCategory) return;
    state.liveNews = data;
    state.liveNewsIndex = 0;
    renderChartNewsTabs();
    renderChartNews();
  } catch (error) {
    console.warn("Chart news feed unavailable", error);
    const host = $("chartNewsList");
    if (host && !state.liveNews?.items?.length) host.innerHTML = `<div class="tiny">News feed unavailable. It will retry automatically.</div>`;
  } finally {
    state.liveNewsLoading = false;
    if (state.active && requested !== state.liveNewsCategory) loadChartNews(true);
  }
}

function selectSymbol(symbol) {
  if (!symbol || symbol === state.symbol) {
    hideSearch();
    return;
  }
  state.symbol = symbol;
  state.loaded = false;
  state.smcData = null;
  state.compareData.clear();
  hideSearch();
  const input = $("symbolSearch");
  if (input) input.value = "";
  document.querySelectorAll(".watch-row").forEach((row) => row.classList.toggle("active", row.dataset.symbol === symbol));
  renderSmcDesk();
  loadChart({ reset: true });
}

/* ------------------------------- watchlist ------------------------------- */

async function loadWatchlist({ silent = false } = {}) {
  try {
    const data = await api("/api/watchlist");
    state.watchlist = data.items || [];
    renderWatchlist();
    const stamp = $("watchlistAsOf");
    if (stamp) {
      stamp.textContent = data.asOf ? new Date(data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
    }
  } catch (error) {
    if (!silent) toast("Watchlist feed unavailable.");
  }
}

function renderWatchlist() {
  const host = $("watchlist");
  if (!host) return;
  if (!state.watchlist.length) {
    host.innerHTML = `<div class="tiny" style="padding:12px">Watchlist unavailable.</div>`;
    return;
  }
  const groups = [
    ["INDICES", state.watchlist.filter((item) => item.type === "index")],
    ["NSE STOCKS", state.watchlist.filter((item) => item.type === "stock")]
  ];
  host.innerHTML = groups.map(([label, items]) => {
    if (!items.length) return "";
    return `<div class="watch-group-label">${label}</div>${items.map((item) => {
      const active = item.key === state.symbol ? "active" : "";
      return `<div class="watch-row ${active}" data-symbol="${esc(item.key)}" title="${esc(item.name)}">
        <div>
          <div class="watch-name">${esc(item.short || item.name)}</div>
          <div class="watch-meta">${esc(item.exchange || "")}${item.sector ? ` · ${esc(item.sector)}` : ""}</div>
        </div>
        <div class="watch-values">
          <div class="watch-price">${item.value == null ? "—" : fmt(item.value)}</div>
          <div class="watch-change ${cls(item.change)}">${item.change == null ? "—" : fmtPct(item.change)}</div>
        </div>
      </div>`;
    }).join("")}`;
  }).join("");
}

/* --------------------------------- search -------------------------------- */

function onSearchInput() {
  const input = $("symbolSearch");
  if (!input) return;
  clearTimeout(state.searchTimer);
  const query = input.value.trim();
  if (query.length < 1) {
    hideSearch();
    return;
  }
  state.searchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      renderSearch(data.items || []);
    } catch {
      hideSearch();
    }
  }, 240);
}

function renderSearch(items) {
  const host = $("searchResults");
  if (!host) return;
  if (!items.length) {
    host.innerHTML = `<div class="tiny" style="padding:10px">No symbols found.</div>`;
    host.classList.add("show");
    return;
  }
  host.innerHTML = items.map((item) => `<div class="search-item" data-symbol="${esc(item.key)}">
    <div>
      <div class="search-item-name">${esc(item.name)}</div>
      <div class="search-item-meta">${esc(item.exchange || "")}${item.type ? ` · ${esc(item.type)}` : ""}</div>
    </div>
    <div class="search-item-key">${esc(item.short || item.key)}</div>
  </div>`).join("");
  host.classList.add("show");
}

function hideSearch() {
  $("searchResults")?.classList.remove("show");
}

/* --------------------------------- cards --------------------------------- */

function renderInfo() {
  const data = state.data;
  if (!data) return;
  const last = data.bars.at(-1) || {};
  const quote = data.quote || {};
  const summary = data.summary || {};
  const levels = data.levels || {};
  const stats = data.stats || {};
  const snap = $("chartSnapshot");
  if (snap) {
    snap.innerHTML = `<div class="snap-grid">
      ${snapItem("Open", fmt(last.o))}
      ${snapItem("High", fmt(last.h))}
      ${snapItem("Low", fmt(last.l))}
      ${snapItem("Close", fmt(last.c))}
      ${snapItem("Volume", fmtCompact(quote.volume ?? last.v))}
      ${snapItem("ATR 14", fmt(summary.atr14))}
      ${snapItem("RSI 14", fmt(summary.rsi14, 1))}
      ${snapItem("ATR %", `${fmt(summary.atrPct, 2)}%`)}
    </div>`;
  }
  const levelsHost = $("chartLevels");
  if (levelsHost) {
    levelsHost.innerHTML = `
      <div class="level-block"><div class="level-title">Pivot</div><span class="level-chip pivot">${fmt(levels.pivot)}</span></div>
      <div class="level-block"><div class="level-title">Supports</div><div class="level-chips">${(levels.supports || []).map((x) => `<span class="level-chip support">${fmt(x)}</span>`).join("") || "—"}</div></div>
      <div class="level-block"><div class="level-title">Resistances</div><div class="level-chips">${(levels.resistances || []).map((x) => `<span class="level-chip resist">${fmt(x)}</span>`).join("") || "—"}</div></div>
      <div class="level-block"><div class="level-title">52-week range</div><div class="tiny">${fmt(stats.low52)} — ${fmt(stats.high52)} <span class="${cls(stats.fromHigh52)}">(${fmtPct(stats.fromHigh52)} from high)</span></div></div>`;
  }
  const ratingHost = $("chartRating");
  if (ratingHost) {
    const rating = summary.rating || "Neutral";
    const lower = rating.toLowerCase();
    const active = lower.includes("strong buy") ? 5 : lower === "buy" ? 4 : lower === "neutral" ? 3 : lower === "sell" ? 2 : 1;
    const classes = ["sell", "sell", "neutral", "buy", "buy"];
    const color = lower.includes("buy") ? "up" : lower.includes("sell") ? "down" : "neutral";
    ratingHost.innerHTML = `
      <div class="rating-line"><span class="rating-name ${color}">${esc(rating)}</span><span class="rating-score">${fmt(summary.score, 0)}/100</span></div>
      <div class="rating-gauge">${classes.map((kind, i) => `<span class="rating-segment ${kind} ${i < active ? "on" : ""}"></span>`).join("")}</div>
      <div class="rating-signals">${(summary.signals || []).map((signal) => `<span class="rating-signal">${esc(signal)}</span>`).join("")}</div>`;
  }
}

function snapItem(label, value) {
  return `<div class="snap-item"><span class="snap-label">${label}</span><span class="snap-value">${value}</span></div>`;
}

/* ----------------------------- smart money ui ---------------------------- */

function renderSmcControls() {
  document.querySelectorAll("[data-smc]").forEach((input) => {
    input.checked = !!state.smc[input.dataset.smc];
  });
  $("smcBtn")?.classList.toggle("active", Object.values(state.smc).some(Boolean));
}

function smcBiasClass(bias) {
  return bias === "Bullish" ? "bullish" : bias === "Bearish" ? "bearish" : "neutral";
}

function renderSmcDesk() {
  const body = $("smcBody");
  const hud = $("smcHud");
  const desk = body?.closest(".smc-desk");
  const stamp = $("smcStamp");
  if (!body) return;
  if (!state.smcData || !state.bars.length) {
    body.innerHTML = `<div class="smc-empty">Load a chart to calculate structure.</div>`;
    hud?.classList.remove("show");
    if (stamp) stamp.textContent = "--";
    return;
  }
  const p = state.smcData.probability;
  if (!p) {
    body.innerHTML = `<div class="smc-empty">Not enough bars for a structure read.</div>`;
    hud?.classList.remove("show");
    return;
  }
  const show = !!state.smc.probability && !state.compare.length;
  if (desk) desk.style.display = show ? "" : "none";
  desk?.parentElement?.classList.toggle("smc-hidden", !show);
  hud?.classList.toggle("show", show);
  if (stamp) stamp.textContent = `${state.interval.toUpperCase()} · ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (!show) return;

  const biasClass = smcBiasClass(p.bias);
  const eventText = p.lastEvent ? `${p.lastEvent.type} ${p.lastEvent.dir === "bull" ? "up" : "down"}` : "No break";
  const eventAge = p.eventAge == null ? "—" : `${p.eventAge} bars ago`;
  const demandText = p.demand ? fmt(p.demand.top) : "—";
  const supplyText = p.supply ? fmt(p.supply.bottom) : "—";
  const confText = `${p.confidence}% confidence`;
  const reasonHtml = p.reasons.length
    ? p.reasons.map((reason) => `<span class="smc-reason ${reason.dir}">${esc(reason.text)}</span>`).join("")
    : `<span class="smc-reason">No strong confluence</span>`;

  body.innerHTML = `
    <div class="smc-topline">
      <div>
        <div class="smc-bias ${biasClass}">${esc(p.bias.toUpperCase())}</div>
        <div class="tiny">Score ${p.score > 0 ? "+" : ""}${p.score} · ${esc(eventText)} · ${eventAge}</div>
      </div>
      <div class="smc-conf">${confText}<br>structure: ${esc(p.structureLabel)}</div>
    </div>
    <div class="smc-prob">
      <div class="smc-prob-labels"><span>Bullish ${p.bull}%</span><span>Neutral ${p.neutral}%</span><span>Bearish ${p.bear}%</span></div>
      <div class="smc-prob-bar">
        <span class="bull" style="width:${p.bull}%"></span>
        <span class="flat" style="width:${p.neutral}%"></span>
        <span class="bear" style="width:${p.bear}%"></span>
      </div>
    </div>
    <div class="smc-metrics">
      <div class="smc-metric"><span class="k">Demand OB</span><span class="v up">${demandText}</span></div>
      <div class="smc-metric"><span class="k">Supply OB</span><span class="v down">${supplyText}</span></div>
      <div class="smc-metric"><span class="k">Active FVG</span><span class="v">${p.activeFvgs}</span></div>
      <div class="smc-metric"><span class="k">Breaker signals</span><span class="v">${p.breakerSignals}</span></div>
      <div class="smc-metric"><span class="k">RSI 14</span><span class="v">${fmt(p.rsi14, 1)}</span></div>
      <div class="smc-metric"><span class="k">ATR 14</span><span class="v">${fmt(p.atr14)}</span></div>
      <div class="smc-metric"><span class="k">Invalidation</span><span class="v">${fmt(p.invalidation)}</span></div>
      <div class="smc-metric"><span class="k">Target zone</span><span class="v">${fmt(p.target)}</span></div>
    </div>
    <div class="smc-reasons">${reasonHtml}</div>
    <div class="tiny">Probability is a transparent local estimate built from structure, EMA position, RSI, order-block proximity, FVGs and breaker signals. It is not the third-party Expo / GainzAlgo / LuxAlgo indicator and is not investment advice.</div>`;

  const hudMeta = `${eventText} · demand ${demandText} · supply ${supplyText} · ${p.activeFvgs} FVG`;
  if (hud) {
    hud.innerHTML = `
      <div class="smc-hud-head"><span class="smc-hud-bias ${biasClass}">${esc(p.bias.toUpperCase())} ${p.bull}%</span><span class="smc-hud-conf">${p.confidence}% conf.</span></div>
      <div class="smc-hud-bar"><span class="bull" style="width:${p.bull}%;background:var(--green)"></span><span class="flat" style="width:${p.neutral}%;background:var(--amber)"></span><span class="bear" style="width:${p.bear}%;background:var(--red)"></span></div>
      <div class="smc-hud-meta">${esc(hudMeta)}</div>`;
  }
}

/* --------------------------------- alerts -------------------------------- */

function loadAlerts() {
  try {
    const raw = JSON.parse(localStorage.getItem("solo_chart_alerts") || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveAlerts() {
  try {
    localStorage.setItem("solo_chart_alerts", JSON.stringify(state.alerts));
  } catch {}
}

function addAlert() {
  const input = $("alertPrice");
  const price = Number(input?.value || state.lastPrice);
  if (!Number.isFinite(price) || price <= 0) {
    toast("Enter a valid alert price.");
    return;
  }
  state.alerts.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: state.symbol,
    name: state.symbolName,
    price,
    createdAt: new Date().toISOString(),
    triggered: false
  });
  saveAlerts();
  renderAlerts();
  if (input) input.value = "";
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  toast(`Alert set for ${state.symbolName} at ${fmt(price)}.`, true);
}

function renderAlerts() {
  const host = $("alertList");
  if (!host) return;
  const rows = state.alerts.slice(0, 30);
  if (!rows.length) {
    host.innerHTML = `<div class="tiny">No alerts yet.</div>`;
    return;
  }
  host.innerHTML = rows.map((alert) => `<div class="alert-row ${alert.triggered ? "triggered" : ""}">
    <span>${esc(alert.symbol)} · ${fmt(alert.price)}</span>
    <button data-remove-alert="${esc(alert.id)}" title="Remove">×</button>
  </div>`).join("");
}

function checkAlerts(last, previous = null) {
  if (last == null) return;
  let changed = false;
  for (const alert of state.alerts) {
    if (alert.triggered || alert.symbol !== state.symbol) continue;
    const crossed = previous != null && ((previous < alert.price && last >= alert.price) || (previous > alert.price && last <= alert.price));
    const touched = Math.abs(last - alert.price) / Math.max(1, alert.price) < 0.0006;
    if (!crossed && !touched) continue;
    alert.triggered = true;
    changed = true;
    const message = `${alert.symbol} touched ${fmt(alert.price)} (last ${fmt(last)})`;
    toast(message, true);
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification("Solo Trading Charts alert", { body: message }); } catch {}
    }
  }
  if (changed) {
    saveAlerts();
    renderAlerts();
  }
}

/* ------------------------------- chart core ------------------------------ */

function ensureChart() {
  const mount = $("chartMount");
  if (!mount) return false;
  const rect = mount.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return false;
  if (!state.chart) {
    state.chart = LightweightCharts.createChart(mount, chartOptions(rect.width, rect.height, state.interval));
    state.chart.subscribeCrosshairMove(onCrosshairMove);
    state.chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRange);
  } else {
    state.chart.resize(rect.width, rect.height);
    state.chart.applyOptions({
      timeScale: { timeVisible: isIntraday(), secondsVisible: false },
      localization: { timeFormatter: (time) => formatAxisTime(time, state.interval) }
    });
  }
  resizeOverlay();
  return true;
}

function isIntraday() {
  return ["5m", "15m", "30m", "1h"].includes(state.interval);
}

function resizeCharts() {
  if (!ensureChart()) return;
  if (state.subChart && state.subIndicator !== "none") {
    const mount = $("subChartMount");
    if (mount) {
      const rect = mount.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 20) state.subChart.resize(rect.width, rect.height);
    }
  }
  resizeOverlay();
}

function onVisibleRange(range) {
  if (!range) return;
  syncSub(range);
  drawOverlay();
}

function syncSub(range) {
  if (!state.subChart || !range || state.subSyncing) return;
  state.subSyncing = true;
  try {
    state.subChart.timeScale().setVisibleLogicalRange(range);
  } catch {} finally {
    state.subSyncing = false;
  }
}

function rebuildMain() {
  if (!state.chart || !state.bars.length) return;
  const visible = state.chart.timeScale().getVisibleLogicalRange();
  const chart = state.chart;

  if (state.mainSeries) {
    try { chart.removeSeries(state.mainSeries); } catch {}
    state.mainSeries = null;
  }
  state.overlays.forEach((series) => {
    try { chart.removeSeries(series); } catch {}
  });
  state.overlays = [];
  if (state.volumeSeries) {
    try { chart.removeSeries(state.volumeSeries); } catch {}
    state.volumeSeries = null;
  }

  const intraday = isIntraday();
  chart.applyOptions({
    timeScale: { timeVisible: intraday, secondsVisible: false, barSpacing: intraday ? 7 : 8 },
    localization: { timeFormatter: (time) => formatAxisTime(time, state.interval) }
  });

  const compareActive = state.compare.length > 0;
  if (compareActive) {
    const base = state.bars[0]?.c;
    state.mainSeries = chart.addLineSeries({
      color: COLORS.cyan,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (value) => `${Number(value).toFixed(1)}%`, minMove: 0.01 }
    });
    state.mainSeries.setData(state.bars.map((bar) => ({
      time: toLwTime(bar.t),
      value: base ? (bar.c / base - 1) * 100 : 0
    })));
    for (const key of state.compare) {
      if (key === state.symbol) continue;
      const compareBars = state.compareData.get(`${key}|${state.interval}|${state.range}`);
      if (!compareBars?.length) continue;
      const series = chart.addLineSeries({
        color: COMPARE_COLORS[key] || COLORS.blue,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(normalisedCompare(state.bars, compareBars));
      state.overlays.push(series);
    }
  } else {
    const data = state.bars.map((bar) => ({
      time: toLwTime(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      value: bar.c
    }));
    if (state.chartType === "ha") {
      state.mainSeries = chart.addCandlestickSeries({
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderVisible: false,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
        priceLineColor: COLORS.cyan,
        priceLineStyle: LightweightCharts.LineStyle?.Dotted ?? 1
      });
      state.mainSeries.setData(heikinAshi(state.bars));
    } else if (state.chartType === "line") {
      state.mainSeries = chart.addLineSeries({
        color: COLORS.cyan,
        lineWidth: 2,
        priceLineColor: COLORS.cyan,
        priceLineStyle: LightweightCharts.LineStyle?.Dotted ?? 1
      });
      state.mainSeries.setData(state.bars.map((bar) => ({ time: toLwTime(bar.t), value: bar.c })));
    } else if (state.chartType === "area") {
      state.mainSeries = chart.addAreaSeries({
        lineColor: COLORS.cyan,
        topColor: "rgba(45,212,191,0.24)",
        bottomColor: "rgba(45,212,191,0.01)",
        lineWidth: 2,
        priceLineColor: COLORS.cyan,
        priceLineStyle: LightweightCharts.LineStyle?.Dotted ?? 1
      });
      state.mainSeries.setData(state.bars.map((bar) => ({ time: toLwTime(bar.t), value: bar.c })));
    } else {
      state.mainSeries = chart.addCandlestickSeries({
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderVisible: false,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
        priceLineColor: COLORS.cyan,
        priceLineStyle: LightweightCharts.LineStyle?.Dotted ?? 1
      });
      state.mainSeries.setData(data);
    }
  }

  if (state.indicators.volume) {
    state.volumeSeries = chart.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    state.volumeSeries.setData(state.bars.map((bar) => ({
      time: toLwTime(bar.t),
      value: bar.v || 0,
      color: bar.c >= bar.o ? "rgba(52,211,153,0.34)" : "rgba(251,113,133,0.34)"
    })));
    try {
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    } catch {}
  }

  if (!compareActive) {
    const closes = state.bars.map((bar) => bar.c);
    if (state.indicators.ema9) addOverlaySeries(chart, ema(closes, 9), "#f472b6", 1);
    if (state.indicators.ema20) addOverlaySeries(chart, ema(closes, 20), COLORS.cyan, 1);
    if (state.indicators.ema50) addOverlaySeries(chart, ema(closes, 50), COLORS.amber, 1);
    if (state.indicators.ema100) addOverlaySeries(chart, ema(closes, 100), COLORS.blue, 1);
    if (state.indicators.ema200) addOverlaySeries(chart, ema(closes, 200), COLORS.purple, 1);
    if (state.indicators.sma20) addOverlaySeries(chart, sma(closes, 20), "#94a3b8", 1, true);
    if (state.indicators.sma50) addOverlaySeries(chart, sma(closes, 50), "#cbd5e1", 1, true);
    if (state.indicators.sma200) addOverlaySeries(chart, sma(closes, 200), "#e2e8f0", 1, true);
    if (state.indicators.supertrend) {
      const st = supertrend(state.bars, 10, 3);
      const lastTrend = st.at(-1)?.trend ?? 1;
      addOverlaySeries(chart, st.map((item) => item.value), lastTrend === 1 ? COLORS.green : COLORS.red, 2);
    }
    if (state.indicators.psar) addOverlaySeries(chart, psar(state.bars), "#f472b6", 1, true);
    if (state.indicators.bb) {
      const mid = sma(closes, 20);
      const dev = stdev(closes, 20);
      const upper = mid.map((value, i) => (value == null || dev[i] == null ? null : value + 2 * dev[i]));
      const lower = mid.map((value, i) => (value == null || dev[i] == null ? null : value - 2 * dev[i]));
      addOverlaySeries(chart, upper, COLORS.blue, 1, true);
      addOverlaySeries(chart, lower, COLORS.blue, 1, true);
    }
    if (state.indicators.donchian) {
      const period = 20;
      const upper = state.bars.map((_, i) => (i < period - 1 ? null : Math.max(...state.bars.slice(i - period + 1, i + 1).map((bar) => bar.h))));
      const lower = state.bars.map((_, i) => (i < period - 1 ? null : Math.min(...state.bars.slice(i - period + 1, i + 1).map((bar) => bar.l))));
      addOverlaySeries(chart, upper, "#38bdf8", 1, true);
      addOverlaySeries(chart, lower, "#38bdf8", 1, true);
    }
    if (state.indicators.keltner) {
      const mid = ema(closes, 20);
      const range = atr(state.bars, 20);
      const upper = mid.map((value, i) => (value == null || range[i] == null ? null : value + 2 * range[i]));
      const lower = mid.map((value, i) => (value == null || range[i] == null ? null : value - 2 * range[i]));
      addOverlaySeries(chart, upper, "#a3e635", 1, true);
      addOverlaySeries(chart, lower, "#a3e635", 1, true);
    }
    if (state.indicators.vwap && intraday) {
      const vwap = vwapSeries(state.bars, state.interval);
      if (vwap.length) {
        const series = chart.addLineSeries({
          color: "#e2e8f0",
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        series.setData(vwap);
        state.overlays.push(series);
      }
    }
  }

  try {
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: state.indicators.volume ? 0.22 : 0.07 } });
  } catch {}

  if (state.fitNext || !visible) {
    chart.timeScale().fitContent();
    state.fitNext = false;
  } else {
    try { chart.timeScale().setVisibleLogicalRange(visible); } catch {}
  }
  renderLegend();
  requestAnimationFrame(drawOverlay);
}

function addOverlaySeries(chart, values, color, width = 1, dashed = false) {
  if (!values?.some((v) => v != null)) return;
  const series = chart.addLineSeries({
    color,
    lineWidth: width,
    lineStyle: dashed ? (LightweightCharts.LineStyle?.Dashed ?? 2) : (LightweightCharts.LineStyle?.Solid ?? 0),
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false
  });
  const data = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    data.push({ time: toLwTime(state.bars[i].t), value: values[i] });
  }
  series.setData(data);
  state.overlays.push(series);
}

function normalisedCompare(primaryBars, compareBars) {
  const map = new Map(compareBars.map((bar) => [toLwTime(bar.t), bar.c]));
  let base = null;
  const out = [];
  for (const bar of primaryBars) {
    const value = map.get(toLwTime(bar.t));
    if (value == null) continue;
    if (base == null) base = value;
    out.push({ time: toLwTime(bar.t), value: (value / base - 1) * 100 });
  }
  return out;
}

async function hydrateCompare() {
  if (!state.compare.length) {
    state.compareData.clear();
    return;
  }
  await Promise.all(state.compare.map(async (key) => {
    const cacheKey = `${key}|${state.interval}|${state.range}`;
    if (state.compareData.has(cacheKey)) return;
    try {
      const query = new URLSearchParams({ symbol: key, interval: state.interval, range: state.range });
      const data = await api(`/api/chart?${query}`);
      state.compareData.set(cacheKey, data.bars || []);
    } catch {
      toast(`Could not load ${key} for comparison.`);
    }
  }));
}

/* ------------------------------- subcharts ------------------------------- */

function addSubLine(values, color, options = {}) {
  const line = state.subChart.addLineSeries({
    color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: options.lastValueVisible !== false,
    crosshairMarkerVisible: false,
    priceFormat: options.priceFormat || { type: "price", precision: 2, minMove: 0.01 },
    autoscaleInfoProvider: options.autoscaleInfoProvider
  });
  const data = [];
  for (let i = 0; i < state.bars.length; i++) {
    if (values[i] == null) continue;
    data.push({ time: toLwTime(state.bars[i].t), value: values[i] });
  }
  line.setData(data);
  state.subSeries.push(line);
  return line;
}

function rebuildSub() {
  const panel = $("subChartPanel");
  const mount = $("subChartMount");
  if (!panel || !mount) return;
  if (state.subIndicator === "none" || !state.bars.length) {
    panel.classList.remove("show");
    if (state.subChart) {
      try { state.subChart.remove(); } catch {}
      state.subChart = null;
      state.subSeries = [];
    }
    return;
  }
  panel.classList.add("show");
  const rect = mount.getBoundingClientRect();
  const width = Math.max(120, rect.width || $("chartStage")?.clientWidth || 600);
  const height = Math.max(100, rect.height || 148);
  if (!state.subChart) {
    state.subChart = LightweightCharts.createChart(mount, subChartOptions(width, height));
    state.subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || state.subSyncing || !state.chart) return;
      state.subSyncing = true;
      try { state.chart.timeScale().setVisibleLogicalRange(range); } catch {} finally { state.subSyncing = false; }
    });
  } else {
    state.subChart.resize(width, height);
    state.subChart.applyOptions({ localization: { timeFormatter: (time) => formatAxisTime(time, state.interval) } });
  }
  state.subSeries.forEach((series) => {
    try { state.subChart.removeSeries(series); } catch {}
  });
  state.subSeries = [];

  const closes = state.bars.map((bar) => bar.c);
  if (state.subIndicator === "macd") {
    const m = macd(closes);
    const histogram = state.subChart.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 }
    });
    histogram.setData(state.bars.map((bar, i) => ({
      time: toLwTime(bar.t),
      value: m.hist[i] ?? 0,
      color: (m.hist[i] ?? 0) >= 0 ? "rgba(52,211,153,0.5)" : "rgba(251,113,133,0.5)"
    })));
    state.subSeries.push(histogram);
    addSubLine(m.line, COLORS.cyan, { lastValueVisible: false });
    addSubLine(m.signal, COLORS.amber, { lastValueVisible: false });
    $("subChartLabel").textContent = "MACD 12,26,9";
  } else if (state.subIndicator === "stoch") {
    const st = stochastic(state.bars, 14, 3);
    const k = addSubLine(st.k, COLORS.cyan, {
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    });
    addSubLine(st.d, COLORS.amber, {
      lastValueVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    });
    k.createPriceLine({ price: 80, color: "rgba(251,113,133,0.45)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2, axisLabelVisible: false, title: "80" });
    k.createPriceLine({ price: 20, color: "rgba(52,211,153,0.45)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2, axisLabelVisible: false, title: "20" });
    $("subChartLabel").textContent = "Stochastic 14,3,3";
  } else if (state.subIndicator === "atr") {
    addSubLine(atr(state.bars, 14), COLORS.amber);
    $("subChartLabel").textContent = "ATR 14";
  } else if (state.subIndicator === "adx") {
    const d = adx(state.bars, 14);
    const line = addSubLine(d.adx, COLORS.cyan, {
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    });
    addSubLine(d.plusDI, COLORS.green, { lastValueVisible: false });
    addSubLine(d.minusDI, COLORS.red, { lastValueVisible: false });
    line.createPriceLine({ price: 25, color: "rgba(148,163,184,0.4)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2, axisLabelVisible: false, title: "25" });
    $("subChartLabel").textContent = "ADX 14 (+DI / −DI)";
  } else if (state.subIndicator === "obv") {
    addSubLine(obv(state.bars), COLORS.purple, {
      priceFormat: { type: "custom", formatter: (value) => fmtCompact(value), minMove: 1 }
    });
    $("subChartLabel").textContent = "OBV";
  } else {
    const values = rsi(closes, 14);
    const line = addSubLine(values, COLORS.cyan, {
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    });
    line.createPriceLine({ price: 70, color: "rgba(251,113,133,0.5)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2, axisLabelVisible: false, title: "70" });
    line.createPriceLine({ price: 30, color: "rgba(52,211,153,0.5)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2, axisLabelVisible: false, title: "30" });
    $("subChartLabel").textContent = "RSI 14";
  }
  const mainRange = state.chart?.timeScale().getVisibleLogicalRange();
  if (mainRange) syncSub(mainRange);
}

/* --------------------------------- legend -------------------------------- */

function renderLegend(crosshair = null) {
  const host = $("chartLegend");
  if (!host) return;
  const bar = crosshair || state.crosshairBar || state.bars.at(-1);
  if (!bar) {
    host.innerHTML = "";
    return;
  }
  const index = state.bars.findIndex((item) => item.t === bar.t);
  const prev = index > 0 ? state.bars[index - 1] : null;
  const change = prev?.c ? (bar.c / prev.c - 1) * 100 : null;
  const intervalLabel = state.interval === "1wk" ? "1W" : state.interval.toUpperCase();
  host.innerHTML = `
    <span class="legend-symbol">${esc(state.symbolName)}</span>
    <span class="legend-key">${intervalLabel} · ${state.range.toUpperCase()}</span>
    <span><span class="legend-key">O</span> ${fmt(bar.o)}</span>
    <span><span class="legend-key">H</span> ${fmt(bar.h)}</span>
    <span><span class="legend-key">L</span> ${fmt(bar.l)}</span>
    <span><span class="legend-key">C</span> <b class="${cls(change)}">${fmt(bar.c)}</b></span>
    <span class="${cls(change)}">${fmtPct(change)}</span>
    <span><span class="legend-key">V</span> ${fmtCompact(bar.v)}</span>
    ${indicatorLegend()}`;
}

function indicatorLegend() {
  if (state.compare.length || !state.bars.length) return "";
  const closes = state.bars.map((item) => item.c);
  const parts = [];
  const add = (label, value, klass = "") => {
    if (value == null || !Number.isFinite(Number(value))) return;
    parts.push(`<span><span class="legend-key">${label}</span> <span class="${klass}">${fmt(value)}</span></span>`);
  };
  if (state.indicators.ema9) add("EMA9", ema(closes, 9).at(-1));
  if (state.indicators.ema20) add("EMA20", ema(closes, 20).at(-1));
  if (state.indicators.ema50) add("EMA50", ema(closes, 50).at(-1));
  if (state.indicators.ema100) add("EMA100", ema(closes, 100).at(-1));
  if (state.indicators.ema200) add("EMA200", ema(closes, 200).at(-1));
  if (state.indicators.sma20) add("SMA20", sma(closes, 20).at(-1));
  if (state.indicators.sma50) add("SMA50", sma(closes, 50).at(-1));
  if (state.indicators.sma200) add("SMA200", sma(closes, 200).at(-1));
  if (state.indicators.supertrend) {
    const st = supertrend(state.bars, 10, 3).at(-1);
    if (st?.value != null) parts.push(`<span><span class="legend-key">ST</span> <span class="${st.trend === 1 ? "up" : "down"}">${fmt(st.value)} ${st.trend === 1 ? "▲" : "▼"}</span></span>`);
  }
  if (state.indicators.psar) add("PSAR", psar(state.bars).at(-1));
  if (state.indicators.bb) parts.push(`<span><span class="legend-key">BB</span> 20,2</span>`);
  if (state.indicators.donchian) parts.push(`<span><span class="legend-key">DC</span> 20</span>`);
  if (state.indicators.keltner) parts.push(`<span><span class="legend-key">KC</span> 20,2</span>`);
  if (state.indicators.vwap && isIntraday()) parts.push(`<span><span class="legend-key">VWAP</span></span>`);
  return parts.join("");
}

function onCrosshairMove(param) {
  if (!state.active || !param || param.time == null || !param.point) {
    state.crosshairBar = null;
    hideCrosshair();
    renderLegend();
    return;
  }
  const found = state.barMap.get(Number(param.time));
  if (!found) {
    state.crosshairBar = null;
    hideCrosshair();
    renderLegend();
    return;
  }
  const { bar, index } = found;
  state.crosshairBar = bar;
  renderLegend(bar);
  const tooltip = $("chartCrosshair");
  const stage = $("chartStage");
  if (!tooltip || !stage) return;
  const prev = index > 0 ? state.bars[index - 1] : null;
  const change = prev?.c ? (bar.c / prev.c - 1) * 100 : null;
  tooltip.innerHTML = `
    <div class="ch-title">${esc(formatFullTime(Number(param.time), state.interval))}</div>
    <div class="ch-row"><span>O</span><b>${fmt(bar.o)}</b></div>
    <div class="ch-row"><span>H</span><b>${fmt(bar.h)}</b></div>
    <div class="ch-row"><span>L</span><b>${fmt(bar.l)}</b></div>
    <div class="ch-row"><span>C</span><b class="${cls(change)}">${fmt(bar.c)}</b></div>
    <div class="ch-row"><span>Change</span><b class="${cls(change)}">${fmtPct(change)}</b></div>
    <div class="ch-row"><span>Volume</span><b>${fmtCompact(bar.v)}</b></div>`;
  tooltip.classList.add("show");
  const stageRect = stage.getBoundingClientRect();
  const tw = tooltip.offsetWidth || 170;
  const th = tooltip.offsetHeight || 110;
  let left = param.point.x + 14;
  let top = param.point.y + 14;
  if (left + tw > stageRect.width - 8) left = param.point.x - tw - 14;
  if (top + th > stageRect.height - 8) top = param.point.y - th - 14;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideCrosshair() {
  $("chartCrosshair")?.classList.remove("show");
}

/* -------------------------------- drawings ------------------------------- */

function drawingKey() {
  return `solo_drawings_${state.symbol}_${state.interval}`;
}

function loadDrawings() {
  try {
    const raw = JSON.parse(localStorage.getItem(drawingKey()) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveDrawings() {
  try {
    localStorage.setItem(drawingKey(), JSON.stringify(state.drawings));
  } catch {}
}

function resizeOverlay() {
  const stage = $("chartStage");
  const canvas = $("drawCanvas");
  if (!stage || !canvas) return;
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawOverlay() {
  const canvas = $("drawCanvas");
  if (!canvas || !state.chart || !state.mainSeries) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (!state.compare.length && (state.smc.structure || state.smc.orderBlocks || state.smc.fvg || state.smc.breakers || state.smc.swings)) {
    drawSmartMoney(ctx, width, height);
  }
  const drawings = state.draft ? [...state.drawings, state.draft] : state.drawings;
  for (const drawing of drawings) drawOneDrawing(ctx, drawing, width, height, drawing === state.draft);
}

function drawSmartMoney(ctx, width, height) {
  const smc = state.smcData;
  if (!smc || !state.mainSeries || !state.chart) return;
  const right = Math.max(10, width - 66);
  const priceY = (price) => {
    if (!Number.isFinite(Number(price))) return null;
    const y = state.mainSeries.priceToCoordinate(Number(price));
    return Number.isFinite(y) ? y : null;
  };
  const indexX = (index) => {
    const bar = state.bars[index];
    if (!bar) return null;
    const x = state.chart.timeScale().timeToCoordinate(toLwTime(bar.t));
    return Number.isFinite(x) ? x : null;
  };
  const lastIndex = state.bars.length - 1;
  const lastX = indexX(lastIndex);
  const zoneEnd = (zone) => {
    const stop = zone.filledIndex ?? zone.failedIndex ?? null;
    if (stop != null) return indexX(stop);
    return lastX == null ? right : Math.min(right, Math.max(indexX(zone.startIndex) ?? right, lastX + 30));
  };
  const label = (text, x, y, color, dark = true) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.font = "7px Cascadia Code, Consolas, monospace";
    const padding = 3;
    const textWidth = ctx.measureText(text).width;
    const bx = Math.max(2, Math.min(right - textWidth - padding * 2 - 2, x));
    const by = y;
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, textWidth + padding * 2, 11);
    ctx.fillStyle = dark ? "#06111a" : "#e9f3f7";
    ctx.fillText(text, bx + padding, by + 8);
  };
  const drawZone = (zone, kind) => {
    const x1raw = indexX(zone.startIndex);
    const x2raw = zoneEnd(zone);
    if (x1raw == null || x2raw == null) return;
    const x1 = Math.max(-18, x1raw);
    const x2 = Math.min(right, x2raw);
    if (x2 <= 2 || x1 >= right) return;
    const top = priceY(zone.top);
    const bottom = priceY(zone.bottom);
    if (top == null || bottom == null) return;
    const wy = Math.min(top, bottom);
    const wh = Math.max(1, Math.abs(bottom - top));
    const filled = zone.filledIndex != null || zone.failedIndex != null;
    let fill = "rgba(52,211,153,.08)";
    let line = "rgba(52,211,153,.45)";
    let text = "BULL OB";
    let dash = [];
    if (kind === "fvg") {
      fill = zone.type === "bull" ? "rgba(96,165,250,.09)" : "rgba(167,139,250,.09)";
      line = zone.type === "bull" ? "rgba(96,165,250,.48)" : "rgba(167,139,250,.48)";
      text = zone.type === "bull" ? "FVG+" : "FVG-";
      dash = [3, 3];
    } else if (kind === "breaker") {
      fill = zone.type === "bull" ? "rgba(251,191,36,.09)" : "rgba(192,132,252,.09)";
      line = zone.type === "bull" ? "rgba(251,191,36,.6)" : "rgba(192,132,252,.6)";
      text = zone.type === "bull" ? "BREAKER+" : "BREAKER-";
      dash = [4, 2];
    } else if (zone.type === "bear") {
      fill = "rgba(251,113,133,.08)";
      line = "rgba(251,113,133,.45)";
      text = "BEAR OB";
    }
    ctx.save();
    ctx.globalAlpha = filled ? 0.5 : 1;
    ctx.fillStyle = fill;
    ctx.fillRect(x1, wy, x2 - x1, wh);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.strokeRect(x1, wy, x2 - x1, wh);
    ctx.setLineDash([]);
    if (x2 - x1 > 34) label(text, x1 + 3, wy + 3, line);
    ctx.restore();
  };

  if (state.smc.orderBlocks) {
    for (const zone of smc.orderBlocks.slice(-8)) drawZone(zone, "ob");
  }
  if (state.smc.fvg) {
    for (const zone of smc.fvgs.slice(-7)) drawZone(zone, "fvg");
  }
  if (state.smc.breakers) {
    for (const zone of smc.breakers.slice(-5)) drawZone(zone, "breaker");
  }

  if (state.smc.structure) {
    for (const event of smc.structure.slice(-9)) {
      const x1raw = indexX(event.fromIndex);
      const x2raw = indexX(event.index);
      const y = priceY(event.price);
      if (x1raw == null || x2raw == null || y == null) continue;
      if (x2raw < 0 || x1raw > right) continue;
      const x1 = Math.max(0, x1raw);
      const x2 = Math.min(right, x2raw);
      const color = event.dir === "bull" ? COLORS.green : COLORS.red;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = event.type === "CHoCH" ? 1.3 : 1;
      ctx.setLineDash(event.type === "CHoCH" ? [5, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(Math.max(x1 + 2, x2), y);
      ctx.stroke();
      ctx.setLineDash([]);
      const text = event.type === "CHoCH" ? "CHoCH" : "BOS";
      label(text, Math.max(2, x2 - (event.type === "CHoCH" ? 36 : 26)), y - 13, color);
      ctx.restore();
    }
  }

  if (state.smc.swings) {
    for (const pivot of smc.pivots.slice(-32)) {
      const x = indexX(pivot.index);
      const y = priceY(pivot.price);
      if (x == null || y == null || x < 0 || x > right) continue;
      const high = pivot.type === "H";
      ctx.fillStyle = high ? "rgba(251,113,133,.9)" : "rgba(52,211,153,.9)";
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "7px Cascadia Code, Consolas, monospace";
      ctx.fillStyle = high ? "rgba(251,113,133,.9)" : "rgba(52,211,153,.9)";
      ctx.fillText(pivot.label, x + 3, high ? y - 4 : y + 9);
    }
  }

  if (state.smc.breakers) {
    for (const signal of smc.signals.slice(-4)) {
      const x = indexX(signal.index);
      const y = priceY(signal.price);
      if (x == null || y == null || x < 0 || x > right) continue;
      const buy = signal.dir === "bull";
      const sy = clampNumber(y + (buy ? 10 : -10), 8, height - 8);
      ctx.save();
      ctx.fillStyle = buy ? COLORS.green : COLORS.red;
      ctx.beginPath();
      if (buy) {
        ctx.moveTo(x, sy - 5);
        ctx.lineTo(x + 5, sy + 2);
        ctx.lineTo(x - 5, sy + 2);
      } else {
        ctx.moveTo(x, sy + 5);
        ctx.lineTo(x + 5, sy - 2);
        ctx.lineTo(x - 5, sy - 2);
      }
      ctx.closePath();
      ctx.fill();
      label(buy ? "BUY" : "SELL", x + 7, sy - 5, buy ? "rgba(52,211,153,.95)" : "rgba(251,113,133,.95)");
      ctx.restore();
    }
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawOneDrawing(ctx, drawing, width, height, draft = false) {
  if (!drawing) return;
  const priceY = (price) => {
    const y = state.mainSeries.priceToCoordinate(Number(price));
    return Number.isFinite(y) ? y : null;
  };
  const timeX = (time) => {
    const x = state.chart.timeScale().timeToCoordinate(Number(time));
    return Number.isFinite(x) ? x : null;
  };
  const alpha = draft ? 0.65 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = draft ? 1.5 : 1;
  if (drawing.type === "hline") {
    const y = priceY(drawing.price);
    if (y == null) { ctx.restore(); return; }
    ctx.strokeStyle = COLORS.cyan;
    ctx.setLineDash(draft ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width - 64, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(45,212,191,0.95)";
    ctx.fillRect(width - 62, y - 8, 58, 16);
    ctx.fillStyle = "#06111a";
    ctx.font = "9px Cascadia Code, monospace";
    ctx.fillText(fmt(drawing.price), width - 58, y + 3);
  } else if (drawing.type === "trend") {
    const x1 = timeX(drawing.t1);
    const y1 = priceY(drawing.p1);
    const x2 = timeX(drawing.t2);
    const y2 = priceY(drawing.p2);
    if ([x1, y1, x2, y2].some((v) => v == null)) { ctx.restore(); return; }
    ctx.strokeStyle = COLORS.blue;
    ctx.setLineDash(draft ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.blue;
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (drawing.type === "rect") {
    const x1 = timeX(drawing.t1);
    const y1 = priceY(drawing.p1);
    const x2 = timeX(drawing.t2);
    const y2 = priceY(drawing.p2);
    if ([x1, y1, x2, y2].some((v) => v == null)) { ctx.restore(); return; }
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    ctx.fillStyle = "rgba(96,165,250,0.12)";
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = COLORS.blue;
    ctx.setLineDash(draft ? [5, 4] : []);
    ctx.strokeRect(left, top, w, h);
  } else if (drawing.type === "fib") {
    const x1 = timeX(drawing.t1);
    const y1 = priceY(drawing.p1);
    const x2 = timeX(drawing.t2);
    const y2 = priceY(drawing.p2);
    if ([x1, y1, x2, y2].some((v) => v == null)) { ctx.restore(); return; }
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    ctx.font = "9px Cascadia Code, monospace";
    for (const level of levels) {
      const y = y1 + (y2 - y1) * level;
      ctx.strokeStyle = level === 0 || level === 1 ? "rgba(251,191,36,0.9)" : "rgba(251,191,36,0.55)";
      ctx.setLineDash(level === 0 || level === 1 ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.amber;
      ctx.fillText(`${(level * 100).toFixed(1)}%  ${fmt(drawing.p1 + (drawing.p2 - drawing.p1) * level)}`, left + 4, y - 3);
    }
  }
  ctx.restore();
}

function onOverlayClick(event) {
  if (state.tool === "cursor" || !state.chart || !state.mainSeries) return;
  const canvas = $("drawCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const price = state.mainSeries.coordinateToPrice(y);
  const time = state.chart.timeScale().coordinateToTime(x);
  if (price == null || time == null) return;
  if (state.tool === "hline") {
    state.drawings.push({ type: "hline", price });
    saveDrawings();
    state.tool = "cursor";
    renderTool();
    drawOverlay();
    return;
  }
  if (!state.draft) {
    state.draft = { type: state.tool, t1: time, p1: price, t2: time, p2: price };
    drawOverlay();
    return;
  }
  state.draft.t2 = time;
  state.draft.p2 = price;
  const draft = { ...state.draft };
  state.drawings.push(draft);
  state.draft = null;
  saveDrawings();
  state.tool = "cursor";
  renderTool();
  drawOverlay();
}

function onOverlayMove(event) {
  if (!state.draft || !state.chart || !state.mainSeries) return;
  const canvas = $("drawCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const price = state.mainSeries.coordinateToPrice(y);
  const time = state.chart.timeScale().coordinateToTime(x);
  if (price == null || time == null) return;
  state.draft.t2 = time;
  state.draft.p2 = price;
  drawOverlay();
}

/* ------------------------------- screenshot ------------------------------ */

function downloadScreenshot() {
  const mainCanvas = $("chartMount")?.querySelector("canvas");
  const overlay = $("drawCanvas");
  const stage = $("chartStage");
  if (!mainCanvas || !stage) {
    toast("Chart is not ready for export.");
    return;
  }
  const out = document.createElement("canvas");
  out.width = mainCanvas.width;
  out.height = mainCanvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(mainCanvas, 0, 0);
  if (overlay && overlay.width) ctx.drawImage(overlay, 0, 0, out.width, out.height);
  const anchor = document.createElement("a");
  anchor.download = `solo-${state.symbol}-${state.interval}-${Date.now()}.png`;
  anchor.href = out.toDataURL("image/png");
  anchor.click();
  toast("Chart image downloaded.", true);
}
