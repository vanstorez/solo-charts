"use client";

import { useCallback, useEffect, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type {
  CryptoQuote,
  CryptoResponse,
  GlobalGroup,
  GlobalQuote,
  GlobalMarketsResponse,
  IndiaConclusion,
  IndiaMarketsResponse,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

const CACHE_KEY = "solo:daily:summary";
const CACHE_TTL_MS = 15 * 60 * 1000;

function loadCache(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed._cached_at || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: any) {
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

function biasPill(bias: string) {
  const tone =
    bias === "bullish" ? "accent" : bias === "bearish" ? "bad" : bias === "mixed / neutral" ? "warn" : "";
  return <span className={`badge ${tone}`}>{bias}</span>;
}

function MarketBlock({
  title,
  kicker,
  quotes,
  conclusion,
  meta,
  loading,
  error,
  onRetry,
  showSource = true,
}: {
  title: string;
  kicker: string;
  quotes?: GlobalQuote[];
  conclusion?: IndiaConclusion;
  meta?: any;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  showSource?: boolean;
}) {
  return (
    <Panel title={title} kicker={kicker} style={{ marginBottom: 12 }}>
      {error && <div style={{ marginBottom: 8 }}><ErrorNotice error={error} retry={onRetry} /></div>}
      {loading && !quotes && !conclusion && <LoadingBlock rows={4} label="Loading market data..." />}
      {quotes && quotes.length > 0 && (
        <div className="grid-3" style={{ marginBottom: 8 }}>
          {quotes.slice(0, 6).map((q) => (
            <div key={q.key} className="stat-card" style={{ borderTop: `3px solid ${quoteColor(q.change)}` }}>
              <div className="stat-label">{q.short}</div>
              <div className="stat-value" style={{ color: quoteColor(q.change) }}>
                {formatNumber(q.value, 2)}
              </div>
              <div className="stat-foot">
                <span style={{ color: quoteColor(q.change) }}>{formatPct(q.change)}</span>{" "}
                <span className="muted">· {q.exchange}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {conclusion && (
        <div className="detail-grid" style={{ marginTop: 8 }}>
          <div className="detail-cell"><span>Bias</span><strong>{biasPill(conclusion.bias)}</strong></div>
          <div className="detail-cell"><span>Confidence</span><strong>{conclusion.confidence_pct ?? "—"}%</strong></div>
          <div className="detail-cell"><span>Bullish</span><strong>{conclusion.bullish_count}</strong></div>
          <div className="detail-cell"><span>Bearish</span><strong>{conclusion.bearish_count}</strong></div>
          <div className="detail-cell"><span>Neutral</span><strong>{conclusion.neutral_count}</strong></div>
          <div className="detail-cell"><span>Instruments</span><strong>{conclusion.bullish_count ?? 0 + (conclusion.bearish_count ?? 0) + (conclusion.neutral_count ?? 0)}</strong></div>
        </div>
      )}
      {conclusion && (
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          {conclusion.note}
        </div>
      )}
      {meta && (
        <div style={{ marginTop: 8 }}><ProvenanceLine meta={meta} /></div>
      )}
    </Panel>
  );
}

export default function DailySummaryPage() {
  const india = useApi<IndiaMarketsResponse>("/api/india/markets", 300_000);
  const global = useApi<GlobalMarketsResponse>("/api/global/markets", 300_000);
  const crypto = useApi<CryptoResponse>("/api/global/crypto", 15_000);
  const [cacheData, setCacheData] = useState<any>(loadCache());
  const [manualLoading, setManualLoading] = useState(!cacheData);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);

  const fetchAll = useCallback(async () => {
    setManualLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      fetch("/backend/api/india/markets", { cache: "no-store" }),
      fetch("/backend/api/global/markets", { cache: "no-store" }),
      fetch("/backend/api/global/crypto", { cache: "no-store" }),
    ]);
    let anyError = false;
    for (const r of results) {
      if (r.status === "rejected") {
        anyError = true;
        setError(r.reason instanceof Error ? r.reason.message : "Request failed");
      }
    }
    try {
      const indiaData = results[0].status === "fulfilled" ? await results[0].value.json() : null;
      const globalData = results[1].status === "fulfilled" ? await results[1].value.json() : null;
      const cryptoData = results[2].status === "fulfilled" ? await results[2].value.json() : null;
      if (indiaData || globalData || cryptoData) {
        const combined = { india: indiaData, global: globalData, crypto: cryptoData };
        setCacheData(combined);
        saveCache(combined);
        setManualLoading(false);
        setToast({ message: "Daily summary refreshed", type: "success" });
      }
      if (anyError && !indiaData && !globalData && !cryptoData) {
        setManualLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse daily summary");
      setManualLoading(false);
      setToast({ message: err instanceof Error ? err.message : "Refresh failed", type: "error" });
    }
  }, []);

  const refreshAll = () => {
    india.refresh();
    global.refresh();
    crypto.refresh();
    void fetchAll();
  };

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const combined = cacheData || { india: india.data, global: global.data, crypto: crypto.data };
  const loading = manualLoading || (india.loading && !cacheData) || (global.loading && !cacheData) || (crypto.loading && !cacheData);

  const indQ: GlobalQuote[] = combined?.india?.quotes ?? [];
  const indConclusion = combined?.india?.conclusion as IndiaConclusion | undefined;
  const indMeta = combined?.india?.meta as any;
  const indError = combined?.india?.coverage?.failed ? `Some Indian instruments unavailable` : null;

  const globalQ = combined?.global as GlobalMarketsResponse | undefined;
  const fx: GlobalQuote[] = globalQ?.fx ?? [];
  const commodities: GlobalQuote[] = globalQ?.commodities ?? [];
  const rates: GlobalQuote[] = globalQ?.rates ?? [];
  const indices: GlobalGroup[] = globalQ?.indices ?? [];
  const globalMeta = globalQ?.meta;

  const cryptoQ: CryptoQuote[] = combined?.crypto?.quotes ?? [];
  const cryptoMeta = combined?.crypto?.meta;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Daily Market Summary"
        title="All Markets in One Window"
        subtitle="Indian markets · Global indices/FX/commodities/yields · Crypto — daily bias, levels, and sector context. Everything inside Solo Trading Charts — no external links."
        actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh all markets</button>
            <span className="badge">daily update</span>
          </>
        }
      />

      {error && <ErrorNotice error={error} retry={fetchAll} />}

      {/* Top banner: overall summary */}
      <Panel title="Today's Market Conclusion" kicker="Transparent bias across all tracked markets" style={{ marginBottom: 10 }}>
        <div className="grid-4">
          <div className="stat-card">
            <div className="stat-label">Indian Market</div>
            <div className="stat-value">{biasPill(indConclusion?.bias ?? "unavailable")}</div>
            <div className="stat-foot"><span>{indConclusion?.confidence_pct ?? "—"}% confidence</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Global Markets</div>
            <div className="stat-value">
              {combined?.global?.coverage?.returned ?? "—"} / {combined?.global?.coverage?.requested ?? "—"}
            </div>
            <div className="stat-foot"><span>instruments returned</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Crypto Pairs</div>
            <div className="stat-value">{combined?.crypto?.coverage?.returned ?? "—"}</div>
            <div className="stat-foot"><span>USDT spot pairs</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Last Updated</div>
            <div className="stat-value">{combined?.india?.as_of ? timeAgo(combined.india.as_of) : "—"}</div>
            <div className="stat-foot"><span>public data · delayed</span></div>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          <strong>Daily routine:</strong> Refresh before market open (9:15 AM IST) for the day's bias across all markets.
          Data is public and delayed/unknown — not a licensed feed. Paper trading only; live execution is hard-disabled.
        </div>
      </Panel>

      {/* Indian Markets */}
      <MarketBlock
        title="Indian Markets — NSE / BSE"
        kicker="NIFTY, BANKNIFTY, SENSEX & Sectors"
        quotes={indQ}
        conclusion={indConclusion}
        meta={indMeta}
        loading={india.loading && !combined?.india}
        error={indError}
        onRetry={india.refresh}
      />

      {/* Global Markets - Indices by Region */}
      {indices.length > 0 && (
        <Panel title="Global Equity Indices — by Region" kicker="Public delayed/unknown snapshots" style={{ marginBottom: 10 }}>
          <div className="grid-2">
            {indices.map((group: GlobalGroup) => (
              <Panel key={group.key} title={group.label} kicker={`${group.quotes.length} indices`} style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "var(--mono)" }}>
                  {group.quotes.slice(0, 8).map((q: GlobalQuote) => (
                    <div key={q.key} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{q.short}</span>
                      <span style={{ color: quoteColor(q.change) }}>{formatPct(q.change)}</span>
                    </div>
                  ))}
                  {group.quotes.length > 8 && <span style={{ color: "var(--muted)" }}>{group.quotes.length - 8} more...</span>}
                </div>
              </Panel>
            ))}
          </div>
          {globalMeta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={globalMeta} /></div>}
        </Panel>
      )}

      {/* FX, Commodities, Rates */}
      <div className="grid-3" style={{ marginBottom: 10 }}>
        <Panel title="FX Crosses" kicker="Delayed/unknown" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "var(--mono)" }}>
            {fx.slice(0, 8).map((q: GlobalQuote) => (
              <div key={q.key} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{q.short}</span>
                <span style={{ color: quoteColor(q.change) }}>{formatPct(q.change)}</span>
              </div>
            ))}
            {fx.length > 8 && <span style={{ color: "var(--muted)" }}>{fx.length - 8} more...</span>}
          </div>
        </Panel>
        <Panel title="Commodities" kicker="Delayed/unknown" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "var(--mono)" }}>
            {commodities.slice(0, 8).map((q: GlobalQuote) => (
              <div key={q.key} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{q.short}</span>
                <span style={{ color: quoteColor(q.change) }}>{formatPct(q.change)}</span>
              </div>
            ))}
            {commodities.length > 8 && <span style={{ color: "var(--muted)" }}>{commodities.length - 8} more...</span>}
          </div>
        </Panel>
        <Panel title="US Yields" kicker="Delayed/unknown" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "var(--mono)" }}>
            {rates.map((q: GlobalQuote) => (
              <div key={q.key} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{q.short}</span>
                <span style={{ color: quoteColor(q.change) }}>{formatNumber(q.value, 2)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Crypto */}
      <Panel title="Crypto — Binance USDT Spot" kicker="Live WebSocket stream when connected" style={{ marginBottom: 10 }}>
        <div className="grid-4" style={{ marginBottom: 8 }}>
          {cryptoQ.slice(0, 8).map((q) => (
            <div key={q.symbol} className="stat-card" style={{ borderTop: `3px solid ${quoteColor(q.change)}` }}>
              <div className="stat-label">{q.short}</div>
              <div className="stat-value" style={{ color: quoteColor(q.change) }}>
                {formatNumber(q.price, q.price !== null && q.price < 1 ? 5 : 2)}
              </div>
              <div className="stat-foot">
                <span style={{ color: quoteColor(q.change) }}>{formatPct(q.change)}</span>{" "}
                <span className="muted">· {q.data_status}</span>
              </div>
            </div>
          ))}
          {cryptoQ.length > 8 && (
            <div className="stat-card">
              <div className="stat-label">{cryptoQ.length - 8} more</div>
              <div className="stat-value">pairs</div>
              <div className="stat-foot"><span>see /global</span></div>
            </div>
          )}
        </div>
        {cryptoMeta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={cryptoMeta} /></div>}
      </Panel>

      {/* Footer contract */}
      <Panel title="Data Contract — All Markets" kicker="Honest provenance, no external links" style={{ marginBottom: 10 }}>
        <div className="detail-grid" style={{ marginTop: 8, fontSize: 11 }}>
          <div className="detail-cell"><span>Indian Market</span><strong>{indMeta?.provider}</strong></div>
          <div className="detail-cell"><span>Global Market</span><strong>{globalMeta?.provider}</strong></div>
          <div className="detail-cell"><span>Crypto</span><strong>{cryptoMeta?.provider}</strong></div>
          <div className="detail-cell"><span>Execution</span><strong>Paper only</strong></div>
        </div>
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          <strong>No consolidated global tape is claimed.</strong> Coverage is curated major instruments only. Missing data stays
          visibly unavailable — never faked. Refresh daily before market open for your plan.
        </div>
        <div className="badge-row" style={{ marginTop: 8 }}>
          <span className="badge">Solo platform</span>
          <span className="badge">Mobile-optimized</span>
          <span className="badge">No external links</span>
          <a className="badge" href="/sources">Source register →</a>
        </div>
      </Panel>
    </>
  );
}
