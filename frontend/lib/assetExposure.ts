/**
 * lib/assetExposure.ts
 *
 * Aggregates the flat event list into per-asset exposure summaries —
 * "which spacecraft is under the most conjunction pressure" rather than
 * "here are N independent rows." Purely a client-side derivation of
 * events already fetched by useScreening; no backend involvement.
 *
 * An asset here is any object appearing as `primary` OR `secondary` on at
 * least one event — for a payload/station that's usually the object an
 * operator actually controls, but debris/rocket-body objects can also be
 * the "asset" side of view if they're the higher-value counterpart.
 */

import { ConjunctionEvent } from "./types";
import { EventEvolution, EvolutionStatus } from "./eventEvolution";

export interface AssetExposure {
  noradId: string;
  name: string;
  objectType: ConjunctionEvent["primary"]["object_type"];
  eventCount: number;
  worseningCount: number;
  within12hCount: number;
  criticalCount: number;
  maxRiskScore: number;
  events: ConjunctionEvent[];
}

export function computeAssetExposure(
  events: ConjunctionEvent[],
  evolutionByEventId: Map<string, EventEvolution>,
  now: Date
): AssetExposure[] {
  const byAsset = new Map<string, AssetExposure>();

  for (const event of events) {
    for (const ref of [event.primary, event.secondary]) {
      let exposure = byAsset.get(ref.norad_id);
      if (!exposure) {
        exposure = {
          noradId: ref.norad_id,
          name: ref.name,
          objectType: ref.object_type,
          eventCount: 0,
          worseningCount: 0,
          within12hCount: 0,
          criticalCount: 0,
          maxRiskScore: 0,
          events: [],
        };
        byAsset.set(ref.norad_id, exposure);
      }
      exposure.eventCount += 1;
      exposure.maxRiskScore = Math.max(exposure.maxRiskScore, event.risk_score);
      exposure.events.push(event);
      if (event.severity === "CRITICAL") exposure.criticalCount += 1;

      const status: EvolutionStatus | undefined = evolutionByEventId.get(event.event_id)?.status;
      if (status === "worsening") exposure.worseningCount += 1;

      const hoursToTca = (new Date(event.tca).getTime() - now.getTime()) / 3_600_000;
      if (hoursToTca >= 0 && hoursToTca <= 12) exposure.within12hCount += 1;
    }
  }

  return Array.from(byAsset.values()).sort((a, b) => {
    if (b.maxRiskScore !== a.maxRiskScore) return b.maxRiskScore - a.maxRiskScore;
    return b.eventCount - a.eventCount;
  });
}

export function exposureLevel(exposure: AssetExposure): "HIGH" | "MEDIUM" | "LOW" {
  if (exposure.criticalCount > 0 || exposure.eventCount >= 4) return "HIGH";
  if (exposure.eventCount >= 2) return "MEDIUM";
  return "LOW";
}

// Only surface assets that actually matter as a distinct "watch this
// spacecraft" entry — pure single-counterpart debris/rocket-body objects
// with just one event add noise, not signal, to this view.
export function notableAssets(exposures: AssetExposure[]): AssetExposure[] {
  return exposures.filter((e) => e.eventCount >= 2 || e.criticalCount > 0);
}
