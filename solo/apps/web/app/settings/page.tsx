"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { apiPut, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { AppConfig, RiskLimits, RiskSettingsResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const fields: { key: keyof EditableLimits; label: string; hint: string; step?: number }[] = [
  { key: "max_open_positions", label: "Max open positions", hint: "Count of simultaneous paper positions" },
  { key: "max_trade_notional", label: "Max trade notional (₹)", hint: "Single simulated position cap", step: 1000 },
  { key: "max_total_exposure", label: "Max gross exposure (₹)", hint: "Sum of absolute paper notional", step: 1000 },
  { key: "daily_loss_limit", label: "Daily loss limit (₹)", hint: "Blocks new paper risk after breach", step: 1000 },
  { key: "max_drawdown", label: "Max realized drawdown (₹)", hint: "Based on closed paper P&L", step: 1000 },
  { key: "paper_slippage_bps", label: "Paper slippage (bps/side)", hint: "Applied to simulated fills", step: 0.5 },
  { key: "paper_fee_bps", label: "Paper fee (bps/side)", hint: "Simulated fee assumption", step: 0.5 }
];

type EditableLimits = Pick<RiskLimits, "max_open_positions" | "max_trade_notional" | "max_total_exposure" | "daily_loss_limit" | "max_drawdown" | "paper_slippage_bps" | "paper_fee_bps">;

type NseSettings = {
  provider: string;
  enabled: boolean;
  index_names_supported: number;
  access: string;
  session_open: boolean;
  note: string;
};

type NseProbeStatus = NseSettings & {
  probe: { ok: boolean; indices_available?: number; sample_nifty?: { last: number | null; percentChange: number | null } | null; error?: string; checked_at?: string };
};

