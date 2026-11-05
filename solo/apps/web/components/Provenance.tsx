import type { FeedMeta } from "@/lib/types";
import { formatAge, formatDateTime, freshnessClass, titleCase } from "@/lib/format";

export function FreshnessBadge({ meta, compact = false }: { meta: FeedMeta; compact?: boolean }) {
  const tone = freshnessClass(meta.freshness);
  const label = meta.freshness === "unavailable"
    ? "UNAVAILABLE"
    : meta.freshness === "unknown"
      ? "TIMESTAMP N/A"
      : meta.freshness.toUpperCase();
  return (
    <span
      className={`freshness-badge ${tone}`}
      title={`${meta.provider} · ${meta.detail || meta.source_type} · as of ${meta.as_of ? formatDateTime(meta.as_of) : "provider timestamp unavailable"}`}
    >
      <span className="freshness-dot" />
      {compact ? label : `${label}${meta.age_seconds !== null ? ` · ${formatAge(meta.age_seconds)}` : ""}`}
    </span>
  );
}

export function SourcePill({ source, type }: { source: string; type?: string }) {
  return (
    <span className="source-pill" title={`${source}${type ? ` · ${type}` : ""}`}>
      <span className="source-mark" />
      {source}
    </span>
  );
}

export function ProvenanceLine({ meta }: { meta: FeedMeta }) {
  return (
    <div className="provenance-line">
      <span>{meta.provider}</span>
      <span className="sep">/</span>
      <span>{titleCase(meta.source_type)}</span>
      <span className="sep">/</span>
      <span>{meta.as_of ? formatDateTime(meta.as_of) : `fetched ${formatDateTime(meta.fetched_at)}`}</span>
      <span className="sep">/</span>
      <FreshnessBadge meta={meta} compact />
      {meta.detail && <span className="provenance-detail">{meta.detail}</span>}
    </div>
  );
}
