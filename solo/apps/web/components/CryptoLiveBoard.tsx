"use client";

import { useEffect, useMemo, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { Panel } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { CryptoQuote, CryptoResponse } from "@/lib/types";

type Connection = "waiting" | "connecting" | "live" | "reconnecting" | "unsupported";

function priceDigits(price: number | null | undefined): number {
  if (price === null || price === undefined || !Number.isFinite(price)) return 2;
  if (price >= 1000) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 5;
  return 8;
}

function parseTicker(payload: unknown): Partial<CryptoQuote> | null {
  if (!payload || typeof payload !== "object") return null;
  const outer = payload as { data?: unknown };
  const data = (outer.data && typeof outer.data === "object" ? outer.data : payload) as Record<string, unknown>;
  if (data.e !== "24hrMiniTicker" && data.e !== "24hrTicker") return null;
  const symbol = String(data.s || "").toUpperCase();
  const price = Number(data.c);
  if (!symbol.endsWith("USDT") || !Number.isFinite(price)) return null;
  const open = Number(data.o);
  const change = Number.isFinite(open) && open > 0 ? (price / open - 1) * 100 : null;
  const eventTime = Number(data.E);
  return {
    key: symbol,
    symbol,
    price,
    change,
    open: Number.isFinite(open) ? open : null,
    high: Number.isFinite(Number(data.h)) ? Number(data.h) : null,
    low: Number.isFinite(Number(data.l)) ? Number(data.l) : null,
    volume_base: Number.isFinite(Number(data.v)) ? Number(data.v) : null,
    volume_quote: Number.isFinite(Number(data.q)) ? Number(data.q) : null,
    as_of: Number.isFinite(eventTime) ? new Date(eventTime).toISOString() : null,
    source: "Binance public WebSocket",
    data_status: "live"
  };
}

export function CryptoLiveBoard({
  data,
  loading,
  error,
  onRetry
}: {
  data: CryptoResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [updates, setUpdates] = useState<Record<string, Partial<CryptoQuote>>>({});
  const [connection, setConnection] = useState<Connection>("waiting");
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const streamUrl = data?.stream.url ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!streamUrl) {
      setConnection("waiting");
      return;
    }
    if (typeof window === "undefined" || !("WebSocket" in window)) {
      setConnection("unsupported");
      return;
    }
    let active = true;
    let retryTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (!active) return;
      setConnection((current) => (current === "live" ? current : "connecting"));
      try {
        socket = new WebSocket(streamUrl);
      } catch {
        setConnection("reconnecting");
        retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), 5000);
        return;
      }
      socket.onopen = () => {
        if (active) setConnection("live");
      };
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const parsed = parseTicker(JSON.parse(event.data));
          if (!parsed?.symbol) return;
          setUpdates((current) => ({ ...current, [parsed.symbol as string]: parsed }));
          setLastTickAt(new Date());
          setConnection("live");
        } catch {
          // A malformed frame is ignored; the next exchange frame is independent.
        }
      };
      socket.onerror = () => {
        if (active) setConnection("reconnecting");
      };
      socket.onclose = () => {
        if (!active) return;
        setConnection("reconnecting");
        retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), 5000);
      };
    };

    connect();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [streamUrl, attempt]);

  const quotes = useMemo(() => {
    const base = data?.quotes ?? [];
    return base.map((quote) => ({ ...quote, ...(updates[quote.symbol] || {}) }));
  }, [data, updates]);

  const lastTickSeconds = lastTickAt ? Math.max(0, Math.round((now - lastTickAt.getTime()) / 1000)) : null;
  const streamHealthy = connection === "live" && (lastTickSeconds === null || lastTickSeconds <= 20);
  const connectionLabel =
    connection === "live"
      ? streamHealthy
        ? "LIVE PUSH"
        : "STREAM QUIET"
      : connection === "connecting"
        ? "CONNECTING"
        : connection === "reconnecting"
          ? "RECONNECTING"
          : connection === "unsupported"
            ? "WS UNSUPPORTED"
            : "WAITING FOR API";
  const connectionTone = streamHealthy ? "accent" : connection === "live" ? "warn" : connection === "reconnecting" || connection === "unsupported" ? "warn" : "";

  return (
    <Panel
      title="Crypto live tape"
      kicker="Binance public WebSocket · USDT spot · no account or API key"
      action={
        <div className="badge-row">
          <span className={`badge ${connectionTone}`}>{connectionLabel}</span>
          {data && <FreshnessBadge meta={data.meta} compact />}
          <button className="button ghost small" onClick={onRetry} type="button">Refresh snapshot</button>
        </div>
      }
      style={{ marginBottom: 13 }}
    >
      <div className="crypto-status-line">
        <span className={`live-dot ${streamHealthy ? "on" : ""}`} aria-hidden="true" />
        <span>
          {connection === "live"
            ? `Exchange frames received${lastTickSeconds === null ? "" : ` · last ${lastTickSeconds}s ago`}`
            : "Attempting direct browser stream; REST snapshot remains visible."}
        </span>
        <span className="sep">/</span>
        <span>{data?.stream.update_mode || "24hrMiniTicker"}</span>
        <span className="sep">/</span>
        <span>{quotes.length} pairs</span>
        {lastTickAt && <span className="sep">/</span>}
        {lastTickAt && <span>last frame {timeAgo(lastTickAt.toISOString())}</span>}
      </div>

      {error && (
        <div className="alert notice error" role="alert" style={{ marginBottom: 10 }}>
          <div><strong>REST snapshot unavailable.</strong><p>{error}</p></div>
        </div>
      )}

      {loading && !data && <div className="loading-block"><div className="loading-label">Loading crypto snapshots and stream endpoint<span className="loading-dots">...</span></div></div>}

      {quotes.length > 0 && (
        <div className="crypto-grid">
          {quotes.map((quote) => {
            const pushed = quote.source === "Binance public WebSocket";
            const age = quote.as_of ? Math.max(0, Math.round((now - new Date(quote.as_of).getTime()) / 1000)) : null;
            const freshEnough = pushed && (age === null || age <= 20);
            return (
              <article className={`crypto-card ${pushed ? "crypto-live" : ""}`} key={quote.key}>
                <div className="crypto-card-head">
                  <div>
                    <strong>{quote.short}</strong>
                    <span>{quote.name}</span>
                  </div>
                  <span className={`micro-status ${freshEnough ? "live" : pushed ? "aging" : ""}`}>
                    {freshEnough ? "LIVE" : pushed ? "QUIET" : "REST"}
                  </span>
                </div>
                <div className="crypto-price">{formatNumber(quote.price, priceDigits(quote.price))}</div>
                <div className="crypto-change-row">
                  <span className={`mono ${toneClass(quote.change)}`}>{formatPct(quote.change)}</span>
                  <span className="small muted">24h</span>
                </div>
                <div className="crypto-metrics">
                  <span>H <b>{formatNumber(quote.high, priceDigits(quote.price))}</b></span>
                  <span>L <b>{formatNumber(quote.low, priceDigits(quote.price))}</b></span>
                  <span>QVol <b>{formatNumber(quote.volume_quote, 0)}</b></span>
                </div>
                <div className="crypto-card-foot">
                  <span title={quote.source}>{quote.source === "Binance public WebSocket" ? "exchange push" : "REST fallback"}</span>
                  <span>{quote.as_of ? timeAgo(quote.as_of) : "time unknown"}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data && (
        <>
          <div style={{ marginTop: 11 }}><ProvenanceLine meta={data.meta} /></div>
          <div className="warning-box" style={{ marginTop: 10 }}>
            <strong>What “live” means here.</strong> The browser connects directly to Binance’s public
            WebSocket for exchange-pushed {data.stream.update_mode} frames. The REST snapshot is a
            fallback. This is a curated set of liquid USDT spot pairs, not every token, every venue or
            a consolidated global crypto tape. Connection loss is shown; no price is fabricated.
          </div>
        </>
      )}
    </Panel>
  );
}
