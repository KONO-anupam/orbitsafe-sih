"""Explainable nominal-risk prioritization for refined conjunction candidates.

The score is deliberately *not* a probability of collision.  Public GP/OMM
data has no covariance, so it can support nominal screening prioritization,
not a statistically valid collision probability.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.services.validation import utc_datetime


@dataclass(frozen=True)
class RiskScore:
    score: int
    severity: str
    confidence: str
    breakdown: list[dict[str, str]]
    limitations: list[str]


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


def score_candidate(
    *,
    miss_distance_km: float,
    relative_velocity_km_s: float,
    tca: datetime,
    analysis_time: datetime,
    data_age_hours: float,
    primary_object_type: str,
    secondary_object_type: str,
) -> RiskScore:
    """Calculate a transparent 0–100 nominal screening-priority score.

    Components are deliberately bounded and exposed to callers:

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
    confidence = _confidence(data_age_hours)
    limitations: list[str] = []
    if data_age_hours >= 72:
        limitations.append("Data age exceeds 72 hours; prediction confidence is low.")
    elif data_age_hours >= 24:
        limitations.append("Data age exceeds 24 hours; prediction confidence is reduced.")
    elif data_age_hours < 0:
        limitations.append("Selected element data is future-dated relative to analysis time.")

    return RiskScore(
        score=score,
        severity=_severity(score, miss_distance_km),
        confidence=confidence,
        breakdown=[
            {"label": "Predicted separation", "value": f"{miss_distance_km:.2f} km ({distance_component:.0f}/55)"},
            {"label": "Relative velocity", "value": f"{relative_velocity_km_s:.2f} km/s ({velocity_component:.0f}/20)"},
            {"label": "Time to TCA", "value": f"{hours_to_tca:.1f} h ({urgency_component:.0f}/15)"},
            {"label": "Protected-object context", "value": f"{context_component:.0f}/10"},
            {"label": "Data freshness adjustment", "value": f"-{freshness_penalty:.0f} points"},
        ],
        limitations=limitations,
    )
