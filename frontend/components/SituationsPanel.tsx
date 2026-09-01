"use client";

import { useMemo, useState } from "react";
import { ConjunctionEvent } from "@/lib/types";
import { EventEvolution, EvolutionStatus } from "@/lib/eventEvolution";
import { computeSituations, Situation } from "@/lib/situations";
import { severityColor, severityGlow } from "@/lib/format";

function SituationGraph({ situation, size = 220 }: { situation: Situation; size?: number }) {
  const c = size / 2;
  const r = size / 2 - 28;
  const n = situation.objects.length;
  const positions = new Map<string, { x: number; y: number }>();
  situation.objects.forEach((obj, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    positions.set(obj.noradId, { x: c + r * Math.cos(angle), y: c + r * Math.sin(angle) });
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-auto"
      role="img"
      aria-label="Objects linked by shared conjunction events in this situation"
    >
      {situation.edges.map((edge, i) => {
        const from = positions.get(edge.fromNoradId)!;
        const to = positions.get(edge.toNoradId)!;
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={severityColor(edge.event.severity)}
            strokeWidth={1}
            opacity={0.5}
          />
        );
      })}
      {situation.objects.map((obj) => {
        const p = positions.get(obj.noradId)!;
        return (
          <g key={obj.noradId}>
            <circle cx={p.x} cy={p.y} r={5} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5} />
            <text
              x={p.x}
              y={p.y + (p.y > c ? 16 : -10)}
              textAnchor="middle"
              fontSize="8"
              fontFamily="var(--font-mono)"
              fill="var(--text-tertiary)"
            >
              {obj.name.length > 14 ? `${obj.name.slice(0, 13)}…` : obj.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SituationsPanel({
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

  const situations = useMemo(() => computeSituations(events, evolution, now), [events, evolution, now]);

  if (situations.length === 0) return null;

  return (
    <div className="panel-card overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
          Conjunction situations
        </h2>
        <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {situations.length} grouped from {events.length} events
        </span>
      </div>

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {situations.map((situation) => {
          const isExpanded = expandedId === situation.id;
          const sevColor = severityColor(situation.worstSeverity);
          return (
            <div key={situation.id}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : situation.id)}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left transition-colors"
                style={{ background: isExpanded ? "var(--surface-2)" : "transparent" }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {situation.objects.slice(0, 3).map((o) => o.name).join(" · ")}
                    {situation.objects.length > 3 ? ` +${situation.objects.length - 3}` : ""}
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {situation.objects.length} objects · {situation.events.length} events
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {situation.worseningCount > 0 && (
                    <span className="font-mono text-[11px]" style={{ color: "var(--critical)" }}>
                      {situation.worseningCount} worsening
                    </span>
                  )}
                  {situation.nextTcaHours !== null && (
                    <span className="font-mono text-[11px] tabular" style={{ color: "var(--text-secondary)" }}>
                      next TCA {situation.nextTcaHours.toFixed(1)}h
                    </span>
                  )}
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                    style={{ color: sevColor, background: severityGlow(situation.worstSeverity) }}
                  >
                    {situation.worstSeverity}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-4 flex flex-col gap-4">
                  {situation.objects.length >= 3 && (
                    <div className="flex flex-col gap-1.5">
                      <div className="w-full max-w-[260px] mx-auto">
                        <SituationGraph situation={situation} />
                      </div>
                      <p className="text-center font-mono text-[9px]" style={{ color: "var(--text-tertiary)" }}>
                        links show shared conjunction events, not physical proximity
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {situation.events.map((event) => (
                      <button
                        key={event.event_id}
                        onClick={() => onSelectEvent(event.event_id)}
                        className="flex items-center justify-between text-left px-3 py-2 rounded-md transition-colors"
                        style={{ background: "var(--surface-2)" }}
                      >
                        <span className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          {event.primary.name} vs {event.secondary.name}
                        </span>
                        <span className="font-mono text-[11px] tabular" style={{ color: "var(--text-tertiary)" }}>
                          risk {event.risk_score} · {event.miss_distance_km.toFixed(1)} km
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
