"use client";

import React, { useCallback, useEffect, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { FeedMeta, Quote } from "@/lib/types";
const CACHE_KEY = "solo:crude-wallstreet:quotes";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — quotes are delayed snapshots anyway
const REQUEST_PATH = "/backend/api/quotes?keys=WTI,BRENT,SPX,NDX,DJI";

const SYMBOL_KEYS = ["WTI", "BRENT", "SPX", "NDX", "DJI"] as const;
type SymbolKey = (typeof SYMBOL_KEYS)[number];

type QuotePayload = {
  quotes: Quote[];
  meta: FeedMeta;
};

function loadCache(): QuotePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotePayload & { _cached_at: number };
    if (Date.now() - parsed._cached_at > CACHE_TTL_MS) return null;
    return { quotes: parsed.quotes ?? [], meta: parsed.meta ?? {} };
  } catch {
    return null;
  }
}

function saveCache(data: QuotePayload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _cached_at: Date.now() }));
  } catch {
    // Storage quota exceeded — caching is an optimization, never required.
  }
}

const GROUP_LABELS: Record<SymbolKey, string> = {
  WTI: "WTI Crude Oil",
  BRENT: "Brent Crude Oil",
  SPX: "S&P 500 (Wall Street)",
  NDX: "Nasdaq 100 (Wall Street)",
  DJI: "Dow Jones (Wall Street)",
};

export default function CrudeWallStreetPage() {
  const [data, setData] = useState<QuotePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);
  const [mounted, setMounted] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Up to 3 attempts: public providers (TradingView/Yahoo) occasionally
    // return transient 5xx. Backend already caches + retries; this guards the
    // full request path (proxy included) the same way.
    let lastError = "Failed to load crude & Wall Street quotes";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await fetch(REQUEST_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as QuotePayload;
        setData(payload);
        saveCache(payload);
        setError(null);
        if (attempt > 1) setToast({ message: "Quotes loaded after retry", type: "success" });
        setLoading(false);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : lastError;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    setError(lastError);
    setToast({ message: lastError, type: "error" });
    setLoading(false);
  }, []);

  // Cache first (instant paint), then refresh from the API.
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    setMounted(true);
    void fetchData();
  }, [fetchData]);

  // Auto-refresh while the tab is visible.
  useEffect(() => {
    if (!mounted) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchData();
    }, 60_000);
    return () => clearInterval(timer);
  }, [fetchData, mounted]);

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

  const quoteList = data?.quotes ?? [];
  const availableQuotes = quoteList.filter((q) => q.value !== null && q.value !== undefined);
  const advancing = availableQuotes.filter((q) => (q.change ?? 0) > 0).length;
  const declining = availableQuotes.filter((q) => (q.change ?? 0) < 0).length;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Crude Oil & Wall Street Indices"
        title="Energy & US Equities — inside Solo Trading Charts"
        subtitle="WTI & Brent crude oil, S&P 500, Nasdaq 100 and Dow Jones. Real quotes, honest delay labels, no external links."
        actions={
          <>
            <button className="button primary" onClick={fetchData} type="button" disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {data && <FreshnessBadge meta={data.meta} />}
          </>
        }
      />

      {error && <ErrorNotice error={error} retry={fetchData} />}

      <div className="grid-4" style={{ marginBottom: 13 }}>
        <div className="stat-card">
          <div className="stat-label">Instruments tracked</div>
          <div className="stat-value">{SYMBOL_KEYS.length}</div>
          <div className="stat-foot">
            <span>
              {availableQuotes.length} returned · {SYMBOL_KEYS.length - availableQuotes.length} unavailable
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Advancing</div>
          <div className={`stat-value ${advancing ? "positive" : "muted"}`}>{availableQuotes.length ? advancing : "—"}</div>
          <div className="stat-foot">
            <span>higher vs previous close</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Declining</div>
          <div className={`stat-value ${declining ? "negative" : "muted"}`}>{availableQuotes.length ? declining : "—"}</div>
          <div className="stat-foot">
            <span>lower vs previous close</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Live execution</div>
          <div className="stat-value negative" style={{ fontSize: 18 }}>
            DISABLED
          </div>
          <div className="stat-foot">
            <span>hard-coded off · paper only</span>
          </div>
        </div>
      </div>

      <Panel
        title="Crude Oil & Wall Street — Quotes"
        kicker="Public delayed snapshots · never fabricated"
        action={
          <button className="chart-chip" onClick={fetchData} type="button">
            Refresh quotes
          </button>
        }
        style={{ marginBottom: 13 }}
      >
        {loading && !quoteList.length ? (
          <LoadingBlock rows={5} label="Loading crude oil & Wall Street quotes…" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            {SYMBOL_KEYS.map((key) => {
              const q = quoteList.find((x) => x.key === key);
              const unavailable = !q || q.value === null || q.value === undefined;
              return (
                <div
                  key={key}
                  className="panel"
                  style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, margin: 0 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {key}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{GROUP_LABELS[key]}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {unavailable ? "unavailable" : q!.data_status}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      fontFamily: "var(--mono)",
                      color: unavailable ? "var(--muted-2)" : "var(--text)",
                    }}
                  >
                    {unavailable ? "—" : formatNumber(q!.value, 2)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontFamily: "var(--mono)",
                      color: unavailable ? "var(--muted-2)" : toneClass(q!.change),
                      fontWeight: 600,
                    }}
                  >
                    {unavailable ? "no snapshot returned" : `${formatNumber(q!.change ?? 0, 2)} (${formatPct(q!.change)})`}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted-2)", marginTop: 6 }}>
                    <span>{q?.exchange || "—"}</span>
                    <span>{q?.currency || "—"}</span>
                    <span>{q?.as_of ? timeAgo(q.as_of) : "delayed"}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted-2)", marginTop: 4 }}>
                    {q?.source || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Provider contract" kicker="Everything inside Solo Trading Charts" style={{ marginBottom: 13 }}>
        {data && <ProvenanceLine meta={data.meta} />}
        <div className="detail-grid" style={{ marginTop: 10 }}>
          <div className="detail-cell">
            <span>Crude oil</span>
            <strong>WTI · Brent — public snapshot · delayed/unknown</strong>
          </div>
          <div className="detail-cell">
            <span>Wall Street indices</span>
            <strong>SPX · NDX · DJI — public snapshot · delayed/unknown</strong>
          </div>
          <div className="detail-cell">
            <span>Refresh</span>
            <strong>Keyboard R · button · auto 60s · cached 60s</strong>
          </div>
          <div className="detail-cell">
            <span>Execution</span>
            <strong>hard-disabled · paper only</strong>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 10 }}>
          <strong>No consolidated tape is claimed.</strong> Values are public snapshots labelled delayed/unknown.
          Exchange timestamps and exact delay are not published by the free provider. Missing values remain visibly
          unavailable — never replaced with zero or a guessed price.
        </div>
        <div className="badge-row" style={{ marginTop: 8 }}>
          <span className="badge">Solo platform</span>
          <span className="badge">Public data</span>
          <span className="badge">Mobile-ready</span>
          <span className="badge negative">no execution</span>
          <a className="badge" href="/sources">
            Source register →
          </a>
        </div>
      </Panel>
    </>
  );
}