function NseDirectCard() {
  const settings = useApi<NseSettings>("/api/nse/settings", 60_000);
  const [probe, setProbe] = useState<NseProbeStatus["probe"] | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runProbe = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const payload = await fetch("/backend/api/nse/status", { cache: "no-store" });
      if (!payload.ok) throw new Error(`HTTP ${payload.status}`);
      const data = (await payload.json()) as NseProbeStatus;
      setProbe(data.probe);
      setMessage(
        data.probe.ok
          ? `Connected — ${data.probe.indices_available} NSE indices reachable (NIFTY 50 sample: ${data.probe.sample_nifty?.last ?? "—"})`
          : `Probe failed: ${data.probe.error ?? "unknown error"}`
      );
    } catch (caught) {
      setMessage(`Test failed: ${caught instanceof Error ? caught.message : "unknown"}`);
    } finally {
      setTesting(false);
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await fetch(`/backend/api/nse/settings?enabled=${enabled ? "true" : "false"}`, { method: "POST", cache: "no-store" });
      if (!payload.ok) throw new Error(`HTTP ${payload.status}`);
      setMessage(enabled ? "NSE direct quotes ENABLED — NSE index quotes now come from the exchange site." : "NSE direct quotes disabled — back to delayed public providers.");
      settings.refresh();
    } catch (caught) {
      setMessage(`Toggle failed: ${caught instanceof Error ? caught.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {settings.error && <ErrorNotice error={settings.error} retry={settings.refresh} />}
      {settings.data && (
        <>
          <div className="detail-grid" style={{ marginBottom: 10 }}>
            <div className="detail-cell"><span>Status</span><strong>{settings.data.enabled ? "ENABLED" : "disabled"}</strong></div>
            <div className="detail-cell"><span>Coverage</span><strong>{settings.data.index_names_supported} NSE indices (Sensex/BSE stay delayed)</strong></div>
            <div className="detail-cell"><span>Source</span><strong>NSE India public website (nseindia.com)</strong></div>
            <div className="detail-cell"><span>Market session</span><strong>{settings.data.session_open ? "open — values near-real-time" : "closed — shows last close"}</strong></div>
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>{settings.data.note}</p>
          <div className="form-actions" style={{ marginBottom: 8 }}>
            <button className="button primary" disabled={busy} onClick={() => void toggle(!settings.data!.enabled)} type="button">
              {busy ? "Working..." : settings.data.enabled ? "Disable NSE direct" : "Enable NSE direct"}
            </button>
            <button className="button" disabled={testing} onClick={() => void runProbe()} type="button">
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
          {message && <div className="notice info"><div><strong>NSE direct.</strong><p>{message}</p></div></div>}
          <div className="warning-box" style={{ marginTop: 10 }}>
            <strong>Personal use only.</strong> This reads the exchange's own public website at a polite, low frequency
            (one request every few seconds at most, cached locally). It is not a licensed market-data feed and must not
            be resold or redistributed. If NSE changes or blocks this endpoint, Solo automatically falls back to the
            usual delayed providers — nothing breaks and nothing is faked.
          </div>
        </>
      )}
      {!settings.data && settings.loading && <LoadingBlock rows={4} label="Loading NSE direct status" />}
    </>
  );
}

export default function SettingsPage() {
  const config = useApi<AppConfig>("/api/config");
  const settings = useApi<RiskSettingsResponse>("/api/risk/settings");
  const [values, setValues] = useState<EditableLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setValues({
      max_open_positions: settings.data.limits.max_open_positions,
      max_trade_notional: settings.data.limits.max_trade_notional,
      max_total_exposure: settings.data.limits.max_total_exposure,
      daily_loss_limit: settings.data.limits.daily_loss_limit,
      max_drawdown: settings.data.limits.max_drawdown,
      paper_slippage_bps: settings.data.limits.paper_slippage_bps,
      paper_fee_bps: settings.data.limits.paper_fee_bps
    });
  }, [settings.data]);

  const update = (key: keyof EditableLimits, value: string) => {
    setValues((current) => current ? { ...current, [key]: Number(value) } : current);
  };

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiPut<RiskSettingsResponse>("/api/risk/settings", values);
      setMessage("Paper risk limits saved. The change is recorded in the local audit trail.");
      settings.refresh();
      config.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        kicker="Settings & system contract"
        title="Configure the guardrails, not the outcome"
        subtitle="Paper-risk limits and provider URLs are visible here. Live execution cannot be enabled, and this local build has no user authentication layer."
        actions={<Link className="button" href="/sources">Inspect data sources</Link>}
      />

      {error && <ErrorNotice error={error} />}
      {message && <div className="notice info" style={{ marginBottom: 13 }}><div><strong>Settings saved.</strong><p>{message}</p></div></div>}

      <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
        <Panel title="Paper risk limits" kicker="Server-side validation">
          {!settings.data && settings.loading && <LoadingBlock rows={5} label="Loading current local limits" />}
          {settings.error && <ErrorNotice error={settings.error} retry={settings.refresh} />}
          {values && (
            <>
              <div className="form-grid">
                {fields.map((field) => (
                  <div className="field" key={field.key}>
                    <label htmlFor={`setting-${field.key}`}>{field.label}</label>
                    <input
                      id={`setting-${field.key}`}
                      min={0}
                      onChange={(event) => update(field.key, event.target.value)}
                      step={field.step || 1}
                      type="number"
                      value={Number(values[field.key])}
                    />
                    <span className="small muted">{field.hint}</span>
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button className="button primary" disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving..." : "Save paper limits"}</button>
                <button className="button ghost" onClick={settings.refresh} type="button">Reload</button>
                <span className="badge bad">live execution remains off</span>
              </div>
            </>
          )}
          <div className="warning-box" style={{ marginTop: 12 }}>
            Risk-limit changes do not enable live trading. The API forces <span className="mono">live_execution_enabled=false</span> and every paper fill is local.
          </div>
        </Panel>

        <Panel title="Execution & mode" kicker="Hard-coded domain boundary">
          {config.error && <ErrorNotice error={config.error} retry={config.refresh} />}
          {!config.data && config.loading && <LoadingBlock rows={4} label="Loading API configuration" />}
          {config.data && (
            <>
              <div className="detail-grid">
                <div className="detail-cell"><span>API version</span><strong>{config.data.version}</strong></div>
                <div className="detail-cell"><span>Environment</span><strong>{config.data.environment}</strong></div>
                <div className="detail-cell"><span>Mode</span><strong>{config.data.mode}</strong></div>
                <div className="detail-cell"><span>Live execution</span><strong className="negative">disabled</strong></div>
                <div className="detail-cell"><span>Requested live</span><strong>{config.data.requested_live_execution ? "yes — blocked" : "no"}</strong></div>
                <div className="detail-cell"><span>Kill switch</span><strong>{config.data.risk_limits.paper_kill_switch ? "engaged" : "off"}</strong></div>
                <div className="detail-cell"><span>API host</span><strong>{config.data.api_host}:{config.data.api_port}</strong></div>
                <div className="detail-cell"><span>Polymarket</span><strong>{config.data.providers.polymarket_enabled ? "enabled" : "disabled"}</strong></div>
                <div className="detail-cell"><span>Global Datafeeds</span><strong>{config.data.providers.globaldatafeeds?.configured ? config.data.providers.globaldatafeeds.state : "not configured"}</strong></div>
                <div className="detail-cell"><span>Licensed delay</span><strong>{config.data.providers.globaldatafeeds?.delay_seconds === null || config.data.providers.globaldatafeeds?.delay_seconds === undefined ? "unknown" : `${config.data.providers.globaldatafeeds.delay_seconds}s`}</strong></div>
              </div>
              <div className="danger-box" style={{ marginTop: 11 }}>
                <strong>No authentication layer.</strong> This research API is intended to be bound to 127.0.0.1. Do not expose it to an untrusted network or add real money without authentication, authorization, CSRF protection, rate limiting, TLS and deployment review.
              </div>
              <div className="form-actions">
                <a className="button ghost small" href="http://127.0.0.1:8000/docs" rel="noreferrer" target="_blank">Open API docs ↗</a>
                <Link className="button ghost small" href="/risk">Risk monitor</Link>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>{config.data.note}</p>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Live data — NSE India direct quotes"
        kicker="Personal use only · not a licensed feed"
        style={{ marginBottom: 13 }}
      >
        <NseDirectCard />
      </Panel>

      <Panel title="Current contract" kicker="Configured limitations">
        <div className="grid-3">
          <div className="note-item"><strong>Persistence</strong><p>SQLite stores news metadata, paper trades, risk settings and hash-chained audit records. There is no multi-user database or production backup.</p></div>
          <div className="note-item"><strong>Providers</strong><p>Public TradingView, Yahoo and Google News endpoints are used. An optional Global Datafeeds licensed REST feed is read server-side from <span className="mono">SOLO_GDF_*</span>; the access key is never sent to the browser. Public providers can change or fail without notice. Polymarket is optional and fails closed.</p></div>
          <div className="note-item"><strong>Execution</strong><p>No broker connection, order routing, kill switch for live orders, SEBI registration workflow or exchange risk controls are present.</p></div>
        </div>
        <div className="badge-row" style={{ marginTop: 11 }}>
          <span className="badge">paper fills only</span>
          <span className="badge">costs are assumptions</span>
          <span className="badge">no guaranteed profit</span>
          <span className="badge warn">research & education</span>
          {settings.data && <span className="badge">fees {formatNumber(settings.data.limits.paper_fee_bps, 1)} bps/side</span>}
        </div>
      </Panel>
    </>
  );
}
