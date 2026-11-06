"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { CryptoLiveBoard } from "@/components/CryptoLiveBoard";
import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatDateTime, formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { CryptoResponse, GlobalMarketsResponse, GlobalQuote } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const CACHE_KEY = "solo:global:markets";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — global data is delayed anyway

function loadCache(): GlobalMarketsResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed._cached_at || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return parsed as GlobalMarketsResponse;
  } catch {
    return null;
  }
}

function saveCache(data: GlobalMarketsResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _cached_at: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

function quoteDigits(quote: GlobalQuote): number {
  if (quote.asset_class === "fx") return quote.value !== null && Math.abs(quote.value) < 10 ? 4 : 2;
  if (quote.asset_class === "rates") return 3;
  return 2;
}

const GlobalTable = React.memo(function GlobalTable({ quotes, loading }: { quotes: GlobalQuote[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="table-scroll" style={{ minHeight: 140 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton-row" style={{ marginBottom: 6 }}>
            <div className="skeleton" style={{ width: "40%" }} />
            <div className="skeleton" style={{ width: "20%", display: "inline-block", marginLeft: 10 }} />
            <div className="skeleton" style={{ width: "12%", display: "inline-block", marginLeft: 8 }} />
            <div className="skeleton" style={{ width: "18%", display: "inline-block", marginLeft: 8 }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="data-table compact global-table">
        <thead>
          <tr>
            <th>Market</th>
            <th className="num">Last</th>
            <th className="num">1D</th>
            <th>Provider time</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => {
            const unavailable = quote.value === null;
            return (
              <tr className={unavailable ? "global-row-unavailable" : ""} key={quote.key}>
                <td>
                  <div className="symbol-cell">
                    <strong>{quote.short}</strong>
                    <span>{quote.exchange} · {quote.country}</span>
                  </div>
                </td>
                <td className="num mono">
                  {formatNumber(quote.value, quoteDigits(quote))}
                  <span className="global-currency">{quote.currency}</span>
                </td>
                <td className={`num mono ${toneClass(quote.change)}`}>{formatPct(quote.change)}</td>
                <td className="mono small" title={quote.as_of ? formatDateTime(quote.as_of) : quote.error || "Provider time unavailable"}>
                  {quote.as_of ? timeAgo(quote.as_of) : "—"}
                </td>
                <td>
                  <span
                    className={`quote-source ${unavailable ? "bad" : ""}`}
                    title={quote.error || quote.source}
                  >
                    {unavailable ? "unavailable" : "Yahoo delayed"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

const CLOCKS = [
  { label: "New York", zone: "America/New_York" },
  { label: "London", zone: "Europe/London" },
  { label: "Mumbai", zone: "Asia/Kolkata" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
  { label: "Sydney", zone: "Australia/Sydney" },
  { label: "Dubai", zone: "Asia/Dubai" }
];

function WorldClocks() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="world-clocks">
      {CLOCKS.map((clock) => (
        <div className="world-clock" key={clock.zone}>
          <span>{clock.label}</span>
          <strong className="mono">
            {now
              ? new Intl.DateTimeFormat("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: clock.zone,
                  hour12: false
                }).format(now)
              : "—"}
          </strong>
        </div>
      ))}
      <p className="small muted">Local clock only; exchange holidays and session breaks are not inferred.</p>
    </div>
  );
}

export default function GlobalMarketsPage() {
  const crypto = useApi<CryptoResponse>("/api/global/crypto", 15_000);
  const [marketsData, setMarketsData] = useState<GlobalMarketsResponse | null>(loadCache());
  const [marketsLoading, setMarketsLoading] = useState(!marketsData);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);

  const fetchMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const res = await fetch("/backend/api/global/markets", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GlobalMarketsResponse;
      setMarketsData(data);
      saveCache(data);
      setToast({ message: "World tape refreshed", type: "success" });
    } catch (err) {
      setMarketsError(err instanceof Error ? err.message : "Failed to load world tape");
      setToast({ message: err instanceof Error ? err.message : "Refresh failed", type: "error" });
    } finally {
      setMarketsLoading(false);
    }
  }, []);

  const refreshAll = () => {
    crypto.refresh();
    void fetchMarkets();
  };

  // Load the world tape on mount (or from cache), then keep it fresh via R / Refresh.
  useEffect(() => {
    void fetchMarkets();
  }, []);

  // Keyboard shortcuts: R = refresh, / = focus search (future)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        refreshAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshAll]);

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const data = marketsData;
  const coverage = data?.coverage;
  const failedEntries = Object.entries(coverage?.errors || {});
  const allQuotes = [
    ...(data?.indices.flatMap((g) => g.quotes) ?? []),
    ...(data?.fx ?? []),
    ...(data?.commodities ?? []),
    ...(data?.rates ?? []),
  ];
  const advancingCount = allQuotes.filter((q) => q.change !== null && q.change > 0).length;
  const decliningCount = allQuotes.filter((q) => q.change !== null && q.change < 0).length;
  const totalWithChange = allQuotes.filter((q) => q.change !== null).length;
  const soloMood =
    totalWithChange === 0
      ? "no data"
      : advancingCount / totalWithChange > 0.6
        ? "bullish"
        : decliningCount / totalWithChange > 0.6
          ? "bearish"
          : "mixed";
  const moodLine =
    totalWithChange === 0
      ? "No instruments returned a value."
      : advancingCount === totalWithChange
        ? "Everything returned is higher."
        : decliningCount === totalWithChange
          ? "Everything returned is lower."
          : `${advancingCount} up · ${decliningCount} down · ${totalWithChange - advancingCount - decliningCount} flat`;

  function unavailableCell(q: GlobalQuote): boolean {
    return q.value === null || q.change === null;
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="World market coverage"
        title="One world tape, inside Solo — no external links"
        subtitle="Major indices by region, FX crosses, commodities, US yields and a dedicated Binance crypto stream. Everything renders inside Solo Trading Charts. Public global snapshots are delayed/unknown; crypto is exchange-pushed while the browser stream is connected."
        actions={<button className="button" onClick={refreshAll} type="button">Refresh world tape</button>}
      />

      {marketsError && <ErrorNotice error={marketsError} retry={fetchMarkets} />}

      {/* Instant cached stats + crypto (fast path) */}
      <div className="grid-4" style={{ marginBottom: 13 }}>
        <div className="stat-card">
          <div className="stat-label">Global instruments</div>
          <div className="stat-value">{coverage?.requested ?? (data ? "cached" : "—")}</div>
          <div className="stat-foot"><span>curated world coverage</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Snapshots returned</div>
          <div className={`stat-value ${coverage && coverage.failed > 0 ? "neutral" : "positive"}`}>
            {coverage?.returned ?? (data ? "cached" : "—")}
          </div>
          <div className="stat-foot"><span>{coverage?.failed ? `${coverage.failed} unavailable` : "no gaps reported"}</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Crypto stream</div>
          <div className="stat-value" style={{ fontSize: 18 }}>Binance WS</div>
          <div className="stat-foot"><span>{crypto.data?.coverage.returned ?? "—"} liquid USDT pairs</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Live execution</div>
          <div className="stat-value negative" style={{ fontSize: 20 }}>DISABLED</div>
          <div className="stat-foot"><span>hard-coded off</span></div>
        </div>
      </div>

      {data && (
        <>
          <Panel title="Solo Read — world tape at a glance" kicker="Simple verdict · not a trade signal" style={{ marginBottom: 12 }}>
            <div className="grid-4">
              <div className="stat-card">
                <div className="stat-label">Instruments returned</div>
                <div className="stat-value">{coverage?.returned}</div>
                <div className="stat-foot"><span>{coverage?.requested} requested · {coverage?.failed} unavailable</span></div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Advancing</div>
                <div className={`stat-value ${advancingCount ? "positive" : "muted"}`}>{advancingCount}</div>
                <div className="stat-foot"><span>higher vs previous close</span></div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Declining</div>
                <div className={`stat-value ${decliningCount ? "negative" : "muted"}`}>{decliningCount}</div>
                <div className="stat-foot"><span>lower vs previous close</span></div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Mood</div>
                <div className="stat-value">{soloMood}</div>
                <div className="stat-foot"><span>{moodLine}</span></div>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Solo Read is a transparent, plain-language read of direction across the returned universe. It weighs only
              the most recent public snapshot (delayed/unknown for equities/FX/commodities; live snapshot for crypto).
              It is not a recommendation and it does not predict the next move.
            </p>
          </Panel>

          <Panel title="World heatmap" kicker="Color = 1-day change · green up, red down · gray unavailable" style={{ marginBottom: 12 }}>
            <div className="heatmap-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, padding: 4 }}>
              {allQuotes.map((quote) => (
                <div
                  key={quote.key}
                  className={`heatmap-cell ${unavailableCell(quote) ? "heatmap-unavailable" : quote.change !== null && quote.change > 0 ? "heatmap-up" : quote.change !== null && quote.change < 0 ? "heatmap-down" : "heatmap-flat"}`}
                  title={`${quote.short} · ${formatNumber(quote.value, 2)} · ${formatPct(quote.change)}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "var(--mono)", color: "var(--muted)" }}>
                    <strong>{quote.short}</strong>
                    <span>{formatPct(quote.change)}</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text)" }}>{formatNumber(quote.value, 2)}</div>
                  <div style={{ fontSize: 9, color: "var(--muted-2)" }}>{quote.exchange}</div>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Cells are grouped by asset class below. Unavailable means the public provider returned no value — it is
              never shown as zero or a guessed price.
            </p>
          </Panel>
        </>
      )}
      <div className="grid-2" style={{ marginBottom: 13 }}>
        <Panel
          title="Provider contract"
          kicker="Everything inside Solo Trading Charts"
          action={data ? <FreshnessBadge meta={data.meta} /> : null}
        >
          {data && <ProvenanceLine meta={data.meta} />}
          <div className="detail-grid" style={{ marginTop: 10 }}>
            <div className="detail-cell"><span>Global equities/FX/commodities</span><strong>Solo · Yahoo public · delayed/unknown</strong></div>
            <div className="detail-cell"><span>Crypto stream</span><strong>Solo · Binance public WebSocket</strong></div>
            <div className="detail-cell"><span>Crypto REST fallback</span><strong>Solo · Binance public snapshot</strong></div>
            <div className="detail-cell"><span>Licensed India feed</span><strong>Global Datafeeds when configured</strong></div>
          </div>
          <div className="warning-box" style={{ marginTop: 10 }}>
            <strong>No consolidated global tape is claimed.</strong> This page covers a curated set of
            major venues and instruments. Yahoo’s chart metadata does not publish an exact exchange
            delay, so those values remain delayed/unknown. Crypto shows exchange event time and browser
            connection state; connection loss is surfaced rather than hidden.
          </div>
          {failedEntries.length > 0 && (
            <div className="warning-box" style={{ marginTop: 9 }}>
              <strong>{failedEntries.length} instrument(s) unavailable.</strong>{" "}
              {failedEntries.slice(0, 4).map(([key, detail]) => `${key}: ${detail}`).join(" · ")}
              {failedEntries.length > 4 ? " · …" : ""}
            </div>
          )}
        </Panel>
        <Panel title="World clocks" kicker="Local time, not session status">
          <WorldClocks />
          <div className="badge-row" style={{ marginTop: 10 }}>
            <span className="badge accent">Yahoo delayed</span>
            <span className="badge warn">delay not published</span>
            <span className="badge">Binance live stream</span>
            <span className="badge negative">no execution</span>
          </div>
        </Panel>
      </div>

      <CryptoLiveBoard
        data={crypto.data}
        loading={crypto.loading}
        error={crypto.error}
        onRetry={crypto.refresh}
      />

      {marketsLoading && !data && (
        <LoadingBlock rows={8} label="Loading global indices, FX, commodities and yields from public providers" />
      )}

      {marketsError && !data && (
        <div className="alert notice error" role="alert" style={{ marginBottom: 13 }}>
          <div>
            <strong>World tape unavailable.</strong> {marketsError}
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="section-heading">
            <div>
              <div className="eyebrow">Global equity indices</div>
              <h2>Regional coverage</h2>
            </div>
            <span className="small muted">Provider times below are Yahoo’s metadata timestamps, not exchange event times.</span>
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            {data.indices.map((group) => (
              <Panel
                key={group.key}
                title={group.label}
                kicker={`${group.quotes.length} indices · public delayed/unknown`}
                action={<FreshnessBadge meta={data.meta} compact />}
              >
                <GlobalTable quotes={group.quotes} />
              </Panel>
            ))}
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            <Panel title="Currencies" kicker="FX crosses · public delayed/unknown" action={<FreshnessBadge meta={data.meta} compact />}>
              <GlobalTable quotes={data.fx} />
            </Panel>
            <Panel title="Commodities" kicker="Futures and spot proxies · public delayed/unknown" action={<FreshnessBadge meta={data.meta} compact />}>
              <GlobalTable quotes={data.commodities} />
            </Panel>
          </div>

          <div className="grid-2">
            <Panel title="US yields" kicker="CBOE/Yahoo yield indices · not a live rates feed" action={<FreshnessBadge meta={data.meta} compact />}>
              <GlobalTable quotes={data.rates} />
              <p className="small muted" style={{ marginTop: 8 }}>
                Yield index values are shown as percentages. They are not a substitute for a licensed
                government-securities feed or a dealer quote.
              </p>
            </Panel>
            <Panel title="Coverage contract" kicker="Broad, not exhaustive">
              <div className="detail-grid">
                <div className="detail-cell"><span>Instruments requested</span><strong>{coverage?.requested}</strong></div>
                <div className="detail-cell"><span>Returned</span><strong>{coverage?.returned}</strong></div>
                <div className="detail-cell"><span>Failed</span><strong>{coverage?.failed}</strong></div>
                <div className="detail-cell"><span>Provider</span><strong>{data.meta.provider}</strong></div>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>{coverage?.note}</p>
              <div className="warning-box" style={{ marginTop: 10 }}>
                <strong>Missing is a state.</strong> A failed symbol remains visibly unavailable. It is
                never replaced with zero, a sample price or a “last known” quote presented as current.
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>{data.note}</p>
              <div className="badge-row" style={{ marginTop: 8 }}>
                <span className="badge">Solo platform</span>
                <span className="badge">Yahoo data</span>
                <span className="badge">Binance data</span>
                <a className="badge" href="/sources">Source register →</a>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
