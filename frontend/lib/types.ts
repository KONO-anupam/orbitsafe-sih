// Mirrors docs/api-contract.md field-for-field.
// Frontend and backend agreed on these names — do not rename locally.

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type ObjectType = "PAYLOAD" | "DEBRIS" | "ROCKET BODY" | "STATION";

export interface OrbitalObjectRef {
  norad_id: string;
  name: string;
  object_type: ObjectType;
}

export interface ConjunctionEvent {
  event_id: string;
  primary: OrbitalObjectRef;
  secondary: OrbitalObjectRef;
  tca: string; // UTC ISO-8601
  miss_distance_km: number;
  relative_velocity_km_s: number;
  risk_score: number; // 0-100
  severity: Severity;
  confidence: Confidence;
  data_age_hours: number;
  forecast_horizon_hours: number;
  source: string;
  method: string;
  limitations: string[];
  // Fields used only for the event-detail panel / score breakdown & trace —
  // additive, not part of the core contract, safe to ignore on the backend.
  altitude_km?: number;
  score_breakdown?: {
    label: string;
    value: string;
  }[];
  separation_trace?: { t_minutes: number; distance_km: number }[];
  // Shape mirrors what SGP4/Skyfield propagation actually returns per Phase 2
  // of the plan: orbital elements sufficient to render a path. When the real
  // propagation engine ships, these come from its output instead of mocks —
  // no other file in the 3D view needs to change.
  orbit3d?: {
    primary: OrbitalElements3D;
    secondary: OrbitalElements3D;
  };
}

export interface OrbitalElements3D {
  altitude_km: number;
  inclination_deg: number;
  raan_deg: number; // right ascension of ascending node
  phase_deg: number; // initial position along the orbit at t=0
  period_minutes: number;
}

export interface TrustPanelData {
  source: string;
  propagation: string;
  data_age: string;
  forecast_horizon: string;
  step_size: string;
  covariance: string;
  risk_type: string;
}
