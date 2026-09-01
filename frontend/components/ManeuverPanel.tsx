"use client";

import { useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { ApiError, evaluateManeuver, ManeuverResponse } from "@/lib/api";
import { formatUTC } from "@/lib/format";

const HOURS_BEFORE_TCA_MAX = 48;
const SEARCH_BUFFER_HOURS = 6;

function slider(
  label: string,
  value: number,
  setValue: (v: number) => void,
  min: number,
  max: number,
  step: number,
  unit: string
) {
  return (
    <label className="flex items-center gap-3">
      <span className="font-mono text-[11px] w-20 shrink-0" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono text-[11px] tabular w-20 text-right" style={{ color: "var(--accent)" }}>
        {value.toFixed(1)} {unit}
      </span>
    </label>
  );
}

export default function ManeuverPanel({ event }: { event: ConjunctionEvent }) {
  const [radial, setRadial] = useState(0);
  const [transverse, setTransverse] = useState(-0.5);
  const [normal, setNormal] = useState(0);
  const [hoursBeforeTca, setHoursBeforeTca] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManeuverResponse | null>(null);

  async function runEvaluation() {
    setLoading(true);
    setError(null);
    setResult(null);
    const tcaMs = new Date(event.tca).getTime();
    const burnTime = new Date(tcaMs - hoursBeforeTca * 3_600_000);
    const searchEnd = new Date(tcaMs + SEARCH_BUFFER_HOURS * 3_600_000);
    try {
      const res = await evaluateManeuver({
        primary_norad_cat_id: Number(event.primary.norad_id),
        secondary_norad_cat_id: Number(event.secondary.norad_id),
        burn_time: burnTime.toISOString(),
        radial_m_s: radial,
        transverse_m_s: transverse,
        normal_m_s: normal,
        search_start: burnTime.toISOString(),
        search_end: searchEnd.toISOString(),
        baseline_miss_distance_km: event.miss_distance_km,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : "backend unreachable or timed out");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
          what-if: avoidance maneuver
        </span>
      </div>

      <div className="flex flex-col gap-2.5 mb-4">
        {slider("radial", radial, setRadial, -3, 3, 0.1, "m/s")}
        {slider("in-track", transverse, setTransverse, -3, 3, 0.1, "m/s")}
        {slider("cross-track", normal, setNormal, -3, 3, 0.1, "m/s")}
        {slider("burn time", hoursBeforeTca, setHoursBeforeTca, 0.5, HOURS_BEFORE_TCA_MAX, 0.5, "h before TCA")}
      </div>

      <button
        onClick={runEvaluation}
        disabled={loading}
        className="w-full px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.08em] transition-colors disabled:opacity-50"
        style={{ color: "var(--bg)", background: "var(--accent)", border: "1px solid var(--border-strong)" }}
      >
        {loading ? "evaluating…" : "evaluate maneuver"}
      </button>

      {error && (
        <p className="text-xs mt-3" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 pt-4 border-t flex flex-col gap-2.5" style={{ borderColor: "var(--border)" }}>
          {result.new_miss_distance_km === null ? (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {result.notes[result.notes.length - 1] ?? "No result for this burn."}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Miss distance</span>
                <span className="font-mono tabular">
                  {result.baseline_miss_distance_km.toFixed(2)} km → {result.new_miss_distance_km.toFixed(2)} km
                </span>
              </div>
              {result.new_tca && (
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>New TCA</span>
                  <span className="font-mono tabular text-xs">{formatUTC(result.new_tca)}</span>
                </div>
              )}
              {result.new_relative_velocity_km_s !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Relative velocity</span>
                  <span className="font-mono tabular">{result.new_relative_velocity_km_s.toFixed(2)} km/s</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>Clears threshold</span>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                  style={
                    result.cleared_threshold
                      ? { color: "var(--safe)", background: "var(--safe-glow)" }
                      : { color: "var(--critical)", background: "var(--critical-glow)" }
                  }
                >
                  {result.cleared_threshold ? "yes" : "no"}
                </span>
              </div>
            </>
          )}
          <ul className="mt-1 space-y-1">
            {result.notes.map((n) => (
              <li key={n} className="flex gap-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                <span style={{ color: "var(--accent)" }}>—</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
