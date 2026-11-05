"use client";

import { useState } from "react";

import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { ErrorNotice, PageHeader, Panel } from "@/components/Ui";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { formatNumber, parseCsvSeries, timeAgo, titleCase } from "@/lib/format";
import type { LagDemo, LagResult, PolymarketStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function seriesToCsv(points: { t: number; value: number }[]): string {
  return points.map((point) => `${point.t},${point.value}`).join("\n");
}

export default function LagLabPage() {
  const status = useApi<PolymarketStatus>("/api/polymarket/status", 120_000);
  const [anchorText, setAnchorText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [bucket, setBucket] = useState(60);
  const [maxLag, setMaxLag] = useState(900);
  const [origin, setOrigin] = useState<"observed" | "simulated">("observed");
  const [demo, setDemo] = useState<LagDemo | null>(null);
  const [result, setResult] = useState<LagResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await apiGet<LagDemo>("/api/lag/demo?lag_seconds=120&bucket_seconds=60&points=240");
      setDemo(payload);
      setAnchorText(seriesToCsv(payload.anchor));
      setResponseText(seriesToCsv(payload.response));
      setOrigin("simulated");
      setResult(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    setError(null);
    setResult(null);
    const anchor = parseCsvSeries(anchorText);
    const response = parseCsvSeries(responseText);
    if (anchor.length < 10 || response.length < 10) {
      setError("Each series needs at least 10 rows in the form timestamp_ms,value.");
      return;
    }
    setBusy(true);
    try {
      const payload = await apiPost<LagResult>("/api/lag/analyze", {
        anchor,
        response,
        bucket_seconds: bucket,
        max_lag_seconds: maxLag,
        min_observations: 30,
        origin
      });
      setResult(payload);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setAnchorText("");
    setResponseText("");
    setDemo(null);
    setResult(null);
    setOrigin("observed");
    setError(null);
  };

  return (
    <>
      <PageHeader
        kicker="Event-lag lab"
        title="Measure the lag. Do not assume it."
        subtitle="A research workflow for comparing an anchor series with a response series. The 30–90 second repricing delay is a hypothesis here, not a product feature."
        actions={<button className="button" onClick={() => void loadDemo()} type="button">Load simulated method demo</button>}
      />

      <div className="grid-2" style={{ marginBottom: 13 }}>
        <Panel title="Prediction-market adapter" kicker="Polymarket public API">
          <div className="source-card-head">
            <div>
              <h3>{status.data ? status.data.state.toUpperCase() : "CHECKING"}</h3>
              <p>{status.data?.detail || "Checking public Gamma API reachability from this network."}</p>
            </div>
            <span className={`source-status ${status.data?.state || "not_checked"}`}>{status.data?.state || "checking"}</span>
          </div>
          <div className="detail-grid" style={{ marginTop: 10 }}>
            <div className="detail-cell"><span>Gamma</span><strong style={{ fontSize: 9 }}>{status.data?.gamma_url || "—"}</strong></div>
            <div className="detail-cell"><span>CLOB</span><strong style={{ fontSize: 9 }}>{status.data?.clob_url || "—"}</strong></div>
          </div>
          <div className="warning-box" style={{ marginTop: 10 }}>
            Prediction-market prices are market-implied, not objective probabilities. They are not equivalent to Bank Nifty direction. The adapter fails closed when unreachable.
          </div>
          <div className="form-actions">
            <button className="button small" onClick={status.refresh} type="button">Re-check adapter</button>
            {status.data?.available && <span className="badge accent">public metadata reachable</span>}
          </div>
        </Panel>

        <Panel title="Method & limits" kicker="What the calculation does">
          <ul className="evidence-list">
            <li>Bucket both series (default 60s), forward-fill only one missing bucket, then compute bucket returns.</li>
            <li>Correlate anchor returns with response returns across positive and negative lags.</li>
            <li>Report the strongest association, sample size, a Fisher-z 95% interval and a lag profile.</li>
            <li>Do not adjust the interval for multiple comparisons; treat every result as exploratory.</li>
          </ul>
          <div className="danger-box" style={{ marginTop: 10 }}>
            Correlation is not causation. A lag can be produced by stale quotes, thin liquidity, asynchronous timestamps or chance. The lab does not create a trade, a signal or a performance claim.
          </div>
          <div className="badge-row" style={{ marginTop: 10 }}>
            <span className="badge warn">no assumed 30–90s edge</span>
            <span className="badge">no fabricated history</span>
          </div>
        </Panel>
      </div>

      {error && <ErrorNotice error={error} />}

      <div className="lag-layout">
        <Panel title="Observation input" kicker="Timestamped series">
          {demo && (
            <div className="warning-box" style={{ marginBottom: 10 }}>
              <strong>Simulated demo loaded.</strong> {demo.warning} Planted lag: {demo.planted_lag_seconds}s. Results below are methodology tests, not market evidence.
            </div>
          )}
          <div className="series-inputs">
            <div className="field">
              <label htmlFor="anchor-series">Anchor series · timestamp_ms,value</label>
              <textarea
                id="anchor-series"
                onChange={(event) => setAnchorText(event.target.value)}
                placeholder={"1710000000000,100.0\n1710000060000,100.2\n..."}
                spellCheck={false}
                value={anchorText}
              />
            </div>
            <div className="field">
              <label htmlFor="response-series">Response series · timestamp_ms,value</label>
              <textarea
                id="response-series"
                onChange={(event) => setResponseText(event.target.value)}
                placeholder={"1710000000000,24000\n1710000060000,24010\n..."}
                spellCheck={false}
                value={responseText}
              />
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="bucket">Bucket seconds</label>
              <input id="bucket" min={10} max={3600} onChange={(event) => setBucket(Number(event.target.value))} type="number" value={bucket} />
            </div>
            <div className="field">
              <label htmlFor="max-lag">Max lag seconds</label>
              <input id="max-lag" min={0} max={86400} onChange={(event) => setMaxLag(Number(event.target.value))} type="number" value={maxLag} />
            </div>
            <div className="field">
              <label htmlFor="origin">Data origin</label>
              <select id="origin" onChange={(event) => setOrigin(event.target.value as "observed" | "simulated")} value={origin}>
                <option value="observed">Observed data</option>
                <option value="simulated">Simulated demo</option>
              </select>
            </div>
            <div className="field">
              <label>Minimum sample</label>
              <input disabled type="text" value="30 aligned returns" />
            </div>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy} onClick={() => void analyze()} type="button">
              {busy ? "Analyzing..." : "Run lag analysis"}
            </button>
            <button className="button ghost" onClick={clear} type="button">Clear</button>
            {demo && <span className="badge warn">simulated</span>}
          </div>
        </Panel>

        <Panel title="Result" kicker="Exploratory statistics">
          {!result && <div className="empty-state"><div className="empty-mark">∿</div><strong>No analysis yet</strong><p>Paste observed series or load the clearly labelled synthetic demo. The lab will not display a result without data.</p></div>}
          {result && (
            <>
              <div className="badge-row" style={{ marginBottom: 10 }}>
                <span className={`badge ${result.state === "exploratory_relationship" ? "accent" : result.state === "no_stable_relationship" ? "warn" : "bad"}`}>
                  {titleCase(result.state)}
                </span>
                {result.origin && <span className={`badge ${result.origin === "simulated" ? "warn" : ""}`}>{result.origin}</span>}
              </div>
              {result.reason && <div className="danger-box" style={{ marginBottom: 10 }}>{result.reason}</div>}
              {result.best_lag && (
                <>
                  <div className="result-strip">
                    <div className="result-cell"><span>Anchor leads</span><strong>{result.best_lag.anchor_leads_by_seconds}s</strong></div>
                    <div className="result-cell"><span>Correlation</span><strong>{formatNumber(result.best_lag.correlation, 3)}</strong></div>
                    <div className="result-cell"><span>Sample</span><strong>{result.best_lag.n}</strong></div>
                    <div className="result-cell"><span>95% CI</span><strong style={{ fontSize: 10 }}>{result.best_lag.ci95.map((value) => value === null ? "—" : value.toFixed(2)).join(" / ")}</strong></div>
                  </div>
                  <p className="small muted" style={{ marginTop: 10 }}>{result.interpretation}</p>
                </>
              )}
              {result.profile && result.profile.length > 0 && (
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="data-table compact">
                    <thead><tr><th>Lag (s)</th><th className="num">Correlation</th><th className="num">n</th></tr></thead>
                    <tbody>
                      {result.profile.slice(0, 8).map((entry) => (
                        <tr key={entry.lag_seconds}>
                          <td className="mono">{entry.lag_seconds}</td>
                          <td className={`num mono ${entry.correlation > 0 ? "positive" : "negative"}`}>{entry.correlation.toFixed(3)}</td>
                          <td className="num mono">{entry.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <div className="warning-box" style={{ marginTop: 10 }}>
                  {result.warnings.join(" ")}
                </div>
              )}
              {result.method && (
                <div style={{ marginTop: 10 }}>
                  <div className="eyebrow">Method</div>
                  <p className="small muted">{result.method.summary}</p>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel title="Adapter status detail" kicker="Trust centre" style={{ marginTop: 13 }}>
        {status.data ? (
          <>
            <div className="detail-grid">
              <div className="detail-cell"><span>State</span><strong>{status.data.state}</strong></div>
              <div className="detail-cell"><span>Available</span><strong>{status.data.available ? "yes" : "no"}</strong></div>
              <div className="detail-cell"><span>Last check</span><strong>{timeAgo(status.lastUpdated?.toISOString())}</strong></div>
              <div className="detail-cell"><span>Adapter</span><strong>Gamma public API</strong></div>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>{status.data.detail}</p>
          </>
        ) : (
          <p className="small muted">Checking adapter...</p>
        )}
      </Panel>
    </>
  );
}
