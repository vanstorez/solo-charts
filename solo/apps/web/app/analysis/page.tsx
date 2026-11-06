"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { apiGet, errorMessage } from "@/lib/api";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type {
  AdvancedAnalysisResponse,
  AdvancedIndicatorValues,
  AdvancedSignal,
  AdvancedTimeframe,
  ChartSignal,
  SupportResistanceLevel,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { createChart, IChartApi, IPriceLine, ISeriesApi, UTCTimestamp, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";

const CACHE_KEY = "solo:analysis:advanced:v2";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for analysis
const SYMBOL_KEY = "solo:analysis:symbol";
const INTERVAL_KEY = "solo:analysis:interval";
const TOGGLES_KEY = "solo:analysis:toggles";

type LiveQuoteRow = {
  key: string;
  name: string;
  short: string;
  exchange: string;
  type: string;
  currency: string;
  value: number;
  change: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previous_close: number | null;
  year_high: number | null;
  year_low: number | null;
  volume: number | null;
  as_of: string | null;
  source: string;
  data_status: string;
  live_attempt?: string;
  note?: string | null;
};

type OverlayToggles = {
  sma20: boolean;
  ema20: boolean;
  sma50: boolean;
  ema50: boolean;
  bb: boolean;
  vwap: boolean;
  volume: boolean;
  sr: boolean;
  signals: boolean;
  wma20: boolean;
  supertrend: boolean;
  keltner: boolean;
  donchian: boolean;
};

const DEFAULT_TOGGLES: OverlayToggles = {
  sma20: true,
  ema20: true,
  sma50: false,
  ema50: false,
  bb: true,
  vwap: false,
  volume: true,
  sr: true,
  signals: false,
  wma20: false,
  supertrend: false,
  keltner: false,
  donchian: false,
};

const OVERLAY_LABELS: Record<keyof OverlayToggles, string> = {
  sma20: "SMA 20",
  ema20: "EMA 20",
  sma50: "SMA 50",
  ema50: "EMA 50",
  bb: "Bollinger",
  vwap: "VWAP",
  volume: "Volume",
  sr: "S/R",
  signals: "Signals",
  wma20: "WMA 20",
  supertrend: "Supertrend",
  keltner: "Keltner",
  donchian: "Donchian",
};

type ChartPoint = { time: UTCTimestamp; value: number };
type CandlePoint = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type VolumePoint = { time: UTCTimestamp; value: number; color: string };

function compactVolume(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(2)} L`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
  return String(Math.round(value));
}

function formatChartTime(time?: UTCTimestamp, intraday = true): string {
  if (!time) return "—";
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    ...(intraday ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  };
  return new Date((time as number) * 1000).toLocaleString("en-IN", options);
}

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
  height = 340,
  candleData,
  volumeData,
  overlayData,
  candlestickSignals,
  toggles,
  onToggle,
  expanded,
  onToggleExpand,
  levels,
}: {
  title: string;
  height?: number;
  candleData: CandlePoint[];
  volumeData?: VolumePoint[];
  overlayData?: {
    sma20?: ChartPoint[];
    ema20?: ChartPoint[];
    sma50?: ChartPoint[];
    ema50?: ChartPoint[];
    bbUpper?: ChartPoint[];
    bbLower?: ChartPoint[];
    vwap?: ChartPoint[];
    wma20?: ChartPoint[];
    supertrend?: ChartPoint[];
    kcUpper?: ChartPoint[];
    kcMiddle?: ChartPoint[];
    kcLower?: ChartPoint[];
    dcUpper?: ChartPoint[];
    dcMiddle?: ChartPoint[];
    dcLower?: ChartPoint[];
  };
  candlestickSignals?: ChartSignal[];
  levels?: {
    support: { price: number; touches: number }[];
    resistance: { price: number; touches: number }[];
  };
  toggles: OverlayToggles;
  onToggle: (key: keyof OverlayToggles) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const wma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const supertrendRef = useRef<ISeriesApi<"Line"> | null>(null);
  const keltnerUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const keltnerMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const keltnerLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const donchianUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const donchianMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const donchianLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [hover, setHover] = useState<{ time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a9ab0", fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(27, 45, 73, 0.45)" } },
      rightPriceScale: { visible: true, scaleMargins: { top: 0.08, bottom: 0.26 } },
      leftPriceScale: { visible: false },
      timeScale: { visible: true, timeVisible: true, secondsVisible: false, borderColor: "#1b2d49" },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: true, labelVisible: true, color: "rgba(110, 168, 255, 0.45)" },
        horzLine: { visible: true, labelVisible: true, color: "rgba(110, 168, 255, 0.45)" },
      },
      localization: { locale: "en-IN" },
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

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    if (volumeData?.length) volume.setData(volumeData);
    volume.applyOptions({ visible: toggles.volume });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeRef.current = volume;

    const addLine = (color: string, style: LineStyle = LineStyle.Solid) =>
      chart.addLineSeries({
        color,
        lineWidth: 1,
        lineStyle: style,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

    const sma20 = addLine("#6ea8ff");
    const ema20 = addLine("#f4c95d");
    const sma50 = addLine("#8be9fd");
    const ema50 = addLine("#ff9f43");
    const bbUpper = addLine("rgba(196, 167, 255, 0.65)", LineStyle.Dashed);
    const bbLower = addLine("rgba(196, 167, 255, 0.65)", LineStyle.Dashed);
    const vwap = addLine("#38d9a9", LineStyle.Dotted);

    const signalSeries = chart.addLineSeries({
      color: "#ff6b81",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 5,
    });

    const wma20 = addLine("#ff9f43");
    const supertrend = addLine("#9b8cff");
    const keltnerUpper = addLine("rgba(196, 167, 255, 0.65)", LineStyle.Dashed);
    const keltnerMiddle = addLine("rgba(196, 167, 255, 0.4)");
    const keltnerLower = addLine("rgba(196, 167, 255, 0.65)", LineStyle.Dashed);
    const donchianUpper = addLine("rgba(56, 217, 169, 0.65)", LineStyle.Dashed);
    const donchianMiddle = addLine("rgba(56, 217, 169, 0.4)");
    const donchianLower = addLine("rgba(56, 217, 169, 0.65)", LineStyle.Dashed);

    if (overlayData?.sma20?.length) sma20.setData(overlayData.sma20);
    if (overlayData?.ema20?.length) ema20.setData(overlayData.ema20);
    if (overlayData?.sma50?.length) sma50.setData(overlayData.sma50);
    if (overlayData?.ema50?.length) ema50.setData(overlayData.ema50);
    if (overlayData?.bbUpper?.length) bbUpper.setData(overlayData.bbUpper);
    if (overlayData?.bbLower?.length) bbLower.setData(overlayData.bbLower);
    if (overlayData?.vwap?.length) vwap.setData(overlayData.vwap);
    if (overlayData?.wma20?.length) wma20.setData(overlayData.wma20);
    if (overlayData?.supertrend?.length) supertrend.setData(overlayData.supertrend);
    if (overlayData?.kcUpper?.length) keltnerUpper.setData(overlayData.kcUpper);
    if (overlayData?.kcMiddle?.length) keltnerMiddle.setData(overlayData.kcMiddle);
    if (overlayData?.kcLower?.length) keltnerLower.setData(overlayData.kcLower);
    if (overlayData?.dcUpper?.length) donchianUpper.setData(overlayData.dcUpper);
    if (overlayData?.dcMiddle?.length) donchianMiddle.setData(overlayData.dcMiddle);
    if (overlayData?.dcLower?.length) donchianLower.setData(overlayData.dcLower);
    if (candlestickSignals?.length && toggles.signals) {
      signalSeries.setData(
        candlestickSignals.map((s) => ({
          time: s.time as UTCTimestamp,
          value: s.position,
          color: s.color,
        })) as { time: UTCTimestamp; value: number; color?: string }[]
      );
    }

    sma20.applyOptions({ visible: toggles.sma20 });
    ema20.applyOptions({ visible: toggles.ema20 });
    sma50.applyOptions({ visible: toggles.sma50 });
    ema50.applyOptions({ visible: toggles.ema50 });
    bbUpper.applyOptions({ visible: toggles.bb });
    bbLower.applyOptions({ visible: toggles.bb });
    vwap.applyOptions({ visible: toggles.vwap });
    wma20.applyOptions({ visible: toggles.wma20 });
    supertrend.applyOptions({ visible: toggles.supertrend });
    keltnerUpper.applyOptions({ visible: toggles.keltner });
    keltnerMiddle.applyOptions({ visible: toggles.keltner });
    keltnerLower.applyOptions({ visible: toggles.keltner });
    donchianUpper.applyOptions({ visible: toggles.donchian });
    donchianMiddle.applyOptions({ visible: toggles.donchian });
    donchianLower.applyOptions({ visible: toggles.donchian });
    signalSeries.applyOptions({ visible: toggles.signals });

    sma20Ref.current = sma20;
    ema20Ref.current = ema20;
    sma50Ref.current = sma50;
    ema50Ref.current = ema50;
    bbUpperRef.current = bbUpper;
    bbLowerRef.current = bbLower;
    vwapRef.current = vwap;
    signalRef.current = signalSeries;
    wma20Ref.current = wma20;
    supertrendRef.current = supertrend;
    keltnerUpperRef.current = keltnerUpper;
    keltnerMiddleRef.current = keltnerMiddle;
    keltnerLowerRef.current = keltnerLower;
    donchianUpperRef.current = donchianUpper;
    donchianMiddleRef.current = donchianMiddle;
    donchianLowerRef.current = donchianLower;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const bar = param.seriesData.get(candle) as { open?: number; high?: number; low?: number; close?: number } | undefined;
      if (!bar || bar.open == null || bar.high == null || bar.low == null || bar.close == null) {
        setHover(null);
        return;
      }
      const vol = param.seriesData.get(volume) as { value?: number } | undefined;
      setHover({
        time: param.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol?.value ?? 0,
      });
    });

    chartRef.current = chart;
    return () => chart.remove();
    // Chart is created once; data and visibility are updated in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (candleRef.current && candleData.length) candleRef.current.setData(candleData);
  }, [candleData]);

  useEffect(() => {
    if (volumeRef.current && volumeData?.length) volumeRef.current.setData(volumeData);
  }, [volumeData]);

  useEffect(() => {
    if (sma20Ref.current && overlayData?.sma20?.length) sma20Ref.current.setData(overlayData.sma20);
    if (ema20Ref.current && overlayData?.ema20?.length) ema20Ref.current.setData(overlayData.ema20);
    if (sma50Ref.current && overlayData?.sma50?.length) sma50Ref.current.setData(overlayData.sma50);
    if (ema50Ref.current && overlayData?.ema50?.length) ema50Ref.current.setData(overlayData.ema50);
    if (bbUpperRef.current && overlayData?.bbUpper?.length) bbUpperRef.current.setData(overlayData.bbUpper);
    if (bbLowerRef.current && overlayData?.bbLower?.length) bbLowerRef.current.setData(overlayData.bbLower);
    if (vwapRef.current && overlayData?.vwap?.length) vwapRef.current.setData(overlayData.vwap);
    if (wma20Ref.current && overlayData?.wma20?.length) wma20Ref.current.setData(overlayData.wma20);
    if (supertrendRef.current && overlayData?.supertrend?.length) supertrendRef.current.setData(overlayData.supertrend);
    if (keltnerUpperRef.current && overlayData?.kcUpper?.length) keltnerUpperRef.current.setData(overlayData.kcUpper);
    if (keltnerMiddleRef.current && overlayData?.kcMiddle?.length) keltnerMiddleRef.current.setData(overlayData.kcMiddle);
    if (keltnerLowerRef.current && overlayData?.kcLower?.length) keltnerLowerRef.current.setData(overlayData.kcLower);
    if (donchianUpperRef.current && overlayData?.dcUpper?.length) donchianUpperRef.current.setData(overlayData.dcUpper);
    if (donchianMiddleRef.current && overlayData?.dcMiddle?.length) donchianMiddleRef.current.setData(overlayData.dcMiddle);
    if (donchianLowerRef.current && overlayData?.dcLower?.length) donchianLowerRef.current.setData(overlayData.dcLower);
    if (signalRef.current && candlestickSignals?.length && toggles.signals) {
      signalRef.current.setData(
        candlestickSignals.map((s) => ({
          time: s.time as UTCTimestamp,
          value: s.position,
          color: s.color,
        })) as { time: UTCTimestamp; value: number; color?: string }[]
      );
    }
  }, [overlayData, candlestickSignals, toggles.signals]);

  useEffect(() => {
    sma20Ref.current?.applyOptions({ visible: toggles.sma20 });
    ema20Ref.current?.applyOptions({ visible: toggles.ema20 });
    sma50Ref.current?.applyOptions({ visible: toggles.sma50 });
    ema50Ref.current?.applyOptions({ visible: toggles.ema50 });
    bbUpperRef.current?.applyOptions({ visible: toggles.bb });
    bbLowerRef.current?.applyOptions({ visible: toggles.bb });
    vwapRef.current?.applyOptions({ visible: toggles.vwap });
    volumeRef.current?.applyOptions({ visible: toggles.volume });
    signalRef.current?.applyOptions({ visible: toggles.signals });
    wma20Ref.current?.applyOptions({ visible: toggles.wma20 });
    supertrendRef.current?.applyOptions({ visible: toggles.supertrend });
    keltnerUpperRef.current?.applyOptions({ visible: toggles.keltner });
    keltnerMiddleRef.current?.applyOptions({ visible: toggles.keltner });
    keltnerLowerRef.current?.applyOptions({ visible: toggles.keltner });
    donchianUpperRef.current?.applyOptions({ visible: toggles.donchian });
    donchianMiddleRef.current?.applyOptions({ visible: toggles.donchian });
    donchianLowerRef.current?.applyOptions({ visible: toggles.donchian });
  }, [toggles]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // chart may already be disposed
      }
    }
    priceLinesRef.current = [];
    if (!toggles.sr || !levels) return;

    const lastClose = candleData[candleData.length - 1]?.close ?? 0;
    const nearest = (items: { price: number; touches: number }[], count: number) =>
      [...items]
        .sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose))
        .slice(0, count);

    const support = nearest(levels.support, 3);
    const resistance = nearest(levels.resistance, 3);
    priceLinesRef.current = [
      ...support.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: "rgba(56, 217, 169, 0.45)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `S ${level.touches}`,
        })
      ),
      ...resistance.map((level) =>
        series.createPriceLine({
          price: level.price,
          color: "rgba(255, 107, 129, 0.45)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `R ${level.touches}`,
        })
      ),
    ];
  }, [levels, toggles.sr, candleData]);

  const intraday = candleData.length > 1 && (candleData[1].time as number) - (candleData[0].time as number) < 4 * 3_600;

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  const resetZoom = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  const downloadPng = useCallback(() => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const link = document.createElement("a");
    const name = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    link.download = `solo-${name || "chart"}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [title]);

  const last = candleData[candleData.length - 1];
  const shown = hover ?? (last ? { ...last, volume: volumeData?.[volumeData.length - 1]?.value ?? 0 } : null);

  return (
    <div className={expanded ? "chart-shell chart-shell-expanded" : "chart-shell"} style={expanded ? undefined : { height }}>
      <div className="chart-toolbar">
        <div className="chart-legend">
          {shown ? (
            <>
              <span className="chart-legend-time">{formatChartTime(shown.time, intraday)}</span>
              <span>O <b>{formatNumber(shown.open, 2)}</b></span>
              <span>H <b>{formatNumber(shown.high, 2)}</b></span>
              <span>L <b>{formatNumber(shown.low, 2)}</b></span>
              <span>C <b style={{ color: shown.close >= shown.open ? "var(--positive)" : "var(--negative)" }}>{formatNumber(shown.close, 2)}</b></span>
              <span>Vol <b>{compactVolume(shown.volume)}</b></span>
            </>
          ) : (
            <span>No data</span>
          )}
        </div>
        <div className="chart-actions">
          {(Object.keys(OVERLAY_LABELS) as (keyof OverlayToggles)[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`chart-chip${toggles[key] ? " active" : ""}`}
              onClick={() => onToggle(key)}
              aria-pressed={toggles[key]}
            >
              {OVERLAY_LABELS[key]}
            </button>
          ))}
          <button type="button" className="chart-chip" onClick={resetZoom} aria-label="Reset chart zoom">
            Reset
          </button>
          <button type="button" className="chart-chip" onClick={downloadPng} aria-label="Download chart as PNG">
            PNG
          </button>
          <button type="button" className="chart-chip" onClick={onToggleExpand} aria-label={expanded ? "Exit fullscreen" : "Fullscreen chart"}>
            {expanded ? "✕ Exit" : "⛶ Fullscreen"}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="chart-canvas" aria-label={title} />
    </div>
  );
}

