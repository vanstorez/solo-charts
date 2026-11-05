"use client";

import Link from "next/link";

import type { LiveStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export function DataModePill() {
  const live = useApi<LiveStatus>("/api/live/status?probe=true", 120_000);
  const status = live.data;

  if (!status || !status.configured) {
    return (
      <Link
        className="data-mode-pill"
        href="/quality"
        title="No licensed exchange feed is verified. Public/delayed or timestamp-unknown data is labelled per module."
      >
        PUBLIC DATA · DELAYED / UNKNOWN
      </Link>
    );
  }

  let label = "GDF CONFIGURED · VERIFYING";
  let tone = "licensed";
  if (status.state === "verified") {
    label = "GDF LICENSED · LIVE SNAPSHOT";
    tone = "live";
  } else if (status.state === "verified_delayed") {
    label = `GDF LICENSED · ${status.delay_seconds ?? "?"}s DELAY`;
    tone = "licensed";
  } else if (status.state === "verified_no_delay_contract") {
    label = "GDF LICENSED · DELAY UNKNOWN";
    tone = "licensed";
  } else if (status.state === "license_disabled" || status.state === "error") {
    label = "GDF LICENSED · CHECK FAILED";
    tone = "error";
  }

  return (
    <Link
      className={`data-mode-pill ${tone}`}
      href="/quality"
      title={`${status.detail} Scope: ${status.license_scope.replaceAll("_", " ")}. REST snapshots are polled; this is not a tick-by-tick stream.`}
    >
      {label}
    </Link>
  );
}
