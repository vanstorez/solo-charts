"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct } from "@/lib/format";
import type { IndicesScannerResponse, IndexScanRow } from "@/lib/types";

const CACHE_KEY = "solo:index-scanner:1y";
const CACHE_TTL_MS = 15 * 60 * 1000; // mirrors server-side 15-min scan cache
const REQUEST_PATH = "/backend/api/indices-scanner";

const CATEGORY_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "broad", label: "Broad" },
  { key: "sectoral", label: "Sectoral" },
  { key: "bse", label: "BSE" },
  { key: "volatility", label: "Volatility" },
];

const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: "year_desc", label: "1Y change ↓" },
  { key: "year_asc", label: "1Y change ↑" },
  { key: "day_desc", label: "Day change ↓" },
  { key: "name", label: "Name A–Z" },
  { key: "rsi", label: "RSI ↑" },
];

const TREND_LABELS: Record<string, { text: string; cls: string }> = {
  strong_uptrend: { text: "Strong uptrend", cls: "chip-positive" },
  uptrend: { text: "Uptrend", cls: "chip-positive" },
  sideways: { text: "Sideways", cls: "chip-neutral" },
  downtrend: { text: "Downtrend", cls: "chip-negative" },
  strong_downtrend: { text: "Strong downtrend", cls: "chip-negative" },
  unknown: { text: "Trend n/a", cls: "chip-neutral" },
};

function loadCache(): IndicesScannerResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IndicesScannerResponse & { _cached_at: number };
    if (Date.now() - parsed._cached_at > CACHE_TTL_MS) return null;
    return {
      available: parsed.available,
      scanned: parsed.scanned,
      returned: parsed.returned,
      advancing_1y: parsed.advancing_1y,
      declining_1y: parsed.declining_1y,
      advancing_today: parsed.advancing_today,
      declining_today: parsed.declining_today,
      strongest: parsed.strongest,
      weakest: parsed.weakest,
      indices: parsed.indices ?? [],
      meta: parsed.meta ?? {},
    };
  } catch {
    return null;
  }
}

function saveCache(data: IndicesScannerResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _cached_at: Date.now() }));
  } catch {
    // quota — caching is an optimization, never required
  }
}

