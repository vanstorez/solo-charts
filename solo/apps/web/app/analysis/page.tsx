"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type {
  AdvancedAnalysisResponse,
  AdvancedIndicatorValues,
  AdvancedSignal,
  AdvancedTimeframe,
  SupportResistanceLevel,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, ColorType, CrosshairMode } from "lightweight-charts";

const CACHE_KEY = "solo:analysis:advanced";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for analysis

function loadCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed._cached_at || 0);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function saveCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...data as object, _cached_at: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

function LineChartPanel({
  title,
  color,
  height = 120,
  data,
}: {
  title: string;
  color: string;
  height?: number;
  data: { time: UTCTimestamp; value: number }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      width: containerRef.current.clientWidth,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a9ab0" },
      grid: { vertLines: { visible: false }, horzLines: { visible: true } },
      rightPriceScale: { visible: true, scaleMargins: { top: 0.2, bottom: 0.2 } },
      leftPriceScale: { visible: true, scaleMargins: { top: 0.2, bottom: 0.2 } },
      timeScale: { visible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false }, horzLine: { visible: true } },
    });
    const line = chart.addLineSeries({ color, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: true, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    if (data.length) line.setData(data as { time: UTCTimestamp; value: number }[]);
    chartRef.current = chart;
    seriesRef.current = line;
    return () => chart.remove();
  }, [height, color]);

  useEffect(() => {
    if (seriesRef.current && data.length) {
      seriesRef.current.setData(data as { time: UTCTimestamp; value: number }[]);
    }
  }, [data]);

  return (
    <div style={{ height, minHeight: 80, width: "100%", overflow: "hidden" }}>
      <div style={{ fontSize: "10px", color: "#6b7c8e", marginBottom: 4, paddingLeft: 2 }}>{title}</div>
      <div ref={containerRef} style={{ height: height - 24, width: "100%" }} />
    </div>
  );
}

function CandleChartPanel({
  title,
  height = 200,
  candleData,
  overlayData,
}: {
  title: string;
  height?: number;
  candleData: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[];
  overlayData?: { sma?: { time: UTCTimestamp; value: number }[]; ema?: { time: UTCTimestamp; value: number }[]; bbUpper?: { time: UTCTimestamp; value: number }[]; bbLower?: { time: UTCTimestamp; value: number }[] };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      width: containerRef.current.clientWidth,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a9ab0" },
      grid: { vertLines: { visible: false }, horzLines: { visible: true } },
      rightPriceScale: { visible: true, scaleMargins: { top: 0.2, bottom: 0.2 } },
      leftPriceScale: { visible: true, scaleMargins: { top: 0.2, bottom: 0.2 } },
      timeScale: { visible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: true }, horzLine: { visible: true } },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#38d9a9",
      downColor: "#ff6b81",
      borderVisible: false,
      wickUpColor: "#38d9a9",
      wickDownColor: "#ff6b81",
      lastValueVisible: false,
    });
    if (candleData.length) candle.setData(candleData);
    candleRef.current = candle;

    if (overlayData?.sma?.length) {
      const sma = chart.addLineSeries({ color: "#6ea8ff", lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: true });
      sma.setData(overlayData.sma);
      smaRef.current = sma;
    }
    if (overlayData?.ema?.length) {
      const ema = chart.addLineSeries({ color: "#f4c95d", lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: true });
      ema.setData(overlayData.ema);
      emaRef.current = ema;
    }
    if (overlayData?.bbUpper?.length) {
      const bbU = chart.addLineSeries({ color: "rgba(196, 167, 255, 0.5)", lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false });
      bbU.setData(overlayData.bbUpper);
      bbUpperRef.current = bbU;
    }
    if (overlayData?.bbLower?.length) {
      const bbL = chart.addLineSeries({ color: "rgba(196, 167, 255, 0.5)", lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false });
      bbL.setData(overlayData.bbLower);
      bbLowerRef.current = bbL;
    }

    chartRef.current = chart;
    return () => chart.remove();
  }, [height]);

  useEffect(() => {
    if (candleRef.current && candleData.length) {
      candleRef.current.setData(candleData);
    }
    if (smaRef.current && overlayData?.sma?.length) {
      smaRef.current.setData(overlayData.sma);
    }
    if (emaRef.current && overlayData?.ema?.length) {
      emaRef.current.setData(overlayData.ema);
    }
    if (bbUpperRef.current && overlayData?.bbUpper?.length) {
      bbUpperRef.current.setData(overlayData.bbUpper);
    }
    if (bbLowerRef.current && overlayData?.bbLower?.length) {
      bbLowerRef.current.setData(overlayData.bbLower);
    }
  }, [candleData, overlayData]);

  return (
    <div style={{ height, width: "100%", overflow: "hidden" }}>
      <div style={{ fontSize: "10px", color: "#6b7c8e", marginBottom: 4, paddingLeft: 2 }}>{title}</div>
      <div ref={containerRef} style={{ height: height - 24, width: "100%" }} />
    </div>
  );
}

