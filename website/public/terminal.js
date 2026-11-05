/* Solo Trading Charts — trader terminal modules: AI, scanner, news, calculators, alerts, notes, reports, broker, watchlists. */

const TICKER_KEYS = ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX", "BRENT", "WTI", "USDINR", "SPX", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "ITC", "LT"];
const ALERT_KEY = "solo_alert_center_v1";
const NOTE_KEY = "solo_notes_v1";
const REPORT_KEY = "solo_reports_v1";
const WATCH_KEY = "solo_watchlists_v1";
const BROKER_LOG_KEY = "solo_broker_orders_v1";
const PAPER_KEY = "dsl_paper_trades";

const state = {
  view: "dashboard",
  symbols: [],
  live: null,
  scan: null,
  scanPreset: "all",
  scanQuery: "",
  scanSort: { key: "score", dir: -1 },
  news: null,
  newsCategory: "all",
  newsQuery: "",
  macro: null,
  macroLoading: false,
  macroScenario: "cut25",
  ai: { symbol: "NIFTY", style: "intraday", capital: 100000, risk: 1, direction: "auto" },
  aiPlan: null,
  aiLoading: false,
  alerts: loadJson(ALERT_KEY, []),
  alertLive: null,
  alertQuotes: new Map(),
  alertFilter: "all",
  alertDraftSymbol: "SENSEX",
  notes: loadJson(NOTE_KEY, []),
  activeNoteId: null,
  notePreview: false,
  reports: loadJson(REPORT_KEY, []),
  activeReportId: null,
  reportBusy: false,
  dailyArchive: null,
  dailyIndex: [],
  dailyArchiveTried: false,
  broker: null,
  brokerOrders: loadJson(BROKER_LOG_KEY, []),
  watchlists: loadWatchlists(),
  activeListId: "core",
  watchQuotes: [],
  ticker: [],
  tickerTimer: null,
  alertTimer: null,
  paper: loadJson(PAPER_KEY, []),
  calcTab: "risk"
};

function $(id) {
  return document.getElementById(id);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
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
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
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

function fmtCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmtInt(n);
}

function cls(value) {
  if (value == null || !Number.isFinite(Number(value))) return "flat";
  const n = Number(value);
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

function toast(message, ok = false) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("ok", !!ok);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3800);
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

function symbolInfo(key) {
  return state.symbols.find((symbol) => symbol.key === key) || null;
}

function symbolLabel(key) {
  const info = symbolInfo(key);
  if (info) return info.short || info.name || key;
  return String(key || "").replace(/^Y:/, "");
}

function dispatchChart(symbol) {
  window.dispatchEvent(new CustomEvent("solo:open-chart", { detail: { symbol } }));
}

function dispatchAi(symbol) {
  window.dispatchEvent(new CustomEvent("solo:open-ai", { detail: { symbol } }));
}

function dispatchAlert(symbol) {
  window.dispatchEvent(new CustomEvent("solo:open-alert", { detail: { symbol } }));
}

