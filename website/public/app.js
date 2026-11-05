import { initCharts } from "./chart.js";
import { initTerminal } from "./terminal.js";

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

const state = {
  view: "dashboard",
  live: null,
  chain: null,
  config: null,
  backtest: null,
  optionBT: null,
  optionMode: "buy",
  buyPayoff: null,
  sellPayoff: null,
  loadingLive: false,
  loadingChain: false,
  paper: loadPaper()
};

let chartController = null;
let terminalController = null;

function loadPaper() {
  try {
    const raw = localStorage.getItem("dsl_paper_trades");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePaper() {
  localStorage.setItem("dsl_paper_trades", JSON.stringify(state.paper));
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return nf0.format(Number(value));
}

function fmtPct(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtMoney(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return n < 0 ? `−₹${fmt(Math.abs(n), digits)}` : `₹${fmt(n, digits)}`;
}

function fmtSignedMoney(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (n < 0) return `−₹${fmt(Math.abs(n), digits)}`;
  return `+₹${fmt(n, digits)}`;
}

function riskCls(value) {
  if (value == null || !Number.isFinite(Number(value))) return "flat";
  return Number(value) > 0 ? "down" : Number(value) < 0 ? "up" : "flat";
}

function fmtCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return fmtInt(n);
}

function cls(value) {
  if (value == null || !Number.isFinite(Number(value))) return "flat";
  const n = Number(value);
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

function quote(key) {
  return state.live?.quotes?.find((q) => q.key === key);
}

function toast(message, ok = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("ok", ok);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || "Working…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

/* ------------------------------- Navigation ------------------------------ */

const VIEW_META = {
  dashboard: ["MARKET PULSE", "Live market dashboard"],
  charts: ["SOLO CHARTS", "TradingView-style chart terminal"],
  scanner: ["CHART SCANNER", "Find the chart that is ready to move"],
  ai: ["SOLO AI TRADER", "Chart reading, stop loss and profit strategy"],
  news: ["NEWS TERMINAL", "India, global, commodities and macro"],
  macro: ["MACRO RADAR", "Bank Nifty, rupee, crude, war risk and policy events"],
  notes: ["TRADER NOTES", "Plans, journals and postmortems"],
  reports: ["REPORTS", "Daily briefs and trade reports"],
  calculator: ["CALCULATORS", "Size the trade before you take it"],
  alerts: ["ALERT CENTER", "Sensex, Nifty and global triggers"],
  broker: ["BROKER HUB", "Paper execution and live adapter status"],
  watchlist: ["WATCHLISTS", "Every symbol you need, ready"],
  backtest: ["BACKTEST LAB", "Test a strategy, not a story"],
  options: ["OPTIONS DESK", "Intraday option buying & selling"],
  paper: ["PAPER BOOK", "Your simulated positions"]
};

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
  const [eyebrow, title] = VIEW_META[view] || VIEW_META.dashboard;
  $("pageEyebrow").textContent = eyebrow;
  $("pageTitle").textContent = title;
  if (view === "options" && !state.chain) loadChain("NIFTY");
  if (view === "paper") renderPaper();
  if (view === "dashboard" && !state.live) loadLive();
  if (view === "charts") chartController?.activate();
  else chartController?.deactivate?.();
  if (["scanner", "ai", "news", "macro", "calculator", "alerts", "notes", "reports", "broker", "watchlist"].includes(view)) {
    terminalController?.activate(view);
  }
}

/* -------------------------------- Live data ------------------------------ */

async function loadLive(silent = false) {
  if (state.loadingLive) return;
  state.loadingLive = true;
  if (!silent) {
    $("feedLabel").textContent = "Updating market tape…";
    $("feedDot").className = "dot warn";
  }
  try {
    const data = await api("/api/live");
    state.live = data;
    renderLive(data);
    $("feedDot").className = data.marketOpen ? "dot live" : "dot";
    $("feedLabel").textContent = data.marketOpen ? "Market open · streaming" : "Market closed · last close";
    $("asOf").textContent = data.asOf;
  } catch (err) {
    toast(`Live feed: ${err.message}`);
    $("feedLabel").textContent = "Feed unavailable";
    $("feedDot").className = "dot warn";
    if (!state.live) {
      $("heroNifty").textContent = "—";
      $("heroChange").textContent = "Could not load live data";
    }
  } finally {
    state.loadingLive = false;
  }
}

function renderLive(data) {
  const nifty = data.indexes.NIFTY;
  const niftyQuote = quote("NIFTY");
  const vix = quote("INDIAVIX");
  const brent = quote("BRENT");
  const inr = quote("USDINR");
  const us10 = quote("US10Y");

  $("heroNifty").textContent = nifty ? fmt(nifty.spot, 2) : fmt(niftyQuote?.value, 2);
  const heroChange = $("heroChange");
  heroChange.textContent = nifty
    ? `${fmtPct(nifty.change)} today · ${fmt(nifty.fromHigh52, 1)}% from 52w high`
    : `${fmtPct(niftyQuote?.change)} · ${fmt(niftyQuote?.value, 2)}`;
  heroChange.className = `hero-change ${cls(nifty?.change ?? niftyQuote?.change)}`;
  $("marketBias").textContent = data.bias;
  $("marketBias").className = `badge ${data.bias.toLowerCase()}`;
  $("heroTrend").textContent = nifty?.trend || "Trend unavailable";
  $("heroRange").textContent = nifty ? `52w ${fmt(nifty.low52, 0)} – ${fmt(nifty.high52, 0)}` : "—";
  $("marketStatus").textContent = data.marketOpen ? "OPEN" : "CLOSED";
  $("sourceNote").textContent = data.source;

  renderSpark($("niftySpark"), nifty?.spark || [], "#2dd4bf");

  $("macroBrent").textContent = brent ? `$${fmt(brent.value, 2)}` : "—";
  $("macroBrent").className = riskCls(brent?.change);
  $("macroBrentNote").textContent = brent ? `${fmtPct(brent.change)} · ${data.regime.oil.label}` : "—";
  $("macroVix").textContent = vix ? fmt(vix.value, 2) : "—";
  $("macroVix").className = riskCls(vix?.change);
  $("macroVixNote").textContent = vix ? `${fmtPct(vix.change)} · ${data.regime.vix.label}` : "—";
  $("macroInr").textContent = inr ? fmt(inr.value, 2) : "—";
  $("macroInr").className = riskCls(inr?.change);
  $("macroYield").textContent = us10 ? `${fmt(us10.value, 3)}%` : "—";
  $("macroYield").className = riskCls(us10?.change);

  $("regimeCallout").textContent = buildRegimeCallout(data);

  renderQuoteStrip(data);
  renderLevels(data);
  renderNarrative(data);
  renderNews(data.headlines || []);
  renderOptionsPulse();
}

function buildRegimeCallout(data) {
  const n = data.indexes.NIFTY;
  const brent = quote("BRENT");
  const vix = quote("INDIAVIX");
  const parts = [];
  if (brent) parts.push(`Brent $${fmt(brent.value, 1)} (${data.regime.oil.label.toLowerCase()})`);
  if (n) parts.push(`Nifty ${n.spot > n.ema200 ? "above" : "below"} its 200-DMA`);
  if (vix) parts.push(`VIX ${fmt(vix.value, 1)} (${data.regime.vix.label.toLowerCase()})`);
  const tail = data.bias === "Bearish"
    ? "Bearish bias: rallies are capped until crude cools and Nifty reclaims the 20-DMA."
    : data.bias === "Bullish"
      ? "Bullish bias: trend and volatility are aligned, but keep an eye on crude."
      : "Mixed tape: trade levels, not predictions.";
  return `${parts.join(" · ")}. ${tail}`;
}

function renderQuoteStrip(data) {
  const strip = $("quoteStrip");
  strip.innerHTML = data.quotes.map((q) => {
    const index = data.indexes[q.key];
    const spark = index?.spark?.length
      ? `<svg class="quote-spark" data-spark="${q.key}" viewBox="0 0 120 24" preserveAspectRatio="none"></svg>`
      : "";
    return `<div class="quote-card" title="${esc(q.ticker)}">
      <div class="quote-card-top"><span class="quote-name">${esc(q.label)}</span><span class="quote-change ${cls(q.change)}">${fmtPct(q.change, 2)}</span></div>
      <div class="quote-value">${q.value == null ? "—" : `${fmt(q.value, q.digits)}${q.suffix || ""}`}</div>
      ${spark}
    </div>`;
  }).join("");
  strip.querySelectorAll("[data-spark]").forEach((svg) => {
    const index = data.indexes[svg.dataset.spark];
    renderSpark(svg, index?.spark || [], "#8da9b8", false);
  });
}

function renderLevels(data) {
  const grid = $("levelsGrid");
  grid.innerHTML = ["NIFTY", "SENSEX", "BANKNIFTY"].map((key) => {
    const tech = data.indexes[key];
    if (!tech) return "";
    const q = quote(key);
    const supports = tech.levels?.supports || [];
    const resistances = tech.levels?.resistances || [];
    const lo = supports.at(-1) ?? tech.low52;
    const hi = resistances.at(-1) ?? tech.high52;
    const pos = hi > lo ? Math.max(3, Math.min(97, ((tech.spot - lo) / (hi - lo)) * 100)) : 50;
    return `<article class="level-card">
      <div class="level-top">
        <div>
          <div class="level-name">${esc(key === "BANKNIFTY" ? "Bank Nifty" : key === "NIFTY" ? "Nifty 50" : "Sensex")}</div>
          <div class="level-price">${fmt(tech.spot, 2)}</div>
          <div class="level-change ${cls(q?.change ?? tech.change)}">${fmtPct(q?.change ?? tech.change)}</div>
        </div>
        <span class="tiny">${tech.rsi14 == null ? "—" : `RSI ${fmt(tech.rsi14, 1)}`}</span>
      </div>
      <div class="level-lanes">
        <div><div class="level-lane-label">Support</div><div class="chips">${supports.slice(0, 3).map((x) => `<span class="chip support">${fmt(x, 0)}</span>`).join("") || '<span class="chip">—</span>'}</div></div>
        <div><div class="level-lane-label">Resistance</div><div class="chips">${resistances.slice(0, 3).map((x) => `<span class="chip resistance">${fmt(x, 0)}</span>`).join("") || '<span class="chip">—</span>'}</div></div>
      </div>
      <div class="level-meter"><span style="left:${pos}%"></span></div>
      <div class="tiny" style="margin-top:8px">${tech.trend}</div>
    </article>`;
  }).join("");
}

function renderNarrative(data) {
  const n = data.indexes.NIFTY;
  const brent = quote("BRENT");
  const vix = quote("INDIAVIX");
  const inr = quote("USDINR");
  const us10 = quote("US10Y");
  const items = [];
  if (n) {
    items.push({
      n: "01",
      title: "Trend",
      text: `<b>Nifty ${fmt(n.spot, 0)}</b> is ${esc(n.trend.toLowerCase())}. RSI ${fmt(n.rsi14, 1)} and ATR ${fmt(n.atr14, 0)} points (${fmt(n.atrPct, 2)}%). The 20-DMA sits at ${fmt(n.ema20, 0)}.`
    });
  }
  if (brent) {
    items.push({
      n: "02",
      title: "Oil",
      text: `<b>Brent ${fmt(brent.value, 1)}</b>. Every $10/bbl sustained rise adds roughly $15–18bn to India's annual import bill. That pressures the rupee, inflation and rate-sensitive banks.`
    });
  }
  if (vix || inr || us10) {
    items.push({
      n: "03",
      title: "Macro",
      text: `VIX <b>${fmt(vix?.value, 1)}</b> · USD/INR <b>${fmt(inr?.value, 2)}</b> · US 10Y <b>${fmt(us10?.value, 3)}%</b>. A firm dollar and 5% US yields tighten global financial conditions.`
    });
  }
  items.push({
    n: "04",
    title: "Plan",
    text: `Treat <b>${fmt(n?.levels?.supports?.[0], 0)}</b> as the first support and <b>${fmt(n?.levels?.resistances?.[0], 0)}</b> as the first resistance. In a downtrend, rallies into resistance are sellable until a close above the 20-DMA.`
  });
  $("narrative").innerHTML = items.map((item) => `<div class="narrative-item"><span class="num">${item.n}</span><div><b>${item.title}</b> — ${item.text}</div></div>`).join("");
}

function renderNews(items) {
  if (!items.length) {
    $("newsList").innerHTML = '<div class="news-item"><div class="news-title">Headlines unavailable right now.</div></div>';
    return;
  }
  $("newsList").innerHTML = items.slice(0, 7).map((item) => `<div class="news-item"><div class="news-title">${esc(item.title)}</div><div class="news-meta">${esc(item.source)} · ${esc(item.published)}</div></div>`).join("");
}

/* -------------------------------- Charts --------------------------------- */

function viewBoxSize(svg) {
  const vb = svg.viewBox?.baseVal;
  return { w: vb?.width || 900, h: vb?.height || 320 };
}

function renderSpark(svg, points, color, showArea = true) {
  const { w, h } = viewBoxSize(svg);
  const px = 2;
  const py = 4;
  if (!points?.length) {
    svg.innerHTML = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#1b3545" stroke-width="1"/>`;
    return;
  }
  const vals = points.map((p) => Number(p.c));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = values(vals, w, h, px, py, min, span);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const last = xy.at(-1);
  const area = showArea ? `<path d="${d} L${(w - px).toFixed(2)},${h} L${px},${h} Z" fill="${color}" opacity="0.10"/>` : "";
  svg.innerHTML = `${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last.x}" cy="${last.y}" r="2.6" fill="${color}"/>`;
}

function values(vals, w, h, px, py, min, span) {
  return vals.map((v, i) => ({
    x: px + (i / Math.max(1, vals.length - 1)) * (w - px * 2),
    y: h - py - ((v - min) / span) * (h - py * 2)
  }));
}

function renderLineChart(svg, series, opts = {}) {
  const { w, h } = viewBoxSize(svg);
  const ml = opts.margin?.l ?? 58;
  const mr = opts.margin?.r ?? 18;
  const mt = opts.margin?.t ?? 18;
  const mb = opts.margin?.b ?? 30;
  const all = series.flatMap((s) => s.points || []).filter((p) => Number.isFinite(p.y));
  if (!all.length) {
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#5d7b8a" font-size="12">No data</text>`;
    return;
  }
  let minX = Math.min(...all.map((p) => p.x));
  let maxX = Math.max(...all.map((p) => p.x));
  let minY = Math.min(...all.map((p) => p.y));
  let maxY = Math.max(...all.map((p) => p.y));
  if (minX === maxX) { minX -= 1; maxX += 1; }
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const pad = (maxY - minY) * 0.08;
  minY -= pad;
  maxY += pad;
  if (opts.includeZero) minY = Math.min(minY, 0);
  const X = (x) => ml + ((x - minX) / (maxX - minX)) * (w - ml - mr);
  const Y = (y) => mt + ((maxY - y) / (maxY - minY)) * (h - mt - mb);
  const yFmt = opts.yFormat || ((v) => fmtCompact(v));
  const xFmt = opts.xFormat || ((v) => String(v));
  let html = "";

  for (let i = 0; i <= 4; i++) {
    const yv = minY + ((maxY - minY) * i) / 4;
    const yy = Y(yv);
    html += `<line x1="${ml}" y1="${yy}" x2="${w - mr}" y2="${yy}" stroke="#1b3545" stroke-width="1" stroke-dasharray="3 5"/>`;
    html += `<text x="${ml - 9}" y="${yy + 3}" text-anchor="end" fill="#5d7b8a" font-size="9" font-family="Cascadia Code, monospace">${yFmt(yv)}</text>`;
  }

  if (opts.zeroLine && minY < 0 && maxY > 0) {
    html += `<line x1="${ml}" y1="${Y(0)}" x2="${w - mr}" y2="${Y(0)}" stroke="#4d6c7c" stroke-width="1.2"/>`;
  }

  for (const s of series) {
    const pts = (s.points || []).filter((p) => Number.isFinite(p.y));
    if (!pts.length) continue;
    const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(" ");
    if (s.area) {
      html += `<path d="${path} L${X(pts.at(-1).x).toFixed(2)},${h - mb} L${X(pts[0].x).toFixed(2)},${h - mb} Z" fill="${s.color}" opacity="0.07"/>`;
    }
    html += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-dasharray="${s.dash || ""}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    const last = pts.at(-1);
    if (!s.hideDot) {
      html += `<circle cx="${X(last.x).toFixed(2)}" cy="${Y(last.y).toFixed(2)}" r="3" fill="${s.color}" stroke="#06111a" stroke-width="1.5"/>`;
    }
  }

  const xPoints = series[0]?.points || [];
  if (xPoints.length) {
    [0, Math.floor(xPoints.length / 2), xPoints.length - 1].forEach((idx) => {
      const p = xPoints[idx];
      if (!p) return;
      html += `<text x="${X(p.x).toFixed(2)}" y="${h - 8}" text-anchor="${idx === 0 ? "start" : idx === xPoints.length - 1 ? "end" : "middle"}" fill="#5d7b8a" font-size="9" font-family="Cascadia Code, monospace">${esc(xFmt(p.x, p))}</text>`;
    });
  }

  if (opts.markerX != null) {
    const mx = X(opts.markerX);
    html += `<line x1="${mx}" y1="${mt}" x2="${mx}" y2="${h - mb}" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.8"/>`;
    html += `<text x="${mx + 4}" y="${mt + 10}" fill="#fbbf24" font-size="9" font-family="Cascadia Code, monospace">${esc(opts.markerLabel || "spot")}</text>`;
  }

  if (opts.breakevens) {
    for (const be of opts.breakevens) {
      const bx = X(be);
      if (bx < ml || bx > w - mr) continue;
      html += `<line x1="${bx}" y1="${mt}" x2="${bx}" y2="${h - mb}" stroke="#a78bfa" stroke-width="1" stroke-dasharray="3 4" opacity="0.9"/>`;
      html += `<text x="${bx}" y="${h - 12}" text-anchor="middle" fill="#a78bfa" font-size="8" font-family="Cascadia Code, monospace">BE ${fmt(be, 0)}</text>`;
    }
  }

  svg.innerHTML = html;
}

function renderPayoffChart(svg, result) {
  const points = result.series.map((p) => ({ x: p.spot, y: p.pnl }));
  renderLineChart(svg, [{ points, color: "#2dd4bf", width: 2.3, area: true }], {
    margin: { l: 50, r: 14, t: 16, b: 30 },
    includeZero: true,
    zeroLine: true,
    yFormat: (v) => `${v < 0 ? "-" : ""}₹${fmtCompact(Math.abs(v))}`,
    xFormat: (v) => fmt(v, 0),
    markerX: result.spot,
    markerLabel: `spot ${fmt(result.spot, 0)}`,
    breakevens: result.breakevens
  });
}

function renderMetrics(el, items) {
  el.innerHTML = items.map((item) => `<div class="metric-card">
    <div class="metric-label">${esc(item.label)}</div>
    <div class="metric-value ${item.cls || ""}">${item.value}</div>
    <div class="metric-sub">${esc(item.sub || "")}</div>
  </div>`).join("");
}

function renderHeatmap(el, monthly) {
  if (!monthly?.length) {
    el.innerHTML = '<div class="tiny">No monthly data.</div>';
    return;
  }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const years = [...new Set(monthly.map((m) => m.key.slice(0, 4)))];
  const maxAbs = Math.max(0.01, ...monthly.map((m) => Math.abs(m.ret)));
  const byKey = new Map(monthly.map((m) => [m.key, m.ret]));
  let html = `<table class="heatmap"><thead><tr><th></th>${monthNames.map((m) => `<th>${m}</th>`).join("")}<th>Year</th></tr></thead><tbody>`;
  for (const year of years) {
    let yearTotal = 1;
    html += `<tr><td style="text-align:left;color:#8da9b8">${year}</td>`;
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const ret = byKey.get(key);
      if (ret == null) {
        html += `<td class="zero">·</td>`;
      } else {
        yearTotal *= 1 + ret;
        const alpha = Math.min(0.62, 0.12 + (Math.abs(ret) / maxAbs) * 0.5);
        const bg = ret >= 0 ? `rgba(52,211,153,${alpha})` : `rgba(251,113,133,${alpha})`;
        html += `<td style="background:${bg};color:${ret >= 0 ? "#c7f9e6" : "#ffd0d6"}" title="${key}: ${fmtPct(ret * 100)}">${(ret * 100).toFixed(1)}</td>`;
      }
    }
    const yr = (yearTotal - 1) * 100;
    html += `<td style="background:${yr >= 0 ? "rgba(52,211,153,.22)" : "rgba(251,113,133,.20)"};color:${yr >= 0 ? "#c7f9e6" : "#ffd0d6"}">${yr.toFixed(1)}</td></tr>`;
  }
  html += "</tbody></table>";
  el.innerHTML = html;
}

/* ------------------------------ Backtest UI ------------------------------ */

function populateBacktestStrategies() {
  if (!state.config?.strategies) return;
  $("btStrategy").innerHTML = state.config.strategies.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  updateBtDescription();
}

function updateBtDescription() {
  const s = state.config?.strategies?.find((x) => x.id === $("btStrategy").value);
  $("btDescription").textContent = s ? `${s.tag} — ${s.description}` : "Choose a strategy and run the test.";
}

async function runBacktest() {
  const button = $("btRun");
  setBusy(button, true, "Running…");
  try {
    const data = await api("/api/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("btSymbol").value,
        strategy: $("btStrategy").value,
        range: $("btRange").value,
        costPct: Number($("btCost").value || 0.05)
      })
    });
    state.backtest = data;
    renderBacktest(data);
    toast("Backtest complete", true);
  } catch (err) {
    toast(`Backtest: ${err.message}`);
  } finally {
    setBusy(button, false);
  }
}

