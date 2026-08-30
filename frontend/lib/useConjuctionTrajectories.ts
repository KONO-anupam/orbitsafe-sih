"use client";

import { useEffect, useState } from "react";
import { ApiError, getTrajectory } from "./api";
import { TimedVec3, pathFromTrajectory } from "./orbitGeometry";

export interface TrajectoryPair {
  primary: TimedVec3[];
  secondary: TimedVec3[];
  /** Real separation vs. time, derived from the two fetched paths — not
   *  the mock's synthetic curve. Empty if either path came back empty. */
  separationTrace: { t_minutes: number; distance_km: number }[];
}

function distanceKm(a: TimedVec3["position"], b: TimedVec3["position"]): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function deriveSeparationTrace(
  primary: TimedVec3[],
  secondary: TimedVec3[],
  tcaMs: number
): { t_minutes: number; distance_km: number }[] {
  if (primary.length < 2 || secondary.length < 2) {
    return [];
  }

  const n = Math.min(primary.length, secondary.length);
  const trace: { t_minutes: number; distance_km: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = primary[i];
    const s = secondary[i];
    trace.push({
      t_minutes: (new Date(p.t).getTime() - tcaMs) / 60000,
      distance_km: distanceKm(p.position, s.position),
    });
  }
  return trace;
}

/**
 * Fetches real SGP4-propagated trajectories for both objects in a
 * conjunction, centered on TCA. Fails soft: if either NORAD ID can't be
 * parsed, the backend is unreachable, or either object isn't in its
 * catalog, this returns data: null rather than throwing — callers should
 * fall back to illustrative/mock content in that case, the same way
 * Globe3D already falls back to the 2D view when WebGL is unavailable.
 */
export function useConjunctionTrajectories(
  primaryNoradId: string,
  secondaryNoradId: string,
  tcaIso: string
): { data: TrajectoryPair | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<TrajectoryPair | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const primaryId = Number(primaryNoradId);
    const secondaryId = Number(secondaryNoradId);

    if (!Number.isFinite(primaryId) || !Number.isFinite(secondaryId) || !tcaIso) {
      // Intentional: resets to a clean empty state when the inputs aren't
      // usable, before any async work would otherwise begin.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const tcaMs = new Date(tcaIso).getTime();
    const nowMs = Date.now();
    const isHistorical = !Number.isFinite(tcaMs) || tcaMs < nowMs - 7 * 24 * 60 * 60 * 1000;

    if (isHistorical) {
      // The catalog only accepts recent GP epochs; stale mock dates can cause a
      // continuous stream of 422s from the propagation endpoint. Skip the live
      // trajectory fetch instead of repeatedly hitting the backend with invalid
      // historical windows.
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const anchorMs = tcaMs;
    const startIso = new Date(anchorMs - 60 * 60 * 1000).toISOString();
    const endIso = new Date(anchorMs + 60 * 60 * 1000).toISOString();

    Promise.all([
      getTrajectory({ norad_cat_id: primaryId, start_time: startIso, end_time: endIso, step_seconds: 60 }),
      getTrajectory({ norad_cat_id: secondaryId, start_time: startIso, end_time: endIso, step_seconds: 60 }),
    ])
      .then(([primaryTraj, secondaryTraj]) => {
        if (cancelled) return;
        const primary = pathFromTrajectory(primaryTraj.states);
        const secondary = pathFromTrajectory(secondaryTraj.states);
        setData({
          primary,
          secondary,
          separationTrace: deriveSeparationTrace(primary, secondary, tcaMs),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? `${err.status}: ${err.message}` : "backend unreachable";
        setError(message);
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primaryNoradId, secondaryNoradId, tcaIso]);

  return { data, loading, error };
}