"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { apiDelete, apiPost, errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber, timeAgo, titleCase } from "@/lib/format";
import type { AlertCheckResponse, AlertsResponse, AlertTrigger, SymbolsResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type PermissionState = "unsupported" | "default" | "granted" | "denied";

function permissionLabel(value: PermissionState): string {
  if (value === "unsupported") return "unsupported";
  if (value === "granted") return "enabled";
  if (value === "denied") return "blocked";
  return "not requested";
}

export default function AlertsPage() {
  const alerts = useApi<AlertsResponse>("/api/alerts", 120_000);
  const refreshAlerts = alerts.refresh;
  const symbols = useApi<SymbolsResponse>("/api/symbols");
  const [form, setForm] = useState({
    kind: "price_above" as "price_above" | "price_below" | "news_keyword",
    symbol: "BANKNIFTY",
    threshold: "",
    keyword: "",
    note: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<AlertCheckResponse | null>(null);
  const [notifications, setNotifications] = useState<PermissionState>("default");
  const [autoCheck, setAutoCheck] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifications("unsupported");
      return;
    }
    setNotifications(Notification.permission as PermissionState);
  }, []);

  const notify = useCallback((trigger: AlertTrigger) => {
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification(`Solo alert · ${trigger.rule.description}`, {
        body: trigger.evidence.kind === "news_keyword"
          ? trigger.evidence.matches?.[0]?.headline || "Keyword matched a recent headline."
          : `${trigger.evidence.symbol}: ${formatNumber(trigger.evidence.value, 2)}`,
        tag: `solo-alert-${trigger.rule.id}`
      });
    } catch {
      // Notification construction is best-effort and may be blocked by the browser.
    }
  }, []);

  const checkNow = useCallback(async (background = false) => {
    if (!background) setChecking(true);
    setError(null);
    try {
      const payload = await apiPost<AlertCheckResponse>("/api/alerts/check");
      setLastCheck(payload);
      payload.triggered.forEach(notify);
      refreshAlerts();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (!background) setChecking(false);
    }
  }, [notify, refreshAlerts]);

  const enabledRules = alerts.data?.rules.filter((rule) => rule.enabled).length ?? 0;
  useEffect(() => {
    if (!autoCheck || enabledRules === 0) return;
    const initial = window.setTimeout(() => void checkNow(true), 3_000);
    const timer = window.setInterval(() => void checkNow(true), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [autoCheck, enabledRules, checkNow]);

  const requestPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifications("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotifications(permission as PermissionState);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost("/api/alerts", {
        kind: form.kind,
        symbol: form.kind === "news_keyword" ? null : form.symbol,
        threshold: form.kind === "news_keyword" ? null : Number(form.threshold),
        keyword: form.kind === "news_keyword" ? form.keyword : null,
        note: form.note || null
      });
      setMessage("Alert rule saved locally. It will be checked while this tab is open and auto-check is enabled.");
      setForm((current) => ({ ...current, threshold: "", keyword: "", note: "" }));
      refreshAlerts();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Delete this local alert rule?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/alerts/${id}`);
      setMessage("Alert rule deleted.");
      refreshAlerts();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const isPrice = form.kind !== "news_keyword";

  return (
    <>
      <PageHeader
        kicker="Smart alerts"
        title="Flag what matters, while the tab is open"
        subtitle="Local price and headline rules with cooldown protection and a browser notification option. No Telegram, email, SMS or always-on background worker is configured."
        actions={
          <>
            <button className="button" disabled={checking} onClick={() => void checkNow()} type="button">{checking ? "Checking..." : "Check now"}</button>
            <button className="button primary" disabled={notifications === "unsupported" || notifications === "granted"} onClick={() => void requestPermission()} type="button">
              {notifications === "granted" ? "Notifications enabled" : "Enable browser alerts"}
            </button>
          </>
        }
      />

      {alerts.error && <ErrorNotice error={alerts.error} retry={alerts.refresh} />}
      {error && <ErrorNotice error={error} />}
      {message && <div className="notice info" style={{ marginBottom: 13 }}><div><strong>Alerts updated.</strong><p>{message}</p></div></div>}

      <div className="grid-4" style={{ marginBottom: 13 }}>
        <div className="stat-card"><div className="stat-label">Active rules</div><div className="stat-value">{enabledRules}</div><div className="stat-foot"><span>{alerts.data?.rules.length ?? 0} total local rules</span></div></div>
        <div className="stat-card"><div className="stat-label">Browser alerts</div><div className={`stat-value ${notifications === "granted" ? "positive" : "neutral"}`} style={{ fontSize: 20 }}>{permissionLabel(notifications).toUpperCase()}</div><div className="stat-foot"><span>permission, not delivery guarantee</span></div></div>
        <div className="stat-card"><div className="stat-label">Last check</div><div className="stat-value" style={{ fontSize: 17 }}>{lastCheck ? timeAgo(lastCheck.checked_at) : "Not checked"}</div><div className="stat-foot"><span>{lastCheck ? `${lastCheck.rules_checked} rules evaluated` : "manual or auto"}</span></div></div>
        <div className="stat-card"><div className="stat-label">Triggered</div><div className={`stat-value ${lastCheck?.triggered.length ? "warning" : "neutral"}`}>{lastCheck?.triggered.length ?? 0}</div><div className="stat-foot"><span>{lastCheck ? `${lastCheck.cooldown_minutes}-minute cooldown` : "no evaluation yet"}</span></div></div>
      </div>

      <div className="grid-2" style={{ alignItems: "start", marginBottom: 13 }}>
        <Panel title="Create an alert rule" kicker="Evaluated against public research feeds">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="alert-kind">Rule type</label>
              <select id="alert-kind" onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as typeof form.kind }))} value={form.kind}>
                <option value="price_above">Price above</option>
                <option value="price_below">Price below</option>
                <option value="news_keyword">News keyword</option>
              </select>
            </div>
            {isPrice ? (
              <>
                <div className="field">
                  <label htmlFor="alert-symbol">Instrument</label>
                  <select id="alert-symbol" onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} value={form.symbol}>
                    {(symbols.data?.symbols || []).map((symbol) => <option key={symbol.key} value={symbol.key}>{symbol.short} · {symbol.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="alert-threshold">Threshold</label>
                  <input id="alert-threshold" min={0} onChange={(event) => setForm((current) => ({ ...current, threshold: event.target.value }))} step={0.05} type="number" value={form.threshold} />
                </div>
              </>
            ) : (
              <div className="field full">
                <label htmlFor="alert-keyword">Headline keyword</label>
                <input id="alert-keyword" maxLength={120} onChange={(event) => setForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="e.g. RBI, ceasefire, crude" value={form.keyword} />
              </div>
            )}
            <div className="field full">
              <label htmlFor="alert-note">Note (optional)</label>
              <input id="alert-note" maxLength={300} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Why this rule matters" value={form.note} />
            </div>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy || (isPrice ? !form.threshold : form.keyword.trim().length < 2)} onClick={() => void submit()} type="button">{busy ? "Saving..." : "Save alert rule"}</button>
            <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input checked={autoCheck} onChange={(event) => setAutoCheck(event.target.checked)} type="checkbox" />
              auto-check while open
            </label>
          </div>
          <div className="warning-box" style={{ marginTop: 11 }}>
            A triggered alert is a prompt to review evidence, not a trade signal. Price alerts use public snapshots with unknown TradingView timestamps. Keyword alerts search recent aggregated headlines and can match false positives.
          </div>
        </Panel>

        <Panel title="Local rule book" kicker="SQLite-backed">
          {!alerts.data && alerts.loading && <LoadingBlock rows={4} label="Loading local alert rules" />}
          {alerts.data && alerts.data.rules.length === 0 && <div className="empty-trades">No alert rules yet. Create one on the left. Rules never place orders.</div>}
          {alerts.data && alerts.data.rules.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Rule</th><th>Created</th><th>Last triggered</th><th /></tr></thead>
                <tbody>
                  {alerts.data.rules.map((rule) => (
                    <tr key={rule.id}>
                      <td><strong>{rule.description}</strong>{rule.note && <span className="calendar-comment">{rule.note}</span>}<span className="small muted">{titleCase(rule.kind)}</span></td>
                      <td className="mono small">{timeAgo(rule.created_at)}</td>
                      <td className="mono small">{rule.last_triggered_at ? timeAgo(rule.last_triggered_at) : "never"}</td>
                      <td><button className="button danger small" disabled={busy} onClick={() => void remove(rule.id)} type="button">Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 9 }}>{alerts.data?.note}</p>
        </Panel>
      </div>

      <Panel title="Latest evaluation" kicker="Manual or 60-second page polling" style={{ marginBottom: 13 }}>
        {!lastCheck ? (
          <div className="empty-trades">No evaluation this session. Click “Check now” or leave the page open with auto-check enabled.</div>
        ) : (
          <>
            <div className="detail-grid">
              <div className="detail-cell"><span>Checked</span><strong>{formatDateTime(lastCheck.checked_at)}</strong></div>
              <div className="detail-cell"><span>Rules evaluated</span><strong>{lastCheck.rules_checked}</strong></div>
              <div className="detail-cell"><span>Triggered</span><strong>{lastCheck.triggered.length}</strong></div>
              <div className="detail-cell"><span>Errors</span><strong className={lastCheck.errors.length ? "negative" : ""}>{lastCheck.errors.length}</strong></div>
            </div>
            {lastCheck.errors.map((item) => <div className="warning-box" key={item} style={{ marginTop: 9 }}>{item}</div>)}
            {lastCheck.triggered.length === 0 ? (
              <div className="empty-trades" style={{ marginTop: 11 }}>No rules crossed their condition. No notification was sent.</div>
            ) : (
              <div className="alert-trigger-list" style={{ marginTop: 11 }}>
                {lastCheck.triggered.map((trigger) => (
                  <div className="alert-trigger" key={trigger.rule.id}>
                    <div className="alert-trigger-head">
                      <strong>{trigger.rule.description}</strong>
                      <span className="badge warn">triggered</span>
                    </div>
                    {trigger.evidence.kind === "news_keyword" ? (
                      <div>
                        {(trigger.evidence.matches || []).map((match) => (
                          <div className="alert-match" key={match.headline}>
                            <p>{match.headline}</p>
                            <span className="small muted">{match.sources.map((source) => source.source).filter(Boolean).join(" · ")} · {match.published_at ? timeAgo(match.published_at) : "time unavailable"}</span>
                            {match.sources[0]?.link && <a className="stat-link" href={match.sources[0].link} rel="noreferrer" target="_blank">Open source ↗</a>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="small muted">
                        Research mark {formatNumber(trigger.evidence.value, 2)} vs threshold {formatNumber(trigger.evidence.threshold, 2)} · {trigger.evidence.quote_source || "provider"} · timestamp {trigger.evidence.quote_freshness || "unknown"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginTop: 10 }}>{lastCheck.note}</p>
          </>
        )}
      </Panel>

      <Panel title="Delivery limits" kicker="No hidden integrations">
        <div className="grid-3">
          <div className="note-item"><strong>Browser notifications</strong><p>Only while the page is open and only after permission is granted. Browsers, focus modes and operating systems can suppress them.</p></div>
          <div className="note-item"><strong>No always-on worker</strong><p>The API has no scheduler, queue or background monitor in this build. Closing the tab stops polling.</p></div>
          <div className="note-item"><strong>No Telegram/email/SMS</strong><p>Those channels require a configured provider, credentials, retry handling, delivery logs and security review. They are not claimed as working.</p></div>
        </div>
      </Panel>
    </>
  );
}
