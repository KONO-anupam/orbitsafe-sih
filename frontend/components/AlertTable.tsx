"use client";

import { useMemo, useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { confidenceColor, formatUTC, severityColor, severityGlow, timeUntil } from "@/lib/format";

type SortKey = "risk_score" | "miss_distance_km" | "tca" | "relative_velocity_km_s";

export default function AlertTable({
  events,
  selectedId,
  onSelect,
  now,
}: {
  events: ConjunctionEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: Date;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("risk_score");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const av = sortKey === "tca" ? new Date(a[sortKey]).getTime() : a[sortKey];
      const bv = sortKey === "tca" ? new Date(b[sortKey]).getTime() : b[sortKey];
      return (av - bv) * sortDir;
    });
    return copy;
  }, [events, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const columns: { key: SortKey | "objects" | "confidence" | "status"; label: string }[] = [
    { key: "objects", label: "Objects" },
    { key: "tca", label: "TCA" },
    { key: "miss_distance_km", label: "Miss dist." },
    { key: "relative_velocity_km_s", label: "Rel. vel." },
    { key: "confidence", label: "Confidence" },
    { key: "risk_score", label: "Risk" },
  ];

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="font-mono text-xs tracking-[0.14em] uppercase mb-2" style={{ color: "var(--text-tertiary)" }}>
          no events in range
        </div>
        <p className="max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
          No candidate conjunctions fall within the current threshold and horizon. Widen the
          what-if controls above to screen a larger window.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* desktop table */}
      <table className="hidden md:table w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] font-normal cursor-pointer select-none"
                style={{ color: "var(--text-tertiary)" }}
                onClick={() =>
                  ["risk_score", "miss_distance_km", "tca", "relative_velocity_km_s"].includes(col.key)
                    ? toggleSort(col.key as SortKey)
                    : undefined
                }
              >
                {col.label}
                {col.key === sortKey && <span style={{ color: "var(--accent)" }}> {sortDir === 1 ? "↑" : "↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr
              key={e.event_id}
              onClick={() => onSelect(e.event_id)}
              className="border-b cursor-pointer transition-colors"
              style={{
                borderColor: "var(--border)",
                background: selectedId === e.event_id ? "var(--surface-2)" : "transparent",
                borderLeft: `3px solid ${selectedId === e.event_id ? "var(--accent)" : "transparent"}`,
              }}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-6 shrink-0 rounded-full"
                    style={{ background: severityColor(e.severity) }}
                    aria-hidden
                  />
                  <div>
                    <div className="text-sm font-medium">{e.primary.name}</div>
                    <div className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      vs {e.secondary.name}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs tabular" style={{ color: "var(--text-secondary)" }}>
                {timeUntil(e.tca, now)}
                <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  {formatUTC(e.tca).slice(5, 16)}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-sm tabular">{e.miss_distance_km.toFixed(1)} km</td>
              <td className="px-4 py-3 font-mono text-sm tabular" style={{ color: "var(--text-secondary)" }}>
                {e.relative_velocity_km_s.toFixed(1)} km/s
              </td>
              <td className="px-4 py-3">
                <span
                  className="font-mono text-[11px] px-1.5 py-0.5 border rounded-md"
                  style={{ color: confidenceColor(e.confidence), borderColor: confidenceColor(e.confidence) + "55" }}
                >
                  {e.confidence}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div
                    className="font-display font-semibold tabular text-sm"
                    style={{ color: severityColor(e.severity) }}
                  >
                    {e.risk_score}
                  </div>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                    style={{ color: severityColor(e.severity), background: severityGlow(e.severity) }}
                  >
                    {e.severity}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* mobile cards */}
      <div className="md:hidden divide-y" style={{ borderColor: "var(--border)" }}>
        {sorted.map((e) => (
          <button
            key={e.event_id}
            onClick={() => onSelect(e.event_id)}
            className="w-full text-left px-4 py-3.5 flex flex-col gap-2"
            style={{
              background: selectedId === e.event_id ? "var(--surface-2)" : "transparent",
              borderBottom: "1px solid var(--border)",
              borderLeft: `3px solid ${selectedId === e.event_id ? "var(--accent)" : "transparent"}`,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{e.primary.name}</span>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                style={{ color: severityColor(e.severity), background: severityGlow(e.severity) }}
              >
                {e.severity}
              </span>
            </div>
            <div className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              vs {e.secondary.name}
            </div>
            <div className="flex items-center justify-between font-mono text-xs tabular" style={{ color: "var(--text-secondary)" }}>
              <span>{e.miss_distance_km.toFixed(1)} km · {e.relative_velocity_km_s.toFixed(1)} km/s</span>
              <span style={{ color: severityColor(e.severity) }} className="font-display font-semibold">
                {e.risk_score}
              </span>
            </div>
            <div className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              TCA in {timeUntil(e.tca, now)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}