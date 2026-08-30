"use client";

import { Vec3, sampleScenePath, toSceneUnits } from "@/lib/orbitGeometry";

export default function OrbitSchematic({
  altitudeKm = 550,
  severityColor,
  primaryTrajectory,
  secondaryTrajectory,
  progress,
}: {
  altitudeKm?: number;
  severityColor: string;
  /** Raw km trajectory points — same shape passed to Globe3D. When both are
   *  present, this renders a real top-down projection instead of the
   *  static illustrative rings, synced via `progress` (0..1). */
  primaryTrajectory?: Vec3[];
  secondaryTrajectory?: Vec3[];
  progress?: number;
}) {
  const size = 260;
  const c = size / 2;
  const earthR = 34;

  const hasRealData =
    primaryTrajectory && secondaryTrajectory && primaryTrajectory.length > 0 && secondaryTrajectory.length > 0;

  if (hasRealData) {
    // Top-down projection: scene-unit (x, z) maps directly to schematic
    // pixels, scaled so Earth's unit-sphere radius matches earthR — the
    // same coordinate convention Globe3D uses, just viewed from above.
    const primaryScene = primaryTrajectory!.map((p) => toSceneUnits(p));
    const secondaryScene = secondaryTrajectory!.map((p) => toSceneUnits(p));
    const scale = earthR;
    const project = (p: Vec3) => ({ x: c + p.x * scale, y: c + p.z * scale });

    const primaryPath2d = primaryScene.map(project);
    const secondaryPath2d = secondaryScene.map(project);
    const frac = progress ?? 0;
    const p1 = project(sampleScenePath(primaryScene, frac));
    const p2 = project(sampleScenePath(secondaryScene, frac));

    return (
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto" role="img" aria-label="Top-down projection of both objects' real trajectories">
        <defs>
          <radialGradient id="earthGradReal" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#232327" />
            <stop offset="100%" stopColor="#09090B" />
          </radialGradient>
        </defs>

        <circle cx={c} cy={c} r={earthR} fill="url(#earthGradReal)" stroke="var(--border-strong)" strokeWidth={1} />

        <polyline
          points={primaryPath2d.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          opacity={0.6}
        />
        <polyline
          points={secondaryPath2d.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke={severityColor}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />

        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={severityColor} strokeWidth={1} strokeDasharray="2 2" opacity={0.7} />

        <circle cx={p1.x} cy={p1.y} r={4} fill="var(--accent)" />
        <circle cx={p2.x} cy={p2.y} r={4} fill={severityColor} />

        <text x={p1.x} y={p1.y - 9} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--text-secondary)">
          primary
        </text>
        <text x={p2.x} y={p2.y + 16} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--text-secondary)">
          secondary
        </text>

        <text x={c} y={size - 6} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-tertiary)">
          live SGP4 trajectory (top-down)
        </text>
      </svg>
    );
  }

  // Fallback: static illustrative schematic for mock/synthetic events only.
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
        ~{Math.round(altitudeKm)} km altitude (illustrative)
      </text>
    </svg>
  );
}