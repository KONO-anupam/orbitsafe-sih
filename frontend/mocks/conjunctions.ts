import { ConjunctionEvent, OrbitalElements3D } from "@/lib/types";

// Builds a plausible pair of near-crossing orbits for the 3D view: same
// altitude band, a small inclination delta, and a RAAN/phase chosen so the
// two paths pass close to one another once per orbit — illustrative, not a
// physics fit, since these are mock events.
function buildOrbit3d(
  altitudeKm: number,
  seed: number
): { primary: OrbitalElements3D; secondary: OrbitalElements3D } {
  const inc = 45 + (seed % 40);
  return {
    primary: {
      altitude_km: altitudeKm,
      inclination_deg: inc,
      raan_deg: (seed * 13) % 360,
      phase_deg: (seed * 7) % 360,
      period_minutes: 90 + (altitudeKm / 100),
    },
    secondary: {
      altitude_km: altitudeKm * (1 + (seed % 5) * 0.01),
      inclination_deg: inc + 6 + (seed % 5),
      raan_deg: (seed * 13 + 8) % 360,
      phase_deg: ((seed * 7) % 360) + 4,
      period_minutes: 90 + (altitudeKm / 100) + 0.4,
    },
  };
}

// Generates a synthetic converge-then-diverge separation trace around TCA,
// the same shape the real screening engine would refine down to (coarse ->
// fine, per Phase 2 of the plan). Deterministic per event via a seed.
function buildTrace(minKm: number, seed: number): { t_minutes: number; distance_km: number }[] {
  const points: { t_minutes: number; distance_km: number }[] = [];
  for (let t = -60; t <= 60; t += 4) {
    const wobble = Math.sin((t + seed) / 9) * (minKm * 0.06);
    const shape = minKm + (t * t) / (55 + seed * 0.4) + wobble;
    points.push({ t_minutes: t, distance_km: Math.max(minKm * 0.97, shape) });
  }
  return points;
}

