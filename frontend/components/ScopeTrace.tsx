"use client";

export default function ScopeTrace({
  trace,
  minKm,
}: {
  trace: { t_minutes: number; distance_km: number }[];
  minKm: number;
}) {
  const width = 600;
  const height = 180;
  const padX = 36;
  const padY = 18;

  const tMin = trace[0].t_minutes;
  const tMax = trace[trace.length - 1].t_minutes;
  const dMax = Math.max(...trace.map((p) => p.distance_km));

  const x = (t: number) => padX + ((t - tMin) / (tMax - tMin)) * (width - padX * 2);
  const y = (d: number) => height - padY - (d / dMax) * (height - padY * 2);

  const points = trace.map((p) => `${x(p.t_minutes).toFixed(1)},${y(p.distance_km).toFixed(1)}`).join(" ");
  const areaPoints = `${x(tMin)},${height - padY} ${points} ${x(tMax)},${height - padY}`;

  const tcaX = x(0);
  const minPoint = trace.reduce((min, p) => (p.distance_km < min.distance_km ? p : min), trace[0]);

  const gridLines = 5;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Separation over time, converging to a minimum of ${minKm.toFixed(1)} kilometers near the time of closest approach`}
      >
        {/* grid */}
        {Array.from({ length: gridLines }).map((_, i) => {
          const gy = padY + (i * (height - padY * 2)) / (gridLines - 1);
          return (
            <line
              key={i}
              x1={padX}
              x2={width - padX}
              y1={gy}
              y2={gy}
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}

        {/* TCA vertical marker */}
        <line x1={tcaX} x2={tcaX} y1={padY} y2={height - padY} stroke="var(--border-strong)" strokeDasharray="2 3" strokeWidth={1} />
        <text x={tcaX} y={height - 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          TCA
        </text>

        {/* area under trace */}
        <polygon points={areaPoints} fill="var(--accent-glow)" opacity={0.5} />

        {/* trace line */}
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* minimum separation marker */}
        <circle cx={x(minPoint.t_minutes)} cy={y(minPoint.distance_km)} r={4} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />
        <text
          x={x(minPoint.t_minutes)}
          y={y(minPoint.distance_km) - 10}
          textAnchor="middle"
          fontSize="10"
          fontFamily="var(--font-mono)"
          fill="var(--accent)"
        >
          {minKm.toFixed(2)} km
        </text>

        {/* sweep cursor, decorative, respects reduced motion via CSS */}
        <rect x={0} y={padY} width={2} height={height - padY * 2} fill="var(--text-primary)" opacity={0.5} className="scope-sweep" />

        {/* axis labels */}
        <text x={padX} y={12} fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          -{Math.abs(tMin)}m
        </text>
        <text x={width - padX} y={12} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          +{tMax}m
        </text>
      </svg>
      <style>{`
        .scope-sweep {
          animation: sweep-x 5s linear infinite;
        }
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
    </div>
  );
}