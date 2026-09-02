"use client";

import { useCallback, useState } from "react";
import { ApiError, ManeuverSimulationParams, ManeuverSimulationResponse, simulateManeuver } from "./api";

export interface ManeuverSimulationState {
  result: ManeuverSimulationResponse | null;
  loading: boolean;
  error: string | null;
  run: (params: ManeuverSimulationParams) => void;
  reset: () => void;
}

export function useManeuverSimulation(): ManeuverSimulationState {
  const [result, setResult] = useState<ManeuverSimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((params: ManeuverSimulationParams) => {
    setLoading(true);
    setError(null);
    simulateManeuver(params)
      .then((res) => setResult(res))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? `${err.status}: ${err.message}` : "simulation failed or timed out";
        setError(message);
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, run, reset };
}
