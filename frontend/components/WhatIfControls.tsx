"use client";

export default function WhatIfControls({
  threshold,
  setThreshold,
  horizon,
  setHorizon,
  matchCount,
  isDirty,
  onRunScreening,
  loading,
}: {
  threshold: number;
  setThreshold: (v: number) => void;
  horizon: number;
  setHorizon: (v: number) => void;
  matchCount: number;
  isDirty: boolean;
  onRunScreening: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="text-[10px] uppercase tracking-[0.14em] font-mono px-1.5 py-0.5 border rounded-md"
          style={{ color: "var(--accent)", borderColor: "var(--border-strong)" }}
        >
          what-if
        </span>
        <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
          {matchCount} matching
        </span>
      </div>

      <label className="flex-1 flex items-center gap-3 min-w-[220px]">
        <span className="font-mono text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
          threshold
        </span>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="orbit-slider flex-1"
          aria-label="Screening distance threshold in kilometers"
        />
        <span className="font-mono text-xs tabular w-16 text-right" style={{ color: "var(--accent)" }}>
          {threshold} km
        </span>
      </label>

      <label className="flex-1 flex items-center gap-3 min-w-[220px]">
        <span className="font-mono text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
          horizon
        </span>
        <input
          type="range"
          min={6}
          max={72}
          step={6}
          value={horizon}
          onChange={(e) => setHorizon(Number(e.target.value))}
          className="orbit-slider flex-1"
          aria-label="Forecast horizon in hours"
        />
        <span className="font-mono text-xs tabular w-16 text-right" style={{ color: "var(--accent)" }}>
          {horizon} h
        </span>
      </label>

      {/* Screening is expensive (can take minutes over the full catalog),
          so slider changes are staged locally and only sent to the backend
          when this button is pressed — not on every drag tick. */}
      <button
        onClick={onRunScreening}
        disabled={loading}
        className="shrink-0 px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.08em] transition-colors disabled:opacity-50"
        style={{
          color: isDirty && !loading ? "var(--bg)" : "var(--text-secondary)",
          background: isDirty && !loading ? "var(--accent)" : "var(--surface-2)",
          border: "1px solid var(--border-strong)",
        }}
      >
        {loading ? "screening…" : isDirty ? "run screening" : "re-run"}
      </button>

      <style>{`
        .orbit-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 999px;
          background: var(--border-strong);
          outline: none;
        }
        .orbit-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: 3px solid var(--surface);
          cursor: pointer;
          box-shadow: 0 0 0 1px var(--border-strong);
        }
        .orbit-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: 3px solid var(--surface);
          cursor: pointer;
          box-shadow: 0 0 0 1px var(--border-strong);
        }
      `}</style>
    </div>
  );
}