export default function AnalysisPage() {
  const symbols = useApi<{ symbols: { key: string; name: string; short: string; exchange: string; type: string; currency: string }[] }>(
    "/api/symbols",
    0
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string>("NIFTY");
  const [selectedInterval, setSelectedInterval] = useState<string>("1d");
  const [toggles, setToggles] = useState<OverlayToggles>(DEFAULT_TOGGLES);
  const [expanded, setExpanded] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const analysis = useApi<AdvancedAnalysisResponse>(
    `/api/analysis-advanced?symbol=${encodeURIComponent(selectedSymbol)}&interval=${selectedInterval}&range=1y`,
    60_000
  );
  const [cacheData, setCacheData] = useState<AdvancedAnalysisResponse | null>(null);
  const [manualLoading, setManualLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);
  const [liveQuote, setLiveQuote] = useState<LiveQuoteRow | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const symbolMeta = (symbols.data?.symbols ?? []).find((s) => s.key === selectedSymbol);
  const canLiveLookup = symbolMeta?.exchange === "NSE" && symbolMeta?.type === "stock";

  // One polite NSE request per click, cached server-side (15s open / 60s closed).
  const fetchLiveQuote = useCallback(async () => {
    setLiveBusy(true);
    try {
      const row = await apiGet<LiveQuoteRow>(`/api/quote-live?key=${encodeURIComponent(selectedSymbol)}`);
      setLiveQuote(row);
      if (row.note) setToast({ message: row.note, type: "success" });
    } catch (caught) {
      setToast({ message: `NSE live unavailable — ${errorMessage(caught).slice(0, 120)}`, type: "error" });
    } finally {
      setLiveBusy(false);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    setLiveQuote(null);
  }, [selectedSymbol]);

  const matchesSelection = (candidate: AdvancedAnalysisResponse | null) =>
    candidate && candidate.symbol === selectedSymbol && candidate.interval === selectedInterval ? candidate : null;
  const data = matchesSelection(analysis.data) ?? matchesSelection(cacheData);
  const loading = analysis.loading || manualLoading;

  // Load cache and saved preferences after mount (avoids hydration mismatch).
  useEffect(() => {
    const cached = loadCache<AdvancedAnalysisResponse>(CACHE_KEY);
    if (cached) {
      setCacheData(cached);
      setManualLoading(false);
    }
    try {
      const savedSymbol = window.localStorage.getItem(SYMBOL_KEY);
      if (savedSymbol) setSelectedSymbol(savedSymbol);
      const savedInterval = window.localStorage.getItem(INTERVAL_KEY);
      if (savedInterval) setSelectedInterval(savedInterval);
      // URL params (e.g. from the index scanner's "Full chart" links) win over saved prefs.
      const params = new URLSearchParams(window.location.search);
      const urlSymbol = params.get("symbol");
      const urlInterval = params.get("interval");
      if (urlSymbol && urlSymbol.trim()) {
        const key = urlSymbol.trim().toUpperCase();
        setSelectedSymbol(key);
        window.localStorage.setItem(SYMBOL_KEY, key);
      }
      if (urlInterval && ["5m", "15m", "30m", "1h", "1d", "1wk"].includes(urlInterval)) {
        setSelectedInterval(urlInterval);
        window.localStorage.setItem(INTERVAL_KEY, urlInterval);
      }
      const savedToggles = window.localStorage.getItem(TOGGLES_KEY);
      if (savedToggles) {
        setToggles({ ...DEFAULT_TOGGLES, ...(JSON.parse(savedToggles) as Partial<OverlayToggles>) });
      }
    } catch {
      // ignore corrupt preferences
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(SYMBOL_KEY, selectedSymbol);
      window.localStorage.setItem(INTERVAL_KEY, selectedInterval);
      window.localStorage.setItem(TOGGLES_KEY, JSON.stringify(toggles));
    } catch {
      // ignore quota errors
    }
  }, [selectedSymbol, selectedInterval, toggles, prefsReady]);

  useEffect(() => {
    if (!analysis.data) return;
    if (analysis.data.symbol !== selectedSymbol || analysis.data.interval !== selectedInterval) return;
    setCacheData(analysis.data);
    saveCache(CACHE_KEY, analysis.data);
    setManualLoading(false);
  }, [analysis.data, selectedSymbol, selectedInterval]);

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

  const refreshAll = useCallback(() => {
    analysis.refresh();
    void fetchAnalysis();
  }, [analysis.refresh, fetchAnalysis]);

  const toggleOverlay = useCallback((key: keyof OverlayToggles) => {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        refreshAll();
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        setExpanded((value) => !value);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = symbols.data?.symbols ?? [];
        if (!list.length) return;
        event.preventDefault();
        const index = list.findIndex((item) => item.key === selectedSymbol);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = list[(index + step + list.length) % list.length];
        if (next) {
          setManualLoading(true);
          setSelectedSymbol(next.key);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshAll, selectedSymbol, symbols.data]);

  const chartData = useMemo(() => {
    const source = data?.series;
    // The API returns epoch milliseconds; lightweight-charts expects epoch seconds.
    const times: UTCTimestamp[] = (source?.times ?? []).map((time) => Math.floor(time / 1000) as UTCTimestamp);
    const closes = source?.closes ?? [];
    const opens = source?.opens ?? closes;
    const highs = source?.highs ?? closes;
    const lows = source?.lows ?? closes;
    const volumes = source?.volumes ?? [];

    const candles: CandlePoint[] = times.map((time, index) => ({
      time,
      open: opens[index] ?? closes[index] ?? 0,
      high: highs[index] ?? closes[index] ?? 0,
      low: lows[index] ?? closes[index] ?? 0,
      close: closes[index] ?? 0,
    }));

    const volumePoints: VolumePoint[] = times.map((time, index) => {
      const close = closes[index] ?? 0;
      const open = opens[index] ?? close;
      return {
        time,
        value: volumes[index] ?? 0,
        color: close >= open ? "rgba(56, 217, 169, 0.35)" : "rgba(255, 107, 129, 0.35)",
      };
    });

    const line = (values?: (number | null)[]): ChartPoint[] =>
      (values ?? []).flatMap((value, index) =>
        value == null || times[index] == null ? [] : [{ time: times[index], value }]
      );

    return {
      candles,
      volumes: volumePoints,
      overlays: {
        sma20: line(source?.sma20),
        ema20: line(source?.ema20),
        sma50: line(source?.sma50),
        ema50: line(source?.ema50),
        bbUpper: line(source?.bb_upper),
        bbLower: line(source?.bb_lower),
        vwap: line(source?.vwap),
        wma20: line(source?.wma20),
        supertrend: line(source?.supertrend),
        kcUpper: line(source?.kc_upper),
        kcMiddle: line(source?.kc_middle),
        kcLower: line(source?.kc_lower),
        dcUpper: line(source?.donchian_upper),
        dcMiddle: line(source?.donchian_middle),
        dcLower: line(source?.donchian_lower),
      },
      signals: (source?.candlestick_signals ?? []).map((s) => ({
        time: s.time as UTCTimestamp,
        position: s.position,
        color: s.color,
        shape: s.shape as "arrow_up" | "arrow_down",
        text: s.text,
        size: s.size,
        external: s.external,
      })),
      rsi: line(source?.rsi14),
      macd: line(source?.macd_hist),
      stoch: line(source?.stoch_k),
    };
  }, [data]);

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
        {(error || data?.reason) && <ErrorNotice error={error ?? data?.reason ?? "Analysis unavailable"} retry={refreshAll} />}
        {loading && <LoadingBlock rows={6} label="Calculating advanced indicators..." />}
        {!loading && !error && !data && <ErrorNotice error="No analysis data for this symbol and interval." retry={refreshAll} />}
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
    meta,
    generated_at,
    input_provider,
  } = data;

  const { sma20, sma50, ema20, ema50, rsi14, macd_hist, bb_upper, bb_lower, atr14, vwap, adx, stoch_k, stoch_d } = indicators;

  const signalColor = signal.bias === "bullish" ? "var(--positive)" : signal.bias === "bearish" ? "var(--negative)" : "var(--muted)";

  const symbolOptions = (symbols.data?.symbols ?? []).map((s) => ({
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
        title={`${data.symbol} — Technical Analysis`}
        subtitle="RSI · MACD · Bollinger Bands · Stochastic · ADX · OBV · VWAP · Support/Resistance · Patterns — all inside Solo Trading Charts"
        actions={
          <>
            <select
              className="range-select"
              value={selectedSymbol}
              onChange={(e) => {
                setManualLoading(true);
                setSelectedSymbol(e.target.value);
              }}
              style={{ fontSize: 11, fontFamily: "var(--mono)", padding: "4px 6px", borderRadius: 3, border: "1px solid var(--line)" }}
            >
              {symbolOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="range-select"
              value={selectedInterval}
              onChange={(e) => {
                setManualLoading(true);
                setSelectedInterval(e.target.value);
              }}
              style={{ fontSize: 11, fontFamily: "var(--mono)", padding: "4px 6px", borderRadius: 3, border: "1px solid var(--line)" }}
            >
              {intervalOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button className="button" onClick={refreshAll} type="button">Refresh</button>
            {canLiveLookup && (
              <button
                className="button"
                onClick={fetchLiveQuote}
                type="button"
                disabled={liveBusy}
                title="One polite request straight from nseindia.com — free, exchange-published, live during market hours"
              >
                {liveBusy ? "NSE…" : "⚡ Live (NSE)"}
              </button>
            )}
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
            <div className="stat-value">{formatNumber(liveQuote ? liveQuote.value : price, 2)}</div>
            <div className="stat-foot">
              {liveQuote ? (
                <span>
                  <span style={{ color: toneClass(liveQuote.change_pct ?? 0) }}>{formatPct(liveQuote.change_pct ?? 0)}</span>
                  {" · "}
                  <span style={{ color: "var(--positive)" }}>
                    {liveQuote.data_status === "live"
                      ? "⚡ NSE live"
                      : liveQuote.live_attempt === "fallback-delayed"
                        ? "delayed snapshot"
                        : "NSE close"}
                  </span>
                </span>
              ) : (
                <span style={{ color: toneClass(change_pct) }}>{formatPct(change_pct)}</span>
              )}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Data As Of</div>
            <div className="stat-value">{meta?.as_of ? timeAgo(meta.as_of) : generated_at ? timeAgo(generated_at) : "—"}</div>
            <div className="stat-foot"><span>{input_provider}{meta?.freshness ? ` · ${meta.freshness}` : ""}</span></div>
          </div>
        </div>
        <div className="warning-box" style={{ marginTop: 8, padding: 8 }}>
          <strong style={{ fontSize: 12 }}>{signal.reasons.join(" · ") || "No clear signal — wait for alignment."}</strong>
        </div>
      </Panel>

      {/* Mobile-Optimized Charts */}
      <Panel title="Price, Volume & Indicators" kicker="Real OHLC candles · R refresh · F fullscreen · ↑/↓ change symbol" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "min(620px, 92vh)" }}>
          <CandleChartPanel
            title="Price · Volume · Overlays"
            height={360}
            candleData={chartData.candles}
            volumeData={chartData.volumes}
            overlayData={chartData.overlays}
            candlestickSignals={chartData.signals}
            levels={levels}
            toggles={toggles}
            onToggle={toggleOverlay}
            expanded={expanded}
            onToggleExpand={() => setExpanded((value) => !value)}
          />
          <LineChartPanel title="RSI (14)" color="#6ea8ff" height={110} data={chartData.rsi} />
          <LineChartPanel title="MACD Histogram" color="#f4c95d" height={100} data={chartData.macd} />
          <LineChartPanel title="Stochastic %K" color="#c4a7ff" height={100} data={chartData.stoch} />
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
