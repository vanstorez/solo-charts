"use client";

import Link from "next/link";

import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatNumber, timeAgo, titleCase } from "@/lib/format";
import type { BankNiftyScenario } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function AiSignalsPage() {
  const scenario = useApi<BankNiftyScenario>("/api/scenarios/banknifty", 120_000);
  const data = scenario.data;
  const available = data?.available === true;
  const plan = data?.scenarios?.find((item) => item.side === data.bias) || data?.scenarios?.find((item) => item.side === "neutral");
  const gates = [
    { label: "Provider data available", pass: Boolean(available), detail: "No signal is produced without a live provider response." },
    { label: "No-trade gate clear", pass: Boolean(data && !data.no_trade), detail: data?.no_trade ? (data.no_trade_reasons || []).join(" ") : "No data-quality gate is blocking the scenario." },
    { label: "A directional bias exists", pass: Boolean(data && data.bias !== "neutral"), detail: data?.bias === "neutral" ? "The model sees a mixed/range regime." : `Bias: ${titleCase(data?.bias)}` },
    {
      label: "Price action confirms the bias",
      pass: Boolean(data?.bias !== "neutral" && data?.price_confirmation?.status === "confirmed"),
      detail: data?.price_confirmation
        ? `${data.price_confirmation.label}: ${data.price_confirmation.passed}/${data.price_confirmation.total} checks.`
        : "No price-confirmation record is available."
    },
    { label: "Net R/R after costs ≥ 1.50", pass: Boolean(plan?.net_risk_reward && plan.net_risk_reward >= 1.5), detail: plan?.net_risk_reward ? `${plan.net_risk_reward.toFixed(2)}x` : "No conditional plan." },
    { label: "Research confidence ≥ 50%", pass: Boolean(data?.confidence && data.confidence >= 50), detail: data?.confidence ? `${data.confidence}%` : "Unavailable" },
    { label: "News context available", pass: Boolean(data?.data_quality?.news_meta?.status !== "unavailable"), detail: data?.data_quality?.news_meta?.detail || "No news metadata." }
  ];
  const blocked = gates.some((gate) => !gate.pass);

  return (
    <>
      <PageHeader
        kicker="Solo AI research gate"
        title="A decision record, not a trade instruction"
        subtitle="The signal gate combines the Bank Nifty scenario engine with explicit data-quality, news, confidence and cost checks. It cannot route an order."
        actions={<Link className="button" href="/bank-nifty">Open scenario desk</Link>}
      />

      {scenario.error && <ErrorNotice error={scenario.error} retry={scenario.refresh} />}
      {!data && scenario.loading && <LoadingBlock rows={6} label="Evaluating Bank Nifty research gates" />}

      {data && available && (
        <>
          <Panel style={{ marginBottom: 13 }}>
            <div className="big-bias">
              <div className={`big-bias-value ${blocked ? "neutral" : plan?.side === "bullish" ? "positive" : "negative"}`}>
                {blocked ? "NO TRADE" : "CANDIDATE"}
              </div>
              <div className="big-bias-meta">
                <span>{data.bias} bias · {data.confidence}% research confidence</span>
                <span>Generated {timeAgo(data.generated_at)}</span>
                <span>{blocked ? "One or more gates failed" : "All research gates passed. Still not advice."}</span>
              </div>
              <div className="badge-row" style={{ marginLeft: "auto" }}>
                <span className="badge warn">paper only</span>
                <span className="badge">live execution off</span>
              </div>
            </div>
            {blocked && <div className="warning-box" style={{ marginTop: 12 }}>The correct output is no trade when the evidence, freshness or cost-adjusted reward is insufficient. The gate is doing its job.</div>}
          </Panel>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            <Panel title="Gate checklist" kicker="Any failure blocks the candidate">
              <div className="risk-checks">
                {gates.map((gate) => (
                  <div className="risk-check" key={gate.label}>
                    <strong>{gate.label}</strong>
                    <span className={`state ${gate.pass ? "ok" : "breach"}`}>{gate.pass ? "PASS" : "BLOCK"}</span>
                    <span className="limit">{gate.detail}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Candidate plan" kicker={plan?.label || "No plan"}>
              {plan ? (
                <>
                  <p className="small muted">{plan.trigger}</p>
                  <div className="detail-grid" style={{ marginTop: 9 }}>
                    <div className="detail-cell"><span>Entry zone</span><strong>{plan.entry_zone ? `${formatNumber(plan.entry_zone[0], 2)} – ${formatNumber(plan.entry_zone[1], 2)}` : "—"}</strong></div>
                    <div className="detail-cell"><span>Stop</span><strong>{formatNumber(plan.stop, 2)}</strong></div>
                    <div className="detail-cell"><span>Targets</span><strong>{plan.targets.map((target) => formatNumber(target, 2)).join(" / ") || "—"}</strong></div>
                    <div className="detail-cell"><span>Net R/R</span><strong>{plan.net_risk_reward ? `${plan.net_risk_reward.toFixed(2)}x` : "—"}</strong></div>
                  </div>
                  <p className="small muted" style={{ marginTop: 9 }}>{plan.invalidation}</p>
                  <div className="form-actions">
                    <Link className="button primary" href="/paper">Simulate in paper book</Link>
                    <Link className="button ghost" href="/charts?symbol=BANKNIFTY">Check chart</Link>
                  </div>
                </>
              ) : (
                <p className="small muted">No candidate plan is available.</p>
              )}
            </Panel>
          </div>

          <Panel title="Decision rationale" kicker="Evidence before action">
            <div className="grid-2">
              <ul className="evidence-list">
                {(data.evidence || []).map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div>
                <div className="note-item">
                  <strong>Headline sentiment is not confirmation</strong>
                  <p>Even a strongly worded headline cannot open this gate. The scenario must also align the current snapshot, daily close versus 20-DMA, RSI and MACD. A contradicted or mixed price response blocks the candidate.</p>
                </div>
                <div className="note-item" style={{ marginTop: 7 }}>
                  <strong>What the agent may do</strong>
                  <p>Classify headlines, calculate scenarios, expose risk and record a paper decision with reasons.</p>
                </div>
                <div className="note-item" style={{ marginTop: 7 }}>
                  <strong>What it must not do</strong>
                  <p>It must not hide stale data, invent a probability, claim a 30–90 second edge without measurement, or submit a live broker order.</p>
                </div>
              </div>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
