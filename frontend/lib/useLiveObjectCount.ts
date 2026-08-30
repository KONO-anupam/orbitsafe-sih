"use client";

import { useEffect, useState } from "react";
import { listObjects } from "./api";
import { objectsTracked as mockObjectsTracked } from "@/mocks/conjunctions";

export type ObjectCountSource = "live" | "mock";

export interface LiveObjectCount {
  count: number;
  source: ObjectCountSource;
}

/**
 * Fetches the total catalog object count. Falls back to the mock count
 * (clearly labeled via `source`) if the backend is unreachable — this is a
 * cheap, fast call (limit=1), unlike screening, so a silent mock fallback
 * here is fine; it's not misleading the way it would be for risk-scored
 * events.
 */
export function useLiveObjectCount(): LiveObjectCount {
  const [state, setState] = useState<LiveObjectCount>({ count: mockObjectsTracked, source: "mock" });

  useEffect(() => {
    let cancelled = false;
    listObjects({ limit: 1 })
      .then((page) => {
        if (!cancelled) setState({ count: page.total, source: "live" });
      })
      .catch(() => {
        if (!cancelled) setState({ count: mockObjectsTracked, source: "mock" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}