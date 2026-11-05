"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorNotice, LoadingBlock, PageHeader, Panel, Toast } from "@/components/Ui";
import { formatNumber, formatPct, timeAgo, toneClass } from "@/lib/format";
import type { WatchlistItem, WatchlistResponse } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function WatchlistPage() {
  const watchlist = useApi<WatchlistResponse>("/api/watchlist", 30_000);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "error" | "success" } | null>(null);

  const data = watchlist.data ?? { watchlist: [], count: 0 };
  const loading = watchlist.loading;

  useEffect(() => {
    if (watchlist.data) {
      setItems(watchlist.data.watchlist);
    }
  }, [watchlist.data]);

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const addSymbol = useCallback(async () => {
    if (!newSymbol.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/backend/api/watchlist/add?symbol=${encodeURIComponent(newSymbol.trim())}&note=${encodeURIComponent(newNote.trim())}`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as WatchlistResponse;
      setItems(payload.watchlist);
      setNewSymbol("");
      setNewNote("");
      setToast({ message: `Added ${newSymbol.trim()} to watchlist`, type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add symbol");
      setToast({ message: err instanceof Error ? err.message : "Add failed", type: "error" });
    } finally {
      setAdding(false);
    }
  }, [newSymbol, newNote]);

  const removeSymbol = useCallback(async (key: string) => {
    setRemoving((prev) => new Set([...prev, key]));
    setError(null);
    try {
      const res = await fetch(`/backend/api/watchlist/remove?symbol=${encodeURIComponent(key)}`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as WatchlistResponse;
      setItems(payload.watchlist);
      setToast({ message: `Removed ${key} from watchlist`, type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove symbol");
      setToast({ message: err instanceof Error ? err.message : "Remove failed", type: "error" });
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const refreshAll = () => {
    watchlist.refresh();
  };

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <PageHeader
        kicker="Watchlist"
        title="Your Tracked Symbols"
        subtitle="Add symbols to track their live prices and changes. Everything inside Solo Trading Charts — no external links."
        actions={
          <>
            <button className="button" onClick={refreshAll} type="button">Refresh</button>
          </>
        }
      />

      {error && <ErrorNotice error={error} />}

      {/* Add symbol form */}
      <Panel title="Add Symbol to Watchlist" kicker="Track any symbol from the symbols list" style={{ marginBottom: 13 }}>
        <div className="grid-3" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Symbol key (e.g. NIFTY, RELIANCE, SPX)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          />
          <input
            className="input"
            placeholder="Optional note"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <button className="button" onClick={addSymbol} disabled={adding || !newSymbol.trim()} type="button">
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </Panel>

      {/* Watchlist table */}
      <Panel title="Watchlist" kicker={`${data.count} symbol${data.count !== 1 ? "s" : ""} tracked · delayed/unknown`} style={{ marginBottom: 13 }}>
        {loading && !data.watchlist.length && <LoadingBlock rows={5} label="Loading watchlist..." />}

        {data.watchlist.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
            <p>No symbols in your watchlist yet.</p>
            <p style={{ fontSize: 12, marginTop: 6 }}>Add a symbol above to start tracking.</p>
          </div>
        )}

        {data.watchlist.length > 0 && (
          <div className="table-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Last</th>
                  <th className="num">Change</th>
                  <th className="num">Exchange</th>
                  <th className="num">Currency</th>
                  <th>Provider time</th>
                  <th>Data</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.watchlist.map((item) => (
                  <tr key={item.key}>
                    <td>
                      <div className="symbol-cell">
                        <strong>{item.short}</strong>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{item.name}</span>
                      </div>
                    </td>
                    <td className={`num mono ${toneClass(item.change)}`}>
                      {formatNumber(item.value, 2)}
                    </td>
                    <td className={`num mono ${toneClass(item.change)}`}>{formatPct(item.change)}</td>
                    <td className="small">{item.exchange}</td>
                    <td className="small">{item.currency}</td>
                    <td className="mono small" title={item.as_of || "Provider time unavailable"}>
                      {item.as_of ? timeAgo(item.as_of) : "—"}
                    </td>
                    <td className={`quote-source ${item.error ? "bad" : ""}`}>
                      {item.error ? "unavailable" : "Yahoo delayed"}
                    </td>
                    <td>
                      <button
                        className="button ghost small"
                        onClick={() => removeSymbol(item.key)}
                        disabled={removing.has(item.key)}
                        type="button"
                      >
                        {removing.has(item.key) ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Footer contract */}
      <Panel title="Data Contract" kicker="Honest provenance" style={{ marginBottom: 13 }}>
        <div className="warning-box" style={{ marginTop: 8, padding: 8, fontSize: 11 }}>
          <strong>Watchlist is local.</strong> Your watched symbols are stored in the API's in-process cache.
          They persist while the API is running but are not saved to disk. Prices are public Yahoo Finance
          snapshots labelled delayed/unknown — never fabricated. Paper trading only; live execution is hard-disabled.
        </div>
        <div className="badge-row" style={{ marginTop: 8 }}>
          <span className="badge">Solo platform</span>
          <span className="badge">Mobile-optimized</span>
          <span className="badge">No external links</span>
          <a className="badge" href="/symbols">All symbols →</a>
        </div>
      </Panel>
    </>
  );
}
