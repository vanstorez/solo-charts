"use client";

import { useState } from "react";

import { ErrorNotice, PageHeader, Panel } from "@/components/Ui";
import { apiPost, errorMessage } from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";
import type { BlackScholesResult } from "@/lib/types";

export default function OptionsPage() {
  const [form, setForm] = useState({
    spot: 54000,
    strike: 54000,
    days: 7,
    volatility: 14,
    rate: 6.5,
    option_type: "call" as "call" | "put"
  });
  const [result, setResult] = useState<BlackScholesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await apiPost<BlackScholesResult>("/api/options/black-scholes", form);
      setResult(payload);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        kicker="Options analytics"
        title="Price the risk before the premium"
        subtitle="A transparent Black-Scholes calculator with Greeks. No live option chain, no implied-volatility surface and no broker Greek feed is claimed in this build."
      />

      <div className="grid-2" style={{ alignItems: "start" }}>
        <Panel title="Option inputs" kicker="Research calculator">
          <div className="form-grid">
            <div className="field"><label htmlFor="spot">Spot</label><input id="spot" min={0} onChange={(event) => update("spot", Number(event.target.value))} type="number" value={form.spot} /></div>
            <div className="field"><label htmlFor="strike">Strike</label><input id="strike" min={0} onChange={(event) => update("strike", Number(event.target.value))} type="number" value={form.strike} /></div>
            <div className="field"><label htmlFor="days">Days to expiry</label><input id="days" min={1} onChange={(event) => update("days", Number(event.target.value))} type="number" value={form.days} /></div>
            <div className="field"><label htmlFor="vol">Volatility % (annualised)</label><input id="vol" min={0.1} onChange={(event) => update("volatility", Number(event.target.value))} step={0.1} type="number" value={form.volatility} /></div>
            <div className="field"><label htmlFor="rate">Risk-free rate %</label><input id="rate" min={-10} onChange={(event) => update("rate", Number(event.target.value))} step={0.1} type="number" value={form.rate} /></div>
            <div className="field"><label htmlFor="type">Option type</label><select id="type" onChange={(event) => update("option_type", event.target.value)} value={form.option_type}><option value="call">Call</option><option value="put">Put</option></select></div>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy} onClick={() => void calculate()} type="button">{busy ? "Calculating..." : "Calculate"}</button>
          </div>
          <div className="warning-box" style={{ marginTop: 12 }}>
            A model price is not an executable price. Real option P&L depends on bid/ask, IV changes, skew, liquidity, expiry and margin. This calculator does not model those.
          </div>
        </Panel>

        <Panel title="Model output" kicker="European, no dividends">
          {error && <ErrorNotice error={error} />}
          {!result && !error && (
            <div className="empty-state"><div className="empty-mark">∂</div><strong>No calculation yet</strong><p>Enter the inputs and calculate. The result is a model value, not a live NSE quote.</p></div>
          )}
          {result && (
            <>
              <div className="result-strip">
                <div className="result-cell"><span>Model price</span><strong>{formatInr(result.price, 2)}</strong></div>
                <div className="result-cell"><span>Intrinsic</span><strong>{formatInr(result.intrinsic_value, 2)}</strong></div>
                <div className="result-cell"><span>Time value</span><strong>{formatInr(result.time_value, 2)}</strong></div>
                <div className="result-cell"><span>Breakeven</span><strong>{formatInr(result.breakeven, 2)}</strong></div>
              </div>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div className="detail-cell"><span>Delta</span><strong>{formatNumber(result.greeks.delta, 4)}</strong></div>
                <div className="detail-cell"><span>Gamma</span><strong>{formatNumber(result.greeks.gamma, 6)}</strong></div>
                <div className="detail-cell"><span>Vega / 1% vol</span><strong>{formatNumber(result.greeks.vega_per_1pct_vol, 3)}</strong></div>
                <div className="detail-cell"><span>Theta / day</span><strong>{formatNumber(result.greeks.theta_per_day, 3)}</strong></div>
              </div>
              <div className="note-list" style={{ marginTop: 11 }}>
                {Object.entries(result.interpretation).map(([key, value]) => (
                  <div className="note-item" key={key}><strong>{key}</strong><p>{value}</p></div>
                ))}
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>{result.assumptions}</p>
              <p className="small muted">{result.limitations}</p>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Options data gap" kicker="Honest limitations" style={{ marginTop: 13 }}>
        <div className="grid-3">
          <div className="note-item"><strong>No live chain</strong><p>The new API does not scrape or pretend to have an NSE option chain. A permitted provider must be configured first.</p></div>
          <div className="note-item"><strong>No Greeks feed</strong><p>Greeks here are model Greeks from inputs, not exchange or broker Greeks. IV skew and term structure are absent.</p></div>
          <div className="note-item"><strong>No execution</strong><p>A model price cannot become an order. Live option execution is outside this build and requires broker/compliance controls.</p></div>
        </div>
      </Panel>
    </>
  );
}