function renderBacktest(data) {
  const m = data.metrics;
  $("btChartTitle").textContent = `${data.name} · ${data.strategy.name}`;
  $("btMeta").textContent = `${data.from} → ${data.to} · ${fmtInt(data.bars)} bars · cost ${data.costPct}% per side · benchmark Nifty B&H`;
  $("tradeCount").textContent = `${data.trades.length} trades`;
  const finalEquity = data.equity?.at(-1)?.equity ?? data.initial;
  renderMetrics($("btMetrics"), [
    { label: "Total return", value: fmtPct(m.totalReturn), sub: `₹1,00,000 → ${fmtMoney(finalEquity, 0)}`, cls: cls(m.totalReturn) },
    { label: "CAGR", value: fmtPct(m.cagr), sub: `${data.to.slice(0, 4)} annualised`, cls: cls(m.cagr) },
    { label: "Max drawdown", value: fmtPct(m.maxDrawdown), sub: "Peak-to-trough", cls: "down" },
    { label: "Sharpe", value: fmt(m.sharpe, 2), sub: "Daily returns · 252d" },
    { label: "Win rate", value: `${fmt(m.winRate, 1)}%`, sub: `${m.trades} trades` },
    { label: "Profit factor", value: m.profitFactor === 99 ? "∞" : fmt(m.profitFactor, 2), sub: "Gross profit / gross loss" },
    { label: "Alpha vs B&H", value: fmtPct(data.alpha), sub: `Benchmark ${fmtPct(data.benchmark.totalReturn)}`, cls: cls(data.alpha) },
    { label: "Exposure", value: `${fmt(m.exposure, 1)}%`, sub: "Time in market" }
  ]);

  const eq = data.equity.map((p, i) => ({ x: i, y: p.equity, date: p.date }));
  const bh = data.equity.map((p, i) => ({ x: i, y: p.benchmark, date: p.date }));
  renderLineChart($("equityChart"), [
    { points: bh, color: "#597282", width: 1.7, dash: "4 4", hideDot: true },
    { points: eq, color: "#2dd4bf", width: 2.4, area: true }
  ], {
    yFormat: (v) => `₹${fmtCompact(v)}`,
    xFormat: (v, p) => p?.date?.slice(0, 7) || ""
  });

  renderHeatmap($("monthlyHeatmap"), data.monthly);
  const body = $("btTradesBody");
  if (!data.trades.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No trades in this period.</td></tr>';
  } else {
    body.innerHTML = data.trades.map((t) => `<tr>
      <td class="mono">${esc(t.entryDate)}</td>
      <td class="mono">${esc(t.exitDate)}</td>
      <td class="mono">${fmt(t.entryPrice)}</td>
      <td class="mono">${fmt(t.exitPrice)}</td>
      <td class="mono ${cls(t.returnPct)}">${fmtPct(t.returnPct)}</td>
      <td class="mono ${cls(t.pnl)}">${fmtSignedMoney(t.pnl, 0)}</td>
      <td class="mono">${t.barsHeld}</td>
      <td>${esc(t.reason)}</td>
    </tr>`).join("");
  }
}

/* ------------------------------ Options data ----------------------------- */

async function loadChain(symbol = "NIFTY", expiry = null, silent = false) {
  if (state.loadingChain) return;
  state.loadingChain = true;
  if (!silent) $("chainStamp").textContent = "Loading…";
  try {
    const params = new URLSearchParams({ symbol });
    if (expiry) params.set("expiry", expiry);
    const chain = await api(`/api/options/chain?${params}`);
    state.chain = chain;
    renderChain(chain);
    renderOptionsPulse();
    if (!silent) toast(`${chain.name} chain loaded`, true);
  } catch (err) {
    toast(`Option chain: ${err.message}`);
    $("chainStamp").textContent = "Unavailable";
    $("feedLabel").textContent = "NSE chain unavailable";
  } finally {
    state.loadingChain = false;
  }
}

function renderChain(chain) {
  $("optSymbol").value = chain.symbol;
  $("optExpiry").innerHTML = chain.expiries.map((e) => `<option value="${esc(e)}" ${e === chain.expiry ? "selected" : ""}>${esc(e)}</option>`).join("");
  $("optExpiry").value = chain.expiry;
  $("chainTitle").textContent = chain.name;
  $("chainStamp").textContent = chain.timestamp ? `NSE ${chain.timestamp}` : "NSE snapshot";
  $("chainStamp").className = `status-pill ${chain.stale ? "warn" : ""}`;

  $("chainSummary").innerHTML = [
    ["Spot", fmt(chain.spot, 2)],
    ["ATM", fmt(chain.atm, 0)],
    ["ATM IV", `${fmt(chain.atmIV, 2)}%`],
    ["PCR", fmt(chain.pcr, 2)],
    ["Max pain", fmt(chain.maxPain, 0)],
    ["Expected move", `±${fmt(chain.expectedMove, 0)}`],
    ["ATM straddle", fmtMoney(chain.atmStraddle, 0)],
    ["Lot size", fmtInt(chain.lotSize)]
  ].map(([label, value]) => `<div class="mini-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");

  renderChainTable(chain);
  renderOiSupport(chain);
  populateBuyStrikes(chain);
  updateBuyPremium();
  renderPaper();
}

function renderChainTable(chain) {
  const body = $("chainBody");
  if (!chain.rows?.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No strikes returned.</td></tr>';
    return;
  }
  body.innerHTML = chain.rows.map((row) => {
    const atm = row.strike === chain.atm;
    const itmCe = row.strike < chain.spot;
    const itmPe = row.strike > chain.spot;
    return `<tr data-strike="${row.strike}" class="${atm ? "atm" : ""} ${itmCe ? "itm-ce" : ""} ${itmPe ? "itm-pe" : ""}">
      <td>${fmtCompact(row.ce?.oi)}</td>
      <td class="${cls(row.ce?.change)}">${fmt(row.ce?.ltp, 2)}</td>
      <td>${fmt(row.ce?.iv, 1)}</td>
      <td class="strike-col">${fmt(row.strike, 0)}</td>
      <td>${fmt(row.pe?.iv, 1)}</td>
      <td class="${cls(row.pe?.change)}">${fmt(row.pe?.ltp, 2)}</td>
      <td>${fmtCompact(row.pe?.oi)}</td>
    </tr>`;
  }).join("");
}

function renderOiSupport(chain) {
  const supports = chain.supports || [];
  const resistances = chain.resistances || [];
  $("oiSupport").innerHTML = `
    <div class="oi-block"><div class="oi-block-title">Put OI supports</div>${supports.map((s) => `<div class="oi-block-row"><span>${fmt(s.strike, 0)}</span><span>${fmtCompact(s.oi)}</span></div>`).join("") || '<div class="tiny">—</div>'}</div>
    <div class="oi-block"><div class="oi-block-title">Call OI resistances</div>${resistances.map((s) => `<div class="oi-block-row"><span>${fmt(s.strike, 0)}</span><span>${fmtCompact(s.oi)}</span></div>`).join("") || '<div class="tiny">—</div>'}</div>`;
}

function renderOptionsPulse() {
  const chain = state.chain;
  if (!chain) return;
  $("optionsExpiry").textContent = chain.expiry;
  $("pulseAtm").textContent = fmt(chain.atm, 0);
  $("pulsePcr").textContent = fmt(chain.pcr, 2);
  $("pulseMaxPain").textContent = fmt(chain.maxPain, 0);
  $("pulseMove").textContent = `±${fmt(chain.expectedMove, 0)}`;
  const maxOi = Math.max(1, ...(chain.resistances || []).map((x) => x.oi), ...(chain.supports || []).map((x) => x.oi));
  const rows = [
    ...(chain.resistances || []).slice(0, 3).map((x) => ({ ...x, kind: "resistance" })),
    ...(chain.supports || []).slice(0, 3).map((x) => ({ ...x, kind: "support" }))
  ];
  $("oiBars").innerHTML = rows.map((x) => `<div class="oi-row"><span>${x.kind === "support" ? "S" : "R"} ${fmt(x.strike, 0)}</span><span class="oi-track"><span class="oi-fill ${x.kind}" style="width:${Math.max(6, (x.oi / maxOi) * 100)}%"></span></span><span>${fmtCompact(x.oi)}</span></div>`).join("");
}

function populateBuyStrikes(chain) {
  const select = $("buyStrike");
  if (!chain?.rows?.length) {
    select.innerHTML = "";
    return;
  }
  const current = Number(select.value);
  select.innerHTML = chain.rows.map((r) => `<option value="${r.strike}">${fmt(r.strike, 0)}</option>`).join("");
  select.value = String(chain.rows.some((r) => r.strike === current) ? current : chain.atm);
}

function chainRow(strike) {
  if (!state.chain) return null;
  return state.chain.rows.find((r) => r.strike === Number(strike)) || state.chain.rows.reduce((best, row) => {
    if (!best) return row;
    return Math.abs(row.strike - strike) < Math.abs(best.strike - strike) ? row : best;
  }, null);
}

function updateBuyPremium() {
  if (!state.chain) return;
  const row = chainRow($("buyStrike").value);
  const side = $("buySide").value;
  const premium = side === "CE" ? row?.ce?.ltp : row?.pe?.ltp;
  if (premium != null) $("buyPremium").value = Number(premium).toFixed(2);
}

function nearestChainStrike(target) {
  if (!state.chain) return target;
  const row = chainRow(target);
  return row?.strike ?? target;
}

async function buildBuyPayoff() {
  if (!state.chain) return toast("Load the option chain first.");
  const side = $("buySide").value;
  const strike = Number($("buyStrike").value);
  const lots = Math.max(1, Number($("buyLots").value) || 1);
  const premium = Math.max(0, Number($("buyPremium").value) || 0);
  const lotSize = state.chain.lotSize;
  try {
    const result = await api("/api/options/payoff", {
      method: "POST",
      body: JSON.stringify({
        symbol: state.chain.symbol,
        spot: state.chain.spot,
        lotSize,
        legs: [{ type: side, action: "buy", strike, premium, lots }],
        rangePct: 0.12
      })
    });
    state.buyPayoff = {
      result,
      symbol: state.chain.symbol,
      expiry: state.chain.expiry,
      side,
      strike,
      lots,
      lotSize,
      premium,
      label: `Buy ${side} ${fmt(strike, 0)}`
    };
    renderBuyPayoff(result, side, strike, lots, premium, lotSize);
  } catch (err) {
    toast(`Payoff: ${err.message}`);
  }
}

function renderBuyPayoff(result, side, strike, lots, premium, lotSize) {
  const targetPct = Math.max(1, Number($("buyTarget").value) || 60);
  const stopPct = Math.max(1, Number($("buyStop").value) || 35);
  renderMetrics($("buyMetrics"), [
    { label: "Net debit", value: fmtMoney(result.netDebit, 0), sub: `${lots} lot × ${lotSize}`, cls: "down" },
    { label: "Max loss", value: fmtMoney(result.maxLoss, 0), sub: "Premium paid", cls: "down" },
    { label: "Max profit", value: fmtMoney(result.maxProfit, 0), sub: "Within ±12% expiry range", cls: "up" },
    { label: "Breakeven", value: result.breakevens.map((x) => fmt(x, 0)).join(" / ") || "—", sub: `${side} ${fmt(strike, 0)}`, cls: "flat" },
    { label: "Target premium", value: fmtMoney(premium * (1 + targetPct / 100), 2), sub: `+${targetPct}%`, cls: "up" },
    { label: "Stop premium", value: fmtMoney(premium * (1 - stopPct / 100), 2), sub: `-${stopPct}%`, cls: "down" }
  ]);
  renderPayoffChart($("buyPayoffChart"), result);
}

async function buildSellPayoff() {
  if (!state.chain) return toast("Load the option chain first.");
  try {
    const legs = buildSellLegs();
    const result = await api("/api/options/payoff", {
      method: "POST",
      body: JSON.stringify({
        symbol: state.chain.symbol,
        spot: state.chain.spot,
        lotSize: state.chain.lotSize,
        legs,
        rangePct: 0.15
      })
    });
    state.sellPayoff = {
      result,
      symbol: state.chain.symbol,
      expiry: state.chain.expiry,
      legs,
      lotSize: state.chain.lotSize,
      strategy: $("sellStrategy").value,
      label: $("sellStrategy").selectedOptions[0]?.textContent || "Short premium"
    };
    renderSellPayoff(result, state.sellPayoff.label, legs, state.chain.lotSize);
  } catch (err) {
    toast(`Payoff: ${err.message}`);
  }
}

function buildSellLegs() {
  const chain = state.chain;
  const strategy = $("sellStrategy").value;
  const lots = Math.max(1, Number($("sellLots").value) || 1);
  const widthPct = Math.max(0.3, Number($("sellWidth").value) || 1);
  const step = chain.strikeStep;
  const wingStrikes = Math.max(1, Math.round((chain.spot * widthPct) / 100 / step));
  const atm = chain.atm;
  const make = (type, action, strike) => {
    const row = chainRow(strike);
    const opt = type === "CE" ? row?.ce : row?.pe;
    if (!row || !opt || !opt.ltp) throw new Error(`No premium for ${type} ${fmt(strike, 0)}`);
    return { type, action, strike: row.strike, premium: opt.ltp, lots };
  };

  if (strategy === "short-straddle") {
    return [make("CE", "sell", atm), make("PE", "sell", atm)];
  }
  if (strategy === "short-strangle") {
    return [
      make("CE", "sell", nearestChainStrike(atm + wingStrikes * step)),
      make("PE", "sell", nearestChainStrike(atm - wingStrikes * step))
    ];
  }
  if (strategy === "bull-put-spread") {
    return [
      make("PE", "sell", nearestChainStrike(atm - step)),
      make("PE", "buy", nearestChainStrike(atm - (wingStrikes + 1) * step))
    ];
  }
  if (strategy === "bear-call-spread") {
    return [
      make("CE", "sell", nearestChainStrike(atm + step)),
      make("CE", "buy", nearestChainStrike(atm + (wingStrikes + 1) * step))
    ];
  }
  if (strategy === "iron-condor") {
    return [
      make("CE", "sell", nearestChainStrike(atm + wingStrikes * step)),
      make("CE", "buy", nearestChainStrike(atm + wingStrikes * 2 * step)),
      make("PE", "sell", nearestChainStrike(atm - wingStrikes * step)),
      make("PE", "buy", nearestChainStrike(atm - wingStrikes * 2 * step))
    ];
  }
  throw new Error("Unknown structure");
}

function renderSellPayoff(result, label, legs, lotSize) {
  const targetPct = Math.max(1, Number($("sellTarget").value) || 50);
  const stopPct = Math.max(1, Number($("sellStop").value) || 35);
  const netLabel = result.netPremium >= 0 ? "Net credit" : "Net debit";
  const netValue = Math.abs(result.netPremium);
  renderMetrics($("sellMetrics"), [
    { label: netLabel, value: fmtMoney(netValue, 0), sub: `${legs.length} legs × ${lotSize}`, cls: result.netPremium >= 0 ? "up" : "down" },
    { label: "Max profit", value: fmtMoney(result.maxProfit, 0), sub: result.unboundedRisk ? "At range edge" : "Defined", cls: "up" },
    { label: "Max loss", value: result.unboundedRisk ? "Unlimited*" : fmtMoney(result.maxLoss, 0), sub: result.unboundedRisk ? "*Naked short call" : "Defined at expiry", cls: "down" },
    { label: "Breakevens", value: result.breakevens.map((x) => fmt(x, 0)).join(" / ") || "—", sub: label },
    { label: "Margin est.", value: fmtMoney(result.marginEstimate, 0), sub: "13% notional approximation" },
    { label: "Target / stop", value: `+${targetPct}% / -${stopPct}%`, sub: "Premium move" }
  ]);
  renderPayoffChart($("sellPayoffChart"), result);
}

/* ------------------------------ Option backtest -------------------------- */

function populateObStrategies() {
  const mode = $("obMode").value;
  const strategy = $("obStrategy");
  const list = mode === "buy"
    ? [{ id: "buy-orb", name: "ORB · buy ATM CE/PE" }]
    : [{ id: "short-straddle", name: "Short ATM straddle" }, { id: "short-strangle", name: "Short OTM strangle" }];
  strategy.innerHTML = list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("obStop").value = mode === "buy" ? 35 : 35;
  $("obTarget").value = mode === "buy" ? 80 : 50;
}

async function runOptionBacktest() {
  const button = $("obRun");
  setBusy(button, true, "Running…");
  try {
    const data = await api("/api/options/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("obSymbol").value,
        mode: $("obMode").value,
        strategy: $("obStrategy").value,
        lots: Number($("obLots").value || 1),
        expiryDays: Number($("obExpiryDays").value || 2),
        stopPct: Number($("obStop").value || 35),
        targetPct: Number($("obTarget").value || 80),
        iv: $("obIv").value === "" ? null : Number($("obIv").value),
        costPct: 0.5
      })
    });
    state.optionBT = data;
    renderOptionBacktest(data);
    toast("Option backtest complete", true);
  } catch (err) {
    toast(`Option backtest: ${err.message}`);
  } finally {
    setBusy(button, false);
  }
}

function renderOptionBacktest(data) {
  const m = data.metrics;
  $("obDisclaimer").textContent = `${data.assumptions.pricing} · IV: ${data.assumptions.iv} · ${data.assumptions.expiryDays}-day expiry · ${data.sessions} sessions · costs ${data.assumptions.costPct}. ${data.note}`;
  renderMetrics($("obMetrics"), [
    { label: "Total P&L", value: fmtSignedMoney(m.totalPnl, 0), sub: `Capital ${fmtMoney(data.initialCapital, 0)}`, cls: cls(m.totalPnl) },
    { label: "Return", value: fmtPct(m.totalReturn), sub: "On deployed capital", cls: cls(m.totalReturn) },
    { label: "Return on margin", value: m.returnOnMargin == null ? "—" : fmtPct(m.returnOnMargin), sub: "Margin-based (est.)", cls: cls(m.returnOnMargin) },
    { label: "Win rate", value: `${fmt(m.winRate, 1)}%`, sub: `${m.trades} sessions` },
    { label: "Profit factor", value: m.profitFactor === 99 ? "∞" : fmt(m.profitFactor, 2), sub: "Gross P / gross L" },
    { label: "Max drawdown", value: fmtPct(m.maxDrawdown), sub: "Session equity", cls: "down" },
    { label: "Avg / session", value: fmtSignedMoney(m.avgPnl, 0), sub: `Best ${fmtSignedMoney(m.bestTrade, 0)}`, cls: cls(m.avgPnl) },
    { label: "Final equity", value: fmtMoney(m.finalEquity, 0), sub: "Paper capital", cls: cls(m.totalPnl) }
  ]);

  const curve = data.curve.map((p, i) => ({ x: i, y: p.equity, date: p.date }));
  renderLineChart($("obEquityChart"), [{ points: curve, color: data.mode === "sell" ? "#fb7185" : "#2dd4bf", width: 2.2, area: true }], {
    yFormat: (v) => `₹${fmtCompact(v)}`,
    xFormat: (v, p) => p?.date?.slice(5) || ""
  });

  const body = $("obTradesBody");
  if (!data.trades.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No qualifying trades.</td></tr>';
  } else {
    body.innerHTML = data.trades.slice(0, 8).map((t) => `<tr>
      <td class="mono">${esc(t.date)}</td>
      <td>${esc(t.side)}</td>
      <td class="mono">${esc(t.strikes ?? t.strike)}</td>
      <td class="mono">${fmt(t.entryPremium, 2)}</td>
      <td class="mono">${fmt(t.exitPremium, 2)}</td>
      <td class="mono ${cls(t.pnl)}">${fmtSignedMoney(t.pnl, 0)}</td>
    </tr>`).join("");
  }
}

/* -------------------------------- Paper book ----------------------------- */

function paperMark(trade) {
  if (trade.status === "CLOSED") return trade.pnl ?? 0;
  if (!state.chain || state.chain.symbol !== trade.symbol || state.chain.expiry !== trade.expiry) return null;
  let pnl = 0;
  for (const leg of trade.legs) {
    const row = state.chain.rows.find((r) => r.strike === leg.strike);
    if (!row) return null;
    const cur = leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp;
    if (cur == null) return null;
    const qty = leg.lots * trade.lotSize;
    pnl += (leg.action === "buy" ? cur - leg.premium : leg.premium - cur) * qty;
  }
  return pnl;
}

function renderPaper() {
  const trades = state.paper;
  let open = 0;
  let closed = 0;
  let total = 0;
  let wins = 0;
  for (const t of trades) {
    if (t.status === "OPEN") {
      open++;
      const mark = paperMark(t);
      if (mark != null) total += mark;
    } else {
      closed++;
      total += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) wins++;
    }
  }
  renderMetrics($("paperMetrics"), [
    { label: "Open positions", value: fmtInt(open), sub: "Paper only" },
    { label: "Closed positions", value: fmtInt(closed), sub: "Realised" },
    { label: "Total P&L", value: fmtSignedMoney(total, 0), sub: "Open marks + realised", cls: cls(total) },
    { label: "Closed win rate", value: closed ? `${fmt((wins / closed) * 100, 1)}%` : "—", sub: `${wins} winners`, cls: closed && wins / closed >= 0.5 ? "up" : "down" }
  ]);
  $("paperStamp").textContent = trades.length ? `${trades.length} records · ${new Date().toLocaleString("en-IN")}` : "No trades yet";

  const body = $("paperBody");
  if (!trades.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No paper trades yet. Build one from the options desk.</td></tr>';
    return;
  }
  body.innerHTML = trades.slice().reverse().map((t) => {
    const mark = paperMark(t);
    const pnl = t.status === "CLOSED" ? t.pnl ?? 0 : mark;
    const legs = t.legs.map((l) => `${l.action === "sell" ? "−" : "+"}${l.type} ${fmt(l.strike, 0)}`).join(" · ");
    return `<tr>
      <td class="mono">${new Date(t.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
      <td>${esc(t.symbol)}<div class="tiny">${esc(t.expiry || "")}</div></td>
      <td>${esc(t.label)}<div class="tiny">${esc(legs)}</div></td>
      <td class="mono">${fmt(t.entrySpot, 2)}</td>
      <td class="mono">${t.status === "CLOSED" || mark == null ? "—" : fmt(t.entryPremium + (mark / (t.lotSize * (t.legs[0]?.lots || 1))), 2)}</td>
      <td class="mono ${cls(pnl)}">${pnl == null ? "—" : fmtSignedMoney(pnl, 0)}</td>
      <td><span class="status-pill">${esc(t.status)}</span></td>
      <td class="paper-row-actions">
        ${t.status === "OPEN" ? `<button class="mini-btn" data-close="${t.id}">Close</button>` : ""}
        <button class="mini-btn danger" data-remove="${t.id}">×</button>
      </td>
    </tr>`;
  }).join("");
}

function addPaperTrade(trade) {
  state.paper.push({ id: `pt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...trade });
  savePaper();
  renderPaper();
  toast("Paper trade added", true);
}

function takePaperBuy() {
  if (!state.buyPayoff) return buildBuyPayoff().then(takePaperBuy);
  const p = state.buyPayoff;
  addPaperTrade({
    symbol: p.symbol,
    expiry: p.expiry,
    label: p.label,
    entrySpot: state.chain.spot,
    entryPremium: p.premium,
    lotSize: p.lotSize,
    legs: [{ type: p.side, action: "buy", strike: p.strike, premium: p.premium, lots: p.lots }],
    status: "OPEN",
    target: Number($("buyTarget").value) || 60,
    stop: Number($("buyStop").value) || 35
  });
}

function takePaperSell() {
  if (!state.sellPayoff) return buildSellPayoff().then(takePaperSell);
  const p = state.sellPayoff;
  addPaperTrade({
    symbol: p.symbol,
    expiry: p.expiry,
    label: p.label,
    entrySpot: state.chain.spot,
    entryPremium: Number(p.result.netPremium.toFixed(2)),
    lotSize: p.lotSize,
    legs: p.legs,
    status: "OPEN",
    target: Number($("sellTarget").value) || 50,
    stop: Number($("sellStop").value) || 35
  });
}

function closePaperTrade(id) {
  const trade = state.paper.find((t) => t.id === id);
  if (!trade) return;
  const mark = paperMark(trade);
  trade.status = "CLOSED";
  trade.pnl = mark ?? 0;
  trade.closedAt = Date.now();
  savePaper();
  renderPaper();
  toast("Paper trade closed", true);
}

function removePaperTrade(id) {
  state.paper = state.paper.filter((t) => t.id !== id);
  savePaper();
  renderPaper();
}

function exportPaper() {
  const blob = new Blob([JSON.stringify(state.paper, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `solo-trading-charts-paper-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------- Event wiring ---------------------------- */

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll("[data-jump]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.jump)));

  $("refreshBtn").addEventListener("click", () => {
    if (state.view === "dashboard") loadLive();
    else if (state.view === "charts") chartController?.refresh();
    else if (state.view === "options") loadChain(state.chain?.symbol || "NIFTY", state.chain?.expiry || null);
    else if (state.view === "backtest" && state.backtest) renderBacktest(state.backtest);
    else if (["scanner", "ai", "news", "macro", "alerts", "broker", "watchlist", "reports"].includes(state.view)) terminalController?.refresh(state.view);
    else renderPaper();
  });

  $("backtestForm").addEventListener("submit", (e) => { e.preventDefault(); runBacktest(); });
  $("btStrategy").addEventListener("change", updateBtDescription);

  $("optSymbol").addEventListener("change", () => loadChain($("optSymbol").value, null));
  $("optExpiry").addEventListener("change", () => loadChain($("optSymbol").value, $("optExpiry").value));
  $("optRefresh").addEventListener("click", () => loadChain($("optSymbol").value, $("optExpiry").value || null));

  document.querySelectorAll("[data-opt-mode]").forEach((btn) => btn.addEventListener("click", () => {
    state.optionMode = btn.dataset.optMode;
    document.querySelectorAll("[data-opt-mode]").forEach((b) => b.classList.toggle("active", b === btn));
    $("builderBuy").classList.toggle("active", state.optionMode === "buy");
    $("builderSell").classList.toggle("active", state.optionMode === "sell");
  }));

  $("buySide").addEventListener("change", updateBuyPremium);
  $("buyStrike").addEventListener("change", updateBuyPremium);
  $("buildBuy").addEventListener("click", buildBuyPayoff);
  $("paperBuy").addEventListener("click", takePaperBuy);
  $("buildSell").addEventListener("click", buildSellPayoff);
  $("paperSell").addEventListener("click", takePaperSell);
  $("obMode").addEventListener("change", populateObStrategies);
  $("optionBacktestForm").addEventListener("submit", (e) => { e.preventDefault(); runOptionBacktest(); });

  $("chainBody").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-strike]");
    if (!row) return;
    $("buyStrike").value = row.dataset.strike;
    updateBuyPremium();
    toast(`Strike ${fmt(Number(row.dataset.strike), 0)} selected`, true);
  });

  $("paperBody").addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) return closePaperTrade(close.dataset.close);
    const remove = e.target.closest("[data-remove]");
    if (remove) return removePaperTrade(remove.dataset.remove);
  });
  $("paperClear").addEventListener("click", () => {
    if (!state.paper.length) return;
    if (confirm("Clear all paper trades?")) {
      state.paper = [];
      savePaper();
      renderPaper();
    }
  });
  $("paperExport").addEventListener("click", exportPaper);
}

async function init() {
  bindEvents();
  chartController = initCharts();
  terminalController = initTerminal();
  window.addEventListener("solo:open-chart", (event) => {
    const symbol = event.detail?.symbol;
    setView("charts");
    chartController?.open(symbol);
  });
  window.addEventListener("solo:open-ai", (event) => {
    const symbol = event.detail?.symbol;
    terminalController?.openAi(symbol);
    setView("ai");
  });
  window.addEventListener("solo:open-alert", (event) => {
    const symbol = event.detail?.symbol;
    terminalController?.openAlert(symbol);
    setView("alerts");
  });
  try {
    state.config = await api("/api/config");
    populateBacktestStrategies();
    populateObStrategies();
  } catch {
    $("btStrategy").innerHTML = '<option value="ema-trend">EMA Trend</option><option value="rsi-dip">RSI Dip</option><option value="donchian">Donchian Breakout</option><option value="momentum">Momentum 60</option>';
    populateObStrategies();
  }
  renderPaper();
  await Promise.allSettled([loadLive(), loadChain("NIFTY", null, true)]);
  setInterval(() => {
    if (state.view === "dashboard") loadLive(true);
    if (state.view === "options") loadChain(state.chain?.symbol || "NIFTY", state.chain?.expiry || null, true);
  }, 45000);
}

init();

