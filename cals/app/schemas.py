"""Pydantic API contracts, deliberately separate from SQLAlchemy models."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field



class ObjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    norad_cat_id: int
    object_name: str
    international_designator: str
    object_type: Literal["PAY", "DEB", "R/B", "UNK"]
    source_category: str
    owner: str | None
    launch_date: date | None
    decay_date: date | None


class ObjectPage(BaseModel):
    items: list[ObjectResponse]
    total: int
    limit: int
    offset: int


class ElementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    norad_cat_id: int
    epoch_utc: datetime
    mean_motion_rev_per_day: float
    eccentricity: float
    inclination_deg: float
    raan_deg: float
    arg_perigee_deg: float
    mean_anomaly_deg: float
    bstar: float
    source_file: str


class GeodeticResponse(BaseModel):
    latitude_deg: float
    longitude_deg: float
    altitude_km: float


class StateVectorResponse(BaseModel):
    timestamp: datetime
    position_teme_km: list[float]
    velocity_teme_km_s: list[float]
    sgp4_error_code: int
    coordinate_frame: Literal["TEME"]
    geodetic: GeodeticResponse | None


class PositionRequest(BaseModel):
    norad_cat_id: int = Field(gt=0)
    timestamp: datetime


class TrajectoryRequest(BaseModel):
    norad_cat_id: int = Field(gt=0)
    start_time: datetime
    end_time: datetime
    step_seconds: int = Field(gt=0, le=86400)


class TrajectoryResponse(BaseModel):
    norad_cat_id: int
    states: list[StateVectorResponse]


class MissionProfile(BaseModel):
    """Optional operator-defined weighting for mission-aware prioritization.

    Multiplies each component's contribution before re-summing; defaults of
    1.0 reproduce the baseline nominal score exactly.
    """

    distance_weight: float = Field(default=1.0, ge=0, le=3)
    velocity_weight: float = Field(default=1.0, ge=0, le=3)
    urgency_weight: float = Field(default=1.0, ge=0, le=3)
    context_weight: float = Field(default=1.0, ge=0, le=3)


class ScreeningRequest(BaseModel):
    """Controls for an on-demand nominal conjunction screen."""

    analysis_time: datetime | None = None
    forecast_horizon_hours: float = Field(default=24, gt=0, le=72)
    screening_threshold_km: float = Field(default=50, gt=0, le=1000)
    # Defaults lowered from 60/1000 — at 60s/1000 objects over a 72h horizon
    # this was ~4,320 timesteps x up to 1000 SGP4 calls each, measured at
    # ~5 minutes end-to-end. 180s/300 objects cuts both factors and is
    # still enough resolution + catalog coverage for a demo.
    coarse_step_seconds: int = Field(default=180, ge=30, le=300)
    object_limit: int = Field(default=300, ge=2, le=5000)
    mission_profile: MissionProfile | None = None


class ScreeningObjectRef(BaseModel):
    norad_id: str
    name: str
    object_type: Literal["PAYLOAD", "DEBRIS", "ROCKET BODY", "STATION"]


class CandidateConjunctionResponse(BaseModel):
    """Nominal candidate facts plus an explainable, non-probabilistic priority score."""

    event_id: str
    primary: ScreeningObjectRef
    secondary: ScreeningObjectRef
    tca: datetime
    miss_distance_km: float
    relative_velocity_km_s: float
    risk_score: int = Field(ge=0, le=100)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    confidence: Literal["HIGH", "MEDIUM", "LOW"]
    data_age_hours: float
    forecast_horizon_hours: float
    source: str
    method: str
    limitations: list[str]
    score_breakdown: list[dict[str, str]]
    next_step: Literal["MONITOR", "INVESTIGATE", "REFRESH_DATA"]
    next_step_reason: str
    mission_priority: int = Field(ge=0, le=100)
    mission_breakdown: list[dict[str, str]]
    robustness_stable: bool
    robustness_max_tca_diff_seconds: float
    robustness_max_miss_distance_diff_km: float
    robustness_checks: list[dict[str, str]]


class ScreeningResponse(BaseModel):
    analysis_time: datetime
    eligible_objects: int
    excluded_objects: int
    candidates: list[CandidateConjunctionResponse]