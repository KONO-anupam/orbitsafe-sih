import { OrbitalElements3D } from "./types";

export const EARTH_RADIUS_KM = 6371;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Position on a circular orbit at a given fraction [0, 1) of one period.
 * This is a simplified stand-in for true SGP4 propagation, sufficient for
 * rendering — it consumes the same conceptual inputs (altitude, inclination,
 * RAAN, phase) that a real propagator's Keplerian elements would provide.
 * Coordinates are in an Earth-centered frame with Z as the polar axis.
 */
export function positionAtFraction(el: OrbitalElements3D, frac: number): Vec3 {
  const r = EARTH_RADIUS_KM + el.altitude_km;
  const theta = ((el.phase_deg / 360) + frac) * Math.PI * 2;

  // position in the orbital plane
  const xOrb = r * Math.cos(theta);
  const yOrb = r * Math.sin(theta);

  const inc = (el.inclination_deg * Math.PI) / 180;
  const raan = (el.raan_deg * Math.PI) / 180;

  // tilt by inclination around the X axis
  const xInc = xOrb;
  const yInc = yOrb * Math.cos(inc);
  const zInc = yOrb * Math.sin(inc);

  // rotate by RAAN around the Z (polar) axis
  const x = xInc * Math.cos(raan) - yInc * Math.sin(raan);
  const y = xInc * Math.sin(raan) + yInc * Math.cos(raan);
  const z = zInc;

  return { x, y, z };
}

/** Full path of an orbit as evenly sampled points, for drawing the ring. */
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

/**
 * Converts real backend trajectory states (position_teme_km: number[])
 * into the same Vec3[] shape orbitPath() produces, so Globe3D can draw a
 * real SGP4-propagated path exactly like it draws a synthetic one. TEME is
 * treated as this scene's inertial frame — the same simplification the
 * synthetic generator above already makes, so no new inconsistency is
 * introduced by using real data here.
 */
export function pathFromTrajectory(states: { position_teme_km: number[] }[]): Vec3[] {
  return states
    .filter((s) => s.position_teme_km.length === 3)
    .map((s) => ({ x: s.position_teme_km[0], y: s.position_teme_km[1], z: s.position_teme_km[2] }));
}