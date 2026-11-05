"use client";

import Link from "next/link";

import { NewsEventCard } from "@/components/NewsEventCard";
import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { QuoteTable } from "@/components/QuoteTable";
import { Sparkline } from "@/components/Sparkline";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel, StatCard } from "@/components/Ui";
import { formatDateTime, formatNumber, formatPct, timeAgo, titleCase, toneClass } from "@/lib/format";
import type { BankNiftyScenario, ChartResponse, NewsResponse, Overview } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function OverviewPage() {
  const overview = useApi<Overview>("/api/overview", 20_000);
  const news = useApi<NewsResponse>("/api/news?limit=6", 120_000);
  const scenario = useApi<BankNiftyScenario>("/api/scenarios/banknifty", 120_000);
  const niftyChart = useApi<ChartResponse>("/api/chart?symbol=NIFTY&interval=1d&range=3mo", 120_000);

  const indices = overview.data?.indices ?? [];
  const macro = overview.data?.macro ?? [];
  const scenarioValue = scenario.data?.available ? scenario.data : null;
  const niftyCloses = niftyChart.data?.bars.map((bar) => bar.c) ?? [];
  const quoteMeta = overview.data?.quote_meta;
  const newsMeta = news.data?.meta;
  const scenarioMeta = scenarioValue?.data_quality?.chart_meta;

  return (
    <>
      <PageHeader
        kicker="Solo intelligence overview"
        title="One screen. Every claim sourced."
        subtitle="Indian market pulse, event radar and conditional research. Data quality is part of the signal — missing feeds stay missing."
        actions={
          <>
            <Link className="button primary" href="/charts">Open charts</Link>
            <Link className="button" href="/news">Event radar</Link>
            <Link className="button ghost" href="/lag-lab">Lag lab</Link>
          </>
        }
      />

      {overview.error && <ErrorNotice error={overview.error} retry={overview.refresh} />}
      {overview.loading && !overview.data && <LoadingBlock rows={4} label="Connecting to market and macro providers" />}

      {overview.data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            {indices.map((quote) => (
              <StatCard
                key={quote.key}
                label={`${quote.name} · ${quote.exchange}`}
                value={quote.value === null ? "—" : `${quote.currency === "INR" && quote.key !== "INDIAVIX" ? "₹" : ""}${formatNumber(quote.value, 2)}`}
                change={formatPct(quote.change)}
                tone={toneClass(quote.change)}
                sub={quote.source.includes("TradingView") ? "provider snapshot" : quote.source}
              />
            ))}
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            <Panel
              title="Market pulse"
              kicker="Provenance-aware quote tape"
              action={quoteMeta ? <FreshnessBadge meta={quoteMeta} /> : null}
            >
              <QuoteTable quotes={indices} compact />
              <div className="table-scroll" style={{ marginTop: 10 }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Macro input</th>
                      <th className="num">Last</th>
                      <th className="num">Change</th>
                      <th>Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macro.map((quote) => (
                      <tr key={quote.key}>
                        <td><span className="symbol-cell"><strong>{quote.short}</strong><span>{quote.name}</span></span></td>
                        <td className="num mono">{formatNumber(quote.value, 2)}</td>
                        <td className={`num mono ${toneClass(quote.change)}`}>{formatPct(quote.change)}</td>
                        <td className="muted">{quote.currency === "%" ? "yield" : quote.currency === "INR" ? "rupee pair" : "global"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {quoteMeta && <div style={{ marginTop: 11 }}><ProvenanceLine meta={quoteMeta} /></div>}
            </Panel>

            <Panel
              title="Bank Nifty conditional bias"
              kicker="Research — not a probability"
              action={scenario.loading ? <span className="no-data">updating...</span> : <Link className="stat-link" href="/bank-nifty">Scenario desk →</Link>}
            >
              {scenario.error && <ErrorNotice error={scenario.error} retry={scenario.refresh} />}
              {!scenario.data && scenario.loading && <LoadingBlock rows={3} label="Calculating scenarios from daily candles" />}
              {scenarioValue && (
                <>
                  <div className="big-bias" style={{ marginBottom: 12 }}>
                    <div className={`big-bias-value ${scenarioValue.bias === "bullish" ? "positive" : scenarioValue.bias === "bearish" ? "negative" : "neutral"}`}>
                      {titleCase(scenarioValue.bias)}
                    </div>
                    <div className="big-bias-meta">
                      <span>{scenarioValue.confidence}% research confidence</span>
                      <span>{scenarioValue.no_trade ? "No-trade gate active" : "Conditional setup gate open"}</span>
                      <span>Generated {timeAgo(scenarioValue.generated_at)}</span>
                    </div>
                  </div>
                  {scenarioValue.no_trade && (
                    <div className="warning-box" style={{ marginBottom: 10 }}>
                      <strong>No-trade conditions:</strong> {scenarioValue.no_trade_reasons?.join(" ")}
                    </div>
                  )}
                  <div className="kpi-grid">
                    <div className="kpi"><div className="kpi-label">Trend score</div><div className="kpi-value">{scenarioValue.pattern?.score}/6 · {scenarioValue.pattern?.trend}</div></div>
                    <div className="kpi"><div className="kpi-label">RSI 14</div><div className="kpi-value">{formatNumber(scenarioValue.pattern?.rsi, 1)}</div></div>
                    <div className="kpi"><div className="kpi-label">Macro tilt</div><div className={`kpi-value ${toneClass(scenarioValue.macro_tilt)}`}>{formatNumber(scenarioValue.macro_tilt, 2)}</div></div>
                  </div>
                  <div className="detail-grid" style={{ marginTop: 10 }}>
                    <div className="detail-cell"><span>20-session range</span><strong>{formatNumber(scenarioValue.pattern?.low20, 2)} – {formatNumber(scenarioValue.pattern?.high20, 2)}</strong></div>
                    <div className="detail-cell"><span>ATR(14)</span><strong>{formatNumber(scenarioValue.pattern?.atr, 2)}</strong></div>
                  </div>
                  {scenarioValue.data_quality?.chart_meta?.detail && (
                    <p className="small muted" style={{ margin: "10px 0 0" }}>{scenarioValue.data_quality.chart_meta.detail}</p>
                  )}
                </>
              )}
            </Panel>
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            <Panel
              title="Nifty 50 · 3-month context"
              kicker="Daily close proxy"
              action={niftyChart.data ? <FreshnessBadge meta={niftyChart.data.meta} compact /> : null}
            >
              {niftyChart.error && <ErrorNotice error={niftyChart.error} retry={niftyChart.refresh} />}
              {!niftyChart.data && niftyChart.loading && <LoadingBlock rows={3} label="Loading daily candles" />}
              {niftyChart.data && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="stat-value" style={{ fontSize: 24 }}>₹{formatNumber(niftyChart.data.daily_close, 2)}</div>
                    <div className="stat-foot">
                      <span className={`delta ${toneClass(niftyChart.data.summary.change)}`}>{formatPct(niftyChart.data.summary.change)}</span>
                      <span>daily session</span>
                    </div>
                  </div>
                  <Sparkline values={niftyCloses} width={260} height={58} />
                </div>
              )}
              {niftyChart.data && (
                <div className="grid-3" style={{ marginTop: 12 }}>
                  <div className="kpi"><div className="kpi-label">RSI 14</div><div className="kpi-value">{formatNumber(niftyChart.data.summary.rsi14, 1)}</div></div>
                  <div className="kpi"><div className="kpi-label">ATR %</div><div className="kpi-value">{formatNumber(niftyChart.data.summary.atr_pct, 2)}%</div></div>
                  <div className="kpi"><div className="kpi-label">Rating</div><div className="kpi-value">{titleCase(niftyChart.data.summary.rating)}</div></div>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Link className="stat-link" href="/charts?symbol=NIFTY">Open the candle workspace →</Link>
              </div>
            </Panel>

            <Panel
              title="Latest event radar"
              kicker="Headlines with timestamps and source labels"
              action={<Link className="stat-link" href="/news">All events →</Link>}
            >
              {news.error && <ErrorNotice error={news.error} retry={news.refresh} />}
              {!news.data && news.loading && <LoadingBlock rows={4} label="Aggregating verified-source feeds" />}
              {news.data && news.data.events.length === 0 && (
                <EmptyState title="No headlines returned">The feed is unavailable or empty. The terminal does not substitute sample headlines.</EmptyState>
              )}
              {news.data?.events.map((event) => (
                <NewsEventCard event={event} compact key={event.id} />
              ))}
              {newsMeta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={newsMeta} /></div>}
            </Panel>
          </div>

          <Panel title="Trust & guardrails" kicker="What the terminal will not do">
            <div className="grid-3">
              <div className="note-item">
                <strong>No assumed 30–90 second lag</strong>
                <p>The Event-Lag Lab measures a relationship and reports sample size and uncertainty. It never labels a delay as a guaranteed opportunity.</p>
              </div>
              <div className="note-item">
                <strong>No hidden stale data</strong>
                <p>Every module displays the provider, source type, timestamp and freshness. A missing Provider remains missing.</p>
              </div>
              <div className="note-item">
                <strong>No live broker execution</strong>
                <p>Paper trades are simulated with configured slippage and fees. Live execution is hard-disabled until broker and regulatory prerequisites are verified.</p>
              </div>
            </div>
            <div className="grid-3" style={{ marginTop: 10 }}>
              <div className="detail-cell"><span>Market session</span><strong>{overview.data.market_session.state} · {overview.data.market_session.reason}</strong></div>
              <div className="detail-cell"><span>Last terminal refresh</span><strong>{formatDateTime(overview.lastUpdated?.toISOString())}</strong></div>
              <div className="detail-cell"><span>Data mode</span><strong>Research + paper only</strong></div>
            </div>
            {scenarioMeta && <div style={{ marginTop: 11 }}><ProvenanceLine meta={scenarioMeta} /></div>}
          </Panel>
        </>
      )}
    </>
  );
}
