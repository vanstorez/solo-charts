import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function Panel({
  title,
  kicker,
  action,
  children,
  className = "",
  style
}: {
  title?: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || kicker || action) && (
        <div className="panel-head">
          <div>
            {kicker && <div className="eyebrow">{kicker}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions
}: {
  kicker: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function LoadingBlock({ rows = 5, label = "Loading provider-backed data" }: { rows?: number; label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <div className="loading-label">{label}<span className="loading-dots">...</span></div>
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index} style={{ width: `${92 - index * 7}%` }} />
      ))}
    </div>
  );
}

export function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <div>
        <strong>Provider unavailable.</strong>
        <p>{error}</p>
      </div>
      {retry && (
        <button className="button ghost small" onClick={retry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-mark">∅</div>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function StatCard({
  label,
  value,
  change,
  sub,
  tone,
  href
}: {
  label: string;
  value: string;
  change?: string;
  sub?: string;
  tone?: string;
  href?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {change && <span className={`delta ${tone || ""}`}>{change}</span>}
        {sub && <span>{sub}</span>}
      </div>
      {href && <Link className="stat-link" href={href}>Open workspace →</Link>}
    </div>
  );
}

export function Toast({
  message,
  type = "success",
  onDismiss
}: {
  message: string;
  type?: "success" | "error";
  onDismiss: () => void;
}) {
  const tone = type === "error" ? "var(--negative)" : "var(--positive)";
  return (
    <div
      className="toast"
      style={{
        borderColor: tone,
        background: type === "error" ? "rgba(255, 107, 129, 0.12)" : "rgba(56, 217, 169, 0.12)"
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="toast-body">
        <span
          className="mono"
          style={{ color: tone, fontSize: "8px", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 8 }}
        >
          {type === "error" ? "ERROR" : "OK"}
        </span>
        <span className="mono" style={{ fontSize: "11px" }}>
          {message}
        </span>
        <button className="button ghost small" onClick={onDismiss} type="button" style={{ marginLeft: 10, padding: 2, fontSize: "10px" }}>
          ✕
        </button>
      </div>
    </div>
  );
}
