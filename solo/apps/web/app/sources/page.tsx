"use client";

import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDateTime, timeAgo, titleCase } from "@/lib/format";
import type { SourceCatalog } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function SourcesPage() {
  const sources = useApi<SourceCatalog>("/api/sources", 60_000);
  const data = sources.data;

  return (
    <>
      <PageHeader
        kicker="Data sources & provenance"
        title="Know what is actually connected"
        subtitle="Each provider is shown with its access path, freshness contract, current health and limitations. Missing, unreachable or non-configured data stays visible."
        actions={<button className="button" onClick={sources.refresh} type="button">Recheck sources</button>}
      />

      {sources.error && <ErrorNotice error={sources.error} retry={sources.refresh} />}
      {!data && sources.loading && <LoadingBlock rows={7} label="Checking configured providers and adapter health" />}

      {data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card"><div className="stat-label">Live execution</div><div className="stat-value negative" style={{ fontSize: 20 }}>DISABLED</div><div className="stat-foot"><span>hard-coded off</span></div></div>
            <div className="stat-card"><div className="stat-label">Sources listed</div><div className="stat-value">{data.sources.length}</div><div className="stat-foot"><span>including unavailable</span></div></div>
            <div className="stat-card"><div className="stat-label">Audit chain</div><div className={`stat-value ${data.audit_chain_valid ? "positive" : "negative"}`} style={{ fontSize: 22 }}>{data.audit_chain_valid ? "Valid" : "Broken"}</div><div className="stat-foot"><span>local SQLite</span></div></div>
            <div className="stat-card"><div className="stat-label">Policy</div><div className="stat-value" style={{ fontSize: 17 }}>No fake data</div><div className="stat-foot"><span>unavailable stays unavailable</span></div></div>
          </div>

          <div className="alert notice info" style={{ marginBottom: 13 }}>
            <div><strong>Source policy.</strong><p>{data.policy} Live execution remains disabled. {data.generated_at && `Checked ${timeAgo(data.generated_at)}.`}</p></div>
          </div>

          <div className="grid-2" style={{ marginBottom: 13 }}>
            {data.sources.map((source) => (
              <Panel key={source.key} title={source.name} kicker={titleCase(source.category)} action={<span className={`source-status ${source.status}`}>{source.status}</span>}>
                <div className="source-card">
                  <div className="source-facts">
                    <strong>Access</strong><span>{source.access}</span>
                    <strong>Freshness</strong><span>{source.freshness}</span>
                    <strong>Capabilities</strong><span>{source.capabilities.length > 0 ? source.capabilities.join(" · ") : "none in this build"}</span>
                    {source.health && (
                      <>
                        <strong>Health</strong><span>{source.health.status} · {source.health.successes} successes / {source.health.failures} failures</span>
                        <strong>Last success</strong><span>{source.health.last_success_at ? `${timeAgo(source.health.last_success_at)} (${formatDateTime(source.health.last_success_at)})` : "—"}</span>
                        <strong>Last error</strong><span>{source.health.last_error || "—"}</span>
                      </>
                    )}
                  </div>
                  {source.notes && <p>{source.notes}</p>}
                  {source.detail && (
                    <div className="detail-grid">
                      <div className="detail-cell"><span>Adapter state</span><strong>{source.detail.state || "unknown"}</strong></div>
                      {"available" in source.detail && (
                        <div className="detail-cell"><span>Reachable</span><strong>{source.detail.available ? "yes" : "no"}</strong></div>
                      )}
                      {"configured" in source.detail && (
                        <div className="detail-cell"><span>Configured</span><strong>{source.detail.configured ? "yes" : "no"}</strong></div>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            ))}
          </div>

          <div className="grid-2">
            <Panel title="Provider health register" kicker="Process-local observations">
              {data.provider_health.length === 0 ? (
                <div className="empty-trades">No provider calls have been made since this API process started.</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead><tr><th>Provider</th><th>Status</th><th className="num">OK</th><th className="num">Fail</th><th>Last success</th><th>Last error</th></tr></thead>
                    <tbody>
                      {data.provider_health.map((item) => item && (
                        <tr key={item.name}>
                          <td><strong>{item.name}</strong></td>
                          <td><span className={`source-status ${item.status}`}>{item.status}</span></td>
                          <td className="num mono">{item.successes}</td>
                          <td className="num mono">{item.failures}</td>
                          <td className="mono small">{item.last_success_at ? timeAgo(item.last_success_at) : "—"}</td>
                          <td className="small muted" title={item.last_error || ""}>{item.last_error ? `${item.last_error.slice(0, 80)}…` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="small muted" style={{ marginTop: 9 }}>Health is in-process and resets when the API restarts. It is not a substitute for an external monitoring system.</p>
            </Panel>

            <Panel title="Non-negotiable data rules" kicker="Why this page exists">
              <div className="note-list">
                <div className="note-item"><strong>Provider timestamp first</strong><p>A provider’s exchange time, publication time, local fetch time and local first-seen time are different fields. They are not collapsed into one “live” label.</p></div>
                <div className="note-item"><strong>Unofficial public feeds</strong><p>TradingView scanner, Yahoo Finance and Google News RSS are used as research inputs. Review provider terms before production use. They are not licensed exchange feeds.</p></div>
                <div className="note-item"><strong>Prediction markets fail closed</strong><p>If Polymarket is unreachable, the Event-Lag Lab shows the failure and refuses to invent a market or probability.</p></div>
                <div className="note-item"><strong>Execution is a separate system</strong><p>No source on this page enables live trading. Broker authorization, order-state reconciliation, SEBI/exchange compliance and operational controls are out of scope for this build.</p></div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
