"use client";

export default function OrbitSchematic({
  altitudeKm = 550,
  severityColor,
}: {
  altitudeKm?: number;
  severityColor: string;
}) {
  const size = 260;
  const c = size / 2;
  const earthR = 34;
  const clamped = Math.min(900, Math.max(300, altitudeKm));
  const ringR = 58 + ((clamped - 300) / 600) * 60;
  const ring2R = ringR + 14;

  const a1 = -40;
  const a2 = 18;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const p1 = { x: c + ringR * Math.cos(rad(a1)), y: c + ringR * 0.42 * Math.sin(rad(a1)) };
  const p2 = { x: c + ring2R * Math.cos(rad(a2)), y: c + ring2R * 0.42 * Math.sin(rad(a2)) };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto" role="img" aria-label="Schematic of both objects' orbital paths">
      <defs>
        <radialGradient id="earthGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#232327" />
          <stop offset="100%" stopColor="#09090B" />
        </radialGradient>
      </defs>

      <ellipse cx={c} cy={c} rx={ringR} ry={ringR * 0.42} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 4" />
      <ellipse cx={c} cy={c} rx={ring2R} ry={ring2R * 0.42} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="1 4" />

      <circle cx={c} cy={c} r={earthR} fill="url(#earthGrad)" stroke="var(--border-strong)" strokeWidth={1} />

      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={severityColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />

      <circle cx={p1.x} cy={p1.y} r={4} fill="var(--accent)" />
      <circle cx={p2.x} cy={p2.y} r={4} fill={severityColor} />

      <text x={p1.x} y={p1.y - 9} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--text-secondary)">
        primary
      </text>
      <text x={p2.x} y={p2.y + 16} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--text-secondary)">
        secondary
      </text>

      <text x={c} y={size - 6} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
        ~{Math.round(altitudeKm)} km altitude
      </text>
    </svg>
  );
}