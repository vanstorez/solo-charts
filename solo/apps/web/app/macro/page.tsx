"use client";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { QuoteTable } from "@/components/QuoteTable";
import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, titleCase, toneClass } from "@/lib/format";
import type { MacroResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function MacroPage() {
  const macro = useApi<MacroResponse>("/api/macro", 120_000);
  const data = macro.data;

  return (
    <>
      <PageHeader
        kicker="Global macro dashboard"
        title="Global-to-India transmission, not a macro crystal ball"
        subtitle="Dollar, rupee, US yields, crude, metals, global equities and NSE cash-market flows with descriptive correlations. A macro move is context; it is not a deterministic Bank Nifty signal."
        actions={<button className="button" onClick={macro.refresh} type="button">Refresh macro</button>}
      />

      {macro.error && <ErrorNotice error={macro.error} retry={macro.refresh} />}
      {!data && macro.loading && <LoadingBlock rows={7} label="Loading macro quotes and 90-session correlations" />}

      {data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Risk regime</div>
              <div className={`stat-value ${data.risk_regime.score > 0.75 ? "positive" : data.risk_regime.score < -0.75 ? "negative" : "neutral"}`} style={{ fontSize: 21 }}>{data.risk_regime.label}</div>
              <div className="stat-foot"><span className="mono">score {formatNumber(data.risk_regime.score, 2)}</span></div>
            </div>
            {data.groups.slice(0, 3).map((group) => (
              <div className="stat-card" key={group.key}>
                <div className="stat-label">{group.label}</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{group.instruments[0]?.short ?? "—"}</div>
                <div className="stat-foot">
                  <span className={toneClass(group.instruments[0]?.change)}>{formatPct(group.instruments[0]?.change)}</span>
                  <span>{group.instruments.length} instruments</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            <Panel title="Macro tape" kicker="All values from provider snapshots" action={data.macro_meta ? <FreshnessBadge meta={data.macro_meta} /> : null}>
              {data.groups.map((group) => (
                <div key={group.key} style={{ marginBottom: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>{group.label}</div>
                  <QuoteTable quotes={group.instruments} compact />
                  <p className="small muted" style={{ margin: "5px 0 0" }}>{group.context}</p>
                </div>
              ))}
              <ProvenanceLine meta={data.macro_meta} />
            </Panel>

            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <Panel title="Bank Nifty correlations" kicker="Descriptive, regime-dependent">
                <div className="correlation-grid">
                  {Object.entries(data.correlations).map(([key, entry]) => (
                    <div className="correlation-item" key={key}>
                      <div>
                        <strong>{key}</strong>
                        <div className="small muted">n={entry.sample} · {entry.window}</div>
                      </div>
                      <span className={toneClass(entry.correlation)}>{entry.correlation === null ? "—" : entry.correlation.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}><ProvenanceLine meta={data.correlation_meta} /></div>
                <p className="small muted" style={{ marginTop: 8 }}>Correlation measures co-movement in the selected sample. It does not establish causality and can flip across regimes.</p>
              </Panel>

              <Panel title="Risk regime contributors" kicker="Heuristic snapshot">
                <div className="regime">
                  <div>
                    <div className="regime-value">{data.risk_regime.label}</div>
                    <div className="small muted">{data.risk_regime.note}</div>
                  </div>
                  <div className="regime-score">score<br />{formatNumber(data.risk_regime.score, 2)}</div>
                </div>
                <div className="badge-row" style={{ marginTop: 10 }}>
                  {data.risk_regime.contributors.map((item) => (
                    <span className={`badge ${item.change > 0 ? "accent" : item.change < 0 ? "warn" : ""}`} key={item.key}>
                      {item.key} {formatPct(item.change)}
                    </span>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <Panel
            title="Institutional cash flows"
            kicker="NSE FII/FPI and DII provisional flows · INR crore"
            action={data.flows?.meta ? <FreshnessBadge meta={data.flows.meta} /> : null}
            style={{ marginBottom: 13 }}
          >
            {data.flows?.available ? (
              <>
                <div className="flow-grid">
                  {data.flows.summary.map((item) => (
                    <div className="flow-item" key={item.category}>
                      <div className="flow-item-head">
                        <span>{item.category}</span>
                        <span className={item.net > 0 ? "positive" : item.net < 0 ? "negative" : "neutral"}>
                          {item.direction}
                        </span>
                      </div>
                      <div className={`flow-net ${item.net > 0 ? "positive" : item.net < 0 ? "negative" : "neutral"}`}>
                        {item.net > 0 ? "+" : item.net < 0 ? "−" : ""}₹{formatNumber(Math.abs(item.net), 2)} cr
                      </div>
                      <div className="flow-buy-sell">
                        <span>Buy ₹{formatNumber(item.buy, 2)} cr</span>
                        <span>Sell ₹{formatNumber(item.sell, 2)} cr</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="detail-grid" style={{ marginTop: 10 }}>
                  <div className="detail-cell"><span>Trade date supplied by NSE</span><strong>{data.flows.reported_date || "unknown"}</strong></div>
                  <div className="detail-cell"><span>Values</span><strong>Provisional cash market</strong></div>
                  <div className="detail-cell"><span>Derivatives positioning</span><strong>Not included</strong></div>
                  <div className="detail-cell"><span>Source</span><strong>{data.flows.source_url ? <a href={data.flows.source_url} rel="noreferrer" target="_blank">NSE India ↗</a> : "NSE India"}</strong></div>
                </div>
                <div style={{ marginTop: 10 }}><ProvenanceLine meta={data.flows.meta} /></div>
                <div className="warning-box" style={{ marginTop: 10 }}>{data.flows.note}</div>
              </>
            ) : (
              <div className="warning-box">
                <strong>FII/DII feed unavailable.</strong>
                <p>{data.flows?.note || "No flow values are substituted."}</p>
                {data.flows?.source_url && <p><a href={data.flows.source_url} rel="noreferrer" target="_blank">Check the official NSE page ↗</a></p>}
              </div>
            )}
          </Panel>

          <div className="grid-2">
            <Panel title="Transmission watch" kicker="What is happening → why it matters → what confirms it">
              <div className="note-list">
                {data.transmission_notes.map((note) => (
                  <div className="note-item" key={note.channel}>
                    <strong>{note.channel} · confidence {note.confidence}</strong>
                    <p><b>Observed:</b> {note.observation}</p>
                    <p style={{ marginTop: 4 }}><b>Why it may matter:</b> {note.effect}</p>
                    <p style={{ marginTop: 4 }}><b>Confirmation:</b> {note.confirm}</p>
                    <p style={{ marginTop: 4 }}><b>Invalidation:</b> {note.invalidate}</p>
                    <p className="small muted" style={{ marginTop: 4 }}><b>Watch:</b> {note.watch}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Global context" kicker="No single-variable causal claims">
              <div className="detail-grid">
                <div className="detail-cell"><span>Macro provider</span><strong>{data.macro_meta.provider}</strong></div>
                <div className="detail-cell"><span>As of</span><strong>{timeAgo(data.macro_meta.as_of)}</strong></div>
                <div className="detail-cell"><span>Correlation source</span><strong>{data.correlation_meta.provider}</strong></div>
                <div className="detail-cell"><span>Correlation state</span><strong>{data.correlation_meta.status}</strong></div>
              </div>
              <div className="warning-box" style={{ marginTop: 11 }}>
                {data.note} The policy/event feed is on the Breaking News page; a macro print and a headline can conflict. When they do, the terminal should show uncertainty rather than choose a narrative.
              </div>
              <div className="badge-row" style={{ marginTop: 10 }}>
                <span className="badge accent">USD/INR</span>
                <span className="badge">US 10Y</span>
                <span className="badge">Brent</span>
                <span className="badge">Gold</span>
                <span className="badge">US equities</span>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
