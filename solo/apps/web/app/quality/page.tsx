"use client";

import Link from "next/link";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDateTime, formatNumber, timeAgo, titleCase } from "@/lib/format";
import type { QualityResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function statusLabel(status: string): string {
  return status === "ok" ? "OK" : status === "warn" ? "WATCH" : status === "error" ? "FAIL" : status.toUpperCase();
}

export default function QualityPage() {
  const quality = useApi<QualityResponse>("/api/quality", 45_000);
  const data = quality.data;
  const licensed = data?.licensed_feed;
  const licensedVerified = licensed?.state === "verified";
  const licensedConfigured = Boolean(licensed?.configured);

  return (
    <>
      <PageHeader
        kicker="Data quality & verification"
        title="A signal is only as good as its timestamp"
        subtitle="Cross-check index snapshots against a second public provider, inspect feed freshness and provider health, and see exactly where this build lacks exchange-grade data."
        actions={
          <>
            <button className="button" onClick={quality.refresh} type="button">Run quality check</button>
            <Link className="button ghost" href="/sources">Provider catalog</Link>
          </>
        }
      />

      {quality.error && <ErrorNotice error={quality.error} retry={quality.refresh} />}
      {!data && quality.loading && <LoadingBlock rows={6} label="Comparing provider snapshots and checking audit integrity" />}

      {data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Overall quality</div>
              <div className={`stat-value ${data.overall === "ok" ? "positive" : data.overall === "degraded" || data.overall === "unavailable" ? "negative" : "warning"}`} style={{ fontSize: 20 }}>{data.overall.toUpperCase()}</div>
              <div className="stat-foot"><span>value + provenance review</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Feed timestamp</div>
              <div className="stat-value" style={{ fontSize: 17 }}>{data.quote_meta.freshness === "unknown" ? "UNKNOWN" : data.quote_meta.freshness.toUpperCase()}</div>
              <div className="stat-foot"><span>{data.quote_meta.provider}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Cross-checks</div>
              <div className="stat-value">{data.cross_checks.filter((row) => row.state === "consistent").length}/{data.cross_checks.length}</div>
              <div className="stat-foot"><span>within 0.25% of Yahoo</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Last checked</div>
              <div className="stat-value" style={{ fontSize: 17 }}>{timeAgo(data.generated_at)}</div>
              <div className="stat-foot"><span>{formatDateTime(data.generated_at)}</span></div>
            </div>
          </div>

          <Panel title="Freshness vocabulary" kicker="FRESH is not the same as exchange-live" style={{ marginBottom: 13 }}>
            <div className="freshness-legend">
              <div className="freshness-legend-item">
                <span className="freshness-badge fresh"><span className="freshness-dot" />LIVE</span>
                <p>Only used when a licensed provider supplies an exchange timestamp and a verified zero-delay contract. It still describes a polled snapshot, never a tick-by-tick stream.</p>
              </div>
              <div className="freshness-legend-item">
                <span className="freshness-badge fresh"><span className="freshness-dot" />FRESH</span>
                <p>Received inside the provider's local freshness window. If the provider supplies no exchange timestamp, this is <strong>not</strong> a live-price claim.</p>
              </div>
              <div className="freshness-legend-item">
                <span className="freshness-badge aging"><span className="freshness-dot" />AGING</span>
                <p>Older than the preferred window but still inside the stale threshold. Treat it as delayed context.</p>
              </div>
              <div className="freshness-legend-item">
                <span className="freshness-badge stale"><span className="freshness-dot" />STALE</span>
                <p>Beyond the stale threshold. Do not use it as an execution price or as proof of a current move.</p>
              </div>
              <div className="freshness-legend-item">
                <span className="freshness-badge unknown"><span className="freshness-dot" />TIMESTAMP N/A</span>
                <p>The provider value exists, but its observation time is unknown. The terminal will not invent one.</p>
              </div>
              <div className="freshness-legend-item">
                <span className="freshness-badge unavailable"><span className="freshness-dot" />UNAVAILABLE</span>
                <p>No usable value. The feature fails closed and shows the reason instead of substituting a number.</p>
              </div>
            </div>
            <div className="warning-box" style={{ marginTop: 11 }}>
              {licensedVerified ? (
                <>
                  <strong>Licensed Global Datafeeds feed verified for personal local display.</strong> The vendor reports zero declared exchange delay; quotes are still polled REST snapshots, not a tick feed. The top-bar label reads <span className="mono">GDF LICENSED · LIVE SNAPSHOT</span>. This is not an execution-grade consolidated tape.
                </>
              ) : licensedConfigured ? (
                <>
                  <strong>Licensed feed configured, but not yet verified.</strong> The terminal will not call it live until the vendor entitlement and delay contract are confirmed. Current label: <span className="mono">GDF CONFIGURED · VERIFYING</span>.
                </>
              ) : (
                <>
                  <strong>No exchange-grade real-time feed is connected.</strong> Every quote, news item and flow print must be read with its source, timestamp and delay provenance. The top-bar label remains <span className="mono">PUBLIC DATA · DELAYED / UNKNOWN</span> rather than claiming “live”.
                </>
              )}
            </div>
          </Panel>

          {licensed && (
            <Panel
              title="Licensed feed contract"
              kicker="Global Datafeeds · personal local display"
              action={<span className={`source-status ${licensed.state}`}>{licensed.state}</span>}
              style={{ marginBottom: 13 }}
            >
              <div className="detail-grid">
                <div className="detail-cell"><span>Configured</span><strong>{licensed.configured ? "yes" : "no"}</strong></div>
                <div className="detail-cell"><span>Transport</span><strong>{licensed.transport}</strong></div>
                <div className="detail-cell"><span>Declared delay</span><strong>{licensed.delay_seconds === null ? "unknown" : `${licensed.delay_seconds}s`}</strong></div>
                <div className="detail-cell"><span>Endpoint host</span><strong>{licensed.base_host || "not set"}</strong></div>
                <div className="detail-cell"><span>Access key</span><strong>{licensed.has_api_key ? "present server-side" : "missing"}</strong></div>
                <div className="detail-cell"><span>Last entitlement check</span><strong>{licensed.last_checked_at ? timeAgo(licensed.last_checked_at) : "not run"}</strong></div>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>{licensed.detail}</p>
              {licensed.entitlement?.exchanges?.length ? (
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="data-table compact">
                    <thead><tr><th>Exchange</th><th className="num">Declared delay</th><th className="num">Allowed instruments</th></tr></thead>
                    <tbody>
                      {licensed.entitlement.exchanges.map((exchange) => (
                        <tr key={exchange.name}>
                          <td><strong>{exchange.name}</strong></td>
                          <td className="num mono">{exchange.data_delay_seconds === null ? "unknown" : `${exchange.data_delay_seconds}s`}</td>
                          <td className="num mono">{exchange.allowed_instruments ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="warning-box" style={{ marginTop: 10 }}>
                {licensed.limitations.join(" ")}
              </div>
            </Panel>
          )}

          <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
            <Panel title="Hard checks" kicker="What is known, unknown or broken" action={<span className={`badge ${data.overall === "ok" ? "accent" : "warn"}`}>{data.overall}</span>}>
              <div className="quality-checks">
                {data.checks.map((check) => (
                  <div className="quality-check" key={check.key}>
                    <span className={`quality-state ${check.status}`}>{statusLabel(check.status)}</span>
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <ProvenanceLine meta={data.quote_meta} />
              </div>
            </Panel>

            <Panel title="What this monitor cannot do" kicker="Scope boundary">
              <div className="note-list">
                <div className="note-item"><strong>It is not an execution feed</strong><p>{licensedVerified ? "Global Datafeeds is licensed for personal local display and supplies REST snapshots. It is not a tick stream, a consolidated tape or an order-pricing service." : "TradingView scanner and Yahoo Finance are public research feeds. The terminal does not have a verified licensed tick feed or a broker timestamp."}</p></div>
                <div className="note-item"><strong>It cannot prove a lag</strong><p>A timestamp gap between providers is not proof that a news event was mispriced. The Event-Lag Lab measures that separately and reports uncertainty.</p></div>
                <div className="note-item"><strong>It is process-local</strong><p>Provider health resets when the API process restarts. There is no external uptime monitor, on-call rotation or automatic failover.</p></div>
              </div>
              <div className="warning-box" style={{ marginTop: 10 }}>{data.note}</div>
              <div className="badge-row" style={{ marginTop: 9 }}>
                <span className="badge bad">no execution-grade claim</span>
                <span className="badge warn">unknown timestamps remain unknown</span>
              </div>
            </Panel>
          </div>

          <Panel title="Cross-source price check" kicker="TradingView vs Yahoo Finance" style={{ marginBottom: 13 }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className="num">TradingView</th>
                    <th>TV timestamp</th>
                    <th className="num">Yahoo</th>
                    <th>Yahoo timestamp</th>
                    <th className="num">Difference</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cross_checks.map((row) => (
                    <tr key={row.key}>
                      <td><div className="symbol-cell"><strong>{row.key}</strong><span>{row.name}</span></div></td>
                      <td className="num mono">{formatNumber(row.tradingview.value, 2)}</td>
                      <td className="small muted">{row.tradingview.as_of ? formatDateTime(row.tradingview.as_of) : "not supplied"}</td>
                      <td className="num mono">{formatNumber(row.yahoo.value, 2)}</td>
                      <td className="small muted">{row.yahoo.as_of ? formatDateTime(row.yahoo.as_of) : "unavailable"}</td>
                      <td className={`num mono ${row.state === "mismatch" ? "negative" : row.state === "watch" ? "warning" : ""}`}>{row.difference_pct === null ? "—" : `${row.difference_pct > 0 ? "+" : ""}${formatNumber(row.difference_pct, 2)}%`}</td>
                      <td><span className={`quality-state ${row.state === "consistent" ? "ok" : row.state === "mismatch" ? "error" : "warn"}`}>{row.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 9 }}>
              {data.cross_checks[0]?.note} A large difference can reflect market closure, a stale snapshot or a provider error; it is not automatically an arbitrage.
            </p>
          </Panel>

          <Panel title="Provider health register" kicker="Process-local observations">
            {data.provider_health.length === 0 ? (
              <div className="empty-trades">No provider calls have been recorded since this API process started.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead><tr><th>Provider</th><th>Status</th><th className="num">OK</th><th className="num">Fail</th><th>Last success</th><th>Latency</th><th>Last error</th></tr></thead>
                  <tbody>
                    {data.provider_health.map((item) => (
                      <tr key={item.name}>
                        <td><strong>{item.name}</strong></td>
                        <td><span className={`source-status ${item.status}`}>{item.status}</span></td>
                        <td className="num mono">{item.successes}</td>
                        <td className="num mono">{item.failures}</td>
                        <td className="mono small">{item.last_success_at ? timeAgo(item.last_success_at) : "—"}</td>
                        <td className="mono small">{item.latency_ms === null ? "—" : `${item.latency_ms} ms`}</td>
                        <td className="small muted" title={item.last_error || ""}>{item.last_error ? `${item.last_error.slice(0, 80)}…` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="badge-row" style={{ marginTop: 9 }}>
              <FreshnessBadge meta={data.quote_meta} compact />
              <span className="badge">{titleCase(data.overall)}</span>
              <span className="badge">checked {timeAgo(data.generated_at)}</span>
            </div>
          </Panel>

          <div className="warning-box" style={{ marginTop: 13 }}>
            {data.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        </>
      )}
    </>
  );
}
