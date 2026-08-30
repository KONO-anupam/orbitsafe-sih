import { ConjunctionEvent } from "@/lib/types";
import { ObjectCountSource } from "@/lib/useLiveObjectCount";
import CountUp from "./CountUp";

export default function SummaryStats({
  events,
  objectsTracked,
  objectsTrackedSource,
}: {
  events: ConjunctionEvent[];
  objectsTracked: number;
  objectsTrackedSource?: ObjectCountSource;
}) {
  const highRisk = events.filter((e) => e.severity === "CRITICAL" || e.severity === "HIGH").length;
  const nearest = events.reduce((min, e) => Math.min(min, e.miss_distance_km), Infinity);
  const oldestAge = events.reduce((max, e) => Math.max(max, e.data_age_hours), 0);

  const stats: {
    label: string;
    value: number;
    suffix: string;
    decimals?: number;
    accent?: boolean;
    tag?: string;
  }[] = [
    {
      label: "Objects tracked",
      value: objectsTracked,
      suffix: "",
      tag: objectsTrackedSource === "mock" ? "mock" : undefined,
    },
    { label: "Conjunctions detected", value: events.length, suffix: "" },
    { label: "High-risk events", value: highRisk, suffix: "", accent: highRisk > 0 },
    { label: "Nearest approach", value: nearest === Infinity ? 0 : nearest, suffix: " km", decimals: 1 },
    { label: "Oldest data age", value: oldestAge, suffix: " h" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0" style={{ borderColor: "var(--border)" }}>
      {stats.map((s) => (
        <div key={s.label} className="p-4" style={{ borderColor: "var(--border)" }}>
          <div
            className="text-[10px] uppercase tracking-[0.14em] font-mono mb-1.5 flex items-center gap-1.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {s.label}
            {s.tag && (
              <span
                className="px-1 py-0.5 rounded-sm text-[8px]"
                style={{ color: "var(--medium)", background: "var(--medium-glow)" }}
              >
                {s.tag}
              </span>
            )}
          </div>
          <div
            className="font-display text-2xl sm:text-3xl font-semibold tabular"
            style={{ color: s.accent ? "var(--critical)" : "var(--text-primary)" }}
          >
            <CountUp value={s.value} decimals={s.decimals ?? 0} />
            <span className="text-base font-mono" style={{ color: "var(--text-tertiary)" }}>
              {s.suffix}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}