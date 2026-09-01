"""What-if collision-avoidance maneuver analysis.

Applies an instantaneous delta-v (RTN frame) to the primary object's SGP4
state at a chosen burn time, then propagates the resulting orbit forward
with unperturbed two-body (Keplerian) mechanics — see
app.services.keplerian for why SGP4 itself cannot be reused post-burn. The
conjunction partner continues to be propagated normally via SGP4 (its
trajectory is unaffected by the primary's burn). The pair is then
re-evaluated for a new time of closest approach and miss distance within
the requested search window, using the same golden-section refinement
pattern as app.services.screening.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import math

from sqlalchemy.orm import Session

from app.services.keplerian import (
    ClassicalElements,
    NonEllipticalOrbitError,
    propagate_elements,
    rtn_delta_v_to_teme,
    state_to_elements,
)
from app.services.propagation import propagate_element, select_element_set
from app.services.validation import utc_datetime

_STATIC_NOTES = [
    "Post-burn trajectory uses unperturbed two-body (Keplerian) propagation, "
    "not SGP4 — J2 and drag are not modeled after the burn.",
    "Burn is modeled as instantaneous (impulsive); finite-duration thruster effects are ignored.",
    "Near-circular orbits are modeled with a small eccentricity floor to keep "
    "the orbital-element parameterization well defined.",
    "Only encounters within the requested search window are considered.",
]


class ManeuverInfeasibleError(ValueError):
    """The requested burn cannot be evaluated (bad geometry, SGP4 failure, etc.)."""


@dataclass(frozen=True)
class ManeuverOutcome:
    burn_time: datetime
    new_tca: datetime | None
    new_miss_distance_km: float | None
    new_relative_velocity_km_s: float | None
    baseline_miss_distance_km: float
    cleared_threshold: bool | None
    sample_count: int
    notes: list[str]


def _primary_state_at(db: Session, norad_cat_id: int, timestamp: datetime) -> tuple[list[float], list[float]]:
    element = select_element_set(db, norad_cat_id, timestamp)
    result = propagate_element(element, timestamp)
    if result["sgp4_error_code"] != 0:
        raise ManeuverInfeasibleError("SGP4 could not propagate the primary object to the requested burn time")
    return result["position_teme_km"], result["velocity_teme_km_s"]


def _secondary_state_at(db: Session, norad_cat_id: int, timestamp: datetime) -> tuple[list[float], list[float]] | None:
    element = select_element_set(db, norad_cat_id, timestamp)
    result = propagate_element(element, timestamp)
    if result["sgp4_error_code"] != 0:
        return None
    return result["position_teme_km"], result["velocity_teme_km_s"]


def evaluate_maneuver(
    db: Session,
    *,
    primary_norad_cat_id: int,
    secondary_norad_cat_id: int,
    burn_time: datetime,
    radial_km_s: float,
    transverse_km_s: float,
    normal_km_s: float,
    search_start: datetime,
    search_end: datetime,
    step_seconds: int,
    screening_threshold_km: float,
    baseline_miss_distance_km: float,
) -> ManeuverOutcome:
    burn_time = utc_datetime(burn_time)
    search_start = utc_datetime(search_start)
    search_end = utc_datetime(search_end)
    if search_end <= search_start:
        raise ValueError("search_end must be after search_start")
    if burn_time < search_start:
        raise ValueError("burn_time must not be before search_start")

    pre_burn_position, pre_burn_velocity = _primary_state_at(db, primary_norad_cat_id, burn_time)
    dv_teme = rtn_delta_v_to_teme(pre_burn_position, pre_burn_velocity, radial_km_s, transverse_km_s, normal_km_s)
    post_burn_velocity = [pre_burn_velocity[i] + dv_teme[i] for i in range(3)]

    try:
        elements: ClassicalElements = state_to_elements(pre_burn_position, post_burn_velocity)
    except NonEllipticalOrbitError as exc:
        return ManeuverOutcome(
            burn_time=burn_time,
            new_tca=None,
            new_miss_distance_km=None,
            new_relative_velocity_km_s=None,
            baseline_miss_distance_km=baseline_miss_distance_km,
            cleared_threshold=None,
            sample_count=0,
            notes=_STATIC_NOTES + [str(exc)],
        )

    def distance_at(stamp: datetime) -> float | None:
        dt_seconds = (stamp - burn_time).total_seconds()
        if dt_seconds < 0:
            return None
        primary_position, _ = propagate_elements(elements, dt_seconds)
        secondary_state = _secondary_state_at(db, secondary_norad_cat_id, stamp)
        if secondary_state is None:
            return None
        secondary_position, _ = secondary_state
        return math.sqrt(sum((a - b) ** 2 for a, b in zip(primary_position, secondary_position)))

    samples: list[tuple[datetime, float]] = []
    current = search_start
    while current <= search_end:
        d = distance_at(current)
        if d is not None:
            samples.append((current, d))
        current += timedelta(seconds=step_seconds)

    if not samples:
        return ManeuverOutcome(
            burn_time=burn_time,
            new_tca=None,
            new_miss_distance_km=None,
            new_relative_velocity_km_s=None,
            baseline_miss_distance_km=baseline_miss_distance_km,
            cleared_threshold=None,
            sample_count=0,
            notes=_STATIC_NOTES + ["No valid samples in the search window (SGP4 propagation failed throughout)."],
        )

    best_time, best_distance = min(samples, key=lambda item: item[1])

    half_window = timedelta(seconds=step_seconds)
    lower = max(search_start, best_time - half_window)
    upper = min(search_end, best_time + half_window)

    if upper > lower:
        duration = (upper - lower).total_seconds()
        ratio = (math.sqrt(5) - 1) / 2
        left, right = 0.0, duration
        x1 = right - ratio * (right - left)
        x2 = left + ratio * (right - left)
        v1 = distance_at(lower + timedelta(seconds=x1))
        v2 = distance_at(lower + timedelta(seconds=x2))
        for _ in range(20):
            if v1 is None or v2 is None:
                break
            if v1 <= v2:
                right = x2
                x2, v2 = x1, v1
                x1 = right - ratio * (right - left)
                v1 = distance_at(lower + timedelta(seconds=x1))
            else:
                left = x1
                x1, v1 = x2, v2
                x2 = left + ratio * (right - left)
                v2 = distance_at(lower + timedelta(seconds=x2))
        refined = [(best_time, best_distance)]
        if v1 is not None:
            refined.append((lower + timedelta(seconds=x1), v1))
        if v2 is not None:
            refined.append((lower + timedelta(seconds=x2), v2))
        best_time, best_distance = min(refined, key=lambda item: item[1])

    dt_seconds = (best_time - burn_time).total_seconds()
    relative_velocity: float | None = None
    if dt_seconds >= 0:
        _, primary_velocity_at_tca = propagate_elements(elements, dt_seconds)
        secondary_state = _secondary_state_at(db, secondary_norad_cat_id, best_time)
        if secondary_state is not None:
            _, secondary_velocity = secondary_state
            relative_velocity = math.sqrt(
                sum((primary_velocity_at_tca[i] - secondary_velocity[i]) ** 2 for i in range(3))
            )

    return ManeuverOutcome(
        burn_time=burn_time,
        new_tca=best_time,
        new_miss_distance_km=best_distance,
        new_relative_velocity_km_s=relative_velocity,
        baseline_miss_distance_km=baseline_miss_distance_km,
        cleared_threshold=best_distance > screening_threshold_km,
        sample_count=len(samples),
        notes=_STATIC_NOTES,
    )
