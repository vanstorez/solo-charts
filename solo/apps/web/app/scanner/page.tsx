"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { ScannerCondition, ScannerResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const SCAN_CONDITIONS: ScannerCondition[] = [
  { key: "rsi_oversold", label: "RSI Oversold (< 30)", description: "Potential bounce buy" },
  { key: "rsi_overbought", label: "RSI Overbought (> 70)", description: "Potential pullback sell" },
  { key: "macd_bullish", label: "MACD Bullish", description: "Histogram positive" },
  { key: "macd_bearish", label: "MACD Bearish", description: "Histogram negative" },
  { key: "price_above_sma20", label: "Price Above SMA 20", description: "Short-term uptrend" },
  { key: "price_below_sma20", label: "Price Below SMA 20", description: "Short-term downtrend" },
  { key: "price_above_vwap", label: "Price Above VWAP", description: "Intraday bullish" },
  { key: "price_below_vwap", label: "Price Below VWAP", description: "Intraday bearish" },
  { key: "bb_squeeze", label: "Bollinger Band Squeeze", description: "Low volatility breakout setup" },
  { key: "bb_breakout_up", label: "BB Breakout Up", description: "Price above upper band" },
  { key: "bb_breakout_down", label: "BB Breakout Down", description: "Price below lower band" },
  { key: "adx_strong_trend", label: "ADX Strong Trend (> 25)", description: "Trending market" },
];

const INTERVALS = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "1d", label: "1D" },
];

export default function ScannerPage() {
  const [condition, setCondition] = useState("rsi_oversold");
  const [interval, setInterval] = useState("1d");
  const [range, setRange] = useState("1y");
  const [scanner, setScanner] = useState<ScannerResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);
  const router = useRouter();

  const openAnalysis = useCallback(
    (key: string) => {
      router.push(`/analysis?symbol=${encodeURIComponent(key)}&interval=1d`);
    },
    [router]
  );

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(
        `/backend/api/scanner?condition=${encodeURIComponent(condition)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as ScannerResponse;
      setScanner(payload);
      setToast({ message: `Scan complete: ${payload.matched_count} of ${payload.scanned} symbols matched`, type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setToast({ message: err instanceof Error ? err.message : "Scan failed", type: "error" });
    } finally {
      setScanning(false);
    }
  }, [condition, interval, range]);

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const matches = scanner?.matches ?? [];
  const bullishMatches = matches.filter((m) => (m.change ?? 0) > 0);
  const bearishMatches = matches.filter((m) => (m.change ?? 0) < 0);

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Market Scanner"
        title="Scan All Symbols"
        subtitle="Technical condition scanner across all tracked symbols. Heuristic results — not trade signals. Everything inside Solo Trading Charts."
        actions={
          <>
            <button className="button" onClick={runScan} disabled={scanning} type="button">
              {scanning ? "Scanning…" : "Run Scan"}
            </button>
          </>
        }
      />

      {error && <ErrorNotice error={error} />}

      {/* Scan controls */}
      <Panel title="Scan Configuration" kicker="Select condition and timeframe" style={{ marginBottom: 13 }}>
        <div className="grid-4" style={{ gap: 8 }}>
          <div>
            <div className="eyebrow">Condition</div>
            <select
              className="input"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {SCAN_CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="small muted">{SCAN_CONDITIONS.find((c) => c.key === condition)?.description}</p>
          </div>
          <div>
            <div className="eyebrow">Interval</div>
            <select className="input" value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="eyebrow">Range</div>
            <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="5d">5d</option>
              <option value="1mo">1mo</option>
              <option value="3mo">3mo</option>
              <option value="1y">1y</option>
              <option value="2y">2y</option>
              <option value="5y">5y</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "bottom" }}>
            <button className="button" onClick={runScan} disabled={scanning} type="button">
              {scanning ? "Scanning…" : "Run Scan"}
            </button>
          </div>
        </div>
      </Panel>

      {/* Results summary */}
      {scanner && (
        <Panel title="Scan Results" kicker={`${scanner.condition} · ${scanner.interval} · ${scanner.range}`} style={{ marginBottom: 13 }}>
          <div className="grid-4">
            <div className="stat-card">
              <div className="stat-label">Symbols Scanned</div>
              <div className="stat-value">{scanner.scanned}</div>
              <div className="stat-foot"><span>public symbols</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Matches</div>
              <div className="stat-value positive">{scanner.matched_count}</div>
              <div className="stat-foot"><span>{((scanner.matched_count / scanner.scanned) * 100).toFixed(1)}% of scanned</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Bullish Matches</div>
              <div className="stat-value positive">{bullishMatches.length}</div>
              <div className="stat-foot"><span>price up today</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Bearish Matches</div>
              <div className="stat-value negative">{bearishMatches.length}</div>
              <div className="stat-foot"><span>price down today</span></div>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Last updated: {scanner.as_of ? timeAgo(scanner.as_of) : "—"} · Provider: {scanner.matches[0]?.provider || "Yahoo Finance"}
          </p>
        </Panel>
      )}

      {/* Matches table */}
      {matches.length > 0 && (
        <Panel title={`Matched Symbols (${matches.length})`} kicker="Click any symbol to analyze in detail" style={{ marginBottom: 13 }}>
          <div className="table-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Last</th>
                  <th className="num">Change</th>
                  <th>Condition</th>
                  <th className="num">Exchange</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.key}>
                    <td>
                      <div className="symbol-cell">
                        <strong>{m.short}</strong>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{m.name}</span>
                      </div>
                    </td>
                    <td className={`num mono ${toneClass(m.change)}`}>{formatNumber(m.price, 2)}</td>
                    <td className={`num mono ${toneClass(m.change)}`}>{formatPct(m.change)}</td>
                    <td>
                      <span className={`badge ${m.change !== null && m.change > 0 ? "accent" : m.change !== null && m.change < 0 ? "bad" : "warn"}`}>
                        {m.condition}
                      </span>
                    </td>
                    <td className="small">{m.exchange}</td>
                    <td>
                      <button
                        className="button ghost small"
                        onClick={() => openAnalysis(m.key)}
                        type="button"
                      >
                        Analyze
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!scanner && (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          <p>No scan results yet.</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>Select a condition and click "Run Scan" to scan all symbols.</p>
        </div>
      )}

      {/* Footer contract */}
      <Panel title="Data Contract" kicker="Honest provenance" style={{ marginBottom: 13 }}>
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          <strong>Scanner is heuristic.</strong> Conditions are public technical formulas (RSI, MACD, Bollinger Bands, etc.)
          calculated from delayed/unknown public Yahoo Finance snapshots. Results are not trade signals, not probabilities,
          and not guarantees. Paper trading only; live execution is hard-disabled.
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
