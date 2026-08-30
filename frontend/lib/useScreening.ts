"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, CandidateConjunctionResponse, screenConjunctions } from "./api";
import { ConjunctionEvent } from "./types";

export type ScreeningSource = "live" | "stale" | "error";

export interface ScreeningResult {
  events: ConjunctionEvent[];
  /** "live" after a successful fetch; "stale" if a later fetch fails but a
   *  previous live result exists (keep showing it rather than blanking);
   *  "error" if no live result has ever been obtained. Mock fallback is
   *  intentionally NOT used here — the backend's screening endpoint can
   *  take minutes, so silently substituting unrelated mock data on failure
   *  would be misleading rather than helpful. */
  source: ScreeningSource;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function normalizeBreakdown(
  rows: Record<string, string>[] | undefined
): { label: string; value: string }[] | undefined {
  if (!rows) return undefined;
  return rows.map((row) => {
    if ("label" in row && "value" in row) {
      return { label: row.label, value: row.value };
    }
    const [label, value] = Object.entries(row)[0] ?? ["", ""];
    return { label, value };
  });
}

function toConjunctionEvent(candidate: CandidateConjunctionResponse): ConjunctionEvent {
  return {
    event_id: candidate.event_id,
    primary: candidate.primary,
    secondary: candidate.secondary,
    tca: candidate.tca,
    miss_distance_km: candidate.miss_distance_km,
    relative_velocity_km_s: candidate.relative_velocity_km_s,
    risk_score: candidate.risk_score,
    severity: candidate.severity,
    confidence: candidate.confidence,
    data_age_hours: candidate.data_age_hours,
    forecast_horizon_hours: candidate.forecast_horizon_hours,
    source: candidate.source,
    method: candidate.method,
    limitations: candidate.limitations,
    score_breakdown: normalizeBreakdown(candidate.score_breakdown),
  };
}

/**
 * Drives the dashboard's conjunction list from POST /api/v1/screen.
 *
 * This does NOT auto-fire on every threshold/horizon change — the backend
 * screening endpoint can take minutes over a large catalog (confirmed:
 * ~5 min in testing), so debouncing a slider into it would hammer a very
 * expensive operation repeatedly. Instead this fires once on mount and
 * again only when `trigger` changes (bump it from an explicit "Run
 * screening" action) or when `retry()` is called after a failure.
 *
 * Sends conservative coarse_step_seconds/object_limit overrides by default
 * as a stopgap against the backend's slow un-cached full-catalog default —
 * remove these once the backend precomputes/caches results (the real fix).
 */
export function useScreening(
  thresholdKm: number,
  horizonHours: number,
  trigger: number
): ScreeningResult {
  const [events, setEvents] = useState<ConjunctionEvent[]>([]);
  const [source, setSource] = useState<ScreeningSource>("error");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const hasLiveDataRef = useRef(false);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  useEffect(() => {
    let cancelled = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    screenConjunctions({
      analysis_time: new Date().toISOString(),
      screening_threshold_km: thresholdKm,
      forecast_horizon_hours: horizonHours,
      // Stopgap only — see doc comment above. Drop these once the backend
      // precomputes/caches instead of screening the whole catalog live.
      coarse_step_seconds: 180,
      object_limit: 100,
    })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.candidates.map(toConjunctionEvent));
        setSource("live");
        setError(null);
        hasLiveDataRef.current = true;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? `${err.status}: ${err.message}` : "backend unreachable or timed out";
        setError(message);
        setSource(hasLiveDataRef.current ? "stale" : "error");
        if (!hasLiveDataRef.current) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, retryCount]);

  return { events, source, loading, error, retry };
}