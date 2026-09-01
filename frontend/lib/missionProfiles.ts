export type MissionProfileKey = "balanced" | "time_critical" | "distance_critical";

export interface MissionProfileWeights {
  distance_weight: number;
  velocity_weight: number;
  urgency_weight: number;
  context_weight: number;
}

export const MISSION_PROFILES: Record<MissionProfileKey, MissionProfileWeights> = {
  balanced: { distance_weight: 1, velocity_weight: 1, urgency_weight: 1, context_weight: 1 },
  time_critical: { distance_weight: 0.7, velocity_weight: 1, urgency_weight: 2, context_weight: 1 },
  distance_critical: { distance_weight: 1.6, velocity_weight: 0.8, urgency_weight: 0.6, context_weight: 1 },
};

export const MISSION_PROFILE_LABELS: Record<MissionProfileKey, string> = {
  balanced: "Balanced",
  time_critical: "Time-critical",
  distance_critical: "Distance-critical",
};
