"use client";

import { useCallback, useEffect, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { GlobalQuote, IndiaConclusion, IndiaMarketsResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const CACHE_KEY = "solo:india:markets";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function loadCache(): IndiaMarketsResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed._cached_at || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return parsed as IndiaMarketsResponse;
  } catch {
    return null;
  }
}

function saveCache(data: IndiaMarketsResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _cached_at: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

function quoteColor(change: number | null): string {
  if (change === null) return "var(--muted)";
  if (change > 0) return "var(--positive)";
  if (change < 0) return "var(--negative)";
  return "var(--muted)";
}

function biasBadge(bias: string) {
  const tone =
    bias === "bullish" ? "accent" : bias === "bearish" ? "bad" : bias === "mixed / neutral" ? "warn" : "";
  return <span className={`badge ${tone}`}>{bias}</span>;
}

function IndexCard({ quote }: { quote: GlobalQuote }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${quoteColor(quote.change)}` }}>
      <div className="stat-label">{quote.short}</div>
      <div className="stat-value" style={{ color: quoteColor(quote.change) }}>
        {formatNumber(quote.value, 2)}
      </div>
      <div className="stat-foot">
        <span style={{ color: quoteColor(quote.change) }}>{formatPct(quote.change)}</span>{" "}
        <span className="muted">· {timeAgo(quote.as_of ?? "")}</span>{" "}
        <span className="muted">· {quote.exchange}</span>
      </div>
    </div>
  );
}

function SectorRow({ quote }: { quote: GlobalQuote }) {
  return (
    <tr key={quote.key}>
      <td>
        <strong>{quote.short}</strong>
        <span className="small muted" style={{ marginLeft: 6 }}>{quote.exchange}</span>
      </td>
      <td className="num mono" style={{ color: quoteColor(quote.change) }}>
        {formatNumber(quote.value, 2)}
      </td>
      <td className={`num mono ${toneClass(quote.change)}`}>{formatPct(quote.change)}</td>
      <td className="num mono">{formatNumber(quote.day_high ?? 0, 2)}</td>
      <td className="num mono">{formatNumber(quote.day_low ?? 0, 2)}</td>
      <td className="quote-source">{quote.data_status}</td>
    </tr>
  );
}

export default function IndiaMarketsPage() {
  const markets = useApi<IndiaMarketsResponse>("/api/india/markets", 300_000);
  const [cacheData, setCacheData] = useState<IndiaMarketsResponse | null>(loadCache());
  const [manualLoading, setManualLoading] = useState(!cacheData);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);

  // Prefer live API data, fall back to cache
  const data = markets.data ?? cacheData;
  const loading = markets.loading || manualLoading;

  // Sync API data to cache
  useEffect(() => {
    if (markets.data) {
      saveCache(markets.data);
      setCacheData(markets.data);
      setManualLoading(false);
    }
  }, [markets.data]);

  const fetchMarkets = useCallback(async () => {
    setManualLoading(true);
    setError(null);
    try {
      const res = await fetch("/backend/api/india/markets", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as IndiaMarketsResponse;
      setCacheData(payload);
      saveCache(payload);
      setToast({ message: "Indian market data refreshed", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Indian market data");
      setToast({ message: err instanceof Error ? err.message : "Refresh failed", type: "error" });
    } finally {
      setManualLoading(false);
    }
  }, []);

  const refreshAll = () => {
    markets.refresh();
    void fetchMarkets();
  };

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const quotes = data?.quotes ?? [];
  const indices = quotes.filter((q) => q.asset_class === "index");
  const sectors = quotes.filter((q) => q.asset_class === "sector");
  const conclusion = data?.conclusion;
  const nifty = indices.find((q) => q.short === "NIFTY");
  const banknifty = indices.find((q) => q.short === "BANKNIFTY");
  const sensex = indices.find((q) => q.short === "SENSEX");
  const vix = indices.find((q) => q.short === "INDIA VIX");

  const support = nifty?.day_low ?? null;
  const resistance = nifty?.day_high ?? null;
  const pivot = nifty?.value && nifty?.day_high && nifty?.day_low ? (nifty.value + nifty.day_high + nifty.day_low) / 3 : null;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Indian Market — Day Trading Plan"
        title="Nifty, Bank Nifty, Sensex & Sectors"
        subtitle="Full Indian market snapshot with day-trading bias, support/resistance and sector performance. Everything inside Solo Trading Charts — no external links."
        actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh data</button>
            <span className="badge">{data?.meta.source_type || "delayed"}</span>
          </>
        }
      />

      {error && <ErrorNotice error={error} retry={fetchMarkets} />}

      {/* Market conclusion banner */}
      <Panel title="Market Conclusion — Today" kicker="Transparent bias, not a trade signal" style={{ marginBottom: 13 }}>
        <div className="grid-4" style={{ marginBottom: 10 }}>
          <div className="stat-card">
            <div className="stat-label">Bias</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{biasBadge(conclusion?.bias ?? "unavailable")}</div>
            <div className="stat-foot"><span>{conclusion?.confidence_pct ?? "—"}% confidence</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Bullish</div>
            <div className="stat-value positive">{conclusion?.bullish_count ?? "—"}</div>
            <div className="stat-foot"><span>instruments</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Bearish</div>
            <div className="stat-value negative">{conclusion?.bearish_count ?? "—"}</div>
            <div className="stat-foot"><span>instruments</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Neutral</div>
            <div className="stat-value">{conclusion?.neutral_count ?? "—"}</div>
            <div className="stat-foot"><span>instruments</span></div>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 8 }}>
          <strong>Why this bias:</strong> {conclusion?.note}{" "}
          <span className="small muted">
            Heuristic: price vs previous close across major NSE indices and sector proxies. Update daily before
            market open for your day-trading plan.
          </span>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          Last updated: {data?.as_of ? timeAgo(data.as_of) : "—"} ·
          Provider: {data?.meta.provider}
        </p>
      </Panel>

      {/* Key indices cards */}
      <div className="grid-4" style={{ marginBottom: 13 }}>
        {nifty && <IndexCard quote={nifty} />}
        {banknifty && <IndexCard quote={banknifty} />}
        {sensex && <IndexCard quote={sensex} />}
        {vix && <IndexCard quote={vix} />}
      </div>

      {/* Day trading plan */}
      <Panel title="Day Trading Plan — Nifty 50" kicker="Support / resistance / pivot from today's range" style={{ marginBottom: 13 }}>
        <div className="grid-3">
          <div className="stat-card">
            <div className="stat-label">Support (Day Low)</div>
            <div className="stat-value">{formatNumber(support, 2)}</div>
            <div className="stat-foot"><span>Watch for bounce/rejection</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Resistance (Day High)</div>
            <div className="stat-value">{formatNumber(resistance, 2)}</div>
            <div className="stat-foot"><span>Watch for breakout/reversal</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pivot (Classic)</div>
            <div className="stat-value">{formatNumber(pivot, 2)}</div>
            <div className="stat-foot"><span>Above = bullish tilt · Below = bearish tilt</span></div>
          </div>
        </div>
        <div className="detail-grid" style={{ marginTop: 10 }}>
          <div className="detail-cell"><span>Suggested bias</span><strong>{conclusion?.bias ?? "unavailable"}</strong></div>
          <div className="detail-cell"><span>Confidence</span><strong>{conclusion?.confidence_pct ?? "—"}%</strong></div>
          <div className="detail-cell"><span>VIX (fear gauge)</span><strong>{formatNumber(vix?.value, 2)}</strong></div>
          <div className="detail-cell"><span>Nifty trend</span><strong>
            {nifty ? (nifty.change !== null && nifty.change > 0 ? "Up" : nifty.change !== null && nifty.change < 0 ? "Down" : "Flat") : "—"}
          </strong></div>
        </div>
        <div className="warning-box" style={{ marginTop: 10 }}>
          <strong>Not a trade signal.</strong> These levels are calculated from today's delayed/unknown public
          snapshot. Place your own stop-loss, position size and risk rules before any paper trade. Live execution
          is hard-disabled in Solo.
        </div>
      </Panel>

      {/* Sector performance */}
      <Panel title="Sector Performance" kicker="NSE sector indices · delayed/unknown" style={{ marginBottom: 13 }}>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="num">Last</th>
                <th className="num">Change</th>
                <th className="num">Day High</th>
                <th className="num">Day Low</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {sectors.length > 0 ? sectors.map((q) => <SectorRow quote={q} />) : <tr><td colSpan={6}>No sector data available</td></tr>}
            </tbody>
          </table>
        </div>
        {sectors.length > 0 && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Sector bias feeds into the market conclusion above. Weak sectors can drag Nifty; strong sectors can
            lead upside.
          </p>
        )}
      </Panel>

      {/* All instruments table */}
      <Panel title="All Indian Instruments" kicker="Every symbol tracked on this page" style={{ marginBottom: 13 }}>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Last</th>
                <th className="num">Change</th>
                <th className="num">High</th>
                <th className="num">Low</th>
                <th className="num">Volume</th>
                <th>Exchange</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={8}><LoadingBlock rows={4} /></td></tr>
              ) : quotes.length > 0 ? quotes.map((q) => (
                <tr key={q.key}>
                  <td><strong>{q.short}</strong></td>
                  <td className="num mono" style={{ color: quoteColor(q.change) }}>{formatNumber(q.value, 2)}</td>
                  <td className={`num mono ${toneClass(q.change)}`}>{formatPct(q.change)}</td>
                  <td className="num mono">{formatNumber(q.day_high ?? 0, 2)}</td>
                  <td className="num mono">{formatNumber(q.day_low ?? 0, 2)}</td>
                  <td className="num mono">{formatNumber(q.volume ?? 0, 0)}</td>
                  <td className="small">{q.exchange}</td>
                  <td className={`quote-source ${q.data_status === "unavailable" ? "bad" : ""}`}>{q.data_status}</td>
                </tr>
              )) : <tr><td colSpan={8}>No data available</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Footer contract */}
      <Panel title="Data Contract" kicker="Honest provenance" style={{ marginBottom: 13 }}>
        {data && <ProvenanceLine meta={data.meta} />}
        <div className="detail-grid" style={{ marginTop: 8 }}>
          <div className="detail-cell"><span>Market</span><strong>India (NSE / BSE)</strong></div>
          <div className="detail-cell"><span>Source</span><strong>{data?.meta.provider}</strong></div>
          <div className="detail-cell"><span>Freshness</span><strong>{data?.meta.source_type}</strong></div>
          <div className="detail-cell"><span>Execution</span><strong>Paper only</strong></div>
        </div>
        <div className="warning-box" style={{ marginTop: 8 }}>
          <strong>Daily update routine:</strong> Refresh this page before market open (9:15 AM IST) for the
          day's bias, support/resistance and sector context. Data is public and delayed/unknown — it is not a
          substitute for a licensed NSE/BSE feed (Global Datafeeds when configured).
        </div>
        <div className="badge-row" style={{ marginTop: 8 }}>
          <span className="badge">Solo platform</span>
          <span className="badge">Indian market data</span>
          <span className="badge">No external links</span>
          <a className="badge" href="/sources">Source register →</a>
        </div>
      </Panel>
    </>
  );
}