function Sparkline({ closes }: { closes: number[] }) {
  if (!closes || closes.length < 2) return <div style={{ height: 56 }} />;
  const width = 232;
  const height = 56;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = closes.map((value, index) => {
    const x = (index / (closes.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? "#38d9a9" : "#ff6b81";
  const fill = up ? "rgba(56, 217, 169, 0.10)" : "rgba(255, 107, 129, 0.10)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={fill} />
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.6} />
    </svg>
  );
}

function RangeBar({ low, high, last }: { low: number; high: number; last: number }) {
  const span = high - low || 1;
  const pos = Math.max(0, Math.min(1, (last - low) / span));
  return (
    <div style={{ marginTop: "auto", paddingTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted-2)", marginBottom: 3 }}>
        <span>52W low {formatNumber(low, 0)}</span>
        <span>52W high {formatNumber(high, 0)}</span>
      </div>
      <div style={{ position: "relative", height: 4, borderRadius: 2, background: "var(--panel-2, #1a2436)" }}>
        <div
          style={{
            position: "absolute",
            left: `calc(${(pos * 100).toFixed(1)}% - 4px)`,
            top: -2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: pos > 0.75 ? "#38d9a9" : pos < 0.25 ? "#ff6b81" : "#f4c95d",
          }}
        />
      </div>
    </div>
  );
}

function IndexCard({ row }: { row: IndexScanRow }) {
  if (!row.available) {
    return (
      <div className="panel" style={{ padding: "14px 15px", margin: 0, minHeight: 230, opacity: 0.7 }}>
        <div style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{row.key}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{row.name}</div>
        <div style={{ marginTop: "auto", paddingTop: 40 }}>
          <div style={{ fontSize: 22, color: "var(--muted-2)", fontFamily: "var(--mono)", fontWeight: 700 }}>—</div>
          <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 6 }}>
            Year history unavailable from public providers. Never filled with a guessed value.
          </div>
        </div>
      </div>
    );
  }

  const yearChange = row.year_change_pct ?? 0;
  const trend = TREND_LABELS[row.trend ?? "unknown"] ?? TREND_LABELS.unknown;
  const yearTone = yearChange > 0.02 ? "positive" : yearChange < -0.02 ? "negative" : "muted";
  const dayChange = row.day_change_pct ?? 0;
  const rsiValue = row.rsi14 ?? null;

  return (
    <div className="panel" style={{ padding: "14px 15px", margin: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 230 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {row.exchange} · {row.currency}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{row.name}</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--muted-2)" }}>{row.key}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text)" }}>
          {formatNumber(row.last_close ?? 0, 2)}
        </div>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: dayChange > 0 ? "#38d9a9" : dayChange < 0 ? "#ff6b81" : "var(--muted-2)" }}>
          {dayChange > 0 ? "▲" : dayChange < 0 ? "▼" : "·"} {formatPct(dayChange)} today
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span
          className="badge"
          style={{
            borderColor: "transparent",
            color: yearTone === "positive" ? "#38d9a9" : yearTone === "negative" ? "#ff6b81" : "var(--muted)",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          1Y {formatPct(yearChange)}
        </span>
        <span
          className="badge"
          style={{
            borderColor: "rgba(110, 168, 255, 0.25)",
            color: trend.cls === "chip-positive" ? "#38d9a9" : trend.cls === "chip-negative" ? "#ff6b81" : "var(--muted)",
            fontSize: 10,
          }}
        >
          {trend.text}
        </span>
        {rsiValue !== null && (
          <span className="badge" style={{ fontSize: 10 }}>
            RSI {rsiValue.toFixed(0)}
            {rsiValue > 70 ? " · overbought" : rsiValue < 30 ? " · oversold" : ""}
          </span>
        )}
      </div>

      <Sparkline closes={row.spark_closes ?? []} />

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted-2)" }}>
        <span>
          Signals 1Y: <strong style={{ color: "#38d9a9" }}>{row.signals_bullish_total ?? 0}▲</strong> /{" "}
          <strong style={{ color: "#ff6b81" }}>{row.signals_bearish_total ?? 0}▼</strong>
        </span>
        {row.last_signal && (
          <span>
            latest: {row.last_signal_side === "bullish" ? "▲" : "▼"} {row.last_signal}
          </span>
        )}
      </div>

      {row.high_52w != null && row.low_52w != null && row.last_close != null && (
        <RangeBar low={row.low_52w} high={row.high_52w} last={row.last_close} />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 9, color: "var(--muted-2)" }}>{row.bar_count} daily bars · delayed public data</span>
        <Link className="chart-chip" href={`/analysis?symbol=${encodeURIComponent(row.key)}&interval=1d`}>
          Full chart →
        </Link>
      </div>
    </div>
  );
}

