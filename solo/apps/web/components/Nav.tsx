"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Terminal",
    items: [
      { href: "/", label: "Overview", note: "Command centre" },
      { href: "/global", label: "Global Markets", note: "World tape + crypto" },
      { href: "/india", label: "Indian Markets", note: "Day trading plan" },
      { href: "/daily", label: "Daily Summary", note: "All markets in one" },
      { href: "/analysis", label: "Analysis", note: "Advanced indicators" },
      { href: "/charts", label: "Charts", note: "Candles & levels" },
      { href: "/tradingview", label: "TradingView", note: "Official embed" },
      { href: "/bank-nifty", label: "Bank Nifty", note: "Scenario desk" }
    ]
  },
  {
    label: "Intelligence",
    items: [
      { href: "/news", label: "Breaking News", note: "Event radar" },
      { href: "/calendar", label: "Economic Calendar", note: "Scheduled catalysts" },
      { href: "/macro", label: "Global Macro", note: "Transmission map" },
      { href: "/alerts", label: "Alert Center", note: "Local triggers" },
      { href: "/lag-lab", label: "Event-Lag Lab", note: "Measure, don't assume" }
    ]
  },
  {
    label: "Research",
    items: [
      { href: "/ai-signals", label: "AI Signals", note: "Conditional research" },
      { href: "/options", label: "Options", note: "Risk calculator" },
      { href: "/backtest", label: "Backtesting", note: "Cost-aware tests" },
      { href: "/paper", label: "Paper Trading", note: "Risk-controlled fills" },
      { href: "/watchlist", label: "Watchlist", note: "Your tracked symbols" },
      { href: "/scanner", label: "Market Scanner", note: "Scan for conditions" }
    ]
  },
  {
    label: "Control",
    items: [
      { href: "/risk", label: "Risk Monitor", note: "Limits & audit" },
      { href: "/quality", label: "Data Quality", note: "Timestamps & checks" },
      { href: "/sources", label: "Data Sources", note: "Provenance" },
      { href: "/settings", label: "Settings", note: "Local configuration" }
    ]
  }
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">S</span>
        <span>
          <strong>SOLO</strong>
          <small>TRADING CHARTS</small>
        </span>
      </Link>
      <div className="sidebar-tagline">EVENT-DRIVEN MARKET INTELLIGENCE</div>
      <nav className="nav" aria-label="Main navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  className={`nav-link ${active ? "active" : ""}`}
                  href={item.href}
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="nav-dot" />
                  <span className="nav-copy">
                    <span>{item.label}</span>
                    <small>{item.note}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-badge">PAPER ONLY</div>
        <p>Live broker execution is disabled. Research, education and simulated fills only.</p>
        <p className="sidebar-fine">Not investment advice.</p>
      </div>
    </aside>
  );
}
