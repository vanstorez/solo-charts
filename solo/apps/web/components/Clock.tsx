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
  const state = data?.state ?? "checking";
  const open = data?.is_open;
  return (
    <span className={`session-pill ${open ? "open" : "closed"}`} title={data?.note}>
      <span className="session-dot" />
      {state === "open" ? "NSE OPEN" : state === "pre_open" ? "PRE-OPEN" : state === "closed" ? "NSE CLOSED" : "SESSION —"}
    </span>
  );
}
