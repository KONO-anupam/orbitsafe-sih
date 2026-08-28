"use client";

import { useEffect, useState } from "react";
import { ApiError, getTrajectory } from "./api";
import { Vec3, pathFromTrajectory } from "./orbitGeometry";

export interface TrajectoryPair {
  primary: Vec3[];
  secondary: Vec3[];
}

/**
 * Fetches real SGP4-propagated trajectories for both objects in a
 * conjunction, centered on TCA. Fails soft: if either NORAD ID can't be
 * parsed, the backend is unreachable, or either object isn't in its
 * catalog, this returns data: null rather than throwing — callers should
 * fall back to the synthetic illustrative orbit in that case, the same way
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

    if (!Number.isFinite(primaryId) || !Number.isFinite(secondaryId)) {
      // Intentional: resets to a clean empty state when the IDs aren't
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

    const tca = new Date(tcaIso).getTime();
    const startIso = new Date(tca - 60 * 60 * 1000).toISOString();
    const endIso = new Date(tca + 60 * 60 * 1000).toISOString();

    Promise.all([
      getTrajectory({ norad_cat_id: primaryId, start_time: startIso, end_time: endIso, step_seconds: 60 }),
      getTrajectory({ norad_cat_id: secondaryId, start_time: startIso, end_time: endIso, step_seconds: 60 }),
    ])
      .then(([primaryTraj, secondaryTraj]) => {
        if (cancelled) return;
        setData({
          primary: pathFromTrajectory(primaryTraj.states),
          secondary: pathFromTrajectory(secondaryTraj.states),
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