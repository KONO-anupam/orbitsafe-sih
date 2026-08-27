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
