"use client";

import { useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { ApiError, apiPost, errorMessage } from "@/lib/api";
import { formatDateTime, formatInr, formatNumber, formatPct, timeAgo, titleCase, toneClass } from "@/lib/format";
import type { CloseResponse, PaperTrade, Quote, RiskSnapshot, SymbolsResponse, TradeResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type TradeListResponse = { trades: PaperTrade[]; mode: string; live_execution_enabled: boolean; note: string };
type QuoteResponse = { quotes: Quote[]; meta: import("@/lib/types").FeedMeta };

function orderError(caught: unknown): string {
  if (caught instanceof ApiError && caught.detail && typeof caught.detail === "object") {
    const detail = caught.detail as { message?: string; reasons?: string[] };
    if (detail.reasons?.length) return `${detail.message || "Order rejected"}: ${detail.reasons.join(" ")}`;
  }
  return errorMessage(caught);
}

export default function PaperPage() {
  const risk = useApi<RiskSnapshot>("/api/risk", 20_000);
  const trades = useApi<TradeListResponse>("/api/paper/trades?status=ALL", 20_000);
  const symbols = useApi<SymbolsResponse>("/api/symbols");
  const [form, setForm] = useState({
    symbol: "NIFTY",
    side: "BUY" as "BUY" | "SELL",
    quantity: 1,
    stop_loss: "",
    take_profit: "",
    notes: ""
  });
  const quote = useApi<QuoteResponse>(`/api/quotes?keys=${encodeURIComponent(form.symbol)}`, 20_000);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastFill, setLastFill] = useState<TradeResponse | null>(null);

  const refreshAll = () => {
    risk.refresh();
    trades.refresh();
    quote.refresh();
  };

  const submit = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const payload = await apiPost<TradeResponse>("/api/paper/trades", {
        symbol: form.symbol,
        side: form.side,
        quantity: Number(form.quantity),
        stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
        take_profit: form.take_profit ? Number(form.take_profit) : null,
        notes: form.notes || null
      });
      setLastFill(payload);
      setMessage(`Simulated paper fill recorded for ${payload.trade.symbol} at ${formatNumber(payload.simulated_fill, 2)}.`);
      refreshAll();
    } catch (caught) {
      setError(orderError(caught));
    } finally {
      setBusy(false);
    }
  };

  const close = async (trade: PaperTrade) => {
    if (!window.confirm(`Close paper trade #${trade.id} at the latest research mark? This is simulated.`)) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const payload = await apiPost<CloseResponse>(`/api/paper/trades/${trade.id}/close`);
      setMessage(`Paper trade #${payload.trade.id} closed. Net simulated P&L: ${formatInr(payload.realized_pnl)}.`);
      refreshAll();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const currentQuote = quote.data?.quotes?.[0];
  const killSwitch = risk.data?.limits?.paper_kill_switch;
  const openTrades = trades.data?.trades.filter((trade) => trade.status === "OPEN") ?? [];
  const closedTrades = trades.data?.trades.filter((trade) => trade.status === "CLOSED") ?? [];

  return (
    <>
      <PageHeader
        kicker="Paper trading & risk"
        title="Simulate the decision. Never fake the fill."
        subtitle="Slippage, fees, duplicate-exposure checks and configured limits are applied locally. No broker adapter is present and live execution is hard-disabled."
        actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh book</button>
            <span className="badge bad">live execution off</span>
          </>
        }
      />

      {risk.error && <ErrorNotice error={risk.error} retry={risk.refresh} />}
      {trades.error && <ErrorNotice error={trades.error} retry={trades.refresh} />}
      {error && <ErrorNotice error={error} />}
      {message && <div className="notice info" style={{ marginBottom: 13 }}><div><strong>Paper event recorded.</strong><p>{message}</p></div></div>}

      {!risk.data && risk.loading && <LoadingBlock rows={5} label="Loading paper-risk limits and marks" />}

      {risk.data && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Day P&L</div>
              <div className={`stat-value ${toneClass(risk.data.day_pnl)}`}>{formatInr(risk.data.day_pnl)}</div>
              <div className="stat-foot"><span>realized + open marks</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gross exposure</div>
              <div className="stat-value">{formatInr(risk.data.gross_exposure)}</div>
              <div className="stat-foot"><span>{risk.data.open_positions} open positions</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Realized drawdown</div>
              <div className="stat-value">{formatInr(risk.data.realized_drawdown)}</div>
              <div className="stat-foot"><span>limit {formatInr(risk.data.limits.max_drawdown)}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Audit chain</div>
              <div className={`stat-value ${risk.data.audit_chain_valid ? "positive" : "negative"}`} style={{ fontSize: 22 }}>{risk.data.audit_chain_valid ? "Valid" : "Broken"}</div>
              <div className="stat-foot"><span>local SHA-256 chain</span></div>
            </div>
          </div>

          {killSwitch && (
            <div className="danger-box" style={{ marginBottom: 13 }}>
              <strong>Paper kill switch engaged.</strong> New simulated orders are blocked until the switch is disengaged on the Risk Monitor page.
            </div>
          )}

          <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
            <Panel title="Simulate a paper order" kicker="No broker route">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="paper-symbol">Symbol</label>
                  <select id="paper-symbol" onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} value={form.symbol}>
                    {(symbols.data?.symbols || []).map((item) => <option key={item.key} value={item.key}>{item.short} · {item.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="paper-side">Side</label>
                  <select id="paper-side" onChange={(event) => setForm((current) => ({ ...current, side: event.target.value as "BUY" | "SELL" }))} value={form.side}>
                    <option value="BUY">BUY / long</option>
                    <option value="SELL">SELL / short</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="paper-quantity">Quantity</label>
                  <input id="paper-quantity" min={1} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} type="number" value={form.quantity} />
                </div>
                <div className="field">
                  <label>Research mark</label>
                  <input disabled type="text" value={currentQuote?.value ? `${formatNumber(currentQuote.value, 2)} · ${currentQuote.source}` : "unavailable"} />
                </div>
                <div className="field">
                  <label htmlFor="paper-stop">Stop-loss (optional)</label>
                  <input id="paper-stop" min={0} onChange={(event) => setForm((current) => ({ ...current, stop_loss: event.target.value }))} step={0.05} type="number" value={form.stop_loss} />
                </div>
                <div className="field">
                  <label htmlFor="paper-target">Take-profit (optional)</label>
                  <input id="paper-target" min={0} onChange={(event) => setForm((current) => ({ ...current, take_profit: event.target.value }))} step={0.05} type="number" value={form.take_profit} />
                </div>
                <div className="field full">
                  <label htmlFor="paper-notes">Decision note</label>
                  <input id="paper-notes" maxLength={500} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Why this paper decision exists" value={form.notes} />
                </div>
              </div>
              <div className="form-actions">
                <button className="button primary" disabled={busy || killSwitch} onClick={() => void submit()} type="button">
                  {busy ? "Simulating..." : "Simulate fill"}
                </button>
                <span className="small muted">Slippage and fees apply. Duplicate open exposure on the same symbol is blocked.</span>
              </div>
              {quote.data?.meta && <div style={{ marginTop: 10 }}><ProvenanceLine meta={quote.data.meta} /></div>}
              {lastFill && (
                <div className="notice info" style={{ marginTop: 10 }}>
                  <div>
                    <strong>Last simulated fill</strong>
                    <p>{lastFill.trade.side} {lastFill.trade.quantity} {lastFill.trade.symbol} @ {formatNumber(lastFill.simulated_fill, 2)} · fees {formatInr(lastFill.fees)} · notional {formatInr(lastFill.notional)}</p>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Risk checks" kicker="Hard controls" action={<span className={`badge ${risk.data.limit_checks.blocked ? "bad" : "accent"}`}>{risk.data.limit_checks.blocked ? "blocked" : "within limits"}</span>}>
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
              <div className="detail-grid" style={{ marginTop: 11 }}>
                <div className="detail-cell"><span>Fees per side</span><strong>{formatNumber(risk.data.limits.paper_fee_bps, 1)} bps</strong></div>
                <div className="detail-cell"><span>Slippage per side</span><strong>{formatNumber(risk.data.limits.paper_slippage_bps, 1)} bps</strong></div>
                <div className="detail-cell"><span>Kill switch</span><strong>{killSwitch ? "ENGAGED" : "off"}</strong></div>
                <div className="detail-cell"><span>Realized today</span><strong className={toneClass(risk.data.realized_pnl_today)}>{formatInr(risk.data.realized_pnl_today)}</strong></div>
              </div>
              {risk.data.warnings.map((warning) => <p className="small muted" key={warning}>{warning}</p>)}
              {risk.data.quote_meta && <div style={{ marginTop: 9 }}><ProvenanceLine meta={risk.data.quote_meta} /></div>}
            </Panel>
          </div>

          <Panel title="Open paper positions" kicker="Marked from provider snapshots" style={{ marginBottom: 13 }}>
            {openTrades.length === 0 ? (
              <div className="empty-trades">No open paper positions. The book is flat.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Stop</th><th className="num">Target</th><th className="num">Entry fee</th><th>Opened</th><th>Source</th><th /></tr></thead>
                  <tbody>
                    {openTrades.map((trade) => (
                      <tr key={trade.id}>
                        <td className="mono">#{trade.id}</td>
                        <td><strong>{trade.symbol}</strong></td>
                        <td className={trade.side === "BUY" ? "positive" : "negative"}>{trade.side}</td>
                        <td className="num mono">{trade.quantity}</td>
                        <td className="num mono">{formatNumber(trade.entry_price, 2)}</td>
                        <td className="num mono">{formatNumber(trade.stop_loss, 2)}</td>
                        <td className="num mono">{formatNumber(trade.take_profit, 2)}</td>
                        <td className="num mono">{formatInr(trade.entry_fee)}</td>
                        <td className="mono small">{formatDateTime(trade.entry_at)}</td>
                        <td className="small muted">{trade.quote_source || "—"}</td>
                        <td><button className="button danger small" disabled={busy} onClick={() => void close(trade)} type="button">Close paper</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {risk.data.marks.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 14 }}>Current marks</div>
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead><tr><th>Trade</th><th>Symbol</th><th className="num">Mark</th><th className="num">Notional</th><th className="num">Unrealized</th><th>Freshness</th></tr></thead>
                    <tbody>
                      {risk.data.marks.map((mark) => (
                        <tr key={mark.trade_id}>
                          <td className="mono">#{mark.trade_id}</td>
                          <td>{mark.symbol}</td>
                          <td className="num mono">{formatNumber(mark.mark, 2)}</td>
                          <td className="num mono">{formatInr(mark.notional)}</td>
                          <td className={`num mono ${toneClass(mark.unrealized_pnl)}`}>{formatInr(mark.unrealized_pnl)}</td>
                          <td className="small">{mark.quote_freshness}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>

          <Panel title="Closed paper trades" kicker="Costs included">
            {closedTrades.length === 0 ? (
              <div className="empty-trades">No closed paper trades yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Exit</th><th className="num">Fees</th><th className="num">Net P&L</th><th>Closed</th></tr></thead>
                  <tbody>
                    {closedTrades.map((trade) => (
                      <tr key={trade.id}>
                        <td className="mono">#{trade.id}</td>
                        <td><strong>{trade.symbol}</strong></td>
                        <td>{trade.side}</td>
                        <td className="num mono">{trade.quantity}</td>
                        <td className="num mono">{formatNumber(trade.entry_price, 2)}</td>
                        <td className="num mono">{formatNumber(trade.exit_price, 2)}</td>
                        <td className="num mono">{formatInr((trade.entry_fee || 0) + (trade.exit_fee || 0))}</td>
                        <td className={`num mono ${toneClass(trade.realized_pnl)}`}>{formatInr(trade.realized_pnl)}</td>
                        <td className="mono small">{formatDateTime(trade.exit_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid-3" style={{ marginTop: 13 }}>
              <div className="note-item"><strong>No broker connection</strong><p>These records cannot become real orders from this terminal.</p></div>
              <div className="note-item"><strong>Marks may be delayed</strong><p>Provider snapshots can differ from exchange fills and can gap through stops.</p></div>
              <div className="note-item"><strong>Taxes not modelled</strong><p>STT, exchange charges, stamp duty, GST and tax treatment are not included in this paper ledger.</p></div>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>{trades.data?.note}</p>
          </Panel>
        </>
      )}
    </>
  );
}
