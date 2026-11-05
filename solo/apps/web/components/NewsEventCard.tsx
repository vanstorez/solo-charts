import type { NewsEvent } from "@/lib/types";
import { formatDateTime, formatPct, timeAgo, titleCase } from "@/lib/format";

const CONFIRMATION_LABELS: Record<string, string> = {
  confirmed: "Price confirmed",
  contradicted: "Price contradicts",
  mixed: "Price mixed / flat",
  not_directional: "No price claim",
  unavailable: "Price check unavailable"
};

export function NewsEventCard({ event, compact = false }: { event: NewsEvent; compact?: boolean }) {
  const tone = event.tone === "positive" ? "positive" : event.tone === "negative" ? "negative" : "neutral";
  const confirmation = event.price_confirmation;
  return (
    <article className={`news-event ${compact ? "compact" : ""}`}>
      <div className="news-event-top">
        <span className={`event-type ${tone}`}>{event.event_label}</span>
        <span className={`verification ${event.verification}`}>
          {event.verification === "multi_source" ? `${event.source_count} source labels` : "single source"}
        </span>
        <span className="news-time" title={formatDateTime(event.published_at)}>{timeAgo(event.published_at)}</span>
      </div>
      <h3>{event.headline}</h3>
      <div className="news-meta">
        <span>Attention {event.impact.attention_score}/100</span>
        <span>Confidence {event.confidence}</span>
        <span>First seen {timeAgo(event.first_seen_at)}</span>
        {confirmation && (
          <span className={`confirmation-mini ${confirmation.status}`}>
            {CONFIRMATION_LABELS[confirmation.status] || confirmation.status}
          </span>
        )}
      </div>
      {!compact && (
        <>
          <p className="news-verification">{event.verification_note}</p>
          {confirmation && (
            <div className={`price-confirmation ${confirmation.status}`}>
              <div className="price-confirmation-head">
                <strong>{CONFIRMATION_LABELS[confirmation.status] || confirmation.label}</strong>
                <span>
                  fetched {confirmation.fetched_at ? formatDateTime(confirmation.fetched_at) : "time unknown"} · quote
                  timestamp {confirmation.as_of ? formatDateTime(confirmation.as_of) : "unknown"} ·{" "}
                  {confirmation.quote_freshness}
                </span>
              </div>
              <div className="price-confirmation-assets">
                {confirmation.assets.map((asset) => (
                  <span className={`price-check-state ${asset.state}`} key={`${event.id}-${asset.symbol}-check`}>
                    <strong>{asset.symbol}</strong>
                    <span>{formatPct(asset.quote_change)}</span>
                    <em>{titleCase(asset.state)}</em>
                  </span>
                ))}
              </div>
              <p>{confirmation.note}</p>
            </div>
          )}
          <div className="asset-tags">
            {event.affected_assets.map((asset) => (
              <span className="asset-tag" key={`${event.id}-${asset.symbol}`}>
                <strong>{asset.symbol}</strong>
                <span>{titleCase(asset.expected_direction)}</span>
              </span>
            ))}
          </div>
          <div className="transmission-list">
            {event.transmission_channels.map((channel) => (
              <span key={channel}>{channel}</span>
            ))}
          </div>
          <div className="news-sources">
            {event.sources.map((source) => (
              <span key={source}>{source}</span>
            ))}
          </div>
          {event.articles.length > 0 && (
            <div className="news-links">
              {event.articles.slice(0, 4).map((article) => (
                <a href={article.link} key={article.id} rel="noreferrer" target="_blank">
                  {article.source} ↗
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}
