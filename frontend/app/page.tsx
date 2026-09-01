"use client";

import { useEffect, useState } from "react";
import MissionBar from "@/components/MissionBar";
import SummaryStats from "@/components/SummaryStats";
import WhatIfControls from "@/components/WhatIfControls";
import AlertTable from "@/components/AlertTable";
import EventDetailPanel from "@/components/EventDetailPanel";
import AssetExposurePanel from "@/components/AssetExposurePanel";
import { useLiveObjectCount } from "@/lib/useLiveObjectCount";
import { useScreening } from "@/lib/useScreening";
import { MissionProfileKey } from "@/lib/missionProfiles";

export default function Home() {
  // Pending values track the sliders instantly for UI feedback. Applied
  // values are what's actually sent to the backend, and only change when
  // "run screening" is pressed — screening is too expensive to fire on
  // every drag tick.
  const [pendingThreshold, setPendingThreshold] = useState(50);
  const [pendingHorizon, setPendingHorizon] = useState(72);
  const [pendingProfile, setPendingProfile] = useState<MissionProfileKey>("balanced");
  const [appliedThreshold, setAppliedThreshold] = useState(50);
  const [appliedHorizon, setAppliedHorizon] = useState(72);
  const [appliedProfile, setAppliedProfile] = useState<MissionProfileKey>("balanced");
  const [trigger, setTrigger] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const liveObjectCount = useLiveObjectCount();
  const screening = useScreening(appliedThreshold, appliedHorizon, trigger, appliedProfile);

  const isDirty =
    pendingThreshold !== appliedThreshold ||
    pendingHorizon !== appliedHorizon ||
    pendingProfile !== appliedProfile;

  function runScreening() {
    setAppliedThreshold(pendingThreshold);
    setAppliedHorizon(pendingHorizon);
    setAppliedProfile(pendingProfile);
    setTrigger((t) => t + 1);
  }

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!screening.loading) {
      // Intentional: resets the timer synchronously the moment a screening
      // attempt ends, so a stale elapsed count never lingers into the next
      // "screening…" cycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [screening.loading]);

  useEffect(() => {
    // Intentional: `now` starts null so server and first client render match
    // (no Date() during SSR), then this sets the real clock once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const stillPresent = screening.events.some((e) => e.event_id === selectedId);
    if (!stillPresent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(screening.events[0]?.event_id ?? null);
    }
  }, [screening.events, selectedId]);

  const selectedEvent = screening.events.find((e) => e.event_id === selectedId) ?? null;
  const selectedEvolution = selectedEvent ? screening.evolution.byEventId.get(selectedEvent.event_id) : undefined;

  function handleSelect(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  if (!now) {
    return (
      <div style={{ background: "var(--bg)" }} className="min-h-dvh">
        <MissionBar />
      </div>
    );
  }

  const statusLabel = screening.loading
    ? elapsedSeconds > 0
      ? `screening… ${elapsedSeconds}s`
      : "screening…"
    : screening.source === "live"
    ? "live"
    : screening.source === "stale"
    ? "last known — reconnecting"
    : "no live data";

  const statusStyle = screening.loading
    ? { color: "var(--text-tertiary)", background: "var(--surface-2)" }
    : screening.source === "live"
    ? { color: "var(--safe)", background: "var(--safe-glow)" }
    : screening.source === "stale"
    ? { color: "var(--medium)", background: "var(--medium-glow)" }
    : { color: "var(--critical)", background: "var(--critical-glow)" };

  return (
    <div style={{ background: "var(--bg)" }} className="min-h-dvh flex flex-col">
      <MissionBar />

      <main className="flex-1 flex flex-col gap-6 p-4 sm:p-6">
        <div className="panel-card overflow-hidden">
          <SummaryStats
            events={screening.events}
            objectsTracked={liveObjectCount.count}
            objectsTrackedSource={liveObjectCount.source}
          />
        </div>

        <div className="panel-card p-4 sm:p-5">
          <WhatIfControls
            threshold={pendingThreshold}
            setThreshold={setPendingThreshold}
            horizon={pendingHorizon}
            setHorizon={setPendingHorizon}
            missionProfile={pendingProfile}
            setMissionProfile={setPendingProfile}
            matchCount={screening.events.length}
            isDirty={isDirty}
            onRunScreening={runScreening}
            loading={screening.loading}
          />
        </div>

        <AssetExposurePanel
          events={screening.events}
          evolution={screening.evolution.byEventId}
          now={now}
          onSelectEvent={handleSelect}
        />

        <div className="flex-1 grid lg:grid-cols-[1fr_400px] gap-6 min-h-0">
          <section className="panel-card overflow-hidden min-w-0 flex flex-col">
            <div
              className="px-5 py-4 border-b flex items-center justify-between shrink-0"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <h1 className="font-display text-sm font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
                  Screened conjunctions
                </h1>
                <span
                  className="font-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md"
                  style={statusStyle}
                >
                  {statusLabel}
                </span>
                {screening.source !== "live" && !screening.loading && (
                  <button
                    onClick={screening.retry}
                    className="font-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-md border transition-colors"
                    style={{ color: "var(--text-secondary)", borderColor: "var(--border-strong)" }}
                  >
                    retry
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {screening.evolution.resolvedCount > 0 && (
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {screening.evolution.resolvedCount} resolved
                  </span>
                )}
                <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  sorted by risk
                </span>
              </div>
            </div>

            {screening.error && screening.source !== "live" && (
              <div
                className="px-5 py-2 border-b font-mono text-[10px]"
                style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
              >
                {screening.error}
              </div>
            )}

            {screening.source === "error" && screening.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="font-mono text-xs tracking-[0.14em] uppercase mb-2" style={{ color: "var(--critical)" }}>
                  no live data
                </div>
                <p className="max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
                  The screening backend is unreachable or the request timed out. This can take a
                  while over the full catalog — check that the backend is running, then retry.
                </p>
              </div>
            ) : (
              <AlertTable
                events={screening.events}
                selectedId={selectedId}
                onSelect={handleSelect}
                now={now}
                evolution={screening.evolution.byEventId}
                missionProfileActive={appliedProfile !== "balanced"}
              />
            )}
          </section>

          <aside className="hidden lg:block min-h-0">
            <EventDetailPanel event={selectedEvent} onClose={() => setSelectedId(null)} evolution={selectedEvolution} />
          </aside>
        </div>
      </main>
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
            <EventDetailPanel
              event={selectedEvent}
              onClose={() => setMobileDetailOpen(false)}
              evolution={selectedEvolution}
            />
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