import { OrbitalElements3D } from "@/lib/types";
import { StateVectorResponse } from "@/lib/api";

export const EARTH_RADIUS_KM = 6371;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TimedVec3 {
  t: string; // ISO-8601 timestamp
  position: Vec3; // raw km, NOT scene units
}

/**
 * Position on a circular orbit at a given fraction [0, 1) of one period.
 * Illustrative Keplerian stand-in for mock/synthetic events only.
 */
export function positionAtFraction(el: OrbitalElements3D, frac: number): Vec3 {
  const r = EARTH_RADIUS_KM + el.altitude_km;
  const theta = ((el.phase_deg / 360) + frac) * Math.PI * 2;

  const xOrb = r * Math.cos(theta);
  const yOrb = r * Math.sin(theta);

  const inc = (el.inclination_deg * Math.PI) / 180;
  const raan = (el.raan_deg * Math.PI) / 180;

  const xInc = xOrb;
  const yInc = yOrb * Math.cos(inc);
  const zInc = yOrb * Math.sin(inc);

  const x = xInc * Math.cos(raan) - yInc * Math.sin(raan);
  const y = xInc * Math.sin(raan) + yInc * Math.cos(raan);
  const z = zInc;

  return { x, y, z };
}

export function orbitPath(el: OrbitalElements3D, samples = 128): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    pts.push(positionAtFraction(el, i / samples));
  }
  return pts;
}

/** Scale km coordinates down to a unit sphere of radius 1 = Earth. */
export function toSceneUnits(v: Vec3, scale = 1 / EARTH_RADIUS_KM): Vec3 {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

/** Converts real backend trajectory states into timestamped raw-km points. */
export function pathFromTrajectory(states: StateVectorResponse[]): TimedVec3[] {
  return states
    .filter((s) => s.sgp4_error_code === 0 && s.position_teme_km.length === 3)
    .map((s) => ({
      t: s.timestamp,
      position: { x: s.position_teme_km[0], y: s.position_teme_km[1], z: s.position_teme_km[2] },
    }));
}

// --- Shared sampling helpers, used by both Globe3D and OrbitSchematic so
// the 3D and 2D views agree exactly on where a given `progress` value
// places each marker along a real trajectory. ---

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Samples a point along an (open) polyline of points at frac [0,1]. */
export function sampleScenePath(points: Vec3[], frac: number): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) return points[0];
  const f = Math.min(0.999999, Math.max(0, frac)) * (points.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(points.length - 1, i0 + 1);
  return lerpVec3(points[i0], points[i1], f - i0);
}

/** Triangle wave in [0,1] — ping-pongs a value back and forth. */
export function pingPong(x: number): number {
  const m = ((x % 2) + 2) % 2;
  return m < 1 ? m : 2 - m;
}