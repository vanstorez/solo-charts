"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PriceChart } from "@/components/PriceChart";
import { FreshnessBadge, ProvenanceLine, SourcePill } from "@/components/Provenance";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDate, formatNumber, formatPct, titleCase, toneClass } from "@/lib/format";
import type { AnalysisResponse, ChartResponse, SymbolsResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const intervals = ["5m", "15m", "30m", "1h", "1d", "1wk"];
const rangesByInterval: Record<string, string[]> = {
  "5m": ["1d", "5d", "1mo"],
  "15m": ["1d", "5d", "1mo"],
  "30m": ["1d", "5d", "1mo"],
  "1h": ["1mo", "3mo", "6mo", "1y"],
  "1d": ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"],
  "1wk": ["1y", "5y", "10y", "max"]
};
const defaultRange: Record<string, string> = { "5m": "5d", "15m": "5d", "30m": "5d", "1h": "1mo", "1d": "1y", "1wk": "5y" };

export default function ChartPageClient() {
  const searchParams = useSearchParams();
  const initialSymbol = (searchParams.get("symbol") || "NIFTY").toUpperCase();
  const [symbol, setSymbol] = useState(initialSymbol);
  const [interval, setInterval] = useState("1d");
  const [range, setRange] = useState("1y");
  const [showStructure, setShowStructure] = useState(true);
  const [showSar, setShowSar] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const symbols = useApi<SymbolsResponse>("/api/symbols");
  const chartPath = `/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`;
  const chart = useApi<ChartResponse>(chartPath, 0);
  const analysisPath = `/api/analysis?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`;
  const analysis = useApi<AnalysisResponse>(analysisPath, 180_000);
  const licensedChart = chart.data?.meta.provider === "Global Datafeeds";
  const refreshMs = licensedChart
    ? interval === "1d" || interval === "1wk"
      ? 60_000
      : 15_000
    : interval === "1d" || interval === "1wk"
      ? 180_000
      : 30_000;

  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") chart.refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [chart.refresh, refreshMs]);

  const symbolList = symbols.data?.symbols ?? [];
  const allowedRanges = rangesByInterval[interval] || ["1y"];
  const quote = chart.data?.quote;
  const meta = chart.data?.meta;
  const quoteMeta = chart.data?.quote_meta;
  const closes = useMemo(() => chart.data?.bars.map((bar) => bar.c) ?? [], [chart.data]);

  useEffect(() => {
    if (symbolList.length > 0 && !symbolList.some((item) => item.key === symbol)) {
      setSymbol("NIFTY");
    }
  }, [symbolList, symbol]);

  useEffect(() => {
    if (!allowedRanges.includes(range)) setRange(defaultRange[interval] || allowedRanges[0]);
  }, [interval, range, allowedRanges]);

  const refreshAll = () => {
    chart.refresh();
    analysis.refresh();
  };

  return (
    <>
      <PageHeader
        kicker="Advanced charting"
        title="Price structure with provenance attached"
        subtitle="Daily and intraday candles from the configured licensed feed when available, otherwise a public provider. Delay and transport are shown explicitly; indicators are calculated locally."
        actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh candles + structure</button>
            <Link className="button ghost" href="/bank-nifty">Scenario desk</Link>
          </>
        }
      />

      {chart.error && <ErrorNotice error={chart.error} retry={chart.refresh} />}
      {!chart.data && chart.loading && <LoadingBlock rows={6} label="Loading candles and quote snapshot" />}

      <Panel className="chart-shell">
        <div className="chart-toolbar">
          <div className="chart-toolbar-group">
            <select
              aria-label="Symbol"
              className="range-select"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            >
              {symbols.loading && <option value={symbol}>{symbol}</option>}
              {symbolList.map((item) => (
                <option key={item.key} value={item.key}>{item.short} · {item.name}</option>
              ))}
            </select>
            <div className="segmented" aria-label="Timeframe">
              {intervals.map((value) => (
                <button
                  className={value === interval ? "active" : ""}
                  key={value}
                  onClick={() => setInterval(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
            <select
              aria-label="History range"
              className="range-select"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              {allowedRanges.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="chart-toolbar-group">
            <div className="segmented" aria-label="Chart overlays">
              <button
                aria-pressed={showStructure}
                className={showStructure ? "active" : ""}
                onClick={() => setShowStructure((value) => !value)}
                type="button"
              >
                SMC
              </button>
              <button
                aria-pressed={showSar}
                className={showSar ? "active" : ""}
                onClick={() => setShowSar((value) => !value)}
                type="button"
              >
                SAR
              </button>
              <button
                aria-pressed={showZones}
                className={showZones ? "active" : ""}
                onClick={() => setShowZones((value) => !value)}
                type="button"
              >
                Zones
              </button>
            </div>
            {meta && <FreshnessBadge meta={meta} />}
            {chart.data?.quote && <SourcePill source={chart.data.quote.source} />}
          </div>
        </div>

        {chart.data ? (
          <>
            <div style={{ position: "relative" }}>
              <PriceChart
                analysis={analysis.data?.available ? analysis.data : null}
                bars={chart.data.bars}
                height={480}
                showSar={showSar}
                showStructure={showStructure}
                showZones={showZones}
              />
              {chart.loading && <div className="chart-loading">Refreshing provider snapshot...</div>}
            </div>
            <div className="chart-legend">
              <span><span className="legend-dot" style={{ background: "#6ea8ff" }} />EMA 20</span>
              <span><span className="legend-dot" style={{ background: "#f4c95d" }} />EMA 50 / SAR</span>
              <span><span className="legend-dot" style={{ background: "#38d9a9" }} />BOS / demand</span>
              <span><span className="legend-dot" style={{ background: "#c4a7ff" }} />sweep / FVG</span>
              <span><span className="legend-dot" style={{ background: "rgba(138,184,255,0.7)" }} />Volume</span>
              <span>Provider: {meta?.provider}</span>
              <span>Bars: {chart.data.bars.length}</span>
            </div>
            {analysis.loading && !analysis.data && <div className="chart-loading">Calculating structure across six timeframes...</div>}
            {(analysis.error || (analysis.data && !analysis.data.available)) && (
              <div className="warning-box" style={{ margin: "9px 11px 0" }}>
                <strong>Structure suite unavailable.</strong>{" "}
                {analysis.error || analysis.data?.reason || "No analysis returned."} The candles still
                render; no overlay is fabricated.
              </div>
            )}
          </>
        ) : (
          !chart.loading && <EmptyState title="Chart unavailable">The provider returned no candles. No synthetic price series is shown.</EmptyState>
        )}

        {chart.data && (
          <div className="chart-foot">
            <div className="badge-row">
              <span className="badge accent">Last bar {formatDate(new Date(chart.data.bars.at(-1)?.t || Date.now()).toISOString())}</span>
              <span className="badge">Quote source: {quote?.source || "unavailable"}</span>
              <span className={`badge ${licensedChart ? "accent" : "warn"}`}>
                {licensedChart
                  ? `Licensed REST · declared ${meta?.delay_seconds === null || meta?.delay_seconds === undefined ? "unknown" : `${meta.delay_seconds}s`} delay`
                  : "Exact exchange delay not published"}
              </span>
            </div>
            <span className="small muted">Auto-refresh: {refreshMs / 1000}s while tab visible</span>
          </div>
        )}
      </Panel>

      {chart.data && (
        <>
          <div className="grid-4" style={{ marginTop: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Last quote</div>
              <div className="stat-value">{formatNumber(quote?.value ?? chart.data.daily_close, 2)}</div>
              <div className="stat-foot"><span className={`delta ${toneClass(quote?.change ?? chart.data.summary.change)}`}>{formatPct(quote?.change ?? chart.data.summary.change)}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">RSI(14)</div>
              <div className="stat-value">{formatNumber(chart.data.summary.rsi14, 1)}</div>
              <div className="stat-foot"><span>Local calculation</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">ATR(14)</div>
              <div className="stat-value">{formatNumber(chart.data.summary.atr14, 2)}</div>
              <div className="stat-foot"><span>{formatNumber(chart.data.summary.atr_pct, 2)}% of close</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Technical score</div>
              <div className="stat-value">{formatNumber(chart.data.summary.score, 0)}<span style={{ fontSize: 12, color: "var(--muted)" }}>/100</span></div>
              <div className="stat-foot"><span>{titleCase(chart.data.summary.rating)}</span></div>
            </div>
          </div>

          {analysis.data?.available && analysis.data.mtf && analysis.data.structure && (
            <>
              <Panel
                title="Multi-timeframe trend"
                kicker="Solo local calculation · alignment, not a probability"
                action={analysis.data.meta ? <FreshnessBadge meta={analysis.data.meta} /> : null}
                style={{ marginTop: 13 }}
              >
                <div className="grid-3" style={{ marginBottom: 10 }}>
                  <div className="stat-card">
                    <div className="stat-label">Weighted direction</div>
                    <div className="stat-value" style={{ fontSize: 20 }}>{titleCase(analysis.data.mtf.direction)}</div>
                    <div className="stat-foot"><span>{analysis.data.mtf.confidence_label}</span></div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Timeframe alignment</div>
                    <div className="stat-value">{formatNumber(analysis.data.mtf.alignment_pct, 1)}<span style={{ fontSize: 12, color: "var(--muted)" }}>%</span></div>
                    <div className="stat-foot"><span>heuristic agreement</span></div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Frames available</div>
                    <div className="stat-value">{analysis.data.mtf.timeframes.filter((item) => item.score !== null).length}<span style={{ fontSize: 12, color: "var(--muted)" }}>/6</span></div>
                    <div className="stat-foot"><span>5m through 1D</span></div>
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead>
                      <tr><th>Frame</th><th>Trend</th><th className="num">Checks</th><th className="num">RSI</th><th>Structure / source</th></tr>
                    </thead>
                    <tbody>
                      {analysis.data.mtf.timeframes.map((timeframe) => (
                        <tr key={timeframe.label}>
                          <td><strong>{timeframe.label}</strong></td>
                          <td>
                            <span className={`badge ${timeframe.trend === "bullish" ? "accent" : timeframe.trend === "bearish" ? "bad" : ""}`}>
                              {timeframe.trend}
                            </span>
                          </td>
                          <td className="num mono">{timeframe.score === null ? "—" : `${timeframe.score}/4`}</td>
                          <td className="num mono">{formatNumber(timeframe.rsi, 1)}</td>
                          <td className="small">
                            {timeframe.last_event || timeframe.structure}
                            <span className="tf-source">{timeframe.source} · {timeframe.bars} bars</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>{analysis.data.mtf.note}</p>
                {analysis.data.meta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={analysis.data.meta} /></div>}
              </Panel>

              <Panel
                title="Solo Structure Suite"
                kicker="Original BOS/CHoCH, order-block, breaker, FVG, sweep and SAR calculations"
                style={{ marginTop: 13 }}
              >
                <div className="grid-3">
                  <div className="structure-column">
                    <div className="eyebrow">BOS / CHoCH</div>
                    {analysis.data.structure.structure.events.length === 0 ? (
                      <p className="small muted">No confirmed structure break in the returned window.</p>
                    ) : (
                      <div className="signal-list">
                        {analysis.data.structure.structure.events.slice(-5).reverse().map((event) => (
                          <div className="signal-item" key={`${event.t}-${event.type}`}>
                            <div>
                              <strong>{event.label}</strong>
                              <span>{formatDate(new Date(event.t).toISOString())} · break level {formatNumber(event.level, 2)}</span>
                            </div>
                            <span className={`badge ${event.direction === "bullish" ? "accent" : "bad"}`}>{event.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="eyebrow" style={{ marginTop: 12 }}>Liquidity sweeps</div>
                    {analysis.data.structure.liquidity_sweeps.length === 0 ? (
                      <p className="small muted">No wick-through-and-close-back event in the window.</p>
                    ) : (
                      <div className="signal-list">
                        {analysis.data.structure.liquidity_sweeps.slice(-4).reverse().map((sweep) => (
                          <div className="signal-item" key={`${sweep.t}-${sweep.side}`}>
                            <div>
                              <strong>{sweep.label}</strong>
                              <span>{formatDate(new Date(sweep.t).toISOString())} · level {formatNumber(sweep.level, 2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="structure-column">
                    <div className="eyebrow">Order blocks & breakers</div>
                    {analysis.data.structure.order_blocks.length === 0 ? (
                      <p className="small muted">No qualifying order block in the returned window.</p>
                    ) : (
                      <div className="signal-list">
                        {analysis.data.structure.order_blocks.slice(-4).reverse().map((zone) => (
                          <div className="signal-item" key={`${zone.t}-${zone.label}`}>
                            <div>
                              <strong>{zone.label}</strong>
                              <span>{formatNumber(zone.bottom, 2)} – {formatNumber(zone.top, 2)} · {zone.status}</span>
                            </div>
                            <span className={`badge ${zone.side === "bullish" ? "accent" : "bad"}`}>{zone.side === "bullish" ? "demand" : "supply"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="eyebrow" style={{ marginTop: 12 }}>Fair value gaps</div>
                    {analysis.data.structure.fair_value_gaps.length === 0 ? (
                      <p className="small muted">No qualifying three-candle imbalance.</p>
                    ) : (
                      <div className="signal-list">
                        {analysis.data.structure.fair_value_gaps.slice(-4).reverse().map((gap) => (
                          <div className="signal-item" key={`${gap.t}-${gap.side}`}>
                            <div>
                              <strong>{gap.label}</strong>
                              <span>{formatNumber(gap.bottom, 2)} – {formatNumber(gap.top, 2)} · {gap.status} · {formatNumber(gap.filled_pct, 0)}% filled</span>
                            </div>
                            <span className={`badge ${gap.side === "bullish" ? "accent" : "bad"}`}>{gap.side === "bullish" ? "↑" : "↓"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="structure-column">
                    <div className="eyebrow">Parabolic SAR & range position</div>
                    <div className="detail-grid">
                      <div className="detail-cell"><span>SAR latest</span><strong>{formatNumber(analysis.data.structure.parabolic_sar.latest?.value, 2)}</strong></div>
                      <div className="detail-cell"><span>SAR trend</span><strong>{analysis.data.structure.parabolic_sar.latest?.trend || "—"}</strong></div>
                      <div className="detail-cell"><span>Range zone</span><strong>{analysis.data.structure.premium_discount.zone || "—"}</strong></div>
                      <div className="detail-cell"><span>Range position</span><strong>{formatNumber(analysis.data.structure.premium_discount.position_pct, 1)}%</strong></div>
                      <div className="detail-cell"><span>Equilibrium</span><strong>{formatNumber(analysis.data.structure.premium_discount.equilibrium, 2)}</strong></div>
                      <div className="detail-cell"><span>Data input</span><strong>{analysis.data.input_provider}</strong></div>
                    </div>
                    <ul className="evidence-list" style={{ marginTop: 10 }}>
                      {analysis.data.structure.summary.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="badge-row" style={{ marginTop: 12 }}>
                  {analysis.data.indicator_contract?.map((item) => (
                    <span className="badge" key={item.key} title={item.note}>{item.label} · local</span>
                  ))}
                </div>
                <div className="warning-box" style={{ marginTop: 10 }}>
                  <strong>Third-party indicator boundary.</strong> {analysis.data.third_party_note}
                </div>
              </Panel>
            </>
          )}

          <div className="grid-2" style={{ marginTop: 13 }}>
            <Panel title="Structure & levels" kicker="Daily reference, not an order">
              <div className="detail-grid">
                <div className="detail-cell"><span>EMA 20</span><strong>{formatNumber(chart.data.summary.ema20, 2)}</strong></div>
                <div className="detail-cell"><span>EMA 50</span><strong>{formatNumber(chart.data.summary.ema50, 2)}</strong></div>
                <div className="detail-cell"><span>EMA 200</span><strong>{formatNumber(chart.data.summary.ema200, 2)}</strong></div>
                <div className="detail-cell"><span>Pivot</span><strong>{formatNumber(chart.data.levels.pivot, 2)}</strong></div>
                <div className="detail-cell"><span>Supports</span><strong>{chart.data.levels.supports.map((value) => formatNumber(value, 2)).join(" / ") || "—"}</strong></div>
                <div className="detail-cell"><span>Resistances</span><strong>{chart.data.levels.resistances.map((value) => formatNumber(value, 2)).join(" / ") || "—"}</strong></div>
                <div className="detail-cell"><span>52-week high</span><strong>{formatNumber(chart.data.summary.high52, 2)}</strong></div>
                <div className="detail-cell"><span>52-week low</span><strong>{formatNumber(chart.data.summary.low52, 2)}</strong></div>
              </div>
              <ul className="evidence-list" style={{ marginTop: 12 }}>
                {chart.data.summary.signals.map((signal) => <li key={signal}>{signal}</li>)}
              </ul>
            </Panel>

            <Panel title="Data contract" kicker="What this chart actually is">
              {meta && <ProvenanceLine meta={meta} />}
              {quoteMeta && <div style={{ marginTop: 9 }}><ProvenanceLine meta={quoteMeta} /></div>}
              <div className="warning-box" style={{ marginTop: 11 }}>
                {licensedChart ? (
                  <>
                    <strong>Licensed REST snapshots.</strong> Global Datafeeds data is licensed for personal local display only. It is polled, not a tick stream, and must not be used for live order pricing, stop-loss triggers or broker reconciliation.
                  </>
                ) : (
                  <>
                    <strong>Public/delayed provider data.</strong> This is not a licensed exchange feed. Do not use it for live order pricing, stop-loss triggers or broker reconciliation.
                  </>
                )}
              </div>
              <div className="detail-grid" style={{ marginTop: 11 }}>
                <div className="detail-cell"><span>Last candle</span><strong>{formatDate(new Date((chart.data.bars.at(-1)?.t || Date.now())).toISOString())}</strong></div>
                <div className="detail-cell"><span>Max 2y drawdown</span><strong>{formatNumber(chart.data.summary.max_drawdown_2y?.pct, 2)}%</strong></div>
                <div className="detail-cell"><span>Closes used</span><strong>{closes.length}</strong></div>
                <div className="detail-cell"><span>Chart interval</span><strong>{chart.data.interval} / {chart.data.range}</strong></div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
