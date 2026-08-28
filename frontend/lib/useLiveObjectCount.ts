"use client";

import { useEffect, useState } from "react";
import { listObjects } from "./api";

/**
 * Fetches the total catalog object count from the backend. Fails soft: on
 * any error (backend not running, network issue, CORS misconfiguration)
 * this returns null and the caller should keep showing its mock fallback
 * number — same defensive posture as everywhere else real data is wired
 * into this dashboard.
 */
export function useLiveObjectCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listObjects({ limit: 1 })
      .then((page) => {
        if (!cancelled) setCount(page.total);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}