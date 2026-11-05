"use client";

import Link from "next/link";
import { useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { apiPost, errorMessage } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber, timeAgo, titleCase, toneClass } from "@/lib/format";
import type { AuditResponse, RiskSnapshot } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function RiskPage() {
  const risk = useApi<RiskSnapshot>("/api/risk", 20_000);
  const audit = useApi<AuditResponse>("/api/audit?limit=40", 30_000);
  const [reason, setReason] = useState("Manual risk review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleKillSwitch = async () => {
    if (!risk.data) return;
    const next = !risk.data.kill_switch;
    if (next && !window.confirm("Engage the paper kill switch? New simulated orders will be blocked. Open paper positions will not be auto-closed.")) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/risk/kill-switch", { engaged: next, reason });
      risk.refresh();
      audit.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        kicker="Risk monitor"
        title="Limits, marks and a tamper-evident trail"
        subtitle="The kill switch blocks new paper risk. It cannot close positions automatically or route live orders. The audit chain detects casual database edits, not a hostile administrator."
        actions={
          <>
            <button className="button" onClick={() => { risk.refresh(); audit.refresh(); }} type="button">Refresh</button>
            <Link className="button ghost" href="/settings">Risk settings</Link>
          </>
        }
      />

      {error && <ErrorNotice error={error} />}
      {risk.error && <ErrorNotice error={risk.error} retry={risk.refresh} />}
      {!risk.data && risk.loading && <LoadingBlock rows={6} label="Loading local risk controls" />}

      {risk.data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Kill switch</div>
              <div className={`stat-value ${risk.data.kill_switch ? "negative" : "positive"}`} style={{ fontSize: 22 }}>{risk.data.kill_switch ? "ENGAGED" : "Off"}</div>
              <div className="stat-foot"><span>paper orders {risk.data.kill_switch ? "blocked" : "allowed"}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Open positions</div>
              <div className="stat-value">{risk.data.open_positions}</div>
              <div className="stat-foot"><span>{formatInr(risk.data.gross_exposure)} gross</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Day P&L</div>
              <div className={`stat-value ${toneClass(risk.data.day_pnl)}`}>{formatInr(risk.data.day_pnl)}</div>
              <div className="stat-foot"><span>realized {formatInr(risk.data.realized_pnl_today)}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Audit chain</div>
              <div className={`stat-value ${risk.data.audit_chain_valid ? "positive" : "negative"}`} style={{ fontSize: 22 }}>{risk.data.audit_chain_valid ? "Valid" : "Broken"}</div>
              <div className="stat-foot"><span>local SHA-256 chain</span></div>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
            <Panel title="Limit checks" kicker="Hard risk controls">
              <div className="risk-checks">
                {risk.data.limit_checks.checks.map((check) => (
                  <div className="risk-check" key={check.key}>
                    <strong>{check.label}</strong>
                    <span className="value">{formatNumber(check.used, 2)}</span>
                    <span className="limit">limit {formatNumber(check.limit, 2)}</span>
                    <span className={`state ${check.state}`}>{check.state.toUpperCase()}</span>
                  </div>
                ))}
              </div>
              {risk.data.limit_checks.blocked && <div className="danger-box" style={{ marginTop: 10 }}>One or more risk limits is breached. New paper risk is blocked.</div>}
              <div className="detail-grid" style={{ marginTop: 10 }}>
                <div className="detail-cell"><span>Fees per side</span><strong>{formatNumber(risk.data.limits.paper_fee_bps, 1)} bps</strong></div>
                <div className="detail-cell"><span>Slippage per side</span><strong>{formatNumber(risk.data.limits.paper_slippage_bps, 1)} bps</strong></div>
                <div className="detail-cell"><span>Live execution</span><strong className="negative">disabled by design</strong></div>
                <div className="detail-cell"><span>Mode</span><strong>{risk.data.mode}</strong></div>
              </div>
              {risk.data.quote_meta && <div style={{ marginTop: 9 }}><ProvenanceLine meta={risk.data.quote_meta} /></div>}
            </Panel>

            <Panel title="Kill switch" kicker="Paper risk only">
              <div className="warning-box" style={{ marginBottom: 10 }}>
                The kill switch blocks new paper orders and is recorded in the audit log. It does <strong>not</strong> close open positions, cancel broker orders or provide a live emergency stop. Those require a broker adapter and operational procedures that this build does not have.
              </div>
              <div className="field">
                <label htmlFor="kill-reason">Reason for change</label>
                <input id="kill-reason" maxLength={500} onChange={(event) => setReason(event.target.value)} type="text" value={reason} />
              </div>
              <div className="form-actions">
                <button className={`button ${risk.data.kill_switch ? "primary" : "danger"}`} disabled={busy} onClick={() => void toggleKillSwitch()} type="button">
                  {busy ? "Recording..." : risk.data.kill_switch ? "Disengage paper kill switch" : "Engage paper kill switch"}
                </button>
                <span className={`badge ${risk.data.kill_switch ? "bad" : "accent"}`}>{risk.data.kill_switch ? "engaged" : "off"}</span>
              </div>
              {risk.data.warnings.map((warning) => <p className="small muted" key={warning}>{warning}</p>)}
            </Panel>
          </div>

          <Panel title="Open marks" kicker="Provider snapshots, not execution prices" style={{ marginBottom: 13 }}>
            {risk.data.marks.length === 0 ? (
              <div className="empty-trades">No open paper positions. No marks are required.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Trade</th><th>Symbol</th><th className="num">Mark</th><th className="num">Notional</th><th className="num">Unrealized</th><th>Quote source</th><th>Freshness</th></tr></thead>
                  <tbody>
                    {risk.data.marks.map((mark) => (
                      <tr key={mark.trade_id}>
                        <td className="mono">#{mark.trade_id}</td>
                        <td><strong>{mark.symbol}</strong></td>
                        <td className="num mono">{formatNumber(mark.mark, 2)}</td>
                        <td className="num mono">{formatInr(mark.notional)}</td>
                        <td className={`num mono ${toneClass(mark.unrealized_pnl)}`}>{formatInr(mark.unrealized_pnl)}</td>
                        <td className="small">{mark.quote_source}</td>
                        <td className="small">{mark.quote_freshness}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Audit trail" kicker="Hash-chained local records" action={<span className={`audit-chain ${risk.data.audit_chain_valid ? "" : "bad"}`}>{risk.data.audit_chain_valid ? "chain valid" : "chain broken"}</span>}>
            {audit.error && <ErrorNotice error={audit.error} retry={audit.refresh} />}
            {audit.data ? (
              <>
                <p className="small muted">{audit.data.note}</p>
                {audit.data.entries.length === 0 ? (
                  <div className="empty-trades">No audit records yet. Paper orders, risk-setting changes and kill-switch actions will appear here.</div>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table compact">
                      <thead><tr><th>ID</th><th>When</th><th>Action</th><th>Payload</th><th>Hash</th></tr></thead>
                      <tbody>
                        {audit.data.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="mono">{entry.id}</td>
                            <td className="mono small" title={formatDateTime(entry.at)}>{timeAgo(entry.at)}</td>
                            <td><span className="tag">{entry.action}</span></td>
                            <td className="small muted" title={entry.payload_json} style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.payload_json}</td>
                            <td className="mono small muted">{entry.hash.slice(0, 12)}…</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="small muted">{audit.loading ? "Loading audit entries..." : "Audit trail unavailable."}</p>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
