"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/format";
import { trustPanel } from "@/mocks/conjunctions";

export default function MissionBar() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Intentional: avoids SSR/client hydration mismatch on the live clock.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 border-b"
      style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.92)", backdropFilter: "blur(8px)" }}
    >
      {/* identity row */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          
          <span className="font-display font-semibold tracking-tight text-lg sm:text-xl">
            ORBITSAFE
          </span>
          <span
            className="hidden sm:inline text-[11px] uppercase tracking-[0.14em] px-2 py-0.5 border rounded-md font-mono"
            style={{ color: "var(--text-tertiary)", borderColor: "var(--border)" }}
          >
            screening
          </span>
        </div>
        <div className="font-mono text-xs sm:text-sm tabular" style={{ color: "var(--text-secondary)" }}>
          {now ? formatClock(now) : "--:--:-- UTC"}
        </div>
      </div>

      {/* trust panel strip */}
      <div
        className="hidden md:grid grid-cols-7 gap-px border-t text-[11px] font-mono"
        style={{ borderColor: "var(--border)", background: "var(--border)" }}
      >
        {[
          ["source", trustPanel.source],
          ["propagation", trustPanel.propagation],
          ["data age", trustPanel.data_age],
          ["horizon", trustPanel.forecast_horizon],
          ["step size", trustPanel.step_size],
          ["covariance", trustPanel.covariance],
          ["risk type", trustPanel.risk_type],
        ].map(([label, value]) => (
          <div key={label} className="px-3 py-1.5" style={{ background: "var(--bg)" }}>
            <div className="uppercase tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>
              {label}
            </div>
            <div className="mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}