"use client";

export default function ScopeTrace({
  trace,
  minKm,
  progress,
}: {
  trace: { t_minutes: number; distance_km: number }[];
  minKm: number;
  /** 0..1 — when provided, replaces the decorative CSS sweep with a
   *  data-positioned "now" marker synced to Globe3D/OrbitSchematic. */
  progress?: number;
}) {
  const width = 600;
  const height = 180;
  const padX = 36;
  const padY = 18;

  if (trace.length < 2) {
    return (
      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
        Not enough separation data to plot a trace for this pair.
      </p>
    );
  }

  const tMin = trace[0].t_minutes;
  const tMax = trace[trace.length - 1].t_minutes;
  const dMax = Math.max(...trace.map((p) => p.distance_km));

  const timeSpan = tMax - tMin || 1;
  const distSpan = dMax || 1;

  const x = (t: number) => padX + ((t - tMin) / timeSpan) * (width - padX * 2);
  const y = (d: number) => height - padY - (d / distSpan) * (height - padY * 2);

  const points = trace.map((p) => `${x(p.t_minutes).toFixed(1)},${y(p.distance_km).toFixed(1)}`).join(" ");
  const areaPoints = `${x(tMin)},${height - padY} ${points} ${x(tMax)},${height - padY}`;

  const tcaX = x(0);
  const minPoint = trace.reduce((min, p) => (p.distance_km < min.distance_km ? p : min), trace[0]);
  const gridLines = 5;

  // Interpolate distance at the current synced time, for a smooth "now" dot.
  let nowMarker: { x: number; y: number; t: number; d: number } | null = null;
  if (progress !== undefined) {
    const currentT = tMin + progress * timeSpan;
    let i = 0;
    while (i < trace.length - 2 && trace[i + 1].t_minutes < currentT) i++;
    const a = trace[i];
    const b = trace[Math.min(i + 1, trace.length - 1)];
    const span = b.t_minutes - a.t_minutes || 1;
    const localT = Math.min(1, Math.max(0, (currentT - a.t_minutes) / span));
    const d = a.distance_km + (b.distance_km - a.distance_km) * localT;
    nowMarker = { x: x(currentT), y: y(d), t: currentT, d };
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Separation over time, converging to a minimum of ${minKm.toFixed(1)} kilometers near the time of closest approach`}
      >
        {Array.from({ length: gridLines }).map((_, i) => {
          const gy = padY + (i * (height - padY * 2)) / (gridLines - 1);
          return <line key={i} x1={padX} x2={width - padX} y1={gy} y2={gy} stroke="var(--border)" strokeWidth={1} />;
        })}

        <line x1={tcaX} x2={tcaX} y1={padY} y2={height - padY} stroke="var(--border-strong)" strokeDasharray="2 3" strokeWidth={1} />
        <text x={tcaX} y={height - 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          TCA
        </text>

        <polygon points={areaPoints} fill="var(--accent-glow)" opacity={0.5} />
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={x(minPoint.t_minutes)} cy={y(minPoint.distance_km)} r={4} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />
        <text x={x(minPoint.t_minutes)} y={y(minPoint.distance_km) - 10} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--accent)">
          {minKm.toFixed(2)} km
        </text>

        {nowMarker ? (
          <>
            <line x1={nowMarker.x} x2={nowMarker.x} y1={padY} y2={height - padY} stroke="var(--text-primary)" strokeWidth={1} opacity={0.6} />
            <circle cx={nowMarker.x} cy={nowMarker.y} r={4} fill="var(--text-primary)" />
            <text x={nowMarker.x} y={padY - 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-primary)">
              {nowMarker.d.toFixed(1)} km
            </text>
          </>
        ) : (
          <rect x={0} y={padY} width={2} height={height - padY * 2} fill="var(--text-primary)" opacity={0.5} className="scope-sweep" />
        )}

        <text x={padX} y={12} fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          -{Math.abs(tMin)}m
        </text>
        <text x={width - padX} y={12} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          +{tMax}m
        </text>
      </svg>
      {progress === undefined && (
        <style>{`
          .scope-sweep { animation: sweep-x 5s linear infinite; }
          @keyframes sweep-x {
            0% { transform: translateX(${padX}px); opacity: 0; }
            8% { opacity: 0.5; }
            92% { opacity: 0.5; }
            100% { transform: translateX(${width - padX}px); opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .scope-sweep { display: none; }
          }
        `}</style>
      )}
    </div>
  );
}