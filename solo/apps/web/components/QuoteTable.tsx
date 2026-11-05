import type { Quote } from "@/lib/types";
import { formatCompact, formatNumber, formatPct, toneClass } from "@/lib/format";

export function QuoteTable({ quotes, compact = false }: { quotes: Quote[]; compact?: boolean }) {
  return (
    <div className="table-scroll">
      <table className={`data-table ${compact ? "compact" : ""}`}>
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="num">Last</th>
            <th className="num">Change</th>
            <th className="num">Volume</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.key}>
              <td>
                <div className="symbol-cell">
                  <strong>{quote.short}</strong>
                  <span>{quote.exchange}</span>
                </div>
              </td>
              <td className="num mono">
                {quote.currency === "INR" ? "₹" : ""}
                {formatNumber(quote.value, 2)}
              </td>
              <td className={`num mono ${toneClass(quote.change)}`}>{formatPct(quote.change)}</td>
              <td className="num mono muted">{formatCompact(quote.volume)}</td>
              <td>
                <span className={`quote-source ${quote.source === "unavailable" ? "bad" : ""}`} title={quote.source}>
                  {quote.source === "TradingView scanner snapshot" ? "TV snapshot" : quote.source === "Yahoo Finance" ? "Yahoo delayed" : quote.source}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
