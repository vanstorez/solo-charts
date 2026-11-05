"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, errorMessage } from "@/lib/api";

export function useApi<T>(path: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    let controller: AbortController | null = null;

    const load = async (background = false) => {
      controller?.abort();
      controller = new AbortController();
      if (!background) setLoading(true);
      try {
        const payload = await apiGet<T>(path, controller.signal);
        if (!active) return;
        setData(payload);
        setError(null);
        setLastUpdated(new Date());
      } catch (caught) {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(errorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    if (refreshMs > 0) {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void load(true);
      }, refreshMs);
    }
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs, revision]);

  return { data, error, loading, lastUpdated, refresh };
}