export default function IndexScannerPage() {
  const [data, setData] = useState<IndicesScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState("year_desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Public providers hiccup occasionally; retry like every other Solo page.
    let lastError = "Index scan failed";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(REQUEST_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as IndicesScannerResponse;
        setData(payload);
        saveCache(payload);
        setError(null);
        if (attempt > 1) setToast({ message: "Scan completed after retry", type: "success" });
        setLoading(false);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : lastError;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    setError(lastError);
    setToast({ message: lastError, type: "error" });
    setLoading(false);
  }, []);

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    void fetchData();
  }, [fetchData]);

  const refresh = useCallback(() => void fetchData(), [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchData();
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void fetchData();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchData]);

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const rows = data?.indices ?? [];
    const query = search.trim().toLowerCase();
    let list = rows.filter((row) => (category === "all" ? true : row.category === category));
    if (query) {
      list = list.filter((row) => row.name.toLowerCase().includes(query) || row.key.toLowerCase().includes(query));
    }
    const sorters: Record<string, (a: IndexScanRow, b: IndexScanRow) => number> = {
      year_desc: (a, b) => (b.available ? b.year_change_pct ?? -999 : -1000) - (a.available ? a.year_change_pct ?? -999 : -1000),
      year_asc: (a, b) => (a.available ? a.year_change_pct ?? 999 : 1000) - (b.available ? b.year_change_pct ?? 999 : 1000),
      day_desc: (a, b) => (b.available ? b.day_change_pct ?? -999 : -1000) - (a.available ? a.day_change_pct ?? -999 : -1000),
      name: (a, b) => a.name.localeCompare(b.name),
      rsi: (a, b) => (a.available ? a.rsi14 ?? 999 : 1000) - (b.available ? b.rsi14 ?? 999 : 1000),
    };
    return [...list].sort(sorters[sortBy] ?? sorters.year_desc);
  }, [data, search, category, sortBy]);

  const returnedCount = data?.returned ?? 0;
  const scannedCount = data?.scanned ?? 0;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Indian Index Scanner — 1 Year"
        title="Every Indian index, one year of candles, scanned"
        subtitle="Sensex, Nifty, sectoral indices and BSE breadth over the previous year: trend, RSI, 52-week range, candlestick signals and sparkline charts — then one click into the full chart."
        actions={
          <>
            <button className="button primary" onClick={refresh} type="button" disabled={loading}>
              {loading ? "Scanning…" : "Rescan"}
            </button>
            {typeof data?.meta?.provider === "string" && (
              <span className="badge accent">{(data.meta as { provider?: string }).provider}</span>
            )}
          </>
        }
      />

      {error && <ErrorNotice error={error} retry={refresh} />}

      <div className="grid-4" style={{ marginBottom: 13 }}>
        <div className="stat-card">
          <div className="stat-label">Indices scanned</div>
          <div className="stat-value">{scannedCount}</div>
          <div className="stat-foot">
            <span>{returnedCount} with 1Y data · {scannedCount - returnedCount} unavailable</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Advancing over 1Y</div>
          <div className={`stat-value ${data?.advancing_1y ? "positive" : "muted"}`}>{data?.advancing_1y ?? "—"}</div>
          <div className="stat-foot">
            <span>{data ? `${data.declining_1y} declining year over year` : ""}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Strongest (1Y)</div>
          <div className="stat-value positive" style={{ fontSize: 15 }}>{data?.strongest?.name ?? "—"}</div>
          <div className="stat-foot">
            <span>{data?.strongest ? formatPct(data.strongest.year_change_pct ?? 0) : ""}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Weakest (1Y)</div>
          <div className="stat-value negative" style={{ fontSize: 15 }}>{data?.weakest?.name ?? "—"}</div>
          <div className="stat-foot">
            <span>{data?.weakest ? formatPct(data.weakest.year_change_pct ?? 0) : ""}</span>
          </div>
        </div>
      </div>

      <Panel
        title="Index scanner — previous 1 year of daily candles"
        kicker="Public delayed history · candlestick signals are transparent heuristics, not advice"
        action={
          <>
            <input
              className="input"
              placeholder="Filter index…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 150 }}
            />
            <select className="input" value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: 120 }}>
              {CATEGORY_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ width: 130 }}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </>
        }
        style={{ marginBottom: 13 }}
      >
        {loading && !data?.indices?.length ? (
          <LoadingBlock rows={6} label="Scanning every Indian index over the past year (first scan takes a few seconds)…" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {filtered.map((row) => (
              <IndexCard key={row.key} row={row} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="How the scan works" kicker="Transparent local heuristics" style={{ marginBottom: 13 }}>
        <div className="detail-grid">
          <div className="detail-cell"><span>History</span><strong>~248 daily bars per index, previous 1Y</strong></div>
          <div className="detail-cell"><span>Trend</span><strong>Close vs SMA50/SMA200 — labelled, not predicted</strong></div>
          <div className="detail-cell"><span>Signals</span><strong>15 candlestick patterns counted per index</strong></div>
          <div className="detail-cell"><span>Data</span><strong>Yahoo public snapshots · delayed/unknown</strong></div>
        </div>
        <div className="warning-box" style={{ marginTop: 10 }}>
          <strong>Solo scanning rules.</strong> Everything is computed inside Solo from public delayed candles. Pattern
          counts describe candles that already formed — they are not predictions and not trade advice. Indices that fail
          to return history stay visibly unavailable. No external chart links; every card opens the full Solo chart.
        </div>
        <div className="badge-row" style={{ marginTop: 8 }}>
          <span className="badge">19 indices</span>
          <span className="badge">1Y daily candles</span>
          <span className="badge">Cached 15 min</span>
          <span className="badge">Keyboard R</span>
          <a className="badge" href="/analysis">Full charts →</a>
        </div>
      </Panel>
    </>
  );
}
