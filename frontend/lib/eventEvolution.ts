/**
 * lib/eventEvolution.ts
 *
 * Diffs the current screening result against the previous successful one,
 * entirely client-side — the backend has no concept of "runs" or history.
 *
 * Pairs are matched on (primary.norad_id, secondary.norad_id), NOT
 * event_id: event_id embeds the refined TCA, which shifts slightly run to
 * run even for the same conjunction, so matching on event_id would treat
 * every re-screen as a brand new event.
 */

import { ConjunctionEvent } from "./types";

export type EvolutionStatus = "new" | "worsening" | "stable" | "improving";

export interface EvolutionDelta {
  label: string;
  from: string;
  to: string;
  // Signed magnitude used only to rank which factor drove the change most.
  // Positive = moved in the more-concerning direction.
  changeFrac: number;
}

export interface EventEvolution {
  status: EvolutionStatus;
  previous: ConjunctionEvent | null; // null only when status === "new"
  current: ConjunctionEvent;
  scoreDelta: number;
  deltas: EvolutionDelta[];
  primaryDriver: EvolutionDelta | null;
}

export interface EvolutionResult {
  byEventId: Map<string, EventEvolution>;
  resolvedCount: number;
}

// Score moves smaller than this are noise (refinement jitter, minor data
// updates) rather than a meaningful priority change.
const STABLE_SCORE_THRESHOLD = 5;

function pairKey(e: ConjunctionEvent): string {
  const ids = [e.primary.norad_id, e.secondary.norad_id].sort();
  return `${ids[0]}::${ids[1]}`;
}

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 1;
  return (to - from) / Math.abs(from);
}

function buildDeltas(previous: ConjunctionEvent, current: ConjunctionEvent): EvolutionDelta[] {
  const nowMs = Date.now();
  const prevTcaHours = (new Date(previous.tca).getTime() - nowMs) / 3_600_000;
  const currTcaHours = (new Date(current.tca).getTime() - nowMs) / 3_600_000;

  return [
    {
      label: "Miss distance",
      from: `${previous.miss_distance_km.toFixed(1)} km`,
      to: `${current.miss_distance_km.toFixed(1)} km`,
      // A shrinking miss distance is more concerning — flip sign so smaller
      // distance registers as a positive (concerning) change.
      changeFrac: -pctChange(previous.miss_distance_km, current.miss_distance_km),
    },
    {
      label: "Time to TCA",
      from: `${prevTcaHours.toFixed(1)}h`,
      to: `${currTcaHours.toFixed(1)}h`,
      changeFrac: -pctChange(prevTcaHours, currTcaHours),
    },
    {
      label: "Relative velocity",
      from: `${previous.relative_velocity_km_s.toFixed(1)} km/s`,
      to: `${current.relative_velocity_km_s.toFixed(1)} km/s`,
      changeFrac: pctChange(previous.relative_velocity_km_s, current.relative_velocity_km_s),
    },
    {
      label: "Data age",
      from: `${previous.data_age_hours.toFixed(1)}h`,
      to: `${current.data_age_hours.toFixed(1)}h`,
      changeFrac: -pctChange(previous.data_age_hours, current.data_age_hours),
    },
  ];
}

export function computeEvolution(
  currentEvents: ConjunctionEvent[],
  previousEvents: ConjunctionEvent[] | null
): EvolutionResult {
  const byEventId = new Map<string, EventEvolution>();

  if (!previousEvents || previousEvents.length === 0) {
    // First successful run ever — nothing to compare against.
    return { byEventId, resolvedCount: 0 };
  }

  const previousByPair = new Map<string, ConjunctionEvent>();
  for (const event of previousEvents) previousByPair.set(pairKey(event), event);

  const currentPairs = new Set<string>();

  for (const current of currentEvents) {
    const key = pairKey(current);
    currentPairs.add(key);
    const previous = previousByPair.get(key);

    if (!previous) {
      byEventId.set(current.event_id, {
        status: "new",
        previous: null,
        current,
        scoreDelta: 0,
        deltas: [],
        primaryDriver: null,
      });
      continue;
    }

    const scoreDelta = current.risk_score - previous.risk_score;
    const status: EvolutionStatus =
      Math.abs(scoreDelta) < STABLE_SCORE_THRESHOLD ? "stable" : scoreDelta > 0 ? "worsening" : "improving";
    const deltas = buildDeltas(previous, current);
    const primaryDriver =
      status === "stable"
        ? null
        : deltas.reduce((max, d) => (Math.abs(d.changeFrac) > Math.abs(max.changeFrac) ? d : max), deltas[0]);

    byEventId.set(current.event_id, { status, previous, current, scoreDelta, deltas, primaryDriver });
  }

  let resolvedCount = 0;
  for (const key of previousByPair.keys()) {
    if (!currentPairs.has(key)) resolvedCount++;
  }

  return { byEventId, resolvedCount };
}