export default function AnalysisPage() {
  const symbols = useApi<{ key: string; name: string; short: string; exchange: string; type: string; currency: string }[]>(
    "/api/symbols",
    0
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string>("NIFTY");
  const [selectedInterval, setSelectedInterval] = useState<string>("1d");
  const analysis = useApi<AdvancedAnalysisResponse>(
    `/api/analysis-advanced?symbol=${encodeURIComponent(selectedSymbol)}&interval=${selectedInterval}&range=1y`,
    60_000
  );
  const [cacheData, setCacheData] = useState<AdvancedAnalysisResponse | null>(loadCache<AdvancedAnalysisResponse>(CACHE_KEY));
  const [manualLoading, setManualLoading] = useState(!cacheData);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);

  const data = analysis.data ?? cacheData;
  const loading = analysis.loading || manualLoading;

  useEffect(() => {
    if (analysis.data) {
      setCacheData(analysis.data);
      saveCache(CACHE_KEY, analysis.data);
      setManualLoading(false);
    }
  }, [analysis.data]);

  const fetchAnalysis = useCallback(async () => {
    setManualLoading(true);
    setError(null);
    try {
      const res = await fetch(`/backend/api/analysis-advanced?symbol=${encodeURIComponent(selectedSymbol)}&interval=${selectedInterval}&range=1y`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as AdvancedAnalysisResponse;
      setCacheData(payload);
      saveCache(CACHE_KEY, payload);
      setToast({ message: "Analysis refreshed", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analysis");
      setManualLoading(false);
      setToast({ message: err instanceof Error ? err.message : "Refresh failed", type: "error" });
    } finally {
      setManualLoading(false);
    }
  }, [selectedSymbol, selectedInterval]);

  const refreshAll = () => {
    analysis.refresh();
    void fetchAnalysis();
  };

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!data?.available) {
    return (
      <>
        <PageHeader kicker="Advanced Market Analysis" title="Solo Analysis Suite" subtitle="Professional technical analysis inside Solo Trading Charts" actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh</button>
          </>
        } />
        {error && <ErrorNotice error={error ?? analysis.error ?? "Analysis unavailable"} retry={refreshAll} />}
        {loading && !data && <LoadingBlock rows={6} label="Calculating advanced indicators..." />}
      </>
    );
  }

  const {
    price,
    change_pct,
    indicators,
    levels,
    patterns,
    signal,
    timeframes,
    series,
    meta,
    generated_at,
    input_provider,
  } = data;

  const { sma20, sma50, ema20, ema50, rsi14, macd_hist, bb_upper, bb_lower, atr14, vwap, adx, stoch_k, stoch_d } = indicators;

  const closeSeries = series.closes.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));
  const smaSeries = series.sma20.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));
  const bbUpperSeries = series.bb_upper.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));
  const bbLowerSeries = series.bb_lower.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));
  const rsiSeries = series.rsi14.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));
  const macdSeries = series.macd_hist.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 }));

  const signalColor = signal.bias === "bullish" ? "var(--positive)" : signal.bias === "bearish" ? "var(--negative)" : "var(--muted)";

  const symbolOptions = (symbols.data ?? []).map((s) => ({
    value: s.key,
    label: `${s.short} (${s.exchange})`,
  }));

  const intervalOptions = [
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "30m", label: "30m" },
    { value: "1h", label: "1H" },
    { value: "1d", label: "1D" },
  ];

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Advanced Market Analysis"
        title={`${data.symbol} — Live Technical Analysis`}
        subtitle="RSI · MACD · Bollinger Bands · Stochastic · ADX · OBV · VWAP · Support/Resistance · Patterns — all inside Solo Trading Charts"
        actions={
          <>
            <select
              className="range-select"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              style={{ fontSize: 11, fontFamily: "var(--mono)", padding: "4px 6px", borderRadius: 3, border: "1px solid var(--line)" }}
            >
              {symbolOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="range-select"
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value)}
              style={{ fontSize: 11, fontFamily: "var(--mono)", padding: "4px 6px", borderRadius: 3, border: "1px solid var(--line)" }}
            >
              {intervalOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button className="button" onClick={refreshAll} type="button">Refresh</button>
            <span className="badge">{data.meta?.source_type || "delayed"}</span>
          </>
        }
      />

      {error && <ErrorNotice error={error} retry={fetchAnalysis} />}

      {/* Signal Conclusion Banner */}
      <Panel title="Market Signal — Actionable Conclusion" kicker="Transparent heuristic score · not a trade signal" style={{ marginBottom: 10 }}>
        <div className="grid-3">
          <div className="stat-card">
            <div className="stat-label">Signal Bias</div>
            <div className="stat-value" style={{ fontSize: 22, color: signalColor }}>{signal.bias}</div>
            <div className="stat-foot"><span>Score {signal.score} / 10</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Current Price</div>
            <div className="stat-value">{formatNumber(price, 2)}</div>
            <div className="stat-foot"><span style={{ color: toneClass(change_pct) }}>{formatPct(change_pct)}</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Last Updated</div>
            <div className="stat-value">{generated_at ? timeAgo(generated_at) : "—"}</div>
            <div className="stat-foot"><span>{input_provider}</span></div>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 8, padding: 8 }}>
          <strong style={{ fontSize: 12 }}>{signal.reasons.join(" · ") || "No clear signal — wait for alignment."}</strong>
        </div>
      </Panel>

      {/* Mobile-Optimized Charts */}
      <Panel title="Live Charts" kicker="Price · RSI · MACD · Stochastic" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "min(600px, 90vh)" }}>
          <CandleChartPanel
            title="Price · SMA20 · EMA20 · Bollinger Bands"
            height={200}
            candleData={series.closes.map((v, i) => ({ time: series.times[i] as UTCTimestamp, open: v ?? 0, high: v ?? 0, low: v ?? 0, close: v ?? 0 }))}
            overlayData={{
              sma: series.sma20.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 })).filter(d => d.value !== 0),
              ema: series.ema20.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 })).filter(d => d.value !== 0),
              bbUpper: series.bb_upper.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 })).filter(d => d.value !== 0),
              bbLower: series.bb_lower.map((v, i) => ({ time: series.times[i] as UTCTimestamp, value: v ?? 0 })).filter(d => d.value !== 0),
            }}
          />
          <LineChartPanel title="RSI (14)" color="#6ea8ff" height={110} data={rsiSeries} />
          <LineChartPanel title="MACD Histogram" color="#f4c95d" height={100} data={macdSeries} />
          <LineChartPanel title="Stochastic %K / %D" color="#c4a7ff" height={100} data={rsiSeries} />
        </div>
      </Panel>

      {/* Support / Resistance Levels */}
      <Panel title="Support & Resistance" kicker="Swing-based levels with touch counts" style={{ marginBottom: 10 }}>
        <div className="grid-2">
          <div className="stat-card">
            <div className="stat-label">Support Levels</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontFamily: "var(--mono)" }}>
              {levels.support.map((l, idx) => (
                <div key={`support-${idx}`} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{formatNumber(l.price, 2)}</span>
                  <span style={{ color: "var(--positive)" }}>{l.touches} touches</span>
                </div>
              ))}
              {levels.support.length === 0 && <span style={{ color: "var(--muted)" }}>None detected</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Resistance Levels</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontFamily: "var(--mono)" }}>
              {levels.resistance.map((l, idx) => (
                <div key={`resistance-${idx}`} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{formatNumber(l.price, 2)}</span>
                  <span style={{ color: "var(--negative)" }}>{l.touches} touches</span>
                </div>
              ))}
              {levels.resistance.length === 0 && <span style={{ color: "var(--muted)" }}>None detected</span>}
            </div>
          </div>
        </div>
      </Panel>

      {/* Chart Patterns */}
      {patterns.length > 0 && (
        <Panel title="Chart Patterns" kicker="Heuristic pattern detection" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {patterns.map((p) => (
              <div key={`${p.type}-${p.t}`} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 12 }}>
                <div>
                  <strong>{p.label}</strong>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>{p.note}</div>
                </div>
                <span className={`badge ${p.bias === "bullish" ? "accent" : "bad"}`}>{p.bias}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Multi-Timeframe Bias */}
      <Panel title="Multi-Timeframe Bias" kicker="1d · 1h · 15m · 5m" style={{ marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, fontSize: 12, fontFamily: "var(--mono)" }}>
          {timeframes.map((tf) => (
            <div key={tf.interval} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "rgba(0,0,0,0.12)", borderRadius: 4 }}>
              <div>
                <strong>{tf.interval}</strong>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{tf.bars} bars · {tf.provider}</div>
              </div>
              <span className={`badge ${tf.bias === "bullish" ? "accent" : tf.bias === "bearish" ? "bad" : "warn"}`}>{tf.bias}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Indicator Values Table */}
      <Panel title="Indicator Values" kicker="Current readings for all indicators" style={{ marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 11, fontFamily: "var(--mono)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>RSI 14</span><span style={{ color: toneClass(rsi14) }}>{formatNumber(rsi14, 1)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>MACD Hist</span><span style={{ color: toneClass(macd_hist) }}>{formatNumber(macd_hist, 4)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>Stoch %K</span><span style={{ color: toneClass(stoch_k) }}>{formatNumber(stoch_k, 1)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>Stoch %D</span><span style={{ color: toneClass(stoch_d) }}>{formatNumber(stoch_d, 1)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>ADX</span><span style={{ color: toneClass(adx) }}>{formatNumber(adx, 1)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>ATR 14</span><span>{formatNumber(atr14, 2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span>VWAP</span><span>{formatNumber(vwap, 2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>BB Width</span><span>{bb_upper && bb_lower ? formatNumber((bb_upper - bb_lower) / bb_lower * 100, 2) + "%" : "—"}</span>
          </div>
        </div>
      </Panel>

      {/* Risk Reward */}
      <Panel title="Risk / Reward Levels" kicker="Based on support/resistance + ATR" style={{ marginBottom: 10 }}>
        <div className="grid-3">
          <div className="stat-card">
            <div className="stat-label">Entry</div>
            <div className="stat-value">{formatNumber(price, 2)}</div>
            <div className="stat-foot"><span>Current price</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Stop Loss</div>
            <div className="stat-value">{formatNumber(levels.support[0]?.price ?? (price ? price - (atr14 ?? 0) * 2 : 0), 2)}</div>
            <div className="stat-foot"><span>Nearest support − 2×ATR</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Target</div>
            <div className="stat-value">{formatNumber(levels.resistance[0]?.price ?? (price ? price + (atr14 ?? 0) * 2 : 0), 2)}</div>
            <div className="stat-foot"><span>Nearest resistance + 2×ATR</span></div>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          <strong>Not financial advice.</strong> Signal is a transparent heuristic count. Always use your own stop-loss and position sizing. Live execution is hard-disabled — paper trading only.
        </div>
      </Panel>

      {/* Footer */}
      <Panel title="Data Contract" kicker="Honest provenance" style={{ marginBottom: 10 }}>
        {meta && <ProvenanceLine meta={meta} />}
        <div className="detail-grid" style={{ marginTop: 8, fontSize: 11 }}>
          <div className="detail-cell"><span>Symbol</span><strong>{data.symbol}</strong></div>
          <div className="detail-cell"><span>Provider</span><strong>{input_provider}</strong></div>
          <div className="detail-cell"><span>Freshness</span><strong>{meta?.source_type}</strong></div>
          <div className="detail-cell"><span>Execution</span><strong>Paper only</strong></div>
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
