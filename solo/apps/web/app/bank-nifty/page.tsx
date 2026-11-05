"use client";

import Link from "next/link";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDateTime, formatNumber, formatPct, timeAgo, titleCase, toneClass } from "@/lib/format";
import type { BankNiftyScenario } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function ScenarioCard({ plan, active }: { plan: NonNullable<BankNiftyScenario["scenarios"]>[number]; active: boolean }) {
  const tone = plan.side === "bullish" ? "bullish" : plan.side === "bearish" ? "bearish" : "neutral";
  return (
    <article className={`scenario-card ${tone} ${active ? "active" : ""}`}>
      <div className="scenario-card-head">
        <h3>{plan.label}</h3>
        <span className="scenario-confidence">{plan.confidence}% conf.</span>
      </div>
      <p className="scenario-trigger">{plan.trigger}</p>
      {plan.entry_zone ? (
        <dl className="level-list">
          <dt>Entry zone</dt><dd>{formatNumber(plan.entry_zone[0], 2)} – {formatNumber(plan.entry_zone[1], 2)}</dd>
          <dt>Stop</dt><dd>{formatNumber(plan.stop, 2)}</dd>
          <dt>Target 1</dt><dd>{formatNumber(plan.targets[0], 2)}</dd>
          <dt>Target 2</dt><dd>{formatNumber(plan.targets[1], 2)}</dd>
          <dt>Gross R/R</dt><dd>{plan.gross_risk_reward ? `${plan.gross_risk_reward.toFixed(2)}x` : "—"}</dd>
          <dt>Net R/R after costs</dt><dd>{plan.net_risk_reward ? `${plan.net_risk_reward.toFixed(2)}x` : "—"}</dd>
        </dl>
      ) : (
        <p className="small muted">No entry zone. The scenario desk stands aside rather than forcing a trade.</p>
      )}
      <p className="small muted"><strong>Invalidation:</strong> {plan.invalidation}</p>
      <ul className="evidence-list">
        {plan.evidence.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
      </ul>
      {plan.notes && <p className="small muted">{plan.notes}</p>}
    </article>
  );
}

export default function BankNiftyPage() {
  const scenario = useApi<BankNiftyScenario>("/api/scenarios/banknifty", 120_000);
  const data = scenario.data;
  const available = data?.available === true;
  const quality = data?.data_quality;

  return (
    <>
      <PageHeader
        kicker="Bank Nifty intelligence"
        title="Conditional scenarios, not predictions"
        subtitle="Evidence-led bullish, bearish and no-trade cases built from daily candles, macro transmission inputs and headline risk. Every level is conditional."
        actions={
          <>
            <button className="button" onClick={scenario.refresh} type="button">Recalculate</button>
            <Link className="button ghost" href="/charts?symbol=BANKNIFTY">Open Bank Nifty chart</Link>
          </>
        }
      />

      {scenario.error && <ErrorNotice error={scenario.error} retry={scenario.refresh} />}
      {!data && scenario.loading && <LoadingBlock rows={8} label="Loading Bank Nifty candles, macro tape and news context" />}

      {data && !available && (
        <EmptyState title="Scenario desk unavailable">{data.reason || "The required provider data is not available."}</EmptyState>
      )}

      {available && data && (
        <>
          <Panel style={{ marginBottom: 13 }}>
            <div className="big-bias">
              <div className={`big-bias-value ${data.bias === "bullish" ? "positive" : data.bias === "bearish" ? "negative" : "neutral"}`}>
                {titleCase(data.bias)}
              </div>
              <div className="big-bias-meta">
                <span>{data.confidence}% research confidence · not a probability</span>
                <span>Trend {data.pattern?.trend} · score {data.pattern?.score}/6</span>
                <span>Generated {timeAgo(data.generated_at)}</span>
                <span>{data.no_trade ? "NO-TRADE GATE ACTIVE" : "CONDITIONAL SETUP GATE OPEN"}</span>
              </div>
              <div className="badge-row" style={{ marginLeft: "auto" }}>
                <span className={`badge ${data.no_trade ? "warn" : "accent"}`}>{data.no_trade ? "stand aside" : "conditional"}</span>
                <span className="badge">paper research</span>
              </div>
            </div>
            {data.no_trade && (
              <div className="warning-box" style={{ marginTop: 12 }}>
                <strong>No-trade reasons:</strong> {data.no_trade_reasons?.join(" ") || "One or more data-quality gates failed."}
              </div>
            )}
            <div className="grid-4" style={{ marginTop: 13 }}>
              <div className="kpi"><div className="kpi-label">Bank Nifty</div><div className="kpi-value">{formatNumber(data.pattern?.close, 2)}</div></div>
              <div className="kpi"><div className="kpi-label">RSI(14)</div><div className="kpi-value">{formatNumber(data.pattern?.rsi, 1)}</div></div>
              <div className="kpi"><div className="kpi-label">Macro tilt</div><div className={`kpi-value ${toneClass(data.macro_tilt)}`}>{formatNumber(data.macro_tilt, 2)}</div></div>
              <div className="kpi"><div className="kpi-label">News tilt</div><div className={`kpi-value ${toneClass(data.news_tilt)}`}>{formatNumber(data.news_tilt, 2)}</div></div>
            </div>
            {data.price_confirmation && (
              <div className={`price-confirmation ${data.price_confirmation.status}`} style={{ marginTop: 13 }}>
                <div className="price-confirmation-head">
                  <strong>{data.price_confirmation.label}</strong>
                  <span>
                    {data.price_confirmation.passed}/{data.price_confirmation.total} checks · snapshot{" "}
                    {data.price_confirmation.as_of ? formatDateTime(data.price_confirmation.as_of) : "timestamp unknown"}
                  </span>
                </div>
                <div className="confirmation-checks">
                  {data.price_confirmation.checks.map((check) => (
                    <span
                      className={`confirmation-check ${check.passed === true ? "pass" : check.passed === false ? "fail" : "unknown"}`}
                      key={check.label}
                    >
                      <strong>{check.passed === true ? "PASS" : check.passed === false ? "FAIL" : "N/A"}</strong>
                      {check.detail}
                    </span>
                  ))}
                </div>
                <p>{data.price_confirmation.note}</p>
              </div>
            )}
          </Panel>

          <div className="scenario-grid" style={{ marginBottom: 13 }}>
            {(data.scenarios || []).map((plan) => (
              <ScenarioCard active={plan.side === data.bias} key={plan.side} plan={plan} />
            ))}
          </div>

          <div className="grid-2">
            <Panel title="Evidence ledger" kicker="What the model saw">
              <ul className="evidence-list">
                {(data.evidence || []).map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div className="warning-box" style={{ marginTop: 12 }}>
                {data.disclaimer}
              </div>
            </Panel>

            <Panel title="News context" kicker="Headline tone is not measured impact">
              {data.news_watch && data.news_watch.length > 0 ? (
                <div>
                  {data.news_watch.map((item) => (
                    <div className="note-item" key={`${item.headline}-${item.published_at}`} style={{ marginBottom: 7 }}>
                      <strong>{item.event_label} · {item.verification}</strong>
                      <p>{item.headline}</p>
                      <div className="news-meta" style={{ marginTop: 5 }}>
                        <span>{formatDateTime(item.published_at)}</span>
                        <span>mapped {item.mapped_direction.map(titleCase).join(" / ") || "uncertain"}</span>
                        <span>price {item.price_confirmation}</span>
                        <span>attention {item.attention_score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No mapped headline risk">No current headline could be mapped to Bank Nifty/Nifty with a defensible direction. That is not the same as no risk.</EmptyState>
              )}
            </Panel>
          </div>

          <Panel title="Data quality & assumptions" kicker="Read before using any level" style={{ marginTop: 13 }}>
            <div className="grid-2">
              <div>
                {quality?.chart_meta && <ProvenanceLine meta={quality.chart_meta} />}
                {quality?.quote_meta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={quality.quote_meta} /></div>}
                {quality?.news_meta && <div style={{ marginTop: 8 }}><ProvenanceLine meta={quality.news_meta} /></div>}
              </div>
              <div className="detail-grid">
                <div className="detail-cell"><span>Bars in sample</span><strong>{quality?.bars ?? "—"}</strong></div>
                <div className="detail-cell"><span>Holiday calendar</span><strong>{titleCase(quality?.holiday_calendar)}</strong></div>
                <div className="detail-cell"><span>Cost per side</span><strong>{formatNumber(Number(data.assumptions?.cost_bps_per_side), 1)} bps</strong></div>
                <div className="detail-cell"><span>Confidence</span><strong>{data.confidence}%</strong></div>
              </div>
            </div>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <div className="note-item"><strong>Levels are conditional</strong><p>Trigger, entry, stop and targets are calculated from available candles. They are not pending orders.</p></div>
              <div className="note-item"><strong>Gaps ignore stops</strong><p>A gap can fill far beyond a stop. Position sizing must account for gap risk.</p></div>
              <div className="note-item"><strong>News is not a fact-check</strong><p>Google News source labels are not independent confirmation. The scenario reduces confidence but never treats a headline as proof.</p></div>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
