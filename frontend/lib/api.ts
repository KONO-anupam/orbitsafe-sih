/**
 * lib/api.ts
 *
 * Typed client for the FastAPI catalog/propagation backend. Every interface
 * here mirrors app/schemas.py field-for-field, on purpose — if the backend's
 * Pydantic models change, this is the one place to update, and any caller
 * that assumed the old shape breaks at compile time instead of silently
 * returning `undefined` at runtime.
 *
 * This backend covers catalog lookup, SGP4 propagation, and nominal
 * conjunction screening with risk scoring (POST /api/v1/screen). It does
 * NOT compute a covariance-based probability of collision — nor does it
 * claim to; see the `limitations` field on each screening candidate.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://orbitsafe-sih.onrender.com";

// --- catalog ---

export type BackendObjectType = "PAY" | "DEB" | "R/B" | "UNK";

export interface ObjectResponse {
  norad_cat_id: number;
  object_name: string;
  international_designator: string;
  object_type: BackendObjectType;
  source_category: string;
  owner: string | null;
  launch_date: string | null;
  decay_date: string | null;
}

export interface ObjectPage {
  items: ObjectResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ElementResponse {
  norad_cat_id: number;
  epoch_utc: string;
  mean_motion_rev_per_day: number;
  eccentricity: number;
  inclination_deg: number;
  raan_deg: number;
  arg_perigee_deg: number;
  mean_anomaly_deg: number;
  bstar: number;
  source_file: string;
}

// --- propagation ---

export interface GeodeticResponse {
  latitude_deg: number;
  longitude_deg: number;
  altitude_km: number;
}

export interface StateVectorResponse {
  timestamp: string;
  // Pydantic types this as list[float]; treated as number[] rather than a
  // fixed 3-tuple so a length mismatch is a runtime check, not a lied-about
  // compile-time guarantee. Callers should verify length === 3 before use.
  position_teme_km: number[];
  velocity_teme_km_s: number[];
  sgp4_error_code: number;
  coordinate_frame: "TEME";
  geodetic: GeodeticResponse | null;
}

export interface TrajectoryResponse {
  norad_cat_id: number;
  states: StateVectorResponse[];
}

export interface ListObjectsParams {
  norad_cat_id?: number;
  name?: string;
  object_type?: string;
  source_category?: string;
  limit?: number;
  offset?: number;
}

export interface TrajectoryParams {
  norad_cat_id: number;
  start_time: string; // ISO-8601
  end_time: string; // ISO-8601
  step_seconds: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function checkHealth(): Promise<{ status: string }> {
  return request("/health");
}

export function listObjects(params: ListObjectsParams = {}): Promise<ObjectPage> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) qs.set(key, String(value));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request(`/api/v1/objects${suffix}`);
}

export function getObject(noradCatId: number): Promise<ObjectResponse> {
  return request(`/api/v1/objects/${noradCatId}`);
}

export function getElements(noradCatId: number): Promise<ElementResponse[]> {
  return request(`/api/v1/objects/${noradCatId}/elements`);
}

export function getTrajectory(params: TrajectoryParams): Promise<TrajectoryResponse> {
  return request("/api/v1/propagation/trajectory", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// --- screening ---
//
// This mirrors app/schemas.py ScreeningRequest / ScreeningResponse /
// CandidateConjunctionResponse. This IS the conjunction-detection + risk
// scoring endpoint — the gap noted in earlier comments in this file no
// longer applies now that the backend exposes it.

export interface MissionProfileWeights {
  distance_weight: number;
  velocity_weight: number;
  urgency_weight: number;
  context_weight: number;
}

export interface ScreeningParams {
  analysis_time?: string;
  forecast_horizon_hours?: number;
  screening_threshold_km?: number;
  coarse_step_seconds?: number;
  object_limit?: number;
  mission_profile?: MissionProfileWeights;
}

export type BackendObjectRoleType = "PAYLOAD" | "DEBRIS" | "ROCKET BODY" | "STATION";

export interface ScreeningObjectRef {
  norad_id: string;
  name: string;
  object_type: BackendObjectRoleType;
}

export interface CandidateConjunctionResponse {
  event_id: string;
  primary: ScreeningObjectRef;
  secondary: ScreeningObjectRef;
  tca: string;
  miss_distance_km: number;
  relative_velocity_km_s: number;
  risk_score: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  data_age_hours: number;
  forecast_horizon_hours: number;
  source: string;
  method: string;
  limitations: string[];
  // Backend types each row as a generic string->string dict, not a fixed
  // {label, value} shape — normalize this on the way in (see
  // lib/useScreening.ts) rather than assuming its exact keys here.
  score_breakdown: Record<string, string>[];
  next_step: "MONITOR" | "INVESTIGATE" | "REFRESH_DATA";
  next_step_reason: string;
  mission_priority: number;
  mission_breakdown: Record<string, string>[];
  robustness_stable: boolean;
  robustness_max_tca_diff_seconds: number;
  robustness_max_miss_distance_diff_km: number;
  robustness_checks: Record<string, string>[];
}

export interface ScreeningResponse {
  analysis_time: string;
  eligible_objects: number;
  excluded_objects: number;
  candidates: CandidateConjunctionResponse[];
}

export function screenConjunctions(params: ScreeningParams = {}): Promise<ScreeningResponse> {
  return request("/api/v1/screen", {
    method: "POST",
    body: JSON.stringify(params),
  });
}