function metric(label, value, sub = "", klass = "") {
  return `<div class="mini-metric"><div class="k">${esc(label)}</div><div class="v ${klass}">${value}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
}

function tag(text, klass = "") {
  return `<span class="tag ${klass}">${esc(text)}</span>`;
}

export function initTerminal() {
  loadSymbols();
  loadTicker();
  clearInterval(state.tickerTimer);
  state.tickerTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadTicker();
  }, 45_000);
  clearInterval(state.alertTimer);
  state.alertTimer = setInterval(() => {
    if (document.visibilityState === "visible" && state.view === "alerts") checkAlerts();
  }, 30_000);
  bindGlobal();
  return {
    activate(view, options = {}) {
      state.view = view;
      if (view === "ai") {
        if (options.symbol) state.ai.symbol = options.symbol;
        renderAi();
        if (!state.aiPlan || options.symbol) loadAi();
      } else if (view === "scanner") {
        renderScanner();
        if (!state.scan) loadScan();
      } else if (view === "news") {
        renderNews();
        if (!state.news) loadNews(state.newsCategory);
      } else if (view === "macro") {
        renderMacro();
        if (!state.macro) loadMacro();
      } else if (view === "calculator") {
        renderCalculator();
      } else if (view === "alerts") {
        if (options.symbol) state.alertDraftSymbol = options.symbol;
        renderAlerts();
        loadAlertContext();
      } else if (view === "notes") {
        renderNotes();
      } else if (view === "reports") {
        renderReports();
        if (!state.dailyArchive && !state.dailyArchiveTried) loadDailyArchive();
      } else if (view === "broker") {
        renderBroker();
        if (!state.broker) loadBroker();
      } else if (view === "watchlist") {
        renderWatchlists();
        loadWatchQuotes();
      }
    },
    refresh(view) {
      if (view === "scanner") loadScan(true);
      else if (view === "news") loadNews(state.newsCategory);
      else if (view === "macro") loadMacro(true);
      else if (view === "ai") loadAi();
      else if (view === "alerts") loadAlertContext();
      else if (view === "broker") loadBroker();
      else if (view === "watchlist") loadWatchQuotes();
      else if (view === "reports") renderReports();
    },
    openAi(symbol) {
      if (symbol) state.ai.symbol = symbol;
      this.activate("ai", { symbol });
    },
    openAlert(symbol) {
      if (symbol) state.alertDraftSymbol = symbol;
      this.activate("alerts", { symbol });
    }
  };
}

function bindGlobal() {
  document.addEventListener("click", (event) => {
    const ticker = event.target.closest("[data-ticker-symbol]");
    if (ticker) dispatchChart(ticker.dataset.tickerSymbol);
  });
  window.addEventListener("solo:terminal-refresh", () => {
    loadTicker();
    if (state.view === "scanner") loadScan(true);
    if (state.view === "alerts") loadAlertContext(true);
  });
}

async function loadSymbols() {
  try {
    const data = await api("/api/symbols");
    state.symbols = data.items || [];
  } catch {
    state.symbols = [];
  }
}

/* --------------------------------- ticker -------------------------------- */

async function loadTicker() {
  try {
    const data = await api(`/api/quotes?symbols=${encodeURIComponent(TICKER_KEYS.join(","))}`);
    state.ticker = data.items || [];
    renderTicker();
  } catch {
    const track = $("tickerTrack");
    if (track && !state.ticker.length) track.innerHTML = `<span class="ticker-loading">Market ticker unavailable</span>`;
  }
}

function renderTicker() {
  const track = $("tickerTrack");
  if (!track) return;
  if (!state.ticker.length) {
    track.innerHTML = `<span class="ticker-loading">Loading market ticker…</span>`;
    return;
  }
  const items = state.ticker.map((item) => {
    const value = item.value == null ? "—" : fmt(item.value);
    const change = item.change == null ? "" : fmtPct(item.change);
    return `<span class="ticker-item" data-ticker-symbol="${esc(item.key)}">
      <span class="ticker-key">${esc(symbolLabel(item.key))}</span>
      <span class="ticker-price">${value}</span>
      <span class="ticker-change ${cls(item.change)}">${change}</span>
    </span>`;
  }).join("");
  track.innerHTML = items + items;
}

/* --------------------------------- AI desk -------------------------------- */

function renderAi() {
  const root = $("aiRoot");
  if (!root) return;
  const plan = state.aiPlan;
  const inputSymbols = state.symbols.filter((symbol) => symbol.type !== "global" || ["SPX", "NDX", "BRENT", "WTI", "USDINR", "BTCUSD"].includes(symbol.key));
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">SOLO AI TRADER</div>
          <div class="module-title">Read the chart. Define the risk. Trade the plan.</div>
          <div class="module-sub">A 10-point trading brain: structure, trend, momentum, volatility, levels, volume, risk, position sizing, options edge and journal discipline. Outputs entry, hard stop, targets, scenarios and a defined-risk option plan.</div>
        </div>
        <div class="module-actions">
          <span class="module-stamp">${plan ? `Plan ${new Date(plan.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST` : "Rule engine v1"}</span>
          <button class="btn btn-ghost" id="aiReRun">Re-run plan</button>
        </div>
      </div>

      <div class="ai-layout">
        <aside class="panel module-card ai-controls">
          <div class="module-card-title">Plan inputs</div>
          <form id="aiForm" class="form-stack">
            <div class="field">
              <label for="aiSymbol">Symbol</label>
              <input id="aiSymbol" list="aiSymbolList" value="${esc(state.ai.symbol)}" autocomplete="off" />
              <datalist id="aiSymbolList">${inputSymbols.map((symbol) => `<option value="${esc(symbol.key)}">${esc(symbol.name)}</option>`).join("")}</datalist>
            </div>
            <div class="field">
              <label>Style</label>
              <div class="seg" id="aiStyle">
                <button type="button" data-ai-style="intraday" class="${state.ai.style === "intraday" ? "active" : ""}">Intraday</button>
                <button type="button" data-ai-style="swing" class="${state.ai.style === "swing" ? "active" : ""}">Swing</button>
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="aiCapital">Capital (₹)</label>
                <input id="aiCapital" type="number" min="1000" step="1000" value="${state.ai.capital}" />
              </div>
              <div class="field">
                <label for="aiRisk">Risk / trade (%)</label>
                <input id="aiRisk" type="number" min="0.1" max="5" step="0.1" value="${state.ai.risk}" />
              </div>
            </div>
            <div class="field">
              <label for="aiDirection">Direction</label>
              <select id="aiDirection">
                <option value="auto" ${state.ai.direction === "auto" ? "selected" : ""}>Auto (chart bias)</option>
                <option value="long" ${state.ai.direction === "long" ? "selected" : ""}>Long only</option>
                <option value="short" ${state.ai.direction === "short" ? "selected" : ""}>Short only</option>
                <option value="range" ${state.ai.direction === "range" ? "selected" : ""}>Range / neutral</option>
              </select>
            </div>
            <button class="btn btn-primary" type="submit" id="aiAnalyze">${state.aiLoading ? "Analyzing…" : "Build trade plan"}</button>
          </form>
          <div class="tiny" style="margin-top:12px">Local multi-factor engine. No orders are placed. Option legs use NSE chain premiums for NIFTY / BANKNIFTY only.</div>
        </aside>

        <div id="aiReport">${renderAiReport(plan)}</div>
      </div>
    </div>`;
  bindAi();
}

function renderAiReport(plan) {
  if (state.aiLoading) return `<div class="panel empty-state">Reading structure, levels, volatility and the option chain…</div>`;
  if (!plan) return `<div class="panel empty-state">Choose a symbol and build a trade plan.</div>`;
  const sideClass = plan.bias.side === "SHORT" ? "short" : plan.bias.side === "RANGE" ? "range" : "";
  const option = plan.option;
  const targets = plan.trade.targets || [];
  const skills = plan.skills || [];
  const checks = plan.checklist || [];
  return `
    <div class="module-grid">
      <article class="panel ai-verdict ${sideClass}">
        <div class="ai-verdict-top">
          <div>
            <div class="eyebrow">${esc(plan.name)} · ${esc(plan.style)} · ${esc(plan.horizon)}</div>
            <div class="ai-side">${esc(plan.bias.side)} <span class="tiny" style="font-size:11px;color:var(--muted)">/ ${esc(plan.bias.label)}</span></div>
            <div class="ai-side-label">Spot ${fmt(plan.market.spot)} · ${fmtPct(plan.market.changePct)} · ${plan.market.marketOpen === false ? "Market closed" : "Market open"} · India VIX ${plan.market.vix ?? "—"}</div>
          </div>
          <div class="ai-confidence">
            <div class="k">Setup confidence</div>
            <div class="v">${plan.bias.confidence}%</div>
            <div class="tiny">Rule score ${fmt(plan.bias.score, 0)}/100</div>
          </div>
        </div>
        <div class="ai-reasons">${(plan.bias.reasons || []).map((reason) => tag(reason, plan.bias.side === "SHORT" ? "red" : plan.bias.side === "RANGE" ? "amber" : "green")).join("")}</div>
        <div class="ai-plan-grid">
          ${metric("Entry trigger", fmt(plan.trade.trigger ?? plan.trade.entry), plan.trade.trigger ? "Wait for confirmation" : "At market")}
          ${metric("Hard stop", fmt(plan.trade.stop), `${fmt(plan.trade.stopPct, 2)}% risk`, "down")}
          ${metric("T2 target", fmt(targets[1] ?? targets[0]), `${fmt(plan.trade.riskReward ?? 0, 1)}R plan`, "up")}
          ${metric("Risk budget", fmtMoney(plan.trade.riskAmount), `${plan.trade.riskPct}% of ${fmtMoney(plan.trade.capital)}`)}
        </div>
        <div class="ai-targets">
          ${targets.slice(0, 3).map((target, index) => `<div class="ai-target"><div class="k">Target ${index + 1}</div><div class="v up">${fmt(target)}</div><div class="s">${index === 0 ? "Book partials" : index === 1 ? "Core target" : "Runner / trail"}</div></div>`).join("")}
        </div>
      </article>

      <div class="module-grid module-two">
        <article class="panel module-card">
          <div class="module-card-title">Trade plan <span class="tag ${plan.bias.side === "SHORT" ? "red" : plan.bias.side === "RANGE" ? "amber" : "green"}">${esc(plan.trade.side)}</span></div>
          <div class="calc-breakdown">
            <div class="calc-line"><span>Instrument</span><b>${esc(plan.trade.instrument)}</b></div>
            <div class="calc-line"><span>Entry zone</span><b>${(plan.trade.entryZone || []).map((value) => fmt(value)).join(" – ")}</b></div>
            <div class="calc-line"><span>Stop distance</span><b>${fmt(plan.trade.stopDistance)} pts / ${fmt(plan.trade.stopPct, 2)}%</b></div>
            <div class="calc-line"><span>Risk : reward</span><b>${plan.trade.riskReward ? `1 : ${fmt(plan.trade.riskReward, 1)}` : "Range plan"}</b></div>
            <div class="calc-line"><span>Position size</span><b>${plan.trade.lots != null ? `${plan.trade.lots} lot${plan.trade.lots === 1 ? "" : "s"} (${fmtInt(plan.trade.qty)} units)` : `${fmtInt(plan.trade.qty)} units`}</b></div>
            <div class="calc-line"><span>Notional</span><b>${fmtMoney(plan.trade.notional)}</b></div>
            <div class="calc-line"><span>Max risk at stop</span><b class="down">${fmtMoney(plan.trade.maxLossAtStop)}</b></div>
            <div class="calc-line total"><span>Plan</span><b>${esc(plan.trade.summary)}</b></div>
          </div>
        </article>

        <article class="panel module-card">
          <div class="module-card-title">Options overlay ${option ? tag(option.strategy, "cyan") : tag("Cash / index", "")}</div>
          ${option ? renderOptionPlan(option) : `<div class="empty-state">Options chain is not available for this symbol. Trade the cash / index plan, or open the options desk for NIFTY / BANKNIFTY.</div>`}
        </article>
      </div>

      <div class="module-grid module-two">
        <article class="panel module-card">
          <div class="module-card-title">The 10-point trading brain</div>
          <div class="ai-skill-grid">${skills.map((skill) => `<div class="ai-skill"><div class="k">${esc(skill.label)}</div><div class="v">${esc(skill.value)}</div><div class="n">${esc(skill.note)}</div></div>`).join("")}</div>
        </article>
        <article class="panel module-card">
          <div class="module-card-title">Pre-trade checklist</div>
          ${checks.map((check) => `<div class="ai-check"><span class="status ${esc(check.status)}"></span><span>${esc(check.text)}</span></div>`).join("")}
        </article>
      </div>

      <div class="module-grid module-two">
        <article class="panel module-card">
          <div class="module-card-title">Scenario map</div>
          ${(plan.scenarios || []).map((scenario) => `<div class="ai-sceanrio"><div class="name">${esc(scenario.name)}</div><div class="cond">${esc(scenario.condition)}</div><div class="act">${esc(scenario.action)} · <b>${esc(scenario.target)}</b></div></div>`).join("")}
        </article>
        <article class="panel module-card">
          <div class="module-card-title">Risk & execution notes</div>
          <div class="ai-narrative">${(plan.narrative || []).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</div>
          <div style="margin-top:9px">${(plan.warnings || []).map((warning) => `<div class="ai-warning">${esc(warning)}</div>`).join("")}</div>
        </article>
      </div>

      <div class="panel module-card">
        <div class="module-actions">
          <button class="btn btn-primary" data-ai-action="chart">Open chart</button>
          <button class="btn btn-ghost" data-ai-action="alert-stop">Alert at stop</button>
          <button class="btn btn-ghost" data-ai-action="alert-target">Alert at T2</button>
          <button class="btn btn-ghost" data-ai-action="note">Save as note</button>
          <button class="btn btn-ghost" data-ai-action="report">Add to report</button>
          <span class="tiny">${esc(plan.disclaimer || "")}</span>
        </div>
      </div>
    </div>`;
}

function renderOptionPlan(option) {
  if (option.legs) {
    return `
      <div class="ai-option">
        <div class="calc-line"><span>Strategy</span><b>${esc(option.strategy)}</b></div>
        <div class="calc-line"><span>Expiry</span><b>${esc(option.expiry)}</b></div>
        <div class="calc-line"><span>Net credit</span><b class="up">${fmt(option.netCredit)}</b></div>
        <div class="calc-line"><span>Max loss / profit</span><b>${fmtMoney(option.maxLoss)} / ${fmtMoney(option.maxProfit)}</b></div>
        <div class="calc-line"><span>Breakevens</span><b>${(option.breakeven || []).map((value) => fmt(value)).join(" / ")}</b></div>
        <div class="legs">${option.legs.map((leg) => `<div class="ai-leg"><span>${leg.action === "sell" ? "SELL" : "BUY"} ${leg.type} ${fmt(leg.strike, 0)}</span><span>@ ${fmt(leg.premium)}</span></div>`).join("")}</div>
        <div class="tiny" style="margin-top:6px">${esc(option.note || "")}</div>
      </div>`;
  }
  return `
    <div class="ai-option">
      <div class="calc-line"><span>Strategy</span><b>${esc(option.strategy)}</b></div>
      <div class="calc-line"><span>Strike / type</span><b>${fmt(option.strike, 0)} ${esc(option.type)}</b></div>
      <div class="calc-line"><span>Expiry</span><b>${esc(option.expiry)}</b></div>
      <div class="calc-line"><span>Premium</span><b>${fmt(option.premium)} × ${option.lots} lot${option.lots === 1 ? "" : "s"}</b></div>
      <div class="calc-line"><span>Premium stop</span><b class="down">${fmt(option.stopPremium)} (−${option.premiumStopPct}%)</b></div>
      <div class="calc-line"><span>Premium target</span><b class="up">${fmt(option.targetPremium)} (+${option.premiumTargetPct}%)</b></div>
      <div class="calc-line"><span>Breakeven</span><b>${fmt(option.breakeven)}</b></div>
      <div class="calc-line"><span>Max loss / risk at stop</span><b>${fmtMoney(option.maxLoss)} / ${fmtMoney(option.riskAtStop)}</b></div>
      <div class="calc-line total"><span>IV / PCR / Max pain</span><b>${fmt(option.iv, 1)}% / ${fmt(option.pcr, 2)} / ${fmt(option.maxPain, 0)}</b></div>
      <div class="tiny" style="margin-top:6px">${(option.rationale || []).map(esc).join(" · ")}</div>
    </div>`;
}

function bindAi() {
  const root = $("aiRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const styleBtn = event.target.closest("[data-ai-style]");
    if (styleBtn) {
      state.ai.style = styleBtn.dataset.aiStyle;
      renderAi();
      return;
    }
    if (event.target.closest("#aiReRun")) {
      loadAi();
      return;
    }
    const action = event.target.closest("[data-ai-action]")?.dataset.aiAction;
    if (action) handleAiAction(action);
  });
  root.addEventListener("submit", (event) => {
    if (event.target.id !== "aiForm") return;
    event.preventDefault();
    state.ai = {
      symbol: String($("aiSymbol")?.value || "NIFTY").trim().toUpperCase(),
      style: state.ai.style,
      capital: Number($("aiCapital")?.value) || 100000,
      risk: Number($("aiRisk")?.value) || 1,
      direction: $("aiDirection")?.value || "auto"
    };
    loadAi();
  });
}

async function loadAi() {
  if (state.aiLoading) return;
  state.aiLoading = true;
  renderAi();
  try {
    const query = new URLSearchParams({
      symbol: state.ai.symbol,
      style: state.ai.style,
      capital: state.ai.capital,
      risk: state.ai.risk,
      direction: state.ai.direction
    });
    state.aiPlan = await api(`/api/ai/plan?${query}`);
    toast("AI trade plan refreshed.", true);
  } catch (error) {
    state.aiPlan = null;
    toast(`AI plan: ${error.message}`);
  } finally {
    state.aiLoading = false;
    renderAi();
  }
}

function handleAiAction(action) {
  const plan = state.aiPlan;
  if (!plan) return;
  if (action === "chart") {
    dispatchChart(plan.symbol);
  } else if (action === "alert-stop" && plan.trade.stop) {
    createAlert({ symbol: plan.symbol, metric: "price", condition: plan.bias.side === "SHORT" ? "above" : "below", value: plan.trade.stop, note: "AI plan invalidation" });
    toast("Stop alert created.", true);
  } else if (action === "alert-target" && plan.trade.targets?.[1]) {
    createAlert({ symbol: plan.symbol, metric: "price", condition: plan.bias.side === "SHORT" ? "below" : "above", value: plan.trade.targets[1], note: "AI plan T2" });
    toast("Target alert created.", true);
  } else if (action === "note") {
    const note = createNote({
      title: `${plan.name} · ${plan.bias.side} plan`,
      symbol: plan.symbol,
      tags: "AI, trade-plan",
      body: aiPlanMarkdown(plan)
    });
    state.activeNoteId = note.id;
    toast("Plan saved to Notes.", true);
  } else if (action === "report") {
    generateReport("ai", plan);
  }
}

function aiPlanMarkdown(plan) {
  return `# ${plan.name} — ${plan.bias.side} plan\n\n` +
    `- Generated: ${new Date(plan.generatedAt).toLocaleString("en-IN")}\n` +
    `- Spot: ${fmt(plan.market.spot)}\n` +
    `- Bias: ${plan.bias.label} (confidence ${plan.bias.confidence}%)\n` +
    `- Entry trigger: ${fmt(plan.trade.trigger ?? plan.trade.entry)}\n` +
    `- Stop: ${fmt(plan.trade.stop)} (${fmt(plan.trade.stopPct, 2)}%)\n` +
    `- Targets: ${(plan.trade.targets || []).map((target) => fmt(target)).join(" / ")}\n` +
    `- Risk budget: ${fmtMoney(plan.trade.riskAmount)}\n` +
    `- Position: ${plan.trade.lots != null ? `${plan.trade.lots} lots / ` : ""}${fmtInt(plan.trade.qty)} units\n\n` +
    `## Options overlay\n${plan.option ? `${plan.option.strategy} · ${plan.option.expiry}\n\n${(plan.option.rationale || []).map((line) => `- ${line}`).join("\n")}` : "No option chain for this symbol."}\n\n` +
    `## Checklist\n${(plan.checklist || []).map((item) => `- [${item.status === "pass" ? "x" : " "}] ${item.text}`).join("\n")}\n\n` +
    `## Warnings\n${(plan.warnings || []).map((warning) => `- ${warning}`).join("\n")}\n`;
}

/* -------------------------------- scanner -------------------------------- */

function renderScanner() {
  const root = $("scannerRoot");
  if (!root) return;
  const scan = state.scan;
  if (!scan) {
    root.innerHTML = `<div class="module-shell"><div class="panel module-head"><div><div class="eyebrow">CHART SCANNER</div><div class="module-title">Scanning the NSE tape…</div><div class="module-sub">Daily trend, momentum, relative volume and volatility filters across indices and 30 liquid stocks.</div></div></div><div class="panel empty-state">Loading scanner data from TradingView…</div></div>`;
    return;
  }
  const summary = scan.summary || {};
  const filtered = filteredScanItems();
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">CHART SCANNER</div>
          <div class="module-title">Find the chart that is ready to move.</div>
          <div class="module-sub">Daily trend, momentum, 1-month breakout/breakdown, relative volume and volatility. Click any row to send it to Solo charts.</div>
        </div>
        <div class="module-actions">
          <span class="module-stamp">${new Date(scan.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST · ${esc(scan.source || "TradingView")}</span>
          <button class="btn btn-ghost" id="scanRefresh">Refresh scan</button>
        </div>
      </div>
      <div class="scan-summary">
        ${metric("Advancing", summary.advancing ?? "—", `${summary.declining ?? "—"} declining`)}
        ${metric("Above 20-EMA", summary.above20 ?? "—", `of ${summary.count ?? "—"} symbols`)}
        ${metric("Above 200-EMA", summary.above200 ?? "—", "long-term trend")}
        ${metric("Oversold", summary.oversold ?? "—", "RSI below 30")}
        ${metric("1M breakouts", summary.breakouts ?? "—", "within 0.5% of high")}
        ${metric("Average RSI", summary.avgRsi ?? "—", "market momentum")}
      </div>
      <div class="panel scan-toolbar">
        <div class="seg" id="scanPresets">
          ${(scan.presets || []).map((preset) => `<button type="button" data-scan-preset="${esc(preset.key)}" class="${state.scanPreset === preset.key ? "active" : ""}">${esc(preset.label)}</button>`).join("")}
        </div>
        <input id="scanSearch" placeholder="Filter symbol / sector…" value="${esc(state.scanQuery)}" />
        <span class="tiny" style="margin-left:auto">${filtered.length} matches</span>
      </div>
      <div class="panel" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="scan-table">
            <thead><tr>
              ${scanTh("Symbol", "name")}
              ${scanTh("Price", "value")}
              ${scanTh("Change", "change")}
              ${scanTh("RSI", "rsi")}
              ${scanTh("Trend", "trend")}
              ${scanTh("Score", "score")}
              ${scanTh("Signals", "signals")}
              <th>Action</th>
            </tr></thead>
            <tbody>${filtered.length ? filtered.map(renderScanRow).join("") : `<tr><td colspan="8"><div class="empty-state">No symbols match this filter.</div></td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  bindScanner();
}

function scanTh(label, key) {
  const active = state.scanSort.key === key;
  const arrow = active ? (state.scanSort.dir > 0 ? "↑" : "↓") : "↕";
  return `<th data-scan-sort="${key}">${label} <span style="opacity:.45">${arrow}</span></th>`;
}

function filteredScanItems() {
  const scan = state.scan;
  if (!scan) return [];
  const query = state.scanQuery.toLowerCase();
  let items = (scan.items || []).filter((item) => {
    if (query && !`${item.key} ${item.name} ${item.sector || ""}`.toLowerCase().includes(query)) return false;
    if (state.scanPreset === "momentum") return item.score >= 60 && item.rsi >= 50 && item.change > 0;
    if (state.scanPreset === "breakout") return (item.signals || []).includes("1M breakout");
    if (state.scanPreset === "trend") return item.trend.includes("uptrend");
    if (state.scanPreset === "oversold") return item.rsi < 35;
    if (state.scanPreset === "bearish") return item.trend.includes("downtrend") || item.rating.includes("Sell");
    if (state.scanPreset === "volume") return item.relVolume >= 1.2;
    return true;
  });
  const { key, dir } = state.scanSort;
  items = items.slice().sort((a, b) => {
    const av = key === "name" ? a.name : a[key];
    const bv = key === "name" ? b.name : b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  return items;
}

function renderScanRow(item) {
  const score = item.score ?? 0;
  const ratingClass = item.rating.includes("buy") ? "green" : item.rating.includes("Sell") ? "red" : "";
  return `<tr data-scan-row="${esc(item.key)}">
    <td><div class="scan-name">${esc(item.key)}</div><div class="scan-meta">${esc(item.name)} ${item.sector ? `· ${esc(item.sector)}` : ""}</div></td>
    <td class="mono">${fmt(item.value)}</td>
    <td class="mono ${cls(item.change)}">${fmtPct(item.change)}</td>
    <td class="mono ${item.rsi >= 70 ? "down" : item.rsi <= 30 ? "up" : ""}">${fmt(item.rsi, 1)}</td>
    <td><span class="tiny">${esc(item.trend)}</span><div style="margin-top:2px">${tag(item.rating, ratingClass)}</div></td>
    <td><div class="scan-score"><div class="scan-bar"><span style="width:${Math.max(2, Math.min(100, score))}%;background:${score >= 60 ? "var(--green)" : score <= 40 ? "var(--red)" : "var(--cyan)"}"></span></div><span class="mono">${score}</span></div></td>
    <td><div class="scan-signals">${(item.signals || []).slice(0, 2).map((signal) => tag(signal)).join("") || `<span class="tiny">—</span>`}</div></td>
    <td class="scan-action"><button class="btn btn-ghost" data-scan-chart="${esc(item.key)}">Chart</button></td>
  </tr>`;
}

function bindScanner() {
  const root = $("scannerRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-scan-preset]");
    if (preset) {
      state.scanPreset = preset.dataset.scanPreset;
      renderScanner();
      return;
    }
    const sort = event.target.closest("[data-scan-sort]");
    if (sort) {
      const key = sort.dataset.scanSort;
      state.scanSort = { key, dir: state.scanSort.key === key ? -state.scanSort.dir : -1 };
      renderScanner();
      return;
    }
    const chart = event.target.closest("[data-scan-chart]");
    if (chart) dispatchChart(chart.dataset.scanChart);
    if (event.target.closest("#scanRefresh")) loadScan(true);
  });
  root.addEventListener("input", (event) => {
    if (event.target.id === "scanSearch") {
      state.scanQuery = event.target.value;
      renderScanner();
    }
  });
}

async function loadScan(force = false) {
  if (state.scan && !force) return;
  try {
    state.scan = await api("/api/scan");
    if (state.view === "scanner") renderScanner();
  } catch (error) {
    toast(`Scanner: ${error.message}`);
  }
}

/* ---------------------------------- news --------------------------------- */

const NEWS_CATEGORIES = [
  ["all", "All wires"], ["india", "India"], ["global", "Global"], ["commodities", "Commodities"],
  ["economy", "Economy"], ["corporate", "Corporate"], ["crypto", "Crypto"], ["forex", "Currencies"], ["geopolitics", "Geopolitics"]
];

function renderNews() {
  const root = $("newsRoot");
  if (!root) return;
  const feed = state.news;
  const categories = feed?.categories?.length ? feed.categories : NEWS_CATEGORIES.map(([key, label]) => ({ key, label }));
  const items = (feed?.items || []).filter((item) => !state.newsQuery || `${item.title} ${item.source}`.toLowerCase().includes(state.newsQuery.toLowerCase()));
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">NEWS TERMINAL</div>
          <div class="module-title">Everything moving the tape.</div>
          <div class="module-sub">Indian markets, global markets, commodities, economy, corporate earnings, crypto, currencies and geopolitics in one filtered wire. Headlines are gathered from Google News and linked to the original publisher.</div>
        </div>
        <div class="module-actions">
          <span class="module-stamp">${feed ? new Date(feed.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) + " IST" : "Live RSS"}</span>
          <button class="btn btn-ghost" id="newsRefresh">Refresh</button>
        </div>
      </div>
      <div class="panel scan-toolbar">
        <div class="seg news-tabs" id="newsTabs">${categories.map((category) => `<button type="button" data-news-category="${esc(category.key)}" class="${state.newsCategory === category.key ? "active" : ""}">${esc(category.label)}</button>`).join("")}</div>
        <input id="newsSearch" placeholder="Search headlines…" value="${esc(state.newsQuery)}" />
      </div>
      <div class="news-grid">
        ${items.length ? items.map(renderNewsCard).join("") : `<div class="panel empty-state" style="grid-column:1/-1">No headlines match this filter.</div>`}
      </div>
    </div>`;
  bindNews();
}

function renderNewsCard(item) {
  const href = /^https?:\/\//i.test(item.link || "") ? item.link : "#";
  return `<article class="news-card">
    <div class="news-card-top"><span class="news-source">${esc(item.source || "News")}</span><span class="news-time">${esc(item.ago || "")}</span></div>
    <div class="news-title"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></div>
    <div class="news-tags">${tag(item.categoryLabel || item.category, "cyan")}${tag(item.sentiment || "neutral", item.sentiment === "positive" ? "green" : item.sentiment === "negative" ? "red" : "")}</div>
  </article>`;
}

function bindNews() {
  const root = $("newsRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-news-category]");
    if (tab) {
      state.newsCategory = tab.dataset.newsCategory;
      state.news = null;
      renderNews();
      loadNews(state.newsCategory);
      return;
    }
    if (event.target.closest("#newsRefresh")) loadNews(state.newsCategory, true);
  });
  root.addEventListener("input", (event) => {
    if (event.target.id === "newsSearch") {
      state.newsQuery = event.target.value;
      renderNews();
    }
  });
}

async function loadNews(category = "all", force = false) {
  if (state.news && !force && state.news.category === category) return;
  state.newsCategory = category;
  try {
    state.news = await api(`/api/news/feed?category=${encodeURIComponent(category)}`);
    if (state.view === "news") renderNews();
  } catch (error) {
    toast(`News: ${error.message}`);
  }
}

/* ------------------------------- macro radar ----------------------------- */

function macroQuoteLine(quote) {
  if (!quote) return `<span class="tiny">Unavailable</span>`;
  return `<span class="macro-quote-value">${fmt(quote.value)}</span> <span class="${cls(quote.change)}">${fmtPct(quote.change)}</span>`;
}

function macroHeadlines(items, empty = "No fresh headlines in this feed.") {
  if (!items?.length) return `<div class="tiny macro-empty">${esc(empty)}</div>`;
  return `<div class="macro-headline-list">${items.map((item) => {
    const href = /^https?:\/\//i.test(item.link || "") ? item.link : "#";
    return `<a class="macro-headline" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
      <span class="macro-headline-title">${esc(item.title)}</span>
      <span class="macro-headline-meta">${esc(item.source || "News")}${item.ago ? ` · ${esc(item.ago)}` : ""}</span>
    </a>`;
  }).join("")}</div>`;
}

function macroList(items) {
  if (!items?.length) return "";
  return `<ul class="macro-list">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function renderMacro() {
  const root = $("macroRoot");
  if (!root) return;
  if (state.macroLoading && !state.macro) {
    root.innerHTML = `<div class="module-shell"><div class="panel empty-state">Building the macro radar — quotes, bank correlation, rupee, crude, war-risk headlines and policy events…</div></div>`;
    return;
  }
  if (!state.macro) {
    root.innerHTML = `<div class="module-shell"><div class="panel empty-state">Macro radar is unavailable right now. <button class="btn btn-ghost" data-macro-refresh>Retry</button></div></div>`;
    bindMacro();
    return;
  }

  const m = state.macro;
  const q = m.market || {};
  const bank = m.bankNifty || {};
  const rupee = m.rupee || {};
  const crude = m.crude || {};
  const war = m.war || {};
  const events = m.events || {};
  const fed = m.fed || {};
  const activeScenario = (fed.scenarios || []).find((scenario) => scenario.key === state.macroScenario) || (fed.scenarios || [])[0];
  const policy = m.policyWatch || {};
  const regimeClass = /risk-off|mixed|event/i.test(m.regime || "") ? "warn" : "good";

  root.innerHTML = `<div class="module-shell macro-shell">
    <div class="panel module-head">
      <div>
        <div class="eyebrow">MACRO RADAR</div>
        <h2 class="module-title">The macro map behind the chart</h2>
        <div class="module-sub">Bank Nifty dependency, rupee, crude, war-risk headlines, Fed 25 bp scenarios, GIFT City / FPI tax and World Bank / rare-earth event watch. Headlines are third-party; scenario impacts are tendencies, not forecasts.</div>
      </div>
      <div class="module-actions">
        <span class="module-stamp">${new Date(m.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST</span>
        <button class="btn btn-ghost" data-macro-refresh>Refresh radar</button>
      </div>
    </div>

    <div class="panel macro-hero">
      <div class="macro-hero-main">
        <div class="macro-regime ${regimeClass}">${esc(m.regime || "Mixed")}</div>
        <div class="macro-summary">${esc(m.summary || "")}</div>
        <div class="macro-hero-actions">
          <button class="btn btn-primary" data-macro-chart="BANKNIFTY">Open Bank Nifty</button>
          <button class="btn btn-ghost" data-macro-ai="BANKNIFTY">AI Bank Nifty plan</button>
          <button class="btn btn-ghost" data-macro-chart="NIFTY">Open Nifty</button>
        </div>
      </div>
      <div class="risk-box">
        <div class="risk-ring" style="--risk:${Number(war.score) || 0}">
          <div><b>${Number(war.score) || 0}</b><span>/100</span></div>
        </div>
        <div class="risk-label ${Number(war.score) >= 70 ? "down" : Number(war.score) >= 55 ? "warn" : "up"}">${esc(war.label || "Watch")}</div>
        <div class="tiny">War / stress gauge</div>
      </div>
      <div class="macro-tape">
        <div class="macro-tape-item"><span>NIFTY</span>${macroQuoteLine(q.nifty)}</div>
        <div class="macro-tape-item"><span>BANKNIFTY</span>${macroQuoteLine(q.bankNifty)}</div>
        <div class="macro-tape-item"><span>USD/INR</span>${macroQuoteLine(q.usdinr)}</div>
        <div class="macro-tape-item"><span>BRENT</span>${macroQuoteLine(q.brent)}</div>
        <div class="macro-tape-item"><span>INDIA VIX</span>${macroQuoteLine(q.vix)}</div>
        <div class="macro-tape-item"><span>US 10Y</span>${macroQuoteLine(q.us10y)}</div>
      </div>
    </div>

    <div class="macro-grid">
      <section class="panel macro-card">
        <div class="macro-card-head">
          <div><div class="eyebrow">DEPENDENCY</div><h3>Bank Nifty ↔ Nifty</h3></div>
          <span class="tag ${bank.dependency === "Very high" || bank.dependency === "High" ? "red" : "cyan"}">${esc(bank.dependency || "Unknown")}</span>
        </div>
        <div class="macro-stat-row">
          ${metric("Correlation (60D)", bank.correlation == null ? "—" : fmt(bank.correlation, 2), "Daily returns")}
          ${metric("Beta to Nifty", bank.beta == null ? "—" : fmt(bank.beta, 2), "1 = market")}
          ${metric("Relative strength 1M", bank.relativeStrength1m == null ? "—" : fmtPct(bank.relativeStrength1m), "Bank − Nifty", cls(bank.relativeStrength1m))}
        </div>
        <div class="macro-split-note">${esc(bank.note || "")}</div>
        <div class="macro-table-wrap">
          <table class="data-table macro-table">
            <thead><tr><th>Bank mover</th><th>Last</th><th>Day</th><th>Corr</th><th>Beta</th><th>RSI</th></tr></thead>
            <tbody>${(bank.movers || []).map((item) => `<tr><td>${esc(item.key)}</td><td>${fmt(item.value)}</td><td class="${cls(item.change)}">${fmtPct(item.change)}</td><td>${item.correlation == null ? "—" : fmt(item.correlation, 2)}</td><td>${item.beta == null ? "—" : fmt(item.beta, 2)}</td><td>${item.rsi == null ? "—" : fmt(item.rsi, 1)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
        <div class="macro-card-actions"><button class="btn btn-ghost" data-macro-chart="BANKNIFTY">Bank Nifty chart</button><button class="btn btn-ghost" data-macro-ai="BANKNIFTY">AI plan</button><button class="btn btn-ghost" data-macro-alert="BANKNIFTY">Alert Bank Nifty</button></div>
      </section>

      <section class="panel macro-card">
        <div class="macro-card-head">
          <div><div class="eyebrow">RUPEE</div><h3>Rupee pulse</h3></div>
          <span class="tag ${/pressure|weaken/i.test(rupee.stress || "") ? "red" : "green"}">${esc(rupee.trend || "Range")}</span>
        </div>
        <div class="macro-big">${macroQuoteLine(rupee.quote)}</div>
        <div class="macro-stat-row">
          ${metric("1 week", fmtPct(rupee.weekChange), "USD/INR", cls(rupee.weekChange))}
          ${metric("1 month", fmtPct(rupee.monthChange), "USD/INR", cls(rupee.monthChange))}
          ${metric("3 months", fmtPct(rupee.quarterChange), "USD/INR", cls(rupee.quarterChange))}
        </div>
        <div class="macro-levels"><span>20 EMA <b>${fmt(rupee.ema20)}</b></span><span>50 EMA <b>${fmt(rupee.ema50)}</b></span><span>Support <b>${fmt(rupee.support)}</b></span><span>Resistance <b>${fmt(rupee.resistance)}</b></span></div>
        <div class="macro-split-note">${esc(rupee.note || "")}</div>
        <div class="macro-two-col">
          <div><div class="macro-minihead up">Rupee weaker helps</div>${macroList(rupee.winners)}</div>
          <div><div class="macro-minihead down">Rupee weaker hurts</div>${macroList(rupee.losers)}</div>
        </div>
        <div class="macro-card-actions"><button class="btn btn-ghost" data-macro-chart="USDINR">USD/INR chart</button><button class="btn btn-ghost" data-macro-alert="USDINR">Alert rupee</button></div>
      </section>

      <section class="panel macro-card">
        <div class="macro-card-head">
          <div><div class="eyebrow">CRUDE</div><h3>Oil & India</h3></div>
          <span class="tag ${crude.risk === "High" ? "red" : crude.risk === "Elevated" ? "amber" : "green"}">${esc(crude.risk || "Normal")} risk</span>
        </div>
        <div class="macro-big">${macroQuoteLine(crude.brent)} <span class="tiny">Brent</span></div>
        <div class="macro-stat-row">
          ${metric("WTI", crude.wti ? fmt(crude.wti.value) : "—", crude.wti ? fmtPct(crude.wti.change) : "", crude.wti ? cls(crude.wti.change) : "")}
          ${metric("1 week", fmtPct(crude.weekChange), "Brent", cls(crude.weekChange))}
          ${metric("1 month", fmtPct(crude.monthChange), "Brent", cls(crude.monthChange))}
        </div>
        <div class="macro-levels"><span>20 EMA <b>${fmt(crude.ema20)}</b></span><span>Support <b>${fmt(crude.support)}</b></span><span>Resistance <b>${fmt(crude.resistance)}</b></span></div>
        <div class="macro-split-note">${esc(crude.sensitivity || "")}</div>
        <div class="macro-two-col">
          <div><div class="macro-minihead up">Oil-up winners</div>${macroList(crude.winners)}</div>
          <div><div class="macro-minihead down">Oil-up losers</div>${macroList(crude.losers)}</div>
        </div>
        <div class="macro-card-actions"><button class="btn btn-ghost" data-macro-chart="BRENT">Brent chart</button><button class="btn btn-ghost" data-macro-alert="BRENT">Alert Brent</button></div>
      </section>

      <section class="panel macro-card macro-war">
        <div class="macro-card-head">
          <div><div class="eyebrow">WAR & HEADLINE RISK</div><h3>Situation monitor</h3></div>
          <span class="tag ${Number(war.score) >= 70 ? "red" : Number(war.score) >= 55 ? "amber" : "green"}">${esc(war.label || "Watch")} ${Number(war.score) || 0}/100</span>
        </div>
        <div class="war-meter"><div style="width:${Math.max(2, Math.min(100, Number(war.score) || 0))}%"></div></div>
        <div class="macro-split-note">Drivers: ${(war.drivers || []).map(esc).join(" · ") || "No stress drivers detected."}</div>
        <div class="macro-subhead">Latest geopolitical headlines</div>
        ${macroHeadlines(war.headlines, "Geopolitical feed is quiet.")}
        <div class="macro-subhead">Trading playbook</div>
        ${macroList(war.playbook)}
        <div class="macro-card-actions"><button class="btn btn-ghost" data-macro-chart="NIFTY">Nifty chart</button><button class="btn btn-ghost" data-macro-alert="NIFTY">Alert Nifty</button></div>
      </section>
    </div>

    <section class="panel macro-section">
      <div class="macro-section-head"><div><div class="eyebrow">EVENT WATCH</div><h3>Fed, World Bank, rare earth and India policy</h3></div><span class="tag cyan">Live headlines</span></div>
      <div class="event-grid">
        <article class="event-card"><div class="event-title">Fed / FOMC</div><div class="event-note">Rate decision, dot plot and the press-conference tone matter more than the 25 bp headline. Use the scenario table below.</div>${macroHeadlines(events.fed?.items)}</article>
        <article class="event-card"><div class="event-title">Rare earth metals</div><div class="event-note">${esc(events.rareEarth?.note || "")}</div>${macroHeadlines(events.rareEarth?.items)}</article>
        <article class="event-card"><div class="event-title">World Bank / IMF</div><div class="event-note">${esc(events.worldBank?.note || "")}</div>${macroHeadlines(events.worldBank?.items)}</article>
        <article class="event-card"><div class="event-title">India policy / GIFT City</div><div class="event-note">Foreign-investor tax, IFSC rules and RBI–Finance Ministry coordination. See the policy-watch cards below.</div>${macroHeadlines(events.policy?.items)}</article>
      </div>
    </section>

    <section class="panel macro-section fed-scenario">
      <div class="macro-section-head">
        <div><div class="eyebrow">US FED — 25 BP SCENARIOS</div><h3>What a 0.25% move can do to India</h3></div>
        <div class="seg macro-scenario-tabs">${(fed.scenarios || []).map((scenario) => `<button type="button" data-macro-scenario="${esc(scenario.key)}" class="${activeScenario?.key === scenario.key ? "active" : ""}">${esc(scenario.label)}</button>`).join("")}</div>
      </div>
      <div class="fed-context">
        <span>VIX <b>${fmt(q.vix?.value)}</b></span><span>USD/INR <b>${fmt(q.usdinr?.value)}</b></span><span>DXY <b>${fmt(q.dxy?.value)}</b></span><span>US 10Y <b>${fmt(q.us10y?.value)}</b></span><span>Nifty <b class="${cls(q.nifty?.change)}">${fmtPct(q.nifty?.change)}</b></span><span>Bank Nifty <b class="${cls(q.bankNifty?.change)}">${fmtPct(q.bankNifty?.change)}</b></span>
      </div>
      ${activeScenario ? `<div class="fed-scenario-body">
        <div class="fed-scenario-summary ${activeScenario.tone === "positive" ? "up" : activeScenario.tone === "negative" ? "down" : "flat"}">${esc(activeScenario.summary)}</div>
        <div class="macro-table-wrap"><table class="data-table macro-table"><thead><tr><th>Asset / sector</th><th>Typical tendency</th><th>Why</th></tr></thead><tbody>${(activeScenario.rows || []).map((row) => `<tr><td>${esc(row[0])}</td><td><b>${esc(row[1])}</b></td><td>${esc(row[2])}</td></tr>`).join("")}</tbody></table></div>
        <div class="tiny" style="margin-top:10px">${esc(fed.pricedIn || "Tendencies only — not a prediction.")}</div>
      </div>` : ""}
    </section>

    <section class="panel macro-section">
      <div class="macro-section-head"><div><div class="eyebrow">POLICY WATCH</div><h3>GIFT City, RBI–Finance Ministry and foreign-investor tax</h3></div><span class="tag cyan">Headline tracker</span></div>
      <div class="policy-grid">
        ${["giftCity", "rbiFinance", "pmTax"].map((key) => {
          const item = policy[key] || {};
          return `<article class="policy-card"><div class="event-title">${esc(item.title || key)}</div><p>${esc(item.explainer || "")}</p>${macroHeadlines(item.items, "No matching headlines right now.")}</article>`;
        }).join("")}
      </div>
    </section>

    <div class="macro-disclaimer">${esc(m.disclaimer || "Research only. Not investment advice.")}</div>
  </div>`;
  bindMacro();
}

function bindMacro() {
  const root = $("macroRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-macro-refresh]")) {
      loadMacro(true);
      return;
    }
    const scenario = event.target.closest("[data-macro-scenario]");
    if (scenario) {
      state.macroScenario = scenario.dataset.macroScenario;
      renderMacro();
      return;
    }
    const chart = event.target.closest("[data-macro-chart]");
    if (chart) {
      dispatchChart(chart.dataset.macroChart);
      return;
    }
    const ai = event.target.closest("[data-macro-ai]");
    if (ai) dispatchAi(ai.dataset.macroAi);
    const alert = event.target.closest("[data-macro-alert]");
    if (alert) dispatchAlert(alert.dataset.macroAlert);
  });
}

async function loadMacro(force = false) {
  if (state.macroLoading) return;
  if (state.macro && !force) return;
  state.macroLoading = true;
  if (state.view === "macro") renderMacro();
  try {
    state.macro = await api("/api/macro/radar");
  } catch (error) {
    toast(`Macro radar: ${error.message}`);
  } finally {
    state.macroLoading = false;
    if (state.view === "macro") renderMacro();
  }
}

/* ------------------------------- calculators ------------------------------ */

function renderCalculator() {
  const root = $("calculatorRoot");
  if (!root) return;
  const tabs = [["risk", "Position size"], ["option", "Options price"], ["charges", "Charges"], ["atr", "ATR / targets"]];
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">TRADING CALCULATORS</div>
          <div class="module-title">Size the trade before you take it.</div>
          <div class="module-sub">Risk-first position sizing, Black-Scholes option pricing, Indian brokerage estimates and ATR target maps. Everything is computed locally in your browser.</div>
        </div>
        <div class="module-actions"><span class="module-stamp">No broker connection needed</span></div>
      </div>
      <div class="calc-layout">
        <div class="panel calc-card">
          <div class="seg calc-tabs" id="calcTabs">${tabs.map(([key, label]) => `<button type="button" data-calc-tab="${key}" class="${state.calcTab === key ? "active" : ""}">${label}</button>`).join("")}</div>
          <div id="calcForm" style="margin-top:12px">${calcFormMarkup()}</div>
        </div>
        <div class="panel calc-card">
          <div class="module-card-title">Result <span class="tiny">live as you type</span></div>
          <div id="calcResult">${calcResultMarkup()}</div>
        </div>
      </div>
    </div>`;
  bindCalculator();
  requestAnimationFrame(runCalc);
}

function calcFormMarkup() {
  if (state.calcTab === "option") {
    return `<div class="form-stack">
      <div class="field-row"><div class="field"><label>Spot</label><input id="calcSpot" type="number" step="0.05" value="22600" /></div><div class="field"><label>Strike</label><input id="calcStrike" type="number" step="0.05" value="22600" /></div></div>
      <div class="field-row"><div class="field"><label>IV (%)</label><input id="calcIv" type="number" step="0.1" value="14.3" /></div><div class="field"><label>Days to expiry</label><input id="calcDays" type="number" step="1" value="7" /></div></div>
      <div class="field-row"><div class="field"><label>Type</label><select id="calcType"><option value="CE">Call (CE)</option><option value="PE">Put (PE)</option></select></div><div class="field"><label>Lot size</label><input id="calcLot" type="number" step="1" value="75" /></div></div>
    </div>`;
  }
  if (state.calcTab === "charges") {
    return `<div class="form-stack">
      <div class="field"><label>Segment</label><select id="calcSegment"><option value="options">Options</option><option value="futures">Futures</option><option value="equity">Equity intraday</option></select></div>
      <div class="field-row"><div class="field"><label>Buy turnover (₹)</label><input id="calcBuy" type="number" step="1000" value="150000" /></div><div class="field"><label>Sell turnover (₹)</label><input id="calcSell" type="number" step="1000" value="165000" /></div></div>
      <div class="field-row"><div class="field"><label>Brokerage / order (₹)</label><input id="calcBrokerage" type="number" step="1" value="20" /></div><div class="field"><label>Orders</label><input id="calcOrders" type="number" step="1" value="2" /></div></div>
    </div>`;
  }
  if (state.calcTab === "atr") {
    return `<div class="form-stack">
      <div class="field-row"><div class="field"><label>Spot / entry</label><input id="calcAtrPrice" type="number" step="0.05" value="22600" /></div><div class="field"><label>ATR (points)</label><input id="calcAtrValue" type="number" step="0.05" value="295.75" /></div></div>
      <div class="field-row"><div class="field"><label>ATR multiplier</label><input id="calcAtrMult" type="number" step="0.1" value="1.2" /></div><div class="field"><label>Direction</label><select id="calcAtrSide"><option value="long">Long</option><option value="short">Short</option></select></div></div>
      <div class="field-row"><div class="field"><label>Capital (₹)</label><input id="calcAtrCapital" type="number" step="1000" value="100000" /></div><div class="field"><label>Risk (%)</label><input id="calcAtrRisk" type="number" step="0.1" value="1" /></div></div>
    </div>`;
  }
  return `<div class="form-stack">
    <div class="field-row"><div class="field"><label>Capital (₹)</label><input id="calcCapital" type="number" step="1000" value="100000" /></div><div class="field"><label>Risk / trade (%)</label><input id="calcRisk" type="number" step="0.1" value="1" /></div></div>
    <div class="field-row"><div class="field"><label>Entry</label><input id="calcEntry" type="number" step="0.05" value="22600" /></div><div class="field"><label>Stop</label><input id="calcStop" type="number" step="0.05" value="22450" /></div></div>
    <div class="field"><label>Target (optional)</label><input id="calcTarget" type="number" step="0.05" value="22900" /></div>
    <div class="calc-note">Quantity is capped by the stop distance. For options, use the option tab to translate premium risk into lots.</div>
  </div>`;
}

function calcResultMarkup() {
  return `<div class="empty-state">Enter values to calculate.</div>`;
}

function bindCalculator() {
  const root = $("calculatorRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-calc-tab]");
    if (tab) {
      state.calcTab = tab.dataset.calcTab;
      renderCalculator();
    }
  });
  root.addEventListener("input", () => runCalc());
  runCalc();
}

function num(id) {
  return Number($(id)?.value) || 0;
}

function runCalc() {
  const result = $("calcResult");
  if (!result) return;
  if (state.calcTab === "option") {
    const spot = num("calcSpot");
    const strike = num("calcStrike");
    const iv = num("calcIv");
    const days = Math.max(1, num("calcDays"));
    const type = $("calcType")?.value || "CE";
    const lot = Math.max(1, num("calcLot"));
    const price = blackScholesPrice(spot, strike, days / 365, iv, type);
    const greeks = blackScholesGreeks(spot, strike, days / 365, iv, type);
    const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const breakeven = type === "CE" ? strike + price : strike - price;
    result.innerHTML = `<div class="calc-result">
      ${metric("Premium", fmt(price), type === "CE" ? "Call" : "Put")}
      ${metric("Intrinsic", fmt(intrinsic), `${fmt(price - intrinsic)} time value`)}
      ${metric("Breakeven", fmt(breakeven), "at expiry")}
      ${metric("Contract value", fmtMoney(price * lot), `${lot} lot size`)}
      ${metric("Delta", fmt(greeks.delta, 3), "per 1 point")}
      ${metric("Theta / day", fmt(greeks.theta, 2), "premium decay")}
    </div>
    <div class="calc-breakdown">
      <div class="calc-line"><span>Gamma</span><b>${fmt(greeks.gamma, 5)}</b></div>
      <div class="calc-line"><span>Vega / 1% IV</span><b>${fmt(greeks.vega, 2)}</b></div>
      <div class="calc-line"><span>Premium stop (−30%)</span><b class="down">${fmt(price * 0.7)}</b></div>
      <div class="calc-line"><span>Premium target (+50%)</span><b class="up">${fmt(price * 1.5)}</b></div>
    </div>
    <div class="calc-note">Black-Scholes with 6.5% risk-free rate. Indian index options are European; early exercise is not modelled.</div>`;
    return;
  }
  if (state.calcTab === "charges") {
    const segment = $("calcSegment")?.value || "options";
    const buy = num("calcBuy");
    const sell = num("calcSell");
    const brokerage = num("calcBrokerage") * Math.max(1, num("calcOrders"));
    const rates = segment === "options" ? { stt: 0.000625, exchange: 0.0003503, stamp: 0.00003, label: "Options" } : segment === "futures" ? { stt: 0.000125, exchange: 0.0000173, stamp: 0.00002, label: "Futures" } : { stt: 0.00025, exchange: 0.0000297, stamp: 0.00003, label: "Equity intraday" };
    const stt = sell * rates.stt;
    const exchange = (buy + sell) * rates.exchange;
    const sebi = (buy + sell) * 0.000001;
    const stamp = buy * rates.stamp;
    const gst = (brokerage + exchange + sebi) * 0.18;
    const total = brokerage + stt + exchange + sebi + stamp + gst;
    result.innerHTML = `<div class="calc-result">
      ${metric("Total charges", fmtMoney(total), rates.label)}
      ${metric("Brokerage", fmtMoney(brokerage), "both sides")}
      ${metric("STT", fmtMoney(stt), "sell side")}
      ${metric("GST", fmtMoney(gst), "18%")}
      ${metric("Exchange + SEBI", fmtMoney(exchange + sebi), "turnover based")}
      ${metric("Stamp", fmtMoney(stamp), "buy side")}
    </div>
    <div class="calc-breakdown">
      <div class="calc-line"><span>Gross turnover</span><b>${fmtMoney(buy + sell)}</b></div>
      <div class="calc-line"><span>Round-trip cost %</span><b>${fmt((total / Math.max(1, buy + sell)) * 100, 3)}%</b></div>
      <div class="calc-line total"><span>Net P&L after costs</span><b>${fmtMoney(sell - buy - total)}</b></div>
    </div>
    <div class="calc-note">Indicative estimates for Indian markets. Brokerage slabs, exchange charges, stamp duty and GST can differ by broker and state. Verify with your contract note.</div>`;
    return;
  }
  if (state.calcTab === "atr") {
    const price = num("calcAtrPrice");
    const atr = num("calcAtrValue");
    const mult = num("calcAtrMult");
    const side = $("calcAtrSide")?.value || "long";
    const capital = num("calcAtrCapital");
    const riskPct = num("calcAtrRisk");
    const distance = atr * mult;
    const riskAmount = capital * riskPct / 100;
    const qty = Math.floor(riskAmount / Math.max(0.01, distance));
    const stop = side === "long" ? price - distance : price + distance;
    const targets = [1, 2, 3].map((multiple) => side === "long" ? price + distance * multiple : price - distance * multiple);
    result.innerHTML = `<div class="calc-result">
      ${metric("Stop", fmt(stop), `${fmt(distance)} points`)}
      ${metric("Quantity", fmtInt(qty), "risk-based")}
      ${metric("Risk", fmtMoney(riskAmount), `${riskPct}% of capital`)}
      ${metric("Notional", fmtMoney(qty * price), "at entry")}
    </div>
    <div class="calc-breakdown">
      ${targets.map((target, index) => `<div class="calc-line"><span>Target ${index + 1} (${index + 1}R)</span><b class="up">${fmt(target)}</b></div>`).join("")}
      <div class="calc-line total"><span>Reward at 2R</span><b class="up">${fmtMoney(riskAmount * 2)}</b></div>
    </div>
    <div class="calc-note">ATR-based stops adapt to volatility. Widen the stop in high-volatility regimes but reduce quantity to keep rupee risk constant.</div>`;
    return;
  }
  const capital = num("calcCapital");
  const riskPct = num("calcRisk");
  const entry = num("calcEntry");
  const stop = num("calcStop");
  const target = num("calcTarget");
  const riskPerUnit = Math.abs(entry - stop);
  const riskAmount = capital * riskPct / 100;
  const qty = riskPerUnit > 0 ? Math.floor(riskAmount / riskPerUnit) : 0;
  const reward = target > 0 ? Math.abs(target - entry) * qty : null;
  const rr = target > 0 && riskPerUnit > 0 ? Math.abs(target - entry) / riskPerUnit : null;
  result.innerHTML = `<div class="calc-result">
    ${metric("Quantity", fmtInt(qty), "units / shares")}
    ${metric("Risk", fmtMoney(qty * riskPerUnit), `${riskPct}% budget`)}
    ${metric("Reward", reward == null ? "—" : fmtMoney(reward), target ? "at target" : "add target")}
    ${metric("Risk : reward", rr == null ? "—" : `1 : ${fmt(rr, 2)}`, "per unit")}
    ${metric("Notional", fmtMoney(qty * entry), "capital deployed")}
    ${metric("Stop distance", fmt(riskPerUnit), `${fmt((riskPerUnit / Math.max(1, entry)) * 100, 2)}%`)}
  </div>
  <div class="calc-breakdown">
    <div class="calc-line"><span>Entry</span><b>${fmt(entry)}</b></div>
    <div class="calc-line"><span>Hard stop</span><b class="down">${fmt(stop)}</b></div>
    <div class="calc-line"><span>Target</span><b class="up">${fmt(target)}</b></div>
    <div class="calc-line total"><span>Maximum rupee risk</span><b>${fmtMoney(riskAmount)}</b></div>
  </div>
  <div class="calc-note">If quantity is zero, the stop is too wide for the risk budget. Reduce size or tighten the setup — never widen the loss.</div>`;
}

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - normPdf(x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function blackScholesPrice(spot, strike, years, ivPct, type) {
  const t = Math.max(1 / 365, years);
  const sigma = Math.max(0.01, ivPct / 100);
  const r = 0.065;
  const d1 = (Math.log(Math.max(1, spot) / Math.max(1, strike)) + (r + 0.5 * sigma * sigma) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  return type === "CE"
    ? Math.max(0, spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2))
    : Math.max(0, strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1));
}

function blackScholesGreeks(spot, strike, years, ivPct, type) {
  const t = Math.max(1 / 365, years);
  const sigma = Math.max(0.01, ivPct / 100);
  const r = 0.065;
  const d1 = (Math.log(Math.max(1, spot) / Math.max(1, strike)) + (r + 0.5 * sigma * sigma) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  const delta = type === "CE" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (spot * sigma * Math.sqrt(t));
  const theta = (-(spot * normPdf(d1) * sigma) / (2 * Math.sqrt(t)) - r * strike * Math.exp(-r * t) * normCdf(type === "CE" ? d2 : -d2)) / 365;
  const vega = spot * normPdf(d1) * Math.sqrt(t) / 100;
  return { delta, gamma, theta, vega };
}

/* --------------------------------- alerts --------------------------------- */

const ALERT_PRESETS = [
  { label: "Sensex above 73,500", symbol: "SENSEX", metric: "price", condition: "above", value: 73500 },
  { label: "Sensex below 72,500", symbol: "SENSEX", metric: "price", condition: "below", value: 72500 },
  { label: "Nifty above 22,800", symbol: "NIFTY", metric: "price", condition: "above", value: 22800 },
  { label: "Nifty below 22,400", symbol: "NIFTY", metric: "price", condition: "below", value: 22400 },
  { label: "Bank Nifty below 54,000", symbol: "BANKNIFTY", metric: "price", condition: "below", value: 54000 },
  { label: "India VIX above 20", symbol: "INDIAVIX", metric: "price", condition: "above", value: 20 },
  { label: "Brent above 120", symbol: "BRENT", metric: "price", condition: "above", value: 120 },
  { label: "Sensex RSI below 35", symbol: "SENSEX", metric: "rsi", condition: "below", value: 35 }
];

function renderAlerts() {
  const root = $("alertsRoot");
  if (!root) return;
  const live = state.alertLive;
  const sensex = live?.indexes?.SENSEX;
  const filtered = (state.alerts || []).filter((alert) => {
    if (state.alertFilter === "all") return true;
    if (state.alertFilter === "GLOBAL") return ["BRENT", "WTI", "USDINR", "SPX", "NDX", "GOLD", "DXY"].includes(alert.symbol);
    return alert.symbol === state.alertFilter;
  });
  const active = state.alerts.filter((alert) => alert.status !== "triggered").length;
  const triggered = state.alerts.filter((alert) => alert.status === "triggered").length;
  const draftQuote = state.alertQuotes.get(state.alertDraftSymbol);
  const draftValue = draftQuote?.value ?? sensex?.spot ?? 0;
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">ALERT CENTER</div>
          <div class="module-title">The Sensex tape, watched for you.</div>
          <div class="module-sub">Price, % move and RSI alerts for SENSEX, NIFTY, BANKNIFTY, India VIX, global macro and your watchlists. The checker runs locally while this page is open.</div>
        </div>
        <div class="module-actions">
          <span class="module-stamp">${active} armed · ${triggered} triggered</span>
          <button class="btn btn-ghost" id="alertCheck">Check now</button>
        </div>
      </div>
      <div class="alerts-layout">
        <div class="module-grid">
          <div class="panel module-card">
            <div class="module-card-title">Create alert</div>
            <form id="alertForm" class="alert-form-grid">
              <div class="field"><label for="alertSymbol">Symbol</label><input id="alertSymbol" list="alertSymbols" value="${esc(state.alertDraftSymbol)}" autocomplete="off" /></div>
              <datalist id="alertSymbols">${state.symbols.filter((symbol) => symbol.type !== "global" || ["SPX", "NDX", "BRENT", "WTI", "GOLD", "DXY", "USDINR", "BTCUSD"].includes(symbol.key)).map((symbol) => `<option value="${esc(symbol.key)}">${esc(symbol.name)}</option>`).join("")}</datalist>
              <div class="field"><label for="alertMetric">Metric</label><select id="alertMetric"><option value="price">Price</option><option value="pct">Day change %</option><option value="rsi">RSI (14)</option></select></div>
              <div class="field"><label for="alertCondition">Condition</label><select id="alertCondition"><option value="above">Crosses above</option><option value="below">Crosses below</option></select></div>
              <div class="field"><label for="alertValue">Level</label><input id="alertValue" type="number" step="0.01" value="${Number(draftValue).toFixed(2)}" /></div>
              <div class="field"><label for="alertNote">Note</label><input id="alertNote" placeholder="Why does this level matter?" /></div>
              <button class="btn btn-primary" type="submit">Arm alert</button>
            </form>
          </div>
          <div class="panel module-card">
            <div class="module-card-title">Quick plays <span class="tiny">one click</span></div>
            <div class="alert-preset-grid">
              ${ALERT_PRESETS.map((preset) => `<button class="alert-preset" data-alert-preset="${esc(JSON.stringify(preset))}"><b>${esc(preset.label)}</b><span>${esc(preset.symbol)} · ${esc(preset.metric)}</span></button>`).join("")}
            </div>
          </div>
        </div>
        <div class="module-grid">
          <div class="panel module-card">
            <div class="module-card-title">Sensex structure <span class="tiny">spot ${fmt(sensex?.spot)}</span></div>
            ${sensex ? `
              <div class="metric-strip" style="grid-template-columns:1fr 1fr">
                ${metric("Day change", fmtPct(sensex.change), "last session", cls(sensex.change))}
                ${metric("RSI (14)", fmt(sensex.rsi14, 1), sensex.trend || "—")}
                ${metric("ATR (14)", fmt(sensex.atr14), `${fmt(sensex.atrPct, 2)}% of spot`)}
                ${metric("Pivot", fmt(sensex.pivot?.p), "classic pivot")}
              </div>
              <div style="margin-top:12px"><div class="level-title">Resistance</div><div class="level-chips">${(sensex.levels?.resistances || []).map((level) => `<button class="level-chip resist" data-level-symbol="SENSEX" data-level-value="${level}">+ ${fmt(level, 0)}</button>`).join("")}</div></div>
              <div style="margin-top:8px"><div class="level-title">Support</div><div class="level-chips">${(sensex.levels?.supports || []).map((level) => `<button class="level-chip support" data-level-symbol="SENSEX" data-level-value="${level}">+ ${fmt(level, 0)}</button>`).join("")}</div></div>
            ` : `<div class="empty-state">Loading Sensex levels…</div>`}
          </div>
          <div class="panel module-card">
            <div class="module-card-title">Alert book <span class="tiny">${filtered.length} shown</span></div>
            <div class="seg" id="alertFilters" style="margin-bottom:8px">
              ${["all", "SENSEX", "NIFTY", "BANKNIFTY", "GLOBAL"].map((filter) => `<button type="button" data-alert-filter="${filter}" class="${state.alertFilter === filter ? "active" : ""}">${filter === "all" ? "All" : filter === "GLOBAL" ? "Global" : filter}</button>`).join("")}
            </div>
            <div style="overflow-x:auto">
              <table class="alert-table">
                <thead><tr><th>Symbol</th><th>Condition</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>${filtered.length ? filtered.slice().reverse().map(renderAlertRow).join("") : `<tr><td colspan="5"><div class="empty-state">No alerts here yet. Arm one above.</div></td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  bindAlerts();
}

function renderAlertRow(alert) {
  const status = alert.status === "triggered" ? `<span class="alert-status triggered">Triggered ${alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</span>` : `<span class="alert-status open">Armed</span>`;
  const label = alert.metric === "pct" ? "% change" : alert.metric === "rsi" ? "RSI" : "Price";
  return `<tr>
    <td><b>${esc(alert.symbol)}</b><div class="tiny">${esc(alert.note || "")}</div></td>
    <td class="mono">${esc(label)} ${alert.condition} ${fmt(alert.value)}</td>
    <td>${status}</td>
    <td class="tiny">${alert.createdAt ? new Date(alert.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
    <td><button class="btn btn-ghost" data-alert-remove="${esc(alert.id)}">×</button></td>
  </tr>`;
}

function bindAlerts() {
  const root = $("alertsRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-alert-preset]");
    if (preset) {
      try {
        const data = JSON.parse(preset.dataset.alertPreset);
        createAlert(data);
        toast(`Alert armed: ${data.label || `${data.symbol} ${data.condition} ${data.value}`}.`, true);
      } catch {}
      return;
    }
    const level = event.target.closest("[data-level-value]");
    if (level) {
      const value = Number(level.dataset.levelValue);
      const sensex = state.alertLive?.indexes?.SENSEX;
      const condition = sensex?.spot != null && value < sensex.spot ? "below" : "above";
      createAlert({ symbol: level.dataset.levelSymbol, metric: "price", condition, value, note: "Sensex structure level" });
      toast(`SENSEX ${condition} ${fmt(value, 0)} armed.`, true);
      return;
    }
    const filter = event.target.closest("[data-alert-filter]");
    if (filter) {
      state.alertFilter = filter.dataset.alertFilter;
      renderAlerts();
      return;
    }
    const remove = event.target.closest("[data-alert-remove]");
    if (remove) {
      state.alerts = state.alerts.filter((alert) => alert.id !== remove.dataset.alertRemove);
      saveJson(ALERT_KEY, state.alerts);
      renderAlerts();
      toast("Alert removed.");
      return;
    }
    if (event.target.closest("#alertCheck")) {
      loadAlertContext(true);
    }
  });
  root.addEventListener("submit", (event) => {
    if (event.target.id !== "alertForm") return;
    event.preventDefault();
    const symbol = String($("alertSymbol")?.value || "").trim().toUpperCase();
    const metric = $("alertMetric")?.value || "price";
    const condition = $("alertCondition")?.value || "above";
    const value = Number($("alertValue")?.value);
    if (!symbol || !Number.isFinite(value)) {
      toast("Enter a valid symbol and alert level.");
      return;
    }
    createAlert({ symbol, metric, condition, value, note: $("alertNote")?.value || "" });
    toast(`Alert armed for ${symbol}.`, true);
  });
}

function createAlert({ symbol, metric = "price", condition = "above", value, note = "" }) {
  const key = String(symbol || "").toUpperCase();
  const level = Number(value);
  if (!key || !Number.isFinite(level)) return null;
  const quote = state.alertQuotes.get(key) || null;
  const current = alertMetricValue(key, metric, state.alertQuotes);
  const alert = {
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: key,
    metric,
    condition,
    value: level,
    note,
    status: "open",
    createdAt: new Date().toISOString(),
    lastValue: current ?? quote?.value ?? null
  };
  state.alerts.unshift(alert);
  saveJson(ALERT_KEY, state.alerts);
  if (state.view === "alerts") renderAlerts();
  return alert;
}

async function loadAlertContext(force = false) {
  const symbols = [...new Set([...state.alerts.map((alert) => alert.symbol), state.alertDraftSymbol, "SENSEX", "NIFTY", "BANKNIFTY", "INDIAVIX", "BRENT", "WTI", "USDINR"])].filter(Boolean);
  try {
    const [live, quotes] = await Promise.all([
      api("/api/live"),
      api(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`)
    ]);
    state.alertLive = live;
    state.live = live;
    state.alertQuotes = new Map((quotes.items || []).map((item) => [item.key, item]));
    for (const quote of live.quotes || []) {
      if (!state.alertQuotes.has(quote.key)) state.alertQuotes.set(quote.key, { ...quote, rsi: null });
    }
    checkAlerts();
    if (state.view === "alerts") renderAlerts();
  } catch (error) {
    if (force) toast(`Alerts: ${error.message}`);
  }
}

function alertMetricValue(symbol, metric, quotes) {
  const quote = quotes.get(symbol);
  if (!quote) return null;
  if (metric === "pct") return quote.change;
  if (metric === "rsi") return quote.rsi;
  return quote.value;
}

function checkAlerts(silent = false) {
  if (!state.alertQuotes.size) return;
  let changed = false;
  for (const alert of state.alerts) {
    if (alert.status === "triggered") continue;
    const current = alertMetricValue(alert.symbol, alert.metric, state.alertQuotes);
    if (current == null || !Number.isFinite(Number(current))) continue;
    const value = Number(alert.value);
    if (alert.lastValue == null || !Number.isFinite(Number(alert.lastValue))) {
      alert.lastValue = current;
      changed = true;
      continue;
    }
    const crossed = alert.condition === "above"
      ? Number(alert.lastValue) < value && current >= value
      : Number(alert.lastValue) > value && current <= value;
    alert.lastValue = current;
    if (crossed) {
      alert.status = "triggered";
      alert.triggeredAt = new Date().toISOString();
      changed = true;
      const text = `ALERT: ${alert.symbol} ${alert.metric === "pct" ? "day change" : alert.metric === "rsi" ? "RSI" : "price"} crossed ${alert.condition} ${fmt(value)}. Current ${fmt(current)}.`;
      toast(text);
      try {
        if ("Notification" in window && Notification.permission === "granted") new Notification("Solo Trading Charts", { body: text });
      } catch {}
    }
  }
  if (changed) {
    saveJson(ALERT_KEY, state.alerts);
    if (state.view === "alerts" && !silent) renderAlerts();
  }
}

/* ---------------------------------- notes --------------------------------- */

const NOTE_TEMPLATES = {
  journal: `# Trade journal\n\n- Symbol:\n- Setup:\n- Direction:\n- Entry:\n- Stop:\n- Targets:\n- Size:\n- Why this trade:\n\n## Execution\n\n## What happened\n\n## Lesson\n`,
  premarket: `# Premarket plan\n\n## Global cues\n\n## India setup\n\n## Levels to watch\n\n## Trades I will take\n\n## Trades I will avoid\n\n## Risk budget\n`,
  postmortem: `# Postmortem\n\n## What I planned\n\n## What I did\n\n## What worked\n\n## What failed\n\n## One change for tomorrow\n`,
  checklist: `# Pre-trade checklist\n\n- [ ] Daily trend agrees\n- [ ] Entry trigger is clear\n- [ ] Stop is defined\n- [ ] Risk is under 1%\n- [ ] Position size is calculated\n- [ ] Event risk checked\n- [ ] Paper-traded or logged\n`
};

function renderNotes() {
  const root = $("notesRoot");
  if (!root) return;
  if (!state.activeNoteId && state.notes.length) state.activeNoteId = state.notes[0].id;
  const note = state.notes.find((item) => item.id === state.activeNoteId) || null;
  const query = state.noteQuery || "";
  const filtered = state.notes.filter((item) => !query || `${item.title} ${item.body} ${item.tags}`.toLowerCase().includes(query.toLowerCase()));
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">TRADER NOTES</div>
          <div class="module-title">Write it down. Then follow the plan.</div>
          <div class="module-sub">Trade journals, premarket plans, postmortems and checklists. Notes autosave in this browser and can be exported as JSON.</div>
        </div>
        <div class="module-actions">
          <button class="btn btn-ghost" id="noteExport">Export JSON</button>
          <button class="btn btn-primary" id="noteNew">New note</button>
        </div>
      </div>
      <div class="notes-layout">
        <div class="panel module-card">
          <div class="field"><input id="noteSearch" placeholder="Search notes…" value="${esc(query)}" /></div>
          <div class="notes-list" id="noteList">
            ${filtered.length ? filtered.map((item) => `<div class="note-item ${item.id === state.activeNoteId ? "active" : ""}" data-note-id="${esc(item.id)}"><div class="note-item-title">${esc(item.title || "Untitled")}</div><div class="note-item-meta"><span>${new Date(item.updatedAt || item.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>${item.tags ? `<span>${esc(item.tags)}</span>` : ""}</div></div>`).join("") : `<div class="empty-state">No notes yet.</div>`}
          </div>
        </div>
        ${note ? renderNoteEditor(note) : `<div class="panel module-card"><div class="empty-state">Create your first note. Start with a premarket plan or trade journal.</div><div class="module-actions" style="justify-content:center"><button class="btn btn-primary" data-note-template="premarket">Premarket plan</button><button class="btn btn-ghost" data-note-template="journal">Trade journal</button></div></div>`}
      </div>
    </div>`;
  bindNotes();
}

function renderNoteEditor(note) {
  return `<div class="panel module-card">
    <div class="note-editor">
      <div class="row">
        <button class="btn btn-ghost" data-note-preview="${state.notePreview ? "false" : "true"}">${state.notePreview ? "Edit" : "Preview"}</button>
        <button class="btn btn-ghost" data-note-template="journal">Journal template</button>
        <button class="btn btn-ghost" data-note-template="postmortem">Postmortem</button>
        <button class="btn btn-ghost" data-note-delete="${esc(note.id)}" style="margin-left:auto;color:var(--red)">Delete</button>
      </div>
      <input class="title" id="noteTitle" value="${esc(note.title)}" placeholder="Note title" />
      <div class="field-row">
        <div class="field"><label>Symbol</label><input id="noteSymbol" value="${esc(note.symbol || "")}" placeholder="NIFTY / RELIANCE" /></div>
        <div class="field"><label>Tags</label><input id="noteTags" value="${esc(note.tags || "")}" placeholder="plan, discipline" /></div>
      </div>
      ${state.notePreview
        ? `<div class="note-preview">${renderMarkdown(note.body)}</div>`
        : `<textarea id="noteBody" placeholder="Write the plan, the setup, the risk…">${esc(note.body)}</textarea>`}
      <div class="tiny">Autosaved locally · ${new Date(note.updatedAt || note.createdAt).toLocaleString("en-IN")}</div>
    </div>
  </div>`;
}

function bindNotes() {
  const root = $("notesRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    if (event.target.closest("#noteNew")) {
      const note = createNote({ title: "Untitled note", body: "", tags: "" });
      state.activeNoteId = note.id;
      renderNotes();
      return;
    }
    const noteItem = event.target.closest("[data-note-id]");
    if (noteItem) {
      state.activeNoteId = noteItem.dataset.noteId;
      renderNotes();
      return;
    }
    const template = event.target.closest("[data-note-template]");
    if (template) {
      const templateKey = template.dataset.noteTemplate;
      let note = state.notes.find((item) => item.id === state.activeNoteId);
      if (!note) {
        note = createNote({ title: templateKey === "journal" ? "Trade journal" : templateKey === "postmortem" ? "Postmortem" : "Premarket plan", body: NOTE_TEMPLATES[templateKey], tags: templateKey });
        state.activeNoteId = note.id;
      } else {
        note.body = NOTE_TEMPLATES[templateKey];
        note.updatedAt = new Date().toISOString();
        saveJson(NOTE_KEY, state.notes);
      }
      renderNotes();
      return;
    }
    const preview = event.target.closest("[data-note-preview]");
    if (preview) {
      state.notePreview = preview.dataset.notePreview === "true";
      renderNotes();
      return;
    }
    const del = event.target.closest("[data-note-delete]");
    if (del) {
      if (!confirm("Delete this note?")) return;
      state.notes = state.notes.filter((note) => note.id !== del.dataset.noteDelete);
      state.activeNoteId = state.notes[0]?.id || null;
      saveJson(NOTE_KEY, state.notes);
      renderNotes();
      toast("Note deleted.");
      return;
    }
    if (event.target.closest("#noteExport")) {
      downloadFile("solo-notes.json", JSON.stringify(state.notes, null, 2), "application/json");
      toast("Notes exported.", true);
    }
  });
  root.addEventListener("input", (event) => {
    if (event.target.id === "noteSearch") {
      state.noteQuery = event.target.value;
      renderNotes();
      return;
    }
    const note = state.notes.find((item) => item.id === state.activeNoteId);
    if (!note) return;
    if (event.target.id === "noteTitle") note.title = event.target.value;
    if (event.target.id === "noteBody") note.body = event.target.value;
    if (event.target.id === "noteSymbol") note.symbol = event.target.value.toUpperCase();
    if (event.target.id === "noteTags") note.tags = event.target.value;
    note.updatedAt = new Date().toISOString();
    clearTimeout(bindNotes.timer);
    bindNotes.timer = setTimeout(() => {
      saveJson(NOTE_KEY, state.notes);
      const item = root.querySelector(`[data-note-id="${note.id}"] .note-item-title`);
      if (item) item.textContent = note.title || "Untitled";
    }, 450);
  });
}

function createNote({ title = "Untitled note", body = "", tags = "", symbol = "" } = {}) {
  const note = {
    id: `nt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    body,
    tags,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.notes.unshift(note);
  saveJson(NOTE_KEY, state.notes);
  return note;
}

function renderMarkdown(text) {
  const lines = esc(text || "").split(/\r?\n/);
  const out = [];
  let listOpen = false;
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      out.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      out.push(`<h2>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      out.push(`<h1>${inlineMarkdown(line.replace(/^#\s+/, ""))}</h1>`);
    } else if (/^[-*]\s+/.test(line) || /^\[\s?\]\s+/.test(line)) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      out.push(line ? `<p>${inlineMarkdown(line)}</p>` : "");
    }
  }
  if (listOpen) out.push("</ul>");
  return out.join("");
}

function inlineMarkdown(value) {
  return String(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, "<br>");
}

function downloadFile(name, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* --------------------------------- reports -------------------------------- */

function renderReports() {
  const root = $("reportsRoot");
  if (!root) return;
  if (!state.activeReportId && state.reports.length) state.activeReportId = state.reports[0].id;
  const active = state.reports.find((report) => report.id === state.activeReportId) || null;
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">REPORTS</div>
          <div class="module-title">A desk brief you can keep.</div>
          <div class="module-sub">Create a daily market brief, a trade plan report or a journal review from live data. Reports are saved in this browser and can be printed or downloaded as Markdown.</div>
        </div>
        <div class="module-actions">
          <span class="module-stamp">${state.reports.length} saved</span>
          <button class="btn btn-ghost" id="reportGenerate">Daily brief</button>
          <button class="btn btn-primary" id="reportAi">AI plan report</button>
        </div>
      </div>
      ${state.reportBusy ? `<div class="panel empty-state">Building the report from live market data…</div>` : ""}
      ${renderDailyArchiveBar()}
      <div class="reports-layout">
        <div class="panel module-card">
          <div class="module-card-title">Saved reports <span class="tiny">local</span></div>
          <div class="report-list">
            ${state.reports.length ? state.reports.map((report) => `<div class="report-item ${report.id === state.activeReportId ? "active" : ""}" data-report-id="${esc(report.id)}"><div class="report-item-title">${esc(report.title)}</div><div class="report-item-meta">${new Date(report.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(report.type)}</div></div>`).join("") : `<div class="empty-state">No saved reports yet.</div>`}
          </div>
        </div>
        <div class="module-grid">
          <div class="panel module-card" style="padding:9px">
            <div class="module-actions">
              <button class="btn btn-ghost" id="reportPrint" ${active ? "" : "disabled"}>Print / PDF</button>
              <button class="btn btn-ghost" id="reportDownload" ${active ? "" : "disabled"}>Download .md</button>
              <button class="btn btn-ghost" id="reportDelete" ${active ? "" : "disabled"} style="color:var(--red)">Delete</button>
              <span class="tiny">${active ? `Generated ${new Date(active.createdAt).toLocaleString("en-IN")}` : ""}</span>
            </div>
          </div>
          ${active ? `<div class="report-doc" id="reportDoc">${active.html}</div>` : `<div class="panel empty-state">Generate a daily brief or an AI plan report. The report will include market pulse, levels, scanner candidates, option context, watchlist and risk notes.</div>`}
        </div>
      </div>
    </div>`;
  bindReports();
}

function renderDailyArchiveBar() {
  const archive = state.dailyArchive;
  const pool = [...(archive?.news?.india || []), ...(archive?.news?.global || [])];
  const clean = pool.find((item) => item.title && !/tradingview|cnbctv|news by/i.test(item.title));
  const headline = clean?.title || pool[0]?.title || "Daily snapshots generated by the GitHub Actions workflow.";
  return `<div class="panel module-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;flex-wrap:wrap">
    <div>
      <div class="eyebrow">SERVER ARCHIVE ${archive?.date ? `· ${esc(archive.date)}` : ""}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px;max-width:760px">${archive ? esc(headline) : esc("Load the latest saved premarket brief. Run scripts/daily-update.mjs locally or let the weekday GitHub Action publish it.")}</div>
    </div>
    <div class="module-actions">
      <a class="btn btn-ghost" href="/data/daily/latest.md" target="_blank" rel="noopener noreferrer">Markdown</a>
      <button class="btn btn-ghost" data-daily-load="${archive ? "open" : "load"}">${archive ? "Open latest brief" : "Load archive"}</button>
    </div>
  </div>`;
}

async function loadDailyArchive(force = false) {
  if (state.dailyArchiveTried && !force) return state.dailyArchive;
  state.dailyArchiveTried = true;
  try {
    const [index, latest] = await Promise.all([
      api("/api/daily/index").catch(() => ({ dates: [] })),
      api("/api/daily/latest")
    ]);
    state.dailyIndex = index.dates || [];
    state.dailyArchive = latest;
    if (state.view === "reports") renderReports();
    return latest;
  } catch {
    return null;
  }
}

async function openDailyArchive() {
  if (!state.dailyArchive) await loadDailyArchive(true);
  const archive = state.dailyArchive;
  if (!archive) {
    toast("No daily archive yet. Run scripts/daily-update.mjs first.");
    return;
  }
  const doc = buildReportDocument({
    live: archive.snapshot,
    scan: archive.scan,
    news: archive.news,
    plan: archive.aiPlan,
    quotes: { items: archive.quotes || [] },
    type: "daily",
    watchName: `Archive ${archive.date}`
  });
  const report = {
    id: `archive_${archive.date}`,
    title: `Daily archive · ${archive.date}`,
    type: "archive",
    createdAt: archive.generatedAt || new Date().toISOString(),
    html: doc.html,
    markdown: doc.markdown
  };
  const existing = state.reports.findIndex((item) => item.id === report.id);
  if (existing >= 0) state.reports.splice(existing, 1, report);
  else state.reports.unshift(report);
  state.reports = state.reports.slice(0, 12);
  state.activeReportId = report.id;
  saveJson(REPORT_KEY, state.reports);
  renderReports();
  toast(`Opened the ${archive.date} archive.`, true);
}

function bindReports() {
  const root = $("reportsRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const item = event.target.closest("[data-report-id]");
    if (item) {
      state.activeReportId = item.dataset.reportId;
      renderReports();
      return;
    }
    if (event.target.closest("#reportGenerate")) {
      generateReport("daily");
      return;
    }
    if (event.target.closest("#reportAi")) {
      generateReport("ai", state.aiPlan);
      return;
    }
    if (event.target.closest("[data-daily-load]")) {
      openDailyArchive();
      return;
    }
    if (event.target.closest("#reportPrint")) {
      window.print();
      return;
    }
    if (event.target.closest("#reportDownload")) {
      const active = state.reports.find((report) => report.id === state.activeReportId);
      if (active) downloadFile(`${active.id}.md`, active.markdown, "text/markdown");
      return;
    }
    if (event.target.closest("#reportDelete")) {
      if (!confirm("Delete this saved report?")) return;
      state.reports = state.reports.filter((report) => report.id !== state.activeReportId);
      state.activeReportId = state.reports[0]?.id || null;
      saveJson(REPORT_KEY, state.reports);
      renderReports();
    }
  });
}

async function generateReport(type = "daily", aiOverride = null) {
  if (state.reportBusy) return;
  state.reportBusy = true;
  renderReports();
  try {
    const watchSymbols = (state.watchlists.find((list) => list.id === state.activeListId)?.symbols || state.watchlists[0]?.symbols || ["NIFTY", "BANKNIFTY", "SENSEX"]).join(",");
    const [live, scan, news, plan, quotes] = await Promise.all([
      api("/api/live").catch(() => null),
      state.scan || api("/api/scan").catch(() => null),
      api("/api/news/feed?category=india").catch(() => null),
      aiOverride || api("/api/ai/plan?symbol=NIFTY&style=intraday&capital=100000&risk=1").catch(() => null),
      api(`/api/quotes?symbols=${encodeURIComponent(watchSymbols)}`).catch(() => null)
    ]);
    state.live = live || state.live;
    state.scan = scan || state.scan;
    const context = { live, scan, news, plan, quotes, type, watchName: state.watchlists.find((list) => list.id === state.activeListId)?.name || "Core" };
    const doc = buildReportDocument(context);
    const report = {
      id: `rp_${new Date().toISOString().slice(0, 10)}_${Date.now().toString(36)}`,
      title: type === "ai" ? `AI trade plan · ${plan?.name || "NIFTY"} · ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : `Solo daily brief · ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      type,
      createdAt: new Date().toISOString(),
      html: doc.html,
      markdown: doc.markdown
    };
    state.reports.unshift(report);
    state.reports = state.reports.slice(0, 12);
    state.activeReportId = report.id;
    saveJson(REPORT_KEY, state.reports);
    toast("Report generated and saved.", true);
  } catch (error) {
    toast(`Report: ${error.message}`);
  } finally {
    state.reportBusy = false;
    if (state.view === "reports") renderReports();
  }
}

function buildReportDocument(context) {
  const { live, scan, news, plan, quotes, watchName } = context;
  const now = new Date();
  const dateText = now.toLocaleString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const quoteRows = (live?.quotes || []).map((quote) => `<tr><td>${esc(quote.label)}</td><td>${fmt(quote.value, quote.digits ?? 2)}</td><td class="${cls(quote.change)}">${fmtPct(quote.change)}</td><td>${fmt(quote.open, quote.digits ?? 2)}</td><td>${fmt(quote.high, quote.digits ?? 2)} / ${fmt(quote.low, quote.digits ?? 2)}</td></tr>`).join("");
  const levelRows = ["SENSEX", "NIFTY", "BANKNIFTY"].map((key) => {
    const index = live?.indexes?.[key];
    if (!index) return "";
    return `<tr><td>${key}</td><td>${fmt(index.spot)}</td><td>${fmt(index.pivot?.p)}</td><td>${(index.levels?.supports || []).slice(0, 3).map((level) => fmt(level, 0)).join(", ")}</td><td>${(index.levels?.resistances || []).slice(0, 3).map((level) => fmt(level, 0)).join(", ")}</td></tr>`;
  }).join("");
  const scanRows = (scan?.items || []).filter((item) => item.value != null).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 7).map((item) => `<tr><td>${esc(item.key)}</td><td>${fmt(item.value)}</td><td class="${cls(item.change)}">${fmtPct(item.change)}</td><td>${fmt(item.rsi, 1)}</td><td>${esc(item.trend)}</td><td>${item.score ?? "—"}</td></tr>`).join("");
  const watchRows = (quotes?.items || []).map((item) => `<tr><td>${esc(item.key)}</td><td>${esc(item.name)}</td><td>${fmt(item.value)}</td><td class="${cls(item.change)}">${fmtPct(item.change)}</td><td>${fmt(item.rsi, 1)}</td></tr>`).join("");
  const newsRows = (news?.items || []).slice(0, 7).map((item) => `<li><b>${esc(item.source || "News")}</b> — ${esc(item.title)} <span class="muted">(${esc(item.ago || "")})</span></li>`).join("");
  const alertRows = state.alerts.slice(0, 8).map((alert) => `<tr><td>${esc(alert.symbol)}</td><td>${esc(alert.metric)} ${esc(alert.condition)} ${fmt(alert.value)}</td><td>${esc(alert.status)}</td></tr>`).join("");
  const closed = state.paper.filter((trade) => trade.status === "CLOSED");
  const openTrades = state.paper.filter((trade) => trade.status === "OPEN");
  const realised = closed.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
  const recentNotes = state.notes.slice(0, 4).map((note) => `<li>${esc(note.title)} <span class="muted">(${new Date(note.updatedAt || note.createdAt).toLocaleDateString("en-IN")})</span></li>`).join("");
  const trade = plan?.trade;
  const option = plan?.option;
  const html = `
    <h1>${context.type === "ai" ? "Solo AI trade plan" : "Solo Trading Charts — daily desk brief"}</h1>
    <p class="muted">${esc(dateText)} IST · ${esc(watchName)} watchlist · research only, not investment advice.</p>
    <h2>Market pulse</h2>
    <p><b>Bias:</b> ${esc(live?.bias || "—")} · <b>Score:</b> ${live?.score ?? "—"} · <b>Market:</b> ${live?.marketOpen ? "Open" : "Closed"} · <b>India VIX:</b> ${fmt(live?.regime?.vix?.value)} (${esc(live?.regime?.vix?.label || "—")}) · <b>Brent:</b> ${fmt(live?.regime?.oil?.value)} (${esc(live?.regime?.oil?.label || "—")})</p>
    <table><thead><tr><th>Instrument</th><th>Last</th><th>Change</th><th>Open</th><th>High / low</th></tr></thead><tbody>${quoteRows}</tbody></table>
    <h2>Index levels</h2>
    <table><thead><tr><th>Index</th><th>Spot</th><th>Pivot</th><th>Support</th><th>Resistance</th></tr></thead><tbody>${levelRows}</tbody></table>
    <h2>AI plan · ${esc(plan?.name || "NIFTY")}</h2>
    ${trade ? `<p><b>${esc(trade.side)}</b> · ${esc(plan.bias.label)} · confidence ${plan.bias.confidence}% · spot ${fmt(plan.market.spot)}</p>
    <ul>
      <li>Entry trigger: <b>${fmt(trade.trigger ?? trade.entry)}</b></li>
      <li>Hard stop: <b>${fmt(trade.stop)}</b> (${fmt(trade.stopPct, 2)}%)</li>
      <li>Targets: <b>${(trade.targets || []).map((target) => fmt(target)).join(" / ")}</b></li>
      <li>Risk budget: <b>${fmtMoney(trade.riskAmount)}</b> · size ${trade.lots != null ? `${trade.lots} lots / ` : ""}${fmtInt(trade.qty)} units</li>
      ${option ? `<li>Options overlay: <b>${esc(option.strategy)}</b> · ${esc(option.expiry)} · premium ${fmt(option.premium)} · stop ${fmt(option.stopPremium)} · target ${fmt(option.targetPremium)}</li>` : ""}
    </ul>` : `<p>No AI plan available for this report.</p>`}
    <h2>Scanner leaders</h2>
    <table><thead><tr><th>Symbol</th><th>Price</th><th>Change</th><th>RSI</th><th>Trend</th><th>Score</th></tr></thead><tbody>${scanRows || `<tr><td colspan="6">No scan data</td></tr>`}</tbody></table>
    <h2>${esc(watchName)} watchlist</h2>
    <table><thead><tr><th>Symbol</th><th>Name</th><th>Last</th><th>Change</th><th>RSI</th></tr></thead><tbody>${watchRows || `<tr><td colspan="5">No watchlist quotes</td></tr>`}</tbody></table>
    <h2>Alerts</h2>
    <table><thead><tr><th>Symbol</th><th>Condition</th><th>Status</th></tr></thead><tbody>${alertRows || `<tr><td colspan="3">No alerts armed</td></tr>`}</tbody></table>
    <h2>Paper book</h2>
    <p>${openTrades.length} open · ${closed.length} closed · realised P&amp;L <b class="${cls(realised)}">${fmtMoney(realised)}</b></p>
    <h2>India headlines</h2>
    <ul>${newsRows || "<li>No headlines available</li>"}</ul>
    <h2>Recent notes</h2>
    <ul>${recentNotes || "<li>No notes yet</li>"}</ul>
    <h2>Risk checklist</h2>
    <ul>
      <li>Stop is defined before entry; never average a loser.</li>
      <li>Keep risk per trade at or below 1–2% of capital.</li>
      <li>Option buyers must respect premium stops and theta decay.</li>
      <li>Event risk, gaps and stale option-chain data can invalidate the plan.</li>
    </ul>
    <p class="disclaimer">Solo Trading Charts is a research and paper-trading workspace. It does not provide investment advice or execute live orders. Data may be delayed or stale. Verify every level and contract with your broker before risking capital.</p>`;

  const markdown = `# ${context.type === "ai" ? "Solo AI trade plan" : "Solo Trading Charts — daily desk brief"}\n\n` +
    `${dateText} IST · ${watchName} watchlist\n\n` +
    `## Market pulse\n\n- Bias: ${live?.bias || "—"}\n- Market: ${live?.marketOpen ? "Open" : "Closed"}\n- India VIX: ${fmt(live?.regime?.vix?.value)}\n- Brent: ${fmt(live?.regime?.oil?.value)}\n\n` +
    `## AI plan\n\n${trade ? `- Side: ${trade.side}\n- Confidence: ${plan.bias.confidence}%\n- Entry: ${fmt(trade.trigger ?? trade.entry)}\n- Stop: ${fmt(trade.stop)}\n- Targets: ${(trade.targets || []).map((target) => fmt(target)).join(" / ")}\n- Risk: ${fmtMoney(trade.riskAmount)}\n` : "No AI plan.\n"}\n` +
    `## Scanner leaders\n\n${(scan?.items || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 7).map((item) => `- ${item.key}: ${fmt(item.value)} (${fmtPct(item.change)}) · RSI ${fmt(item.rsi, 1)} · ${item.trend} · score ${item.score ?? "—"}`).join("\n")}\n\n` +
    `## Watchlist\n\n${(quotes?.items || []).map((item) => `- ${item.key}: ${fmt(item.value)} (${fmtPct(item.change)}) · RSI ${fmt(item.rsi, 1)}`).join("\n")}\n\n` +
    `## Headlines\n\n${(news?.items || []).slice(0, 7).map((item) => `- ${item.source || "News"}: ${item.title}`).join("\n")}\n\n` +
    `## Paper book\n\n${openTrades.length} open · ${closed.length} closed · realised ${fmtMoney(realised)}\n\n` +
    `> Research only. Not investment advice. No live orders are placed.\n`;
  return { html, markdown };
}

/* --------------------------------- broker --------------------------------- */

async function loadBroker() {
  try {
    state.broker = await api("/api/broker/status");
    if (state.view === "broker") renderBroker();
  } catch (error) {
    toast(`Broker hub: ${error.message}`);
  }
}

function renderBroker() {
  const root = $("brokerRoot");
  if (!root) return;
  const broker = state.broker;
  if (!broker) {
    root.innerHTML = `<div class="module-shell"><div class="panel module-head"><div><div class="eyebrow">BROKER HUB</div><div class="module-title">Connecting the execution layer…</div></div></div><div class="panel empty-state">Loading broker adapters…</div></div>`;
    return;
  }
  const paper = state.brokerOrders.length;
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">BROKER HUB</div>
          <div class="module-title">Paper execution first. Live adapters are gated.</div>
          <div class="module-sub">The order ticket below creates a local paper fill and an audit record. Live broker adapters are scaffolds: this build never sends a real order and never stores broker credentials.</div>
        </div>
        <div class="module-actions"><span class="module-stamp">${paper} paper tickets · live orders disabled</span><button class="btn btn-ghost" id="brokerRefresh">Refresh status</button></div>
      </div>
      <div class="broker-note">${esc(broker.note || "")}</div>
      <div class="broker-grid">
        ${(broker.adapters || []).map(renderBrokerCard).join("")}
      </div>
      <div class="module-grid module-two">
        <div class="panel module-card">
          <div class="module-card-title">Order ticket <span class="tag cyan">Paper</span></div>
          <form id="brokerForm" class="order-ticket">
            <div class="field-row">
              <div class="field"><label for="brokerAdapter">Broker</label><select id="brokerAdapter">${(broker.adapters || []).map((adapter) => `<option value="${esc(adapter.key)}" ${adapter.key === "paper" ? "selected" : ""}>${esc(adapter.name)}${adapter.configured ? "" : " · not configured"}</option>`).join("")}</select></div>
              <div class="field"><label for="brokerSide">Side</label><select id="brokerSide"><option value="BUY">Buy</option><option value="SELL">Sell</option></select></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="brokerSymbol">Symbol</label><input id="brokerSymbol" value="NIFTY" /></div>
              <div class="field"><label for="brokerQty">Quantity</label><input id="brokerQty" type="number" min="1" step="1" value="75" /></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="brokerType">Order type</label><select id="brokerType"><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></div>
              <div class="field"><label for="brokerPrice">Price (limit / reference)</label><input id="brokerPrice" type="number" step="0.05" value="22600" /></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="brokerProduct">Product</label><select id="brokerProduct"><option value="MIS">Intraday (MIS)</option><option value="NRML">Normal (NRML)</option><option value="CNC">Delivery (CNC)</option></select></div>
              <div class="field"><label for="brokerNote">Note</label><input id="brokerNote" placeholder="Setup / reason" /></div>
            </div>
            <div class="order-preview" id="brokerPreview">Preview the order to see value and estimated charges.</div>
            <div class="module-actions">
              <button class="btn btn-ghost" type="button" id="brokerPreviewBtn">Preview</button>
              <button class="btn btn-primary" type="submit">Create paper fill</button>
            </div>
          </form>
        </div>
        <div class="panel module-card">
          <div class="module-card-title">Paper order log <span class="tiny">local audit trail</span></div>
          ${state.brokerOrders.length ? `<div style="overflow-x:auto"><table class="order-log"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${state.brokerOrders.slice().reverse().map((order) => `<tr><td>${new Date(order.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(order.symbol)}</td><td class="${order.side === "BUY" ? "up" : "down"}">${esc(order.side)}</td><td>${fmtInt(order.qty)}</td><td>${fmtMoney(order.value)}</td><td><span class="tag">${esc(order.status)}</span></td><td><button class="btn btn-ghost" data-broker-remove="${esc(order.id)}">×</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">No paper tickets yet.</div>`}
        </div>
      </div>
    </div>`;
  bindBroker();
}

function renderBrokerCard(adapter) {
  return `<div class="broker-card ${adapter.key === "paper" ? "paper" : ""}">
    <div class="broker-card-top">
      <div><div class="broker-name">${esc(adapter.name)}</div><div class="tiny">${adapter.mode === "paper" ? "Simulated" : "Live adapter scaffold"}</div></div>
      ${adapter.configured ? tag(adapter.mode === "paper" ? "Ready" : "Credentials found", "green") : tag(adapter.mode === "paper" ? "Ready" : "Keys missing", adapter.mode === "paper" ? "green" : "amber")}
    </div>
    <div class="broker-desc">${esc(adapter.description)}</div>
    <div class="broker-env">${adapter.env?.length ? `env: ${adapter.env.join(", ")}` : "local paper engine"}</div>
    <div class="tag ${adapter.liveOrdersEnabled ? "green" : "amber"}" style="margin-top:7px">${adapter.liveOrdersEnabled ? "Live enabled" : "Live orders disabled"}</div>
  </div>`;
}

function bindBroker() {
  const root = $("brokerRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    if (event.target.closest("#brokerRefresh")) {
      loadBroker();
      return;
    }
    if (event.target.closest("#brokerPreviewBtn")) {
      previewBrokerOrder();
      return;
    }
    const remove = event.target.closest("[data-broker-remove]");
    if (remove) {
      state.brokerOrders = state.brokerOrders.filter((order) => order.id !== remove.dataset.brokerRemove);
      saveJson(BROKER_LOG_KEY, state.brokerOrders);
      renderBroker();
    }
  });
  root.addEventListener("submit", (event) => {
    if (event.target.id !== "brokerForm") return;
    event.preventDefault();
    const adapter = $("brokerAdapter")?.value || "paper";
    if (adapter !== "paper") {
      toast("Live broker execution is disabled in this build. Use the paper adapter.");
      return;
    }
    const price = Number($("brokerPrice")?.value) || 0;
    const qty = Math.max(1, Math.floor(Number($("brokerQty")?.value) || 1));
    const value = price * qty;
    const order = {
      id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      broker: "paper",
      symbol: String($("brokerSymbol")?.value || "").toUpperCase(),
      side: $("brokerSide")?.value || "BUY",
      type: $("brokerType")?.value || "MARKET",
      product: $("brokerProduct")?.value || "MIS",
      qty,
      price,
      value,
      note: $("brokerNote")?.value || "",
      status: "PAPER FILLED"
    };
    state.brokerOrders.push(order);
    saveJson(BROKER_LOG_KEY, state.brokerOrders);
    renderBroker();
    toast("Paper fill recorded. No live order was sent.", true);
  });
}

function previewBrokerOrder() {
  const target = $("brokerPreview");
  if (!target) return;
  const qty = Math.max(1, Math.floor(Number($("brokerQty")?.value) || 1));
  const price = Number($("brokerPrice")?.value) || 0;
  const value = qty * price;
  const brokerage = 20;
  const exchange = value * 0.0003503;
  const gst = (brokerage + exchange) * 0.18;
  const stamp = value * 0.00003;
  const total = brokerage + exchange + gst + stamp;
  target.innerHTML = `<b>${esc($("brokerSide")?.value || "BUY")} ${fmtInt(qty)} × ${esc($("brokerSymbol")?.value || "—")} @ ${fmt(price)}</b><br>Order value: ${fmtMoney(value)} · est. charges: ${fmtMoney(total)} · net cash: ${fmtMoney(value + total)}<br><span class="tiny">Paper estimate only. Live adapter execution is disabled.</span>`;
}

/* ------------------------------- watchlists ------------------------------- */

function defaultWatchlists() {
  return [
    { id: "core", name: "Core market", symbols: ["NIFTY", "BANKNIFTY", "SENSEX", "RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN", "ITC"] },
    { id: "global", name: "Global macro", symbols: ["SPX", "NDX", "BRENT", "WTI", "GOLD", "USDINR", "DXY", "BTCUSD"] },
    { id: "options", name: "Options radar", symbols: ["NIFTY", "BANKNIFTY", "INDIAVIX"] },
    { id: "momentum", name: "Momentum", symbols: ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"] }
  ];
}

function loadWatchlists() {
  const saved = loadJson(WATCH_KEY, null);
  if (!Array.isArray(saved) || !saved.length) return defaultWatchlists();
  return saved.map((list) => ({ id: list.id || `wl_${Date.now()}`, name: list.name || "Watchlist", symbols: Array.isArray(list.symbols) ? list.symbols : [] }));
}

function saveWatchlists() {
  saveJson(WATCH_KEY, state.watchlists);
}

function renderWatchlists() {
  const root = $("watchlistRoot");
  if (!root) return;
  if (!state.watchlists.length) state.watchlists = defaultWatchlists();
  if (!state.watchlists.find((list) => list.id === state.activeListId)) state.activeListId = state.watchlists[0].id;
  const active = state.watchlists.find((list) => list.id === state.activeListId);
  const quoteMap = new Map((state.watchQuotes || []).map((quote) => [quote.key, quote]));
  const symbols = active?.symbols || [];
  root.innerHTML = `
    <div class="module-shell">
      <div class="panel module-head">
        <div>
          <div class="eyebrow">WATCHLISTS</div>
          <div class="module-title">The right symbols, ready when needed.</div>
          <div class="module-sub">Indices, liquid NSE stocks, global macro and options radar in separate lists. Add any symbol, jump to its chart or arm a price alert.</div>
        </div>
        <div class="module-actions"><button class="btn btn-ghost" id="watchNewList">New list</button><button class="btn btn-ghost" id="watchRefresh">Refresh quotes</button></div>
      </div>
      <div class="watch-layout">
        <div class="panel module-card">
          <div class="module-card-title">My lists <span class="tiny">${state.watchlists.length}</span></div>
          <div class="watch-lists">
            ${state.watchlists.map((list) => `<button class="watch-list-btn ${list.id === state.activeListId ? "active" : ""}" data-watch-list="${esc(list.id)}"><span>${esc(list.name)}</span><span class="watch-count">${list.symbols.length}</span></button>`).join("")}
          </div>
          <button class="btn btn-ghost" id="watchDeleteList" style="margin-top:10px;width:100%;color:var(--red)">Delete current list</button>
        </div>
        <div class="panel module-card">
          <div class="module-card-title">${esc(active?.name || "Watchlist")} <span class="tiny">${symbols.length} symbols</span></div>
          <div class="watch-add-row">
            <input id="watchAddSymbol" list="watchSymbolList" placeholder="Add NIFTY, RELIANCE, BRENT…" autocomplete="off" />
            <datalist id="watchSymbolList">${state.symbols.map((symbol) => `<option value="${esc(symbol.key)}">${esc(symbol.name)}</option>`).join("")}</datalist>
            <button class="btn btn-primary" id="watchAddBtn">Add</button>
          </div>
          <div style="overflow-x:auto;margin-top:10px">
            <table class="watch-table">
              <thead><tr><th>Symbol</th><th>Last</th><th>Change</th><th>RSI</th><th>Rating</th><th>Actions</th></tr></thead>
              <tbody>${symbols.length ? symbols.map((key) => renderWatchRow(key, quoteMap.get(key))).join("") : `<tr><td colspan="6"><div class="empty-state">This list is empty. Add a symbol above.</div></td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  bindWatchlists();
}

function renderWatchRow(key, quote) {
  return `<tr>
    <td><b>${esc(symbolLabel(key))}</b><div class="tiny">${esc(key)}</div></td>
    <td class="mono">${fmt(quote?.value)}</td>
    <td class="mono ${cls(quote?.change)}">${fmtPct(quote?.change)}</td>
    <td class="mono">${fmt(quote?.rsi, 1)}</td>
    <td>${quote?.rating == null ? "—" : tag(Number(quote.rating) > 0.15 ? "Buy" : Number(quote.rating) < -0.15 ? "Sell" : "Neutral", Number(quote.rating) > 0.15 ? "green" : Number(quote.rating) < -0.15 ? "red" : "")}</td>
    <td><div class="module-actions"><button class="btn btn-ghost" data-watch-chart="${esc(key)}">Chart</button><button class="btn btn-ghost" data-watch-alert="${esc(key)}">Alert</button><button class="btn btn-ghost" data-watch-remove="${esc(key)}">×</button></div></td>
  </tr>`;
}

function bindWatchlists() {
  const root = $("watchlistRoot");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("click", (event) => {
    const list = event.target.closest("[data-watch-list]");
    if (list) {
      state.activeListId = list.dataset.watchList;
      state.watchQuotes = [];
      renderWatchlists();
      loadWatchQuotes();
      return;
    }
    const chart = event.target.closest("[data-watch-chart]");
    if (chart) {
      dispatchChart(chart.dataset.watchChart);
      return;
    }
    const alert = event.target.closest("[data-watch-alert]");
    if (alert) {
      window.dispatchEvent(new CustomEvent("solo:open-alert", { detail: { symbol: alert.dataset.watchAlert } }));
      return;
    }
    const remove = event.target.closest("[data-watch-remove]");
    if (remove) {
      const active = state.watchlists.find((item) => item.id === state.activeListId);
      if (!active) return;
      active.symbols = active.symbols.filter((key) => key !== remove.dataset.watchRemove);
      saveWatchlists();
      renderWatchlists();
      loadWatchQuotes();
      return;
    }
    if (event.target.closest("#watchAddBtn")) {
      const input = $("watchAddSymbol");
      const key = String(input?.value || "").trim().toUpperCase();
      if (!key) return;
      const active = state.watchlists.find((item) => item.id === state.activeListId);
      if (!active) return;
      if (!active.symbols.includes(key)) active.symbols.push(key);
      saveWatchlists();
      if (input) input.value = "";
      renderWatchlists();
      loadWatchQuotes();
      return;
    }
    if (event.target.closest("#watchNewList")) {
      const name = prompt("List name", "New watchlist");
      if (!name) return;
      const id = `wl_${Date.now().toString(36)}`;
      state.watchlists.push({ id, name: name.trim(), symbols: [] });
      state.activeListId = id;
      saveWatchlists();
      renderWatchlists();
      return;
    }
    if (event.target.closest("#watchDeleteList")) {
      if (state.watchlists.length <= 1) {
        toast("Keep at least one watchlist.");
        return;
      }
      if (!confirm("Delete the current watchlist?")) return;
      state.watchlists = state.watchlists.filter((list) => list.id !== state.activeListId);
      state.activeListId = state.watchlists[0].id;
      saveWatchlists();
      renderWatchlists();
      loadWatchQuotes();
      return;
    }
    if (event.target.closest("#watchRefresh")) loadWatchQuotes();
  });
  root.addEventListener("keydown", (event) => {
    if (event.target.id === "watchAddSymbol" && event.key === "Enter") {
      event.preventDefault();
      $("watchAddBtn")?.click();
    }
  });
}

async function loadWatchQuotes() {
  const active = state.watchlists.find((list) => list.id === state.activeListId);
  if (!active?.symbols?.length) {
    state.watchQuotes = [];
    if (state.view === "watchlist") renderWatchlists();
    return;
  }
  try {
    const data = await api(`/api/quotes?symbols=${encodeURIComponent(active.symbols.join(","))}`);
    state.watchQuotes = data.items || [];
    if (state.view === "watchlist") renderWatchlists();
  } catch (error) {
    toast(`Watchlist: ${error.message}`);
  }
}
