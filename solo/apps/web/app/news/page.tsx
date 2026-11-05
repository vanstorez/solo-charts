"use client";

import { useMemo, useState } from "react";

import { NewsEventCard } from "@/components/NewsEventCard";
import { FreshnessBadge, ProvenanceLine } from "@/components/Provenance";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel } from "@/components/Ui";
import { formatDateTime } from "@/lib/format";
import type { NewsResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function NewsPage() {
  const news = useApi<NewsResponse>("/api/news?limit=60", 120_000);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const categories = news.data?.categories?.filter((item) => item.key === "all" || news.data?.events.some((event) => event.event_type === item.key)) ?? [];
  const events = useMemo(() => {
    const all = news.data?.events ?? [];
    const normalized = query.trim().toLowerCase();
    return all.filter((event) => {
      const categoryMatch = category === "all" || event.event_type === category;
      const queryMatch = !normalized || event.headline.toLowerCase().includes(normalized) || event.sources.join(" ").toLowerCase().includes(normalized);
      return categoryMatch && queryMatch;
    });
  }, [news.data, category, query]);

  return (
    <>
      <PageHeader
        kicker="Breaking news & event radar"
        title="Headlines with timestamps, sources and uncertainty"
        subtitle="War, Fed, RBI, policy, GIFT City, energy and critical-minerals headlines from Google News RSS. Publication time, local first-seen time and source labels stay separate."
        actions={
          <button className="button" onClick={news.refresh} type="button">Refresh feed</button>
        }
      />

      {news.error && <ErrorNotice error={news.error} retry={news.refresh} />}
      {!news.data && news.loading && <LoadingBlock rows={7} label="Aggregating nine Google News category feeds" />}

      {news.data && (
        <>
          <div className="panel" style={{ marginBottom: 13 }}>
            <div className="chart-toolbar" style={{ padding: 0, border: 0, marginBottom: 11 }}>
              <div className="segmented" style={{ flexWrap: "wrap" }}>
                {categories.map((item) => (
                  <button className={category === item.key ? "active" : ""} key={item.key} onClick={() => setCategory(item.key)} type="button">
                    {item.label}
                  </button>
                ))}
              </div>
              <input
                aria-label="Search headlines"
                className="text-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search headline or source"
                style={{ maxWidth: 250 }}
                type="search"
                value={query}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="badge-row">
                <span className="badge accent">{events.length} events shown</span>
                <span className="badge">{news.data.events.length} in feed</span>
                <span className="badge warn">headline ≠ verified fact</span>
              </div>
              <FreshnessBadge meta={news.data.meta} />
            </div>
            <div style={{ marginTop: 9 }}><ProvenanceLine meta={news.data.meta} /></div>
            {Object.keys(news.data.errors).length > 0 && (
              <div className="warning-box" style={{ marginTop: 9 }}>
                Partial feed failure: {Object.entries(news.data.errors).map(([key, value]) => `${key}: ${value}`).join(" · ")}
              </div>
            )}
          </div>

          <div className="grid-2" style={{ alignItems: "start" }}>
            <Panel title="Event timeline" kicker="Newest first">
              {events.length === 0 ? (
                <EmptyState title="No matching events">No headline matched this filter. The terminal will not produce synthetic news.</EmptyState>
              ) : (
                <div className="timeline">
                  {events.map((event) => <NewsEventCard event={event} key={event.id} />)}
                </div>
              )}
            </Panel>

            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <Panel title="Verification protocol" kicker="How to read this tape">
                <div className="note-list">
                  <div className="note-item">
                    <strong>One source label is not confirmation</strong>
                    <p>Multi-source labels mean a similar headline appeared with multiple source labels. This is still not an independent fact-check.</p>
                  </div>
                  <div className="note-item">
                    <strong>Publication time ≠ event time</strong>
                    <p>Google News timestamps describe publication. The local first-seen timestamp records when this terminal ingested the link.</p>
                  </div>
                  <div className="note-item">
                    <strong>Attention is ordered, not a probability</strong>
                    <p>The attention score prioritises review. It does not estimate the direction, magnitude or probability of a market move.</p>
                  </div>
                  <div className="note-item">
                    <strong>Never trade a headline alone</strong>
                    <p>Cross-asset transmission, liquidity, stale data and conflicting reports must be checked before any paper scenario is considered.</p>
                  </div>
                </div>
              </Panel>

              <Panel title="Feed detail" kicker="Provider contract">
                <div className="detail-grid">
                  <div className="detail-cell"><span>Provider</span><strong>{news.data.meta.provider}</strong></div>
                  <div className="detail-cell"><span>Source type</span><strong>{news.data.meta.source_type}</strong></div>
                  <div className="detail-cell"><span>As of</span><strong>{formatDateTime(news.data.meta.as_of)}</strong></div>
                  <div className="detail-cell"><span>Feed status</span><strong>{news.data.meta.status}</strong></div>
                </div>
                <p className="small muted" style={{ marginTop: 10 }}>{news.data.note}</p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </>
  );
}
