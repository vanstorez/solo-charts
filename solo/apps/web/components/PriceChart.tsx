"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, SeriesMarker, UTCTimestamp } from "lightweight-charts";

import type { AnalysisResponse, ChartBar, ChartZone } from "@/lib/types";

const DEFAULT_EMA = [20, 50];

function calculateEma(values: number[], period: number): (number | null)[] {
  const output: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return output;
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  let previous = seed / period;
  output[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * multiplier + previous * (1 - multiplier);
    output[index] = previous;
  }
  return output;
}

export function PriceChart({
  bars,
  height = 480,
  showVolume = true,
  emaPeriods = DEFAULT_EMA,
  analysis = null,
  showStructure = true,
  showSar = true,
  showZones = true
}: {
  bars: ChartBar[];
  height?: number;
  showVolume?: boolean;
  emaPeriods?: number[];
  analysis?: AnalysisResponse | null;
  showStructure?: boolean;
  showSar?: boolean;
  showZones?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;
    let disposed = false;

    void (async () => {
      const { createChart, LineStyle } = await import("lightweight-charts");
      if (disposed || !container) return;
      const chart = createChart(container, {
        width: container.clientWidth,
        height,
        layout: {
          background: { color: "transparent" },
          textColor: "#8fa4b0",
          fontSize: 10,
          fontFamily: "SFMono-Regular, Cascadia Code, Consolas, monospace"
        },
        grid: {
          vertLines: { color: "rgba(27, 45, 73, 0.55)" },
          horzLines: { color: "rgba(27, 45, 73, 0.55)" }
        },
        crosshair: {
          mode: 0,
          vertLine: { color: "rgba(110, 168, 255, 0.35)", width: 1, style: 2, labelBackgroundColor: "#0e1c30" },
          horzLine: { color: "rgba(110, 168, 255, 0.35)", width: 1, style: 2, labelBackgroundColor: "#0e1c30" }
        },
        rightPriceScale: {
          borderColor: "rgba(21, 50, 66, 0.8)",
          scaleMargins: { top: 0.08, bottom: showVolume ? 0.26 : 0.08 }
        },
        timeScale: {
          borderColor: "rgba(21, 50, 66, 0.8)",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 4,
          barSpacing: 7
        },
        localization: { locale: "en-IN" },
        handleScroll: true,
        handleScale: true
      });
      chartRef.current = chart;
      const candles = chart.addCandlestickSeries({
        upColor: "#38d9a9",
        downColor: "#ff6b81",
        borderVisible: false,
        wickUpColor: "#38d9a9",
        wickDownColor: "#ff6b81",
        priceFormat: { type: "price", precision: 2, minMove: 0.05 }
      });
      candles.setData(
        bars.map((bar) => ({
          time: Math.floor(bar.t / 1000) as UTCTimestamp,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c
        }))
      );
      if (showVolume) {
        const volume = chart.addHistogramSeries({
          color: "rgba(138, 184, 255, 0.22)",
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          lastValueVisible: false,
          priceLineVisible: false
        });
        volume.setData(
          bars.map((bar) => ({
            time: Math.floor(bar.t / 1000) as UTCTimestamp,
            value: bar.v,
            color: bar.c >= bar.o ? "rgba(56, 217, 169, 0.18)" : "rgba(255, 107, 129, 0.18)"
          }))
        );
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      const colors = ["#6ea8ff", "#f4c95d", "#9b8cff"];
      emaPeriods.forEach((period, index) => {
        const values = calculateEma(bars.map((bar) => bar.c), period);
        const line = chart.addLineSeries({
          color: colors[index % colors.length],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        line.setData(
          values
            .map((value, barIndex) => ({
              time: Math.floor(bars[barIndex].t / 1000) as UTCTimestamp,
              value
            }))
            .filter((point): point is { time: UTCTimestamp; value: number } => point.value !== null)
        );
      });
      const structure = analysis?.structure;
      if (showSar && structure?.parabolic_sar?.points?.length) {
        const bullish = structure.parabolic_sar.points
          .filter((point) => point.trend === "bullish")
          .map((point) => ({ time: Math.floor(point.t / 1000) as UTCTimestamp, value: point.value }));
        const bearish = structure.parabolic_sar.points
          .filter((point) => point.trend === "bearish")
          .map((point) => ({ time: Math.floor(point.t / 1000) as UTCTimestamp, value: point.value }));
        for (const [points, color] of [
          [bullish, "#f4c95d"],
          [bearish, "#ff8fa3"]
        ] as const) {
          if (points.length === 0) continue;
          const series = chart.addLineSeries({
            color,
            lineVisible: false,
            pointMarkersVisible: true,
            pointMarkersRadius: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          });
          series.setData(points);
        }
      }

      if (showStructure) {
        const markers: SeriesMarker<UTCTimestamp>[] = [];
        for (const event of structure?.structure?.events ?? []) {
          markers.push({
            time: Math.floor(event.t / 1000) as UTCTimestamp,
            position: event.direction === "bullish" ? "belowBar" : "aboveBar",
            color: event.direction === "bullish" ? "#38d9a9" : "#ff6b81",
            shape: event.direction === "bullish" ? "arrowUp" : "arrowDown",
            text: event.type === "CHoCH" ? "CHoCH" : "BOS"
          });
        }
        for (const sweep of structure?.liquidity_sweeps ?? []) {
          markers.push({
            time: Math.floor(sweep.t / 1000) as UTCTimestamp,
            position: sweep.side === "buy_side" ? "aboveBar" : "belowBar",
            color: "#c4a7ff",
            shape: "circle",
            text: "sweep"
          });
        }
        const unique = new Map<string, SeriesMarker<UTCTimestamp>>();
        for (const marker of markers) {
          unique.set(`${marker.time}-${marker.text}-${marker.position}`, marker);
        }
        candles.setMarkers([...unique.values()].sort((left, right) => Number(left.time) - Number(right.time)));
      }

      if (showZones && structure) {
        const lines: { zone: ChartZone; label: string; color: string }[] = [];
        for (const block of (structure.order_blocks ?? []).slice(-3)) {
          lines.push({
            zone: block,
            label: block.side === "bullish" ? "OB demand" : "OB supply",
            color: block.side === "bullish" ? "rgba(56, 217, 169, 0.65)" : "rgba(255, 107, 129, 0.65)"
          });
        }
        for (const gap of (structure.fair_value_gaps ?? []).filter((item) => item.status !== "filled").slice(-3)) {
          lines.push({
            zone: gap,
            label: gap.side === "bullish" ? "FVG ↑" : "FVG ↓",
            color: "rgba(196, 167, 255, 0.62)"
          });
        }
        for (const line of lines) {
          for (const price of [line.zone.top, line.zone.bottom]) {
            candles.createPriceLine({
              price,
              color: line.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: line.label
            });
          }
        }
        if (structure.premium_discount?.available && structure.premium_discount.equilibrium) {
          candles.createPriceLine({
            price: structure.premium_discount.equilibrium,
            color: "rgba(143, 164, 176, 0.5)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "EQ"
          });
        }
      }

      chart.timeScale().fitContent();
      const observer = new ResizeObserver(() => {
        if (!disposed) chart.applyOptions({ width: container.clientWidth, height });
      });
      observer.observe(container);
      (container as HTMLDivElement & { _soloObserver?: ResizeObserver })._soloObserver = observer;
    })();

    return () => {
      disposed = true;
      const containerWithObserver = container as HTMLDivElement & { _soloObserver?: ResizeObserver };
      containerWithObserver._soloObserver?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [analysis, bars, emaPeriods, height, showSar, showStructure, showVolume, showZones]);

  if (bars.length === 0) {
    return <div className="chart-empty" style={{ minHeight: height }}>No candles returned. The chart does not fabricate a series.</div>;
  }

  return <div className="chart-canvas" ref={containerRef} style={{ height }} />;
}
