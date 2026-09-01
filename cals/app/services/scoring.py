"""Explainable nominal-risk prioritization for refined conjunction candidates.

The score is deliberately *not* a probability of collision.  Public GP/OMM
data has no covariance, so it can support nominal screening prioritization,
not a statistically valid collision probability.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.services.validation import utc_datetime

NextStep = Literal["MONITOR", "INVESTIGATE", "REFRESH_DATA"]


@dataclass(frozen=True)
class MissionProfile:
    """Operator-defined component weights for mission-aware prioritization.

    Multiplies each component's contribution before re-summing to a 0-100
    mission_priority score. Defaults of 1.0 reproduce the baseline
    risk_score exactly — this is a separate ranking dimension, not a
    replacement for the physical nominal score.
    """

    distance_weight: float = 1.0
    velocity_weight: float = 1.0
    urgency_weight: float = 1.0
    context_weight: float = 1.0


DEFAULT_MISSION_PROFILE = MissionProfile()


@dataclass(frozen=True)
class RiskScore:
    score: int
    severity: str
    confidence: str
    breakdown: list[dict[str, str]]
    limitations: list[str]
    next_step: NextStep
    next_step_reason: str
    mission_priority: int
    mission_breakdown: list[dict[str, str]]


def _confidence(data_age_hours: float) -> str:
    if data_age_hours < 0:
        return "LOW"
    if data_age_hours < 24:
        return "HIGH"
    if data_age_hours < 72:
        return "MEDIUM"
    return "LOW"


def _severity(score: int, miss_distance_km: float) -> str:
    """Map prioritization score to UI severity with a close-distance floor."""
    if score >= 80:
        return "CRITICAL"
    if score >= 60 or miss_distance_km < 1:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


def _next_step(severity: str, confidence: str) -> tuple[NextStep, str]:
    """Deterministic triage recommendation from severity + data confidence.

    Not a maneuver directive — a review-queue action. Confidence gates
    everything: a high nominal score on stale data is a reason to distrust
    the score, not to escalate it.
    """
    if confidence == "LOW":
        return "REFRESH_DATA", "Element data is too stale for a reliable priority; refresh before acting."
    if severity in ("CRITICAL", "HIGH") and confidence == "MEDIUM":
        return "REFRESH_DATA", "High nominal priority but data freshness is reduced; refresh before escalating."
    if severity in ("CRITICAL", "HIGH"):
        return "INVESTIGATE", "High nominal priority on fresh data; review in detail."
    if severity == "MEDIUM":
        return "MONITOR", "Moderate nominal priority; keep under routine monitoring."
    return "MONITOR", "Low nominal priority; no action needed beyond routine monitoring."


def score_candidate(
    *,
    miss_distance_km: float,
    relative_velocity_km_s: float,
    tca: datetime,
    analysis_time: datetime,
    data_age_hours: float,
    primary_object_type: str,
    secondary_object_type: str,
    profile: MissionProfile | None = None,
) -> RiskScore:
    """Calculate a transparent 0–100 nominal screening-priority score, plus
    an optional mission-weighted reranking of the same components.

    Baseline components are bounded and exposed to callers:

    * distance: up to 55 points, dominant because it is the core screen;
    * relative velocity: up to 20 points, capped at 15 km/s;
    * time to closest approach: up to 15 points inside a 72-hour window;
    * protected payload/station context: up to 10 points;
    * data freshness: a 0/5/15-point penalty, separate from confidence.
    """
    if miss_distance_km < 0 or relative_velocity_km_s < 0:
        raise ValueError("Miss distance and relative velocity must be non-negative")

    analysis = utc_datetime(analysis_time)
    tca_utc = utc_datetime(tca)
    hours_to_tca = max(0.0, (tca_utc - analysis).total_seconds() / 3600)

    # A squared falloff keeps close nominal approaches meaningfully distinct
    # while still assigning a small score to wide 100 km informational cases.
    distance_component = 55 * (max(0.0, 1 - min(miss_distance_km, 100) / 100) ** 2)
    velocity_component = 20 * min(relative_velocity_km_s, 15) / 15
    urgency_component = 15 * max(0.0, 1 - min(hours_to_tca, 72) / 72)
    protected_types = {"PAYLOAD", "STATION"}
    context_component = 10 if {primary_object_type, secondary_object_type} & protected_types else 0

    if data_age_hours < 0:
        freshness_penalty = 5
    elif data_age_hours < 24:
        freshness_penalty = 0
    elif data_age_hours < 72:
        freshness_penalty = 5
    else:
        freshness_penalty = 15

    score = round(
        max(
            0,
            min(
                100,
                distance_component
                + velocity_component
                + urgency_component
                + context_component
                - freshness_penalty,
            ),
        )
    )
    severity = _severity(score, miss_distance_km)
    confidence = _confidence(data_age_hours)
    next_step, next_step_reason = _next_step(severity, confidence)

    active_profile = profile or DEFAULT_MISSION_PROFILE
    mission_raw = (
        distance_component * active_profile.distance_weight
        + velocity_component * active_profile.velocity_weight
        + urgency_component * active_profile.urgency_weight
        + context_component * active_profile.context_weight
        - freshness_penalty
    )
    mission_priority = round(max(0, min(100, mission_raw)))

    limitations: list[str] = []
    if data_age_hours >= 72:
        limitations.append("Data age exceeds 72 hours; prediction confidence is low.")
    elif data_age_hours >= 24:
        limitations.append("Data age exceeds 24 hours; prediction confidence is reduced.")
    elif data_age_hours < 0:
        limitations.append("Selected element data is future-dated relative to analysis time.")

    return RiskScore(
        score=score,
        severity=severity,
        confidence=confidence,
        breakdown=[
            {"label": "Predicted separation", "value": f"{miss_distance_km:.2f} km ({distance_component:.0f}/55)"},
            {"label": "Relative velocity", "value": f"{relative_velocity_km_s:.2f} km/s ({velocity_component:.0f}/20)"},
            {"label": "Time to TCA", "value": f"{hours_to_tca:.1f} h ({urgency_component:.0f}/15)"},
            {"label": "Protected-object context", "value": f"{context_component:.0f}/10"},
            {"label": "Data freshness adjustment", "value": f"-{freshness_penalty:.0f} points"},
        ],
        limitations=limitations,
        next_step=next_step,
        next_step_reason=next_step_reason,
        mission_priority=mission_priority,
        mission_breakdown=[
            {"label": "Predicted separation", "value": f"{miss_distance_km:.2f} km (×{active_profile.distance_weight:.1f})"},
            {"label": "Relative velocity", "value": f"{relative_velocity_km_s:.2f} km/s (×{active_profile.velocity_weight:.1f})"},
            {"label": "Time to TCA", "value": f"{hours_to_tca:.1f} h (×{active_profile.urgency_weight:.1f})"},
            {"label": "Protected-object context", "value": f"×{active_profile.context_weight:.1f}"},
            {"label": "Data freshness adjustment", "value": f"-{freshness_penalty:.0f} points"},
        ],
    )