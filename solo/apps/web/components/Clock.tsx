"use client";

import { useEffect, useState } from "react";

import { useApi } from "@/lib/useApi";
import type { MarketSession } from "@/lib/types";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <span className="mono">--:--:-- IST</span>;
  return (
    <span className="mono">
      {new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata"
      }).format(now)}{" "}
      IST
    </span>
  );
}

export function SessionPill() {
  const { data } = useApi<MarketSession>("/api/market/session", 30_000);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const state = data?.state ?? "checking";
  const open = data?.is_open;
  let opensIn: string | null = null;
  if (!open && data?.next_open_at && now) {
    const target = new Date(data.next_open_at).getTime();
    if (Number.isFinite(target)) {
      const diffMs = target - now.getTime();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / 3_600_000);
        const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
        opensIn = hours >= 24 ? Math.floor(hours / 24) + "d " + (hours % 24) + "h" : hours + "h " + minutes + "m";
      }
    }
  }
  return (
    <span className={`session-pill ${open ? "open" : "closed"}`} title={data?.note}>
      <span className="session-dot" />
      {state === "open"
        ? "NSE OPEN"
        : state === "pre_open"
          ? "PRE-OPEN"
          : state === "closed"
            ? opensIn
              ? `CLOSED · opens in ${opensIn}`
              : "NSE CLOSED"
            : "SESSION —"}
    </span>
  );
}
