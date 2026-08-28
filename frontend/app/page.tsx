"use client";

import { useEffect, useMemo, useState } from "react";
import MissionBar from "@/components/MissionBar";
import SummaryStats from "@/components/SummaryStats";
import WhatIfControls from "@/components/WhatIfControls";
import AlertTable from "@/components/AlertTable";
import EventDetailPanel from "@/components/EventDetailPanel";
import { conjunctions, objectsTracked } from "@/mocks/conjunctions";
import { useLiveObjectCount } from "@/lib/useLiveObjectCount";

export default function Home() {
  const [threshold, setThreshold] = useState(50);
  const [horizon, setHorizon] = useState(72);
  const [selectedId, setSelectedId] = useState<string | null>(conjunctions[0]?.event_id ?? null);
  const [now, setNow] = useState<Date | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const liveObjectCount = useLiveObjectCount();

  useEffect(() => {
    // Intentional: `now` starts null so server and first client render match
    // (no Date() during SSR), then this sets the real clock once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(
    () =>
      conjunctions.filter(
        (e) => e.miss_distance_km <= threshold && e.forecast_horizon_hours <= horizon
      ),
    [threshold, horizon]
  );

  const selectedEvent = filtered.find((e) => e.event_id === selectedId) ?? null;

  function handleSelect(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  if (!now) {
    // avoid hydration mismatch on the clock; render nothing on the very first tick
    return (
      <div style={{ background: "var(--bg)" }} className="min-h-dvh">
        <MissionBar />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)" }} className="min-h-dvh flex flex-col">
      {/* MissionBar stays the one full-bleed strip, deliberately — a sticky
          top instrument bar, like a real app's toolbar, is expected to sit
          flush with the viewport edge. Everything below it floats as cards
          on the void with real gaps, per the redesign. */}
      <MissionBar />

      <main className="flex-1 flex flex-col gap-6 p-4 sm:p-6">
        {/* summary stats card */}
        <div className="panel-card overflow-hidden">
          <SummaryStats events={filtered} objectsTracked={liveObjectCount ?? objectsTracked} />
        </div>

        {/* what-if controls card */}
        <div className="panel-card p-4 sm:p-5">
          <WhatIfControls
            threshold={threshold}
            setThreshold={setThreshold}
            horizon={horizon}
            setHorizon={setHorizon}
            matchCount={filtered.length}
          />
        </div>

        <div className="flex-1 grid lg:grid-cols-[1fr_400px] gap-6 min-h-0">
          {/* alert table card */}
          <section className="panel-card overflow-hidden min-w-0 flex flex-col">
            <div
              className="px-5 py-4 border-b flex items-center justify-between shrink-0"
              style={{ borderColor: "var(--border)" }}
            >
              <h1 className="font-display text-sm font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
                Screened conjunctions
              </h1>
              <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                sorted by risk
              </span>
            </div>
            <AlertTable events={filtered} selectedId={selectedId} onSelect={handleSelect} now={now} />
          </section>

          {/* detail panel — desktop, always visible; renders its own stack
              of panel-cards internally, spaced with the same gap-6 rhythm */}
          <aside className="hidden lg:block min-h-0">
            <EventDetailPanel event={selectedEvent} onClose={() => setSelectedId(null)} />
          </aside>
        </div>
      </main>

      {/* detail panel — mobile, slide-up sheet */}
      {mobileDetailOpen && selectedEvent && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <button
            className="absolute inset-0"
            style={{ background: "rgba(3,3,4,0.7)" }}
            onClick={() => setMobileDetailOpen(false)}
            aria-label="Close"
          />
          <div
            className="relative max-h-[85dvh] overflow-hidden border-t animate-rise-in rounded-t-xl"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          >
            <EventDetailPanel event={selectedEvent} onClose={() => setMobileDetailOpen(false)} />
          </div>
        </div>
      )}

      <footer
        className="px-4 sm:px-6 py-3 border-t font-mono text-[10px] flex flex-wrap gap-x-4 gap-y-1"
        style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
      >
        <span>ORBITSAFE — educational screening dashboard</span>
        <span>·</span>
        <span>Does not replace Space-Track or NASA CARA</span>
        <span>·</span>
        <span>Not an operational flight-safety system</span>
      </footer>
    </div>
  );
}