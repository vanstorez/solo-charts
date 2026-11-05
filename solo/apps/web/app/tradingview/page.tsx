"use client";

import { useMemo, useState } from "react";

import { PageHeader, Panel } from "@/components/Ui";

const symbols = [
  { value: "NSE:NIFTY", label: "Nifty 50 · NSE" },
  { value: "NSE:BANKNIFTY", label: "Bank Nifty · NSE" },
  { value: "BSE:SENSEX", label: "Sensex · BSE" },
  { value: "NSE:INDIAVIX", label: "India VIX · NSE" },
  { value: "NSEIX:NIFTY1!", label: "GIFT Nifty · NSE IX" },
  { value: "NSE:RELIANCE", label: "Reliance Industries · NSE" },
  { value: "NSE:HDFCBANK", label: "HDFC Bank · NSE" },
  { value: "NSE:ICICIBANK", label: "ICICI Bank · NSE" },
  { value: "NSE:SBIN", label: "State Bank of India · NSE" },
  { value: "NSE:TCS", label: "TCS · NSE" },
  { value: "NSE:INFY", label: "Infosys · NSE" }
];

const intervals = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" }
];

function chartUrl(symbol: string, interval: string): string {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: "dark",
    style: "1",
    timezone: "Asia/Kolkata",
    locale: "en",
    withdateranges: "1",
    hidesidetoolbar: "0",
    allow_symbol_change: "1",
    saveimage: "0",
    details: "1",
    hotlist: "0",
    calendar: "0",
    news: "0",
    studies: "[]"
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function tickerUrl(): string {
  const config = {
    symbols: [
      { proName: "NSE:NIFTY", title: "Nifty 50" },
      { proName: "NSE:BANKNIFTY", title: "Bank Nifty" },
      { proName: "BSE:SENSEX", title: "Sensex" },
      { proName: "NSE:INDIAVIX", title: "India VIX" },
      { proName: "NSEIX:NIFTY1!", title: "GIFT Nifty" }
    ],
    showSymbolLogo: true,
    isTransparent: true,
    displayMode: "adaptive",
    colorTheme: "dark",
    locale: "en"
  };
  return `https://s.tradingview.com/embed-widget/ticker-tape/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}

export default function TradingViewPage() {
  const [symbol, setSymbol] = useState("NSE:NIFTY");
  const [interval, setInterval] = useState("D");
  const chartSource = useMemo(() => chartUrl(symbol, interval), [symbol, interval]);
  const tapeSource = useMemo(() => tickerUrl(), []);

  return (
    <>
      <PageHeader
        kicker="TradingView official embed"
        title="TradingView charts, clearly separated"
        subtitle="An official TradingView iframe for visual reference. Solo cannot read or export this chart's values; it does not feed alerts, scenarios, quality checks or paper trading."
        actions={
          <span className="badge">Embedded in Solo</span>
        }
      />

      <div className="alert notice info" style={{ marginBottom: 13 }}>
        <div>
          <strong>Third-party widget boundary.</strong>
          <p>
            The chart and ticker tape below are rendered by TradingView, not Solo. Their data entitlement,
            delay status and availability are controlled by TradingView and your browser session. A
            TradingView paid plan is not a data-feed licence for this application. Use the licensed
            Global Datafeeds feed for Solo's own analysis when it is configured.
          </p>
        </div>
      </div>

      <Panel
        title="Live market tape"
        kicker="TradingView ticker-tape embed"
        action={<span className="badge warn">external iframe</span>}
        style={{ marginBottom: 13 }}
      >
        <div className="tv-tape-shell">
          <iframe
            className="tv-tape-frame"
            src={tapeSource}
            title="TradingView market ticker tape"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </Panel>

      <Panel
        title="Advanced chart"
        kicker="TradingView widget · drawings and indicators are inside the iframe"
        action={<span className="badge warn">external iframe</span>}
      >
        <div className="tv-toolbar">
          <div className="chart-toolbar-group">
            <select
              aria-label="TradingView symbol"
              className="range-select"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            >
              {symbols.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <div className="segmented" aria-label="TradingView interval">
              {intervals.map((item) => (
                <button
                  className={item.value === interval ? "active" : ""}
                  key={item.value}
                  onClick={() => setInterval(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="badge-row">
            <span className="badge">iframe · no API access</span>
            <span className="badge warn">delay set by TradingView</span>
          </div>
        </div>

        <div className="tv-chart-shell">
          <iframe
            key={`${symbol}-${interval}`}
            className="tv-chart-frame"
            src={chartSource}
            title={`TradingView chart for ${symbol}`}
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>

        <div className="warning-box" style={{ marginTop: 11 }}>
          <strong>Do not treat the iframe as Solo data.</strong> Prices visible here may be delayed,
          real-time or unavailable depending on TradingView's own entitlements. Solo cannot verify
          that timestamp, cannot run alerts on it and cannot copy its values into the paper-trading
          ledger. If the widget is blocked by your network, use the “Open on TradingView” link.
        </div>
      </Panel>

      <div className="grid-2" style={{ marginTop: 13 }}>
        <Panel title="What this gives you" kicker="Visual parity, not data integration">
          <div className="note-list">
            <div className="note-item"><strong>TradingView chart interface</strong><p>Official candlesticks, indicators, drawing tools, symbol search and timeframes inside a third-party iframe.</p></div>
            <div className="note-item"><strong>One-click comparison</strong><p>Compare TradingView's visual structure with Solo's locally calculated levels, scenario desk and quality checks.</p></div>
            <div className="note-item"><strong>Attribution preserved</strong><p>The embed remains a TradingView product. Solo does not remove branding or redistribute extracted values.</p></div>
          </div>
        </Panel>
        <Panel title="What it cannot do" kicker="Scope boundary">
          <div className="note-list">
            <div className="note-item"><strong>No backend data access</strong><p>Browser iframe isolation prevents Solo from reading the chart's quotes, indicators or drawings.</p></div>
            <div className="note-item"><strong>No alerts or paper fills</strong><p>TradingView widget prices cannot trigger Solo alerts, scenarios, risk marks or simulated orders.</p></div>
            <div className="note-item"><strong>No live-data guarantee</strong><p>Any “live” or delayed label inside the widget is TradingView's classification, not Solo's verified provenance.</p></div>
          </div>
          <div className="warning-box" style={{ marginTop: 10 }}>
            For verified licensed data, configure Global Datafeeds in the API environment and use the
            Solo Charts, Quality and Data Sources pages.
          </div>
        </Panel>
      </div>
    </>
  );
}
