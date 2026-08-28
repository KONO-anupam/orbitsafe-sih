"use client";

import { useEffect, useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { confidenceColor, formatUTC, severityColor, severityGlow } from "@/lib/format";
import ScopeTrace from "./ScopeTrace";
import OrbitSchematic from "./OrbitSchematic";
import Globe3D from "./Globe3D";

export default function EventDetailPanel({
  event,
  onClose,
}: {
  event: ConjunctionEvent | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [globeUnavailable, setGlobeUnavailable] = useState(false);

  // Reset to 3D for each newly selected event, unless this device already
  // told us 3D isn't supported.
  useEffect(() => {
    // Intentional: resets the view when the selected event changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!globeUnavailable) setView("3d");
  }, [event?.event_id, globeUnavailable]);

  if (!event) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--text-tertiary)" }}>
          no event selected
        </div>
        <p className="text-sm max-w-xs" style={{ color: "var(--text-secondary)" }}>
          Select a conjunction from the list to inspect its orbit geometry, separation trace, and
          score breakdown.
        </p>
      </div>
    );
  }

  const sevColor = severityColor(event.severity);

  return (
    <div className="h-full overflow-y-auto animate-rise-in p-4 sm:p-5 flex flex-col gap-6">
      {/* header card */}
      <div className="panel-card p-5 flex items-start justify-between gap-3">
        <div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-md inline-block mb-2"
            style={{ color: sevColor, background: severityGlow(event.severity) }}
          >
            {event.severity} · confidence {event.confidence}
          </div>
          <h2 className="font-display text-lg font-semibold leading-tight">
            {event.primary.name}
          </h2>
          <div className="font-mono text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            vs {event.secondary.name} · {event.secondary.norad_id}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 w-8 h-8 flex items-center justify-center border rounded-md font-mono text-sm transition-colors"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          aria-label="Close event detail"
        >
          ×
        </button>
      </div>

      {/* orbit geometry card: 3D globe with 2D fallback */}
      <div className="panel-card p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
            orbit geometry
          </span>
          {event.orbit3d && !globeUnavailable && (
            <div className="flex border rounded-md overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {(["3d", "2d"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors"
                  style={{
                    color: view === v ? "var(--bg)" : "var(--text-tertiary)",
                    background: view === v ? "var(--accent)" : "transparent",
                  }}
                  aria-pressed={view === v}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* The canvas container holds ONLY the globe — nothing is absolutely
            positioned on top of it. The caption below is a normal static
            block in the card's own flow, never an overlay on the canvas. */}
        {view === "3d" && event.orbit3d && !globeUnavailable ? (
          <div className="flex flex-col gap-2.5">
            <div className="h-64 sm:h-72 rounded-lg overflow-hidden" style={{ background: "var(--bg)" }}>
              <Globe3D
                primaryElements={event.orbit3d.primary}
                secondaryElements={event.orbit3d.secondary}
                secondaryColor={sevColor}
                onUnavailable={() => {
                  setGlobeUnavailable(true);
                  setView("2d");
                }}
              />
            </div>
            <p className="font-mono text-[9px] text-center" style={{ color: "var(--text-tertiary)" }}>
              drag to rotate · scroll or pinch to zoom
            </p>
          </div>
        ) : (
          <OrbitSchematic altitudeKm={event.altitude_km} severityColor={sevColor} />
        )}
      </div>

      {/* separation trace card */}
      <div className="panel-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
            separation vs. time
          </span>
          <span className="flex-1 h-px" style={{ background: "var(--border)" }} aria-hidden />
          <span className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            TCA {formatUTC(event.tca)}
          </span>
        </div>
        {event.separation_trace && (
          <ScopeTrace trace={event.separation_trace} minKm={event.miss_distance_km} />
        )}
      </div>

      {/* score breakdown card */}
      <div className="panel-card p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
            why flagged
          </span>
          <span className="font-display font-semibold text-xl tabular" style={{ color: sevColor }}>
            {event.risk_score}<span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>/100</span>
          </span>
        </div>
        <dl className="space-y-1.5">
          {event.score_breakdown?.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <dt style={{ color: "var(--text-secondary)" }}>{row.label}</dt>
              <dd className="font-mono tabular">{row.value}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm pt-1">
            <dt style={{ color: "var(--text-secondary)" }}>Prediction confidence</dt>
            <dd className="font-mono" style={{ color: confidenceColor(event.confidence) }}>
              {event.confidence}
            </dd>
          </div>
        </dl>
      </div>

      {/* limitations card */}
      <div className="panel-card p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--text-tertiary)" }}>
          limitations
        </div>
        <ul className="space-y-1.5">
          {event.limitations.map((l) => (
            <li key={l} className="flex gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent)" }}>—</span>
              {l}
            </li>
          ))}
        </ul>
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          Source: {event.source} · Method: {event.method}. This is a nominal screening estimate,
          not a probability of collision — standard TLE/OMM data carries no covariance.
        </p>
      </div>
    </div>
  );
}