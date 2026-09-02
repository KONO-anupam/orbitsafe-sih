"use client";

import { useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { useManeuverSimulation } from "@/lib/useManeuverSimulation";

function statusMeta(status: string): { label: string; color: string } {
  switch (status) {
    case "new":
      return { label: "NEW CASCADE RISK", color: "var(--critical)" };
    case "worsened":
      return { label: "WORSENED", color: "var(--critical)" };
    case "resolved":
      return { label: "RESOLVED", color: "var(--safe)" };
    case "improved":
      return { label: "IMPROVED", color: "var(--safe)" };
    default:
      return { label: "UNCHANGED", color: "var(--text-tertiary)" };
  }
}

export default function ManeuverWhatIf({ event }: { event: ConjunctionEvent }) {
  const [target, setTarget] = useState<"primary" | "secondary">("primary");
  const [deltaV, setDeltaV] = useState(200);
  const [leadHours, setLeadHours] = useState(6);
  const { result, loading, error, run, reset } = useManeuverSimulation();

  const targetRef = target === "primary" ? event.primary : event.secondary;

  function handleSimulate() {
    run({
      norad_cat_id: Number(targetRef.norad_id),
      delta_v_m_s: deltaV,
      maneuver_lead_hours: leadHours,
      forecast_horizon_hours: event.forecast_horizon_hours,
    });
  }

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
          what-if maneuver
        </span>
        {result && (
          <button
            onClick={reset}
            className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 border rounded-md"
            style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}
          >
            clear
          </button>
        )}
      </div>

      {!result && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
              maneuver
            </span>
            <div className="flex border rounded-md overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["primary", "secondary"] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setTarget(side)}
                  className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors"
                  style={{
                    color: target === side ? "var(--bg)" : "var(--text-tertiary)",
                    background: target === side ? "var(--accent)" : "transparent",
                  }}
                >
                  {side === "primary" ? event.primary.name : event.secondary.name}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3">
            <span className="font-mono text-xs whitespace-nowrap w-24" style={{ color: "var(--text-secondary)" }}>
              delta-v
            </span>
            <input
              type="range"
              min={-500}
              max={500}
              step={10}
              value={deltaV}
              onChange={(e) => setDeltaV(Number(e.target.value))}
              className="flex-1"
              aria-label="Along-track delta-v in meters per second, prograde positive"
            />
            <span className="font-mono text-xs tabular w-20 text-right" style={{ color: "var(--accent)" }}>
              {deltaV > 0 ? "+" : ""}
              {deltaV} m/s
            </span>
          </label>

          <label className="flex items-center gap-3">
            <span className="font-mono text-xs whitespace-nowrap w-24" style={{ color: "var(--text-secondary)" }}>
              lead time
            </span>
            <input
              type="range"
              min={1}
              max={48}
              step={1}
              value={leadHours}
              onChange={(e) => setLeadHours(Number(e.target.value))}
              className="flex-1"
              aria-label="Hours from now until the hypothetical maneuver executes"
            />
            <span className="font-mono text-xs tabular w-20 text-right" style={{ color: "var(--accent)" }}>
              {leadHours} h
            </span>
          </label>

          <button
            onClick={handleSimulate}
            disabled={loading}
            className="self-start px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.08em] transition-colors disabled:opacity-50"
            style={{ color: "var(--bg)", background: "var(--accent)" }}
          >
            {loading ? "simulating…" : "simulate maneuver"}
          </button>

          {error && (
            <p className="text-xs" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {result.delta_v_m_s > 0 ? "+" : ""}
            {result.delta_v_m_s} m/s prograde on {result.target.name}, executed {new Date(result.maneuver_time).toUTCString().slice(0, 22)} UTC.
          </p>

          {result.comparison.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              No conjunctions found for this target after the maneuver time, before or after.
            </p>
          ) : (
            <dl className="space-y-1.5">
              {result.comparison.map((row, i) => {
                const meta = statusMeta(row.status);
                return (
                  <div key={i} className="flex items-center justify-between text-xs gap-2">
                    <dt className="truncate" style={{ color: "var(--text-secondary)" }}>
                      {row.secondary.name}
                    </dt>
                    <dd className="flex items-center gap-2 shrink-0 font-mono tabular">
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {row.before_risk_score ?? "—"} → {row.after_risk_score ?? "—"}
                      </span>
                      <span
                        className="text-[9px] uppercase tracking-[0.08em] px-1.5 py-0.5 border rounded-md"
                        style={{ color: meta.color, borderColor: meta.color + "55" }}
                      >
                        {meta.label}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          <ul className="space-y-1">
            {result.limitations.map((l) => (
              <li key={l} className="flex gap-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                <span style={{ color: "var(--accent)" }}>—</span>
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
