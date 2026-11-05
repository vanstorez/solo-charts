"use client";

import { useEffect, useState } from "react";

import { ProvenanceLine } from "@/components/Provenance";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDate, formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import type { EconomicCalendarResponse, EconomicEvent, FeedMeta } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function calendarValue(value: number | string | null, unit: string | null, scale: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  const number = Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 2);
  if (unit === "$") return `$${number}${scale || ""}`;
  if (unit === "%") return `${number}%`;
  return `${number}${scale || ""}${unit ? ` ${unit}` : ""}`;
}

function importanceClass(event: EconomicEvent): string {
  return event.importance_label === "high" ? "negative" : event.importance_label === "medium" ? "warning" : "muted";
}

function dateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export default function CalendarPage() {
  const [importance, setImportance] = useState<"all" | "medium" | "high">("medium");
  const [view, setView] = useState<"upcoming" | "released" | "all">("upcoming");
  const [tick, setTick] = useState(Date.now());
  const calendar = useApi<EconomicCalendarResponse>(`/api/calendar?days=21&importance=${importance}`, 300_000);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const data = calendar.data;
  const now = tick;
  const events = data?.events ?? [];
  const upcoming = events.filter((event) => new Date(event.date).getTime() >= now);
  const released = events.filter((event) => new Date(event.date).getTime() < now);
  const selected = view === "upcoming" ? upcoming : view === "released" ? released : events;
  const groups = selected.reduce<Record<string, EconomicEvent[]>>((result, event) => {
    const key = dateKey(event.date);
    (result[key] ||= []).push(event);
    return result;
  }, {});
  const nextHigh = data?.next_high_impact;

  return (
    <>
      <PageHeader
        kicker="Economic calendar"
        title="Know what the market is waiting for"
        subtitle="Central-bank decisions, inflation releases, growth data and scheduled macro events with actual, forecast and previous values. Provider data is shown with source links; it is not an event-trading instruction."
        actions={
          <>
            <button className="button" onClick={calendar.refresh} type="button">Refresh calendar</button>
            <span className="badge accent">source-linked</span>
          </>
        }
      />

      {calendar.error && <ErrorNotice error={calendar.error} retry={calendar.refresh} />}
      {!data && calendar.loading && <LoadingBlock rows={7} label="Loading scheduled macroeconomic events" />}

      {data && !data.available && (
        <Panel title="Calendar unavailable" kicker="Fail closed">
          <EmptyState title="No verified event feed">{data.reason || "The calendar provider did not return usable data."}</EmptyState>
          <ProvenanceLine meta={data.meta} />
        </Panel>
      )}

      {data?.available && (
        <>
          <div className="grid-4" style={{ marginBottom: 13 }}>
            <div className="stat-card">
              <div className="stat-label">Next high impact</div>
              <div className="stat-value" style={{ fontSize: 17 }}>{nextHigh ? nextHigh.title : "None in window"}</div>
              <div className="stat-foot"><span>{nextHigh ? `${formatDateTime(nextHigh.date)} · ${timeAgo(nextHigh.date)}` : "widen the window"}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Upcoming</div>
              <div className="stat-value">{upcoming.length}</div>
              <div className="stat-foot"><span>in the next 21 days</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Released in window</div>
              <div className="stat-value">{released.length}</div>
              <div className="stat-foot"><span>actuals included when supplied</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Calendar feed</div>
              <div className={`stat-value ${data.meta.freshness === "fresh" ? "positive" : "neutral"}`} style={{ fontSize: 20 }}>{data.meta.freshness.toUpperCase()}</div>
              <div className="stat-foot"><span>{data.meta.provider}</span></div>
            </div>
          </div>

          <div className="calendar-toolbar">
            <div className="segmented" aria-label="Calendar view">
              <button className={view === "upcoming" ? "active" : ""} onClick={() => setView("upcoming")} type="button">Upcoming</button>
              <button className={view === "released" ? "active" : ""} onClick={() => setView("released")} type="button">Released</button>
              <button className={view === "all" ? "active" : ""} onClick={() => setView("all")} type="button">All</button>
            </div>
            <div className="segmented" aria-label="Importance filter">
              <button className={importance === "medium" ? "active" : ""} onClick={() => setImportance("medium")} type="button">Medium + high</button>
              <button className={importance === "high" ? "active" : ""} onClick={() => setImportance("high")} type="button">High only</button>
              <button className={importance === "all" ? "active" : ""} onClick={() => setImportance("all")} type="button">All importance</button>
            </div>
            <div className="small muted">All times in IST · {data.window?.countries.join(" / ")}</div>
          </div>

          {selected.length === 0 ? (
            <EmptyState title="No events in this view">Change the importance filter or calendar window. Empty results are shown honestly; the page does not generate filler events.</EmptyState>
          ) : (
            <div className="calendar-groups">
              {Object.entries(groups).map(([key, dayEvents]) => (
                <Panel key={key} title={dateLabel(dayEvents[0].date)} kicker={`${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}>
                  <div className="table-scroll">
                    <table className="data-table calendar-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Event</th>
                          <th>Region</th>
                          <th>Impact</th>
                          <th className="num">Actual</th>
                          <th className="num">Forecast</th>
                          <th className="num">Previous</th>
                          <th>Period</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayEvents.map((event) => {
                          const isUpcoming = new Date(event.date).getTime() >= now;
                          return (
                            <tr key={event.id}>
                              <td className="mono small" title={formatDateTime(event.date)}>
                                {new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.date))}
                                <span className="calendar-countdown">{isUpcoming ? timeAgo(event.date) : "released"}</span>
                              </td>
                              <td>
                                <strong>{event.title}</strong>
                                {event.comment && <span className="calendar-comment" title={event.comment}>{event.comment.slice(0, 120)}{event.comment.length > 120 ? "…" : ""}</span>}
                              </td>
                              <td><span className="badge">{event.country}</span></td>
                              <td><span className={`calendar-importance ${importanceClass(event)}`}>{event.importance_label.toUpperCase()}</span></td>
                              <td className={`num mono calendar-actual ${event.actual !== null && event.actual !== "" ? "" : "muted"}`}>{calendarValue(event.actual, event.unit, event.scale)}</td>
                              <td className="num mono">{calendarValue(event.forecast, event.unit, event.scale)}</td>
                              <td className="num mono muted">{calendarValue(event.previous, event.unit, event.scale)}</td>
                              <td className="small muted">{event.period || "—"}</td>
                              <td className="small">{event.source_url ? <a className="external-link" href={event.source_url} rel="noreferrer" target="_blank">{event.source || "source"} ↗</a> : event.source || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ))}
            </div>
          )}

          <div className="grid-2" style={{ marginTop: 13, alignItems: "start" }}>
            <Panel title="How to read the calendar" kicker="Context, not a signal">
              <div className="note-list">
                <div className="note-item"><strong>Surprise matters more than the level</strong><p>A CPI print can be above forecast and still be priced in. The terminal does not infer direction without price and positioning evidence.</p></div>
                <div className="note-item"><strong>Revisions and timestamps</strong><p>Actual, forecast and previous values can be revised. An event marked “released” may still update. The provider timestamp is not the official release time.</p></div>
                <div className="note-item"><strong>Bank Nifty is not the only reaction</strong><p>USD/INR, Brent, US yields, India VIX and global equities can react first. Use the Macro and Event-Lag Lab modules before drawing a causality claim.</p></div>
              </div>
              <ProvenanceLine meta={data.meta} />
            </Panel>

            <Panel title="Official verification" kicker="Check the primary source">
              <div className="official-links">
                {data.official_calendars.map((item) => (
                  <a href={item.url} key={item.url} rel="noreferrer" target="_blank">
                    <strong>{item.name} ↗</strong>
                    <span>{item.note}</span>
                  </a>
                ))}
              </div>
              <div className="warning-box" style={{ marginTop: 12 }}>
                {data.disclaimer} The calendar is a scheduled-event aid, not investment advice.
              </div>
              <div className="detail-grid" style={{ marginTop: 10 }}>
                <div className="detail-cell"><span>Calendar generated</span><strong>{formatDateTime(data.generated_at)}</strong></div>
                <div className="detail-cell"><span>Release date</span><strong>{nextHigh ? formatDate(nextHigh.date) : "—"}</strong></div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