export const conjunctions: ConjunctionEvent[] = [
  {
    event_id: "25544-49044-2026-08-23T12:30:00Z",
    primary: { norad_id: "25544", name: "ISS (ZARYA)", object_type: "STATION" },
    secondary: { norad_id: "49044", name: "COSMOS 1408 DEB", object_type: "DEBRIS" },
    tca: "2026-08-23T12:30:00Z",
    miss_distance_km: 2.4,
    relative_velocity_km_s: 13.8,
    risk_score: 82,
    severity: "CRITICAL",
    confidence: "MEDIUM",
    data_age_hours: 4,
    forecast_horizon_hours: 24,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
    ],
    altitude_km: 418,
    score_breakdown: [
      { label: "Predicted separation", value: "2.4 km" },
      { label: "Relative velocity", value: "13.8 km/s" },
      { label: "Time to TCA", value: "7.2 h" },
      { label: "Data freshness", value: "4 h old" },
    ],
    separation_trace: buildTrace(2.4, 3),
    orbit3d: buildOrbit3d(418, 3),
  },
  {
    event_id: "44713-38341-2026-08-23T18:05:00Z",
    primary: { norad_id: "44713", name: "STARLINK-1130", object_type: "PAYLOAD" },
    secondary: { norad_id: "38341", name: "FENGYUN 1C DEB", object_type: "DEBRIS" },
    tca: "2026-08-23T18:05:00Z",
    miss_distance_km: 3.9,
    relative_velocity_km_s: 14.5,
    risk_score: 71,
    severity: "HIGH",
    confidence: "MEDIUM",
    data_age_hours: 6,
    forecast_horizon_hours: 24,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
    ],
    altitude_km: 549,
    score_breakdown: [
      { label: "Predicted separation", value: "3.9 km" },
      { label: "Relative velocity", value: "14.5 km/s" },
      { label: "Time to TCA", value: "12.9 h" },
      { label: "Data freshness", value: "6 h old" },
    ],
    separation_trace: buildTrace(3.9, 11),
    orbit3d: buildOrbit3d(549, 11),
  },
  {
    event_id: "43205-27386-2026-08-24T02:40:00Z",
    primary: { norad_id: "43205", name: "ONEWEB-0012", object_type: "PAYLOAD" },
    secondary: { norad_id: "27386", name: "COSMOS 2251 DEB", object_type: "DEBRIS" },
    tca: "2026-08-24T02:40:00Z",
    miss_distance_km: 8.7,
    relative_velocity_km_s: 11.2,
    risk_score: 54,
    severity: "MEDIUM",
    confidence: "HIGH",
    data_age_hours: 2,
    forecast_horizon_hours: 48,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
    ],
    altitude_km: 786,
    score_breakdown: [
      { label: "Predicted separation", value: "8.7 km" },
      { label: "Relative velocity", value: "11.2 km/s" },
      { label: "Time to TCA", value: "20.4 h" },
      { label: "Data freshness", value: "2 h old" },
    ],
    separation_trace: buildTrace(8.7, 22),
    orbit3d: buildOrbit3d(786, 22),
  },
  {
    event_id: "48274-33759-2026-08-23T09:15:00Z",
    primary: { norad_id: "48274", name: "STARLINK-2231", object_type: "PAYLOAD" },
    secondary: { norad_id: "33759", name: "IRIDIUM 33 DEB", object_type: "DEBRIS" },
    tca: "2026-08-23T09:15:00Z",
    miss_distance_km: 14.2,
    relative_velocity_km_s: 9.7,
    risk_score: 38,
    severity: "MEDIUM",
    confidence: "HIGH",
    data_age_hours: 3,
    forecast_horizon_hours: 24,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
    ],
    altitude_km: 611,
    score_breakdown: [
      { label: "Predicted separation", value: "14.2 km" },
      { label: "Relative velocity", value: "9.7 km/s" },
      { label: "Time to TCA", value: "3.1 h" },
      { label: "Data freshness", value: "3 h old" },
    ],
    separation_trace: buildTrace(14.2, 6),
    orbit3d: buildOrbit3d(611, 6),
  },
  {
    event_id: "39084-40889-2026-08-24T14:50:00Z",
    primary: { norad_id: "39084", name: "LANDSAT 8", object_type: "PAYLOAD" },
    secondary: { norad_id: "40889", name: "OBJECT DEB", object_type: "DEBRIS" },
    tca: "2026-08-24T14:50:00Z",
    miss_distance_km: 34.6,
    relative_velocity_km_s: 7.4,
    risk_score: 19,
    severity: "LOW",
    confidence: "HIGH",
    data_age_hours: 1,
    forecast_horizon_hours: 72,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
    ],
    altitude_km: 705,
    score_breakdown: [
      { label: "Predicted separation", value: "34.6 km" },
      { label: "Relative velocity", value: "7.4 km/s" },
      { label: "Time to TCA", value: "32.7 h" },
      { label: "Data freshness", value: "1 h old" },
    ],
    separation_trace: buildTrace(34.6, 40),
    orbit3d: buildOrbit3d(705, 40),
  },
  {
    event_id: "37820-45019-2026-08-23T21:00:00Z",
    primary: { norad_id: "37820", name: "NOAA 19", object_type: "PAYLOAD" },
    secondary: { norad_id: "45019", name: "SL-16 R/B DEB", object_type: "ROCKET BODY" },
    tca: "2026-08-23T21:00:00Z",
    miss_distance_km: 6.1,
    relative_velocity_km_s: 12.9,
    risk_score: 63,
    severity: "HIGH",
    confidence: "LOW",
    data_age_hours: 18,
    forecast_horizon_hours: 24,
    source: "CelesTrak",
    method: "SGP4 nominal screening",
    limitations: [
      "No covariance-based collision probability",
      "Not an operational flight-safety alert",
      "Data age exceeds 3-day freshness threshold for high confidence",
    ],
    altitude_km: 850,
    score_breakdown: [
      { label: "Predicted separation", value: "6.1 km" },
      { label: "Relative velocity", value: "12.9 km/s" },
      { label: "Time to TCA", value: "15.6 h" },
      { label: "Data freshness", value: "18 h old" },
    ],
    separation_trace: buildTrace(6.1, 17),
    orbit3d: buildOrbit3d(850, 17),
  },
];

export const trustPanel = {
  source: "CelesTrak GP data",
  propagation: "SGP4",
  data_age: "1h – 18h across tracked set",
  forecast_horizon: "24h",
  step_size: "1 minute (refined)",
  covariance: "unavailable",
  risk_type: "nominal screening score",
};

export const objectsTracked = 1842;
