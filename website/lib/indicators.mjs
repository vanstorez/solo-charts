/* Dependency-free indicator and statistics helpers. */

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function round(x, digits = 2) {
  if (x == null || !Number.isFinite(x)) return null;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= n) acc -= values[i - n];
    if (i >= n - 1) out[i] = acc / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) {
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += values[j];
      prev = sum / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = Math.max(diff, 0);
    const down = Math.max(-diff, 0);
    if (i <= n) {
      gain += up / n;
      loss += down / n;
      if (i === n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    } else {
      gain = (gain * (n - 1) + up) / n;
      loss = (loss * (n - 1) + down) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

export function atr(bars, n = 14) {
  const tr = bars.map((bar, i) => {
    if (i === 0) return bar.h - bar.l;
    const prev = bars[i - 1].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - prev), Math.abs(bar.l - prev));
  });
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = n - 1; i < bars.length; i++) {
    if (prev == null) {
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += tr[j];
      prev = sum / n;
    } else {
      prev = (prev * (n - 1) + tr[i]) / n;
    }
    out[i] = prev;
  }
  return out;
}

export function stdev(values, sample = true) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - (sample ? 1 : 0));
  return Math.sqrt(variance);
}

export function maxDrawdown(equity) {
  let peak = -Infinity;
  let dd = 0;
  let peakAt = 0;
  let troughAt = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakAt = i;
    }
    const cur = peak > 0 ? (equity[i] / peak - 1) : 0;
    if (cur < dd) {
      dd = cur;
      troughAt = i;
    }
  }
  return { dd, peakAt, troughAt };
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const am = ax.reduce((x, y) => x + y, 0) / n;
  const bm = bx.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ax[i] - am;
    const y = bx[i] - bm;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function pivotPoints(bar) {
  const p = (bar.h + bar.l + bar.c) / 3;
  return {
    p,
    r1: 2 * p - bar.l,
    r2: p + (bar.h - bar.l),
    r3: bar.h + 2 * (p - bar.l),
    s1: 2 * p - bar.h,
    s2: p - (bar.h - bar.l),
    s3: bar.l - 2 * (bar.h - p)
  };
}

export function monthlyReturns(equityCurve) {
  // equityCurve: [{t, equity}]
  const byMonth = new Map();
  for (const point of equityCurve) {
    const d = new Date(point.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, { first: point.equity, last: point.equity, key });
    const item = byMonth.get(key);
    item.last = point.equity;
  }
  return [...byMonth.values()].map((m) => ({
    key: m.key,
    ret: m.first > 0 ? m.last / m.first - 1 : 0
  }));
}
