"use client";

import { useState } from "react";

import { EquityCurve } from "@/components/EquityCurve";
import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { EmptyState, ErrorNotice, PageHeader, Panel } from "@/components/Ui";
import { apiPost, errorMessage } from "@/lib/api";
import { formatInr, formatNumber, formatPct, titleCase, toneClass } from "@/lib/format";
import type { BacktestResult } from "@/lib/types";

export default function BacktestPage() {
  const [form, setForm] = useState({
    symbol: "NIFTY",
    range: "2y" as "1y" | "2y" | "5y",
    fast: 20,
    slow: 50,
    cost_bps: 5,
    initial_capital: 500000
  });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await apiPost<BacktestResult>("/api/backtest/ema", form);
      setResult(payload);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const metrics = result?.metrics;
  return (
    <>
      <PageHeader
        kicker="Strategy lab"
        title="Backtest with the costs left in"
        subtitle="A deliberately simple long-only EMA crossover simulation. Next-session execution, per-side costs and equity drawdown are shown. It is not a promise of live performance."
      />

      {error && <ErrorNotice error={error} />}

      <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
        <Panel title="Test configuration" kicker="Daily candles">
          <div className="form-grid">
            <div className="field"><label htmlFor="bt-symbol">Symbol</label><select id="bt-symbol" onChange={(event) => update("symbol", event.target.value)} value={form.symbol}><option value="NIFTY">NIFTY</option><option value="BANKNIFTY">BANKNIFTY</option><option value="SENSEX">SENSEX</option><option value="RELIANCE">RELIANCE</option></select></div>
            <div className="field"><label htmlFor="bt-range">Range</label><select id="bt-range" onChange={(event) => update("range", event.target.value)} value={form.range}><option value="1y">1 year</option><option value="2y">2 years</option><option value="5y">5 years</option></select></div>
            <div className="field"><label htmlFor="bt-fast">Fast EMA</label><input id="bt-fast" min={2} onChange={(event) => update("fast", Number(event.target.value))} type="number" value={form.fast} /></div>
            <div className="field"><label htmlFor="bt-slow">Slow EMA</label><input id="bt-slow" min={5} onChange={(event) => update("slow", Number(event.target.value))} type="number" value={form.slow} /></div>
            <div className="field"><label htmlFor="bt-cost">Cost per side (bps)</label><input id="bt-cost" min={0} onChange={(event) => update("cost_bps", Number(event.target.value))} step={1} type="number" value={form.cost_bps} /></div>
            <div className="field"><label htmlFor="bt-capital">Initial capital</label><input id="bt-capital" min={10000} onChange={(event) => update("initial_capital", Number(event.target.value))} step={10000} type="number" value={form.initial_capital} /></div>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy} onClick={() => void run()} type="button">{busy ? "Running simulation..." : "Run EMA backtest"}</button>
            <span className="small muted">Fast must be less than slow.</span>
          </div>
          <div className="warning-box" style={{ marginTop: 12 }}>
            The simulation uses fractional all-in sizing, no shorting, no lot sizes, no taxes, no margin and no intraday data. These are major simplifications. A profitable backtest is not evidence of future returns.
          </div>
        </Panel>

        <Panel title="Results" kicker="Closed-trade equity">
          {!result && !error && <div className="empty-state"><div className="empty-mark">∫</div><strong>No simulation yet</strong><p>Choose a configuration and run the test. Missing provider history stays unavailable; the lab does not generate candles.</p></div>}
          {result && !result.available && <EmptyState title="Backtest unavailable">{result.reason || "Historical candles are unavailable."}</EmptyState>}
          {result?.available && metrics && (
            <>
              <div className="result-strip">
                <div className="result-cell"><span>Total return</span><strong className={toneClass(metrics.total_return_pct)}>{formatPct(metrics.total_return_pct)}</strong></div>
                <div className="result-cell"><span>Closed trades</span><strong>{metrics.trades}</strong></div>
                <div className="result-cell"><span>Win rate</span><strong>{metrics.win_rate_pct === null ? "—" : `${metrics.win_rate_pct.toFixed(1)}%`}</strong></div>
                <div className="result-cell"><span>Max drawdown</span><strong className="negative">{formatNumber(metrics.max_drawdown.pct, 2)}%</strong></div>
              </div>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div className="detail-cell"><span>Final equity</span><strong>{formatInr(metrics.final_equity)}</strong></div>
                <div className="detail-cell"><span>Total P&L</span><strong className={toneClass(metrics.total_pnl)}>{formatInr(metrics.total_pnl)}</strong></div>
                <div className="detail-cell"><span>Profit factor</span><strong>{formatNumber(metrics.profit_factor, 2)}</strong></div>
                <div className="detail-cell"><span>Expectancy / trade</span><strong>{formatInr(metrics.expectancy_per_trade)}</strong></div>
                <div className="detail-cell"><span>Modelled costs</span><strong>{formatInr(metrics.total_costs)}</strong></div>
                <div className="detail-cell"><span>Sharpe</span><strong>{metrics.sharpe ?? "not reported"}</strong></div>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>{metrics.sharpe_note}</p>
              {result.data_quality?.meta && <div style={{ marginTop: 9 }}><ProvenanceLine meta={result.data_quality.meta} /></div>}
            </>
          )}
        </Panel>
      </div>

      {result?.available && result.equity_curve && (
        <Panel title="Equity curve" kicker={result.strategy?.name} style={{ marginBottom: 13 }}>
          <EquityCurve points={result.equity_curve} />
          <div className="badge-row" style={{ marginTop: 8 }}>
            <span className="badge">{result.strategy?.range} sample</span>
            <span className="badge">{result.strategy?.cost_bps_per_side} bps per side</span>
            <span className="badge warn">closed trades only</span>
          </div>
        </Panel>
      )}

      {result?.available && (
        <Panel title="Trade log" kicker="Most recent 100 closed trades" style={{ marginBottom: 13 }}>
          {!result.trades || result.trades.length === 0 ? (
            <EmptyState title="No closed trades">This parameter set produced no completed trades in the sample. That is a valid result, not a reason to tune until something appears.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Entry</th><th>Exit</th><th className="num">Entry px</th><th className="num">Exit px</th><th className="num">Qty</th><th className="num">Return</th><th className="num">Costs</th><th className="num">P&L</th></tr></thead>
                <tbody>
                  {result.trades.map((trade, index) => (
                    <tr key={`${trade.entry_at}-${index}`}>
                      <td className="mono small">{trade.entry_date}</td>
                      <td className="mono small">{trade.exit_date}</td>
                      <td className="num mono">{formatNumber(trade.entry, 2)}</td>
                      <td className="num mono">{formatNumber(trade.exit, 2)}</td>
                      <td className="num mono">{formatNumber(trade.quantity, 4)}</td>
                      <td className={`num mono ${toneClass(trade.return_pct)}`}>{formatPct(trade.return_pct)}</td>
                      <td className="num mono">{formatInr(trade.costs)}</td>
                      <td className={`num mono ${toneClass(trade.pnl)}`}>{formatInr(trade.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {result?.available && (
        <Panel title="Method and limitations" kicker="Read the fine print">
          <div className="grid-3">
            <div className="note-item"><strong>Execution</strong><p>{result.strategy?.execution}</p></div>
            <div className="note-item"><strong>Position sizing</strong><p>{result.strategy?.caveat}</p></div>
            <div className="note-item"><strong>Result integrity</strong><p>{result.disclaimer}</p></div>
          </div>
          <div className="badge-row" style={{ marginTop: 10 }}>
            {result.strategy && <span className="badge accent">{result.strategy.name_label}</span>}
            <span className="badge">no survivorship adjustment</span>
            <span className="badge">no taxes / STT</span>
            <span className="badge">no intraday execution</span>
            {result.open_position && <span className="badge warn">open position excluded from closed equity</span>}
          </div>
          {result.open_position && <p className="small muted" style={{ marginTop: 9 }}>{JSON.stringify(result.open_position)}</p>}
        </Panel>
      )}
    </>
  );
}
