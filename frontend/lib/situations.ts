/**
 * lib/situations.ts
 *
 * Groups events into connected components by shared object — if event A
 * involves {X, Y} and event B involves {Y, Z}, they're the same situation
 * even though X and Z never directly co-occur. Purely a client-side
 * derivation of events already fetched by useScreening.
 *
 * This groups events that reference the same objects, not events that are
 * physically close to each other — a situation's objects are not
 * necessarily near one another in space.
 */

import { ConjunctionEvent } from "./types";
import { EventEvolution, EvolutionStatus } from "./eventEvolution";

export interface SituationObject {
  noradId: string;
  name: string;
  objectType: ConjunctionEvent["primary"]["object_type"];
}

export interface SituationEdge {
  fromNoradId: string;
  toNoradId: string;
  event: ConjunctionEvent;
}

export interface Situation {
  id: string;
  objects: SituationObject[];
  events: ConjunctionEvent[];
  edges: SituationEdge[];
  worseningCount: number;
  worstSeverity: ConjunctionEvent["severity"];
  maxRiskScore: number;
  nextTcaHours: number | null;
}

const SEVERITY_RANK: Record<ConjunctionEvent["severity"], number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    if (!this.parent.has(id)) this.parent.set(id, id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

export function computeSituations(
  events: ConjunctionEvent[],
  evolutionByEventId: Map<string, EventEvolution>,
  now: Date
): Situation[] {
  const uf = new UnionFind();
  for (const event of events) {
    uf.union(event.primary.norad_id, event.secondary.norad_id);
  }

  const groups = new Map<string, ConjunctionEvent[]>();
  for (const event of events) {
    const root = uf.find(event.primary.norad_id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(event);
  }

  const situations: Situation[] = [];
  for (const groupEvents of groups.values()) {
    const objectsById = new Map<string, SituationObject>();
    const edges: SituationEdge[] = [];
    let worseningCount = 0;
    let worstSeverity: ConjunctionEvent["severity"] = "LOW";
    let maxRiskScore = 0;
    let nextTcaHours: number | null = null;

    for (const event of groupEvents) {
      for (const ref of [event.primary, event.secondary]) {
        if (!objectsById.has(ref.norad_id)) {
          objectsById.set(ref.norad_id, {
            noradId: ref.norad_id,
            name: ref.name,
            objectType: ref.object_type,
          });
        }
      }
      edges.push({ fromNoradId: event.primary.norad_id, toNoradId: event.secondary.norad_id, event });

      const status: EvolutionStatus | undefined = evolutionByEventId.get(event.event_id)?.status;
      if (status === "worsening") worseningCount += 1;
      if (SEVERITY_RANK[event.severity] > SEVERITY_RANK[worstSeverity]) worstSeverity = event.severity;
      maxRiskScore = Math.max(maxRiskScore, event.risk_score);

      const hoursToTca = (new Date(event.tca).getTime() - now.getTime()) / 3_600_000;
      if (hoursToTca >= 0 && (nextTcaHours === null || hoursToTca < nextTcaHours)) nextTcaHours = hoursToTca;
    }

    const objects = Array.from(objectsById.values());
    situations.push({
      id: objects.map((o) => o.noradId).sort().join("::"),
      objects,
      events: groupEvents,
      edges,
      worseningCount,
      worstSeverity,
      maxRiskScore,
      nextTcaHours,
    });
  }

  return situations
    .filter((s) => s.events.length >= 2)
    .sort((a, b) => b.maxRiskScore - a.maxRiskScore);
}
