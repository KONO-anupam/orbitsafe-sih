"use client";

import { useMemo, useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { EventEvolution } from "@/lib/eventEvolution";
import { AssetExposure, computeAssetExposure, exposureLevel, notableAssets } from "@/lib/assetExposure";

function levelColor(level: "HIGH" | "MEDIUM" | "LOW"): { color: string; glow: string } {
  switch (level) {
    case "HIGH":
      return { color: "var(--critical)", glow: "var(--critical-glow)" };
    case "MEDIUM":
      return { color: "var(--medium)", glow: "var(--medium-glow)" };
    default:
      return { color: "var(--text-tertiary)", glow: "var(--surface-2)" };
  }
}

export default function AssetExposurePanel({
  events,
  evolution,
  now,
  onSelectEvent,
}: {
  events: ConjunctionEvent[];
  evolution: Map<string, EventEvolution>;
  now: Date;
  onSelectEvent: (eventId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const assets = useMemo(() => {
    const all = computeAssetExposure(events, evolution, now);
    return notableAssets(all);
  }, [events, evolution, now]);

  if (assets.length === 0) return null;

  return (
    <div className="panel-card overflow-hidden">
      <div
        className="px-5 py-4 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)" }}
      >
        <h2
          className="font-display text-sm font-semibold uppercase tracking-[0.1em]"
          style={{ color: "var(--text-secondary)" }}
        >
          Asset exposure
        </h2>
        <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {assets.length} asset{assets.length === 1 ? "" : "s"} with multiple conjunctions
        </span>
      </div>

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {assets.map((asset) => {
          const level = exposureLevel(asset);
          const { color, glow } = levelColor(level);
          const isExpanded = expandedId === asset.noradId;
          return (
            <div key={asset.noradId}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : asset.noradId)}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left transition-colors"
                style={{ background: isExpanded ? "var(--surface-2)" : "transparent" }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{asset.name}</div>
                  <div className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {asset.noradId} · {asset.objectType}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {asset.worseningCount > 0 && (
                    <span className="font-mono text-[11px]" style={{ color: "var(--critical)" }}>
                      {asset.worseningCount} worsening
                    </span>
                  )}
                  {asset.within12hCount > 0 && (
                    <span className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {asset.within12hCount} within 12h
                    </span>
                  )}
                  <span className="font-mono text-xs tabular" style={{ color: "var(--text-secondary)" }}>
                    {asset.eventCount} events
                  </span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                    style={{ color, background: glow }}
                  >
                    {level}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-3.5 flex flex-col gap-1.5">
                  {asset.events.map((event) => (
                    <button
                      key={event.event_id}
                      onClick={() => onSelectEvent(event.event_id)}
                      className="flex items-center justify-between text-left px-3 py-2 rounded-md transition-colors"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        vs {event.primary.norad_id === asset.noradId ? event.secondary.name : event.primary.name}
                      </span>
                      <span className="font-mono text-[11px] tabular" style={{ color: "var(--text-tertiary)" }}>
                        risk {event.risk_score} · {event.miss_distance_km.toFixed(1)} km
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
