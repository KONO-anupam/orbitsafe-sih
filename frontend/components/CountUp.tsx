"use client";

import { useEffect, useRef, useState } from "react";

export default function CountUp({
  value,
  decimals = 0,
  durationMs = 600,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      // Intentional: prefers-reduced-motion is only readable client-side,
      // so the immediate (unanimated) value must be set post-mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(value);
      prevRef.current = value;
      return;
    }

    const start = prevRef.current;
    const startTime = performance.now();

    let raf: number;
    function tick(t: number) {
      const progress = Math.min(1, (t - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (value - start) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display.toFixed(decimals)}</>;
}
