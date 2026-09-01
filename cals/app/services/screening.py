"""Conservative, nominal conjunction screening built on the SGP4 service.

This is a candidate generator, not a collision-probability service.  It uses
one fixed GP/OMM element set per object for the entire run, samples all
eligible objects on a shared coarse timeline, uses a 3D spatial hash to avoid
all-pairs comparisons, and refines local minima with SGP4 propagation.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import combinations
import math

from sgp4.api import Satrec, jday
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import MAX_ELEMENT_AGE_DAYS, MAX_FUTURE_ELEMENT_HOURS
from app.models import OrbitalElementSet, OrbitalObject
from app.services.sgp4_adapter import satrec_from_element_set
from app.services.scoring import MissionProfile, score_candidate
from app.services.validation import utc_datetime


# A conservative LEO relative-speed bound.  It is only used to widen the
# broad-phase gate enough that a close approach between coarse samples is not
# discarded merely because neither endpoint is close.
MAX_RELATIVE_SPEED_KM_S = 16.0
EARTH_RADIUS_KM = 6378.137
MU_EARTH_KM3_S2 = 398600.4418
# Distinct SATCAT entries can represent attached components of one physical
# spacecraft (for example ISS modules) and share an identical GP state.  They
# are catalog artifacts, not fly-by conjunctions.
CO_PROPAGATING_DISTANCE_KM = 1e-3
CO_PROPAGATING_SPEED_KM_S = 1e-5


@dataclass(frozen=True)
class ScreeningConfig:
    analysis_time: datetime
    forecast_horizon_hours: float = 24.0
    screening_threshold_km: float = 50.0
    coarse_step_seconds: int = 60
    object_limit: int = 1000
    mission_profile: MissionProfile | None = None

    @property
    def broad_phase_gate_km(self) -> float:
        """Distance gate inflated for possible motion to the nearest sample."""
        return self.screening_threshold_km + (
            MAX_RELATIVE_SPEED_KM_S * self.coarse_step_seconds / 2
        )


@dataclass(frozen=True)
class ScreenedObject:
    object: OrbitalObject
    element: OrbitalElementSet
    satrec: Satrec


@dataclass(frozen=True)
class CoarseObservation:
    timestamp: datetime
    distance_km: float


def _state(satrec: Satrec, timestamp: datetime) -> tuple[int, list[float], list[float]]:
    stamp = utc_datetime(timestamp)
    seconds = stamp.second + stamp.microsecond / 1_000_000
    jd, fraction = jday(stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, seconds)
    error_code, position, velocity = satrec.sgp4(jd, fraction)
    return error_code, list(position), list(velocity)


def _distance(left: list[float], right: list[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def _relative_speed(left: list[float], right: list[float]) -> float:
    return _distance(left, right)


def _cell(position: list[float], cell_size_km: float) -> tuple[int, int, int]:
    return tuple(math.floor(axis / cell_size_km) for axis in position)  # type: ignore[return-value]


def _neighbor_cells(cell: tuple[int, int, int]):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                yield (cell[0] + dx, cell[1] + dy, cell[2] + dz)


def _altitude_envelope(element: OrbitalElementSet) -> tuple[float, float]:
    """Approximate perigee/apogee from the GP mean motion and eccentricity."""
    mean_motion_rad_s = element.mean_motion_rev_per_day * math.tau / 86400
    semi_major_axis = (MU_EARTH_KM3_S2 / (mean_motion_rad_s * mean_motion_rad_s)) ** (1 / 3)
    return (
        semi_major_axis * (1 - element.eccentricity) - EARTH_RADIUS_KM,
        semi_major_axis * (1 + element.eccentricity) - EARTH_RADIUS_KM,
    )


def _envelopes_can_overlap(left: ScreenedObject, right: ScreenedObject, margin_km: float) -> bool:
    """A conservative cheap rejection before refinement, never based on plane angle."""
    left_perigee, left_apogee = _altitude_envelope(left.element)
    right_perigee, right_apogee = _altitude_envelope(right.element)
    return not (
        left_apogee + margin_km < right_perigee
        or right_apogee + margin_km < left_perigee
    )


def _select_screened_objects(db: Session, config: ScreeningConfig) -> tuple[list[ScreenedObject], int]:
    """Select one valid element set per object relative to the run start.

    The selection is deliberately frozen for the entire screening horizon so
    results cannot switch element records halfway through an event.
    """
    requested = utc_datetime(config.analysis_time)
    objects = db.scalars(
        select(OrbitalObject)
        .join(OrbitalElementSet)
        .distinct()
        .order_by(OrbitalObject.norad_cat_id)
        .limit(config.object_limit)
    ).all()
    if not objects:
        return [], 0

    object_ids = [item.norad_cat_id for item in objects]
    elements_by_object: dict[int, list[OrbitalElementSet]] = defaultdict(list)
    for element in db.scalars(
        select(OrbitalElementSet).where(OrbitalElementSet.norad_cat_id.in_(object_ids))
    ).all():
        elements_by_object[element.norad_cat_id].append(element)

    cutoff = requested + timedelta(hours=MAX_FUTURE_ELEMENT_HOURS)
    selected: list[ScreenedObject] = []
    excluded = 0
    for item in objects:
        eligible = [
            element
            for element in elements_by_object[item.norad_cat_id]
            if utc_datetime(element.epoch_utc) <= cutoff
        ]
        if not eligible:
            excluded += 1
            continue
        element = max(eligible, key=lambda value: utc_datetime(value.epoch_utc))
        if requested - utc_datetime(element.epoch_utc) > timedelta(days=MAX_ELEMENT_AGE_DAYS):
            excluded += 1
            continue
        selected.append(ScreenedObject(item, element, satrec_from_element_set(element)))
    return selected, excluded


def _refine_tca(
    left: ScreenedObject,
    right: ScreenedObject,
    center: datetime,
    half_window_seconds: int,
    start: datetime,
    end: datetime,
) -> tuple[datetime, float, float] | None:
    """Minimize nominal separation in a local bracket using golden-section search."""
    lower = max(start, center - timedelta(seconds=half_window_seconds))
    upper = min(end, center + timedelta(seconds=half_window_seconds))
    if upper <= lower:
        return None

    def evaluate(stamp: datetime) -> tuple[float, float] | None:
        left_error, left_position, left_velocity = _state(left.satrec, stamp)
        right_error, right_position, right_velocity = _state(right.satrec, stamp)
        if left_error != 0 or right_error != 0:
            return None
        return _distance(left_position, right_position), _relative_speed(left_velocity, right_velocity)

    # Golden-section search is used only in a short local bracket around the
    # best coarse sample; checking both endpoints prevents an endpoint minimum
    # from being lost.
    duration = (upper - lower).total_seconds()
    ratio = (math.sqrt(5) - 1) / 2
    left_seconds, right_seconds = 0.0, duration
    x1 = right_seconds - ratio * (right_seconds - left_seconds)
    x2 = left_seconds + ratio * (right_seconds - left_seconds)

    def stamp(offset_seconds: float) -> datetime:
        return lower + timedelta(seconds=offset_seconds)

    value1 = evaluate(stamp(x1))
    value2 = evaluate(stamp(x2))
    if value1 is None or value2 is None:
        return None
    for _ in range(28):
        if value1[0] <= value2[0]:
            right_seconds = x2
            x2, value2 = x1, value1
            x1 = right_seconds - ratio * (right_seconds - left_seconds)
            value1 = evaluate(stamp(x1))
        else:
            left_seconds = x1
            x1, value1 = x2, value2
            x2 = left_seconds + ratio * (right_seconds - left_seconds)
            value2 = evaluate(stamp(x2))
        if value1 is None or value2 is None:
            return None

    candidates = [(lower, evaluate(lower)), (upper, evaluate(upper)), (stamp(x1), value1), (stamp(x2), value2)]
    valid = [(time, value) for time, value in candidates if value is not None]
    if not valid:
        return None
    best_time, (distance, speed) = min(valid, key=lambda item: item[1][0])
    return best_time, distance, speed


def _object_type(value: str) -> str:
    return {"PAY": "PAYLOAD", "DEB": "DEBRIS", "R/B": "ROCKET BODY"}.get(value, "STATION")


def _is_co_propagating(refined: tuple[datetime, float, float]) -> bool:
    """Exclude identical catalog states for components of the same vehicle."""
    _, distance, speed = refined
    return distance <= CO_PROPAGATING_DISTANCE_KM and speed <= CO_PROPAGATING_SPEED_KM_S


def _candidate_response(
    left: ScreenedObject,
    right: ScreenedObject,
    refined: tuple[datetime, float, float],
    config: ScreeningConfig,
) -> dict:
    tca, miss_distance, relative_velocity = refined
    primary, secondary = sorted((left, right), key=lambda item: item.object.norad_cat_id)
    oldest_epoch = min(utc_datetime(left.element.epoch_utc), utc_datetime(right.element.epoch_utc))
    data_age = (utc_datetime(config.analysis_time) - oldest_epoch).total_seconds() / 3600
    limitations = [
        "Nominal SGP4/GP screening only; no covariance-based collision probability is available.",
    ]
    primary_type = _object_type(primary.object.object_type)
    secondary_type = _object_type(secondary.object.object_type)
    risk = score_candidate(
        miss_distance_km=miss_distance,
        relative_velocity_km_s=relative_velocity,
        tca=tca,
        analysis_time=config.analysis_time,
        data_age_hours=data_age,
        primary_object_type=primary_type,
        secondary_object_type=secondary_type,
        profile=config.mission_profile,
    )
    limitations.extend(risk.limitations)
    return {
        "event_id": f"{primary.object.norad_cat_id}-{secondary.object.norad_cat_id}-{tca.isoformat()}",
        "primary": {
            "norad_id": str(primary.object.norad_cat_id),
            "name": primary.object.object_name,
            "object_type": primary_type,
        },
        "secondary": {
            "norad_id": str(secondary.object.norad_cat_id),
            "name": secondary.object.object_name,
            "object_type": secondary_type,
        },
        "tca": tca,
        "miss_distance_km": miss_distance,
        "relative_velocity_km_s": relative_velocity,
        "risk_score": risk.score,
        "severity": risk.severity,
        "confidence": risk.confidence,
        "data_age_hours": data_age,
        "forecast_horizon_hours": config.forecast_horizon_hours,
        "source": "CelesTrak cached GP/OMM data",
        "method": "SGP4 nominal screening with spatial broad phase and local TCA refinement",
        "limitations": limitations,
        "score_breakdown": risk.breakdown,
        "next_step": risk.next_step,
        "next_step_reason": risk.next_step_reason,
        "mission_priority": risk.mission_priority,
        "mission_breakdown": risk.mission_breakdown,
    }


def screen_catalog(db: Session, config: ScreeningConfig) -> dict:
    """Screen a catalog subset and return refined nominal conjunction candidates."""
    analysis_time = utc_datetime(config.analysis_time)
    config = ScreeningConfig(
        analysis_time=analysis_time,
        forecast_horizon_hours=config.forecast_horizon_hours,
        screening_threshold_km=config.screening_threshold_km,
        coarse_step_seconds=config.coarse_step_seconds,
        object_limit=config.object_limit,
        mission_profile=config.mission_profile,
    )
    objects, excluded = _select_screened_objects(db, config)
    end_time = analysis_time + timedelta(hours=config.forecast_horizon_hours)
    observations: dict[tuple[int, int], list[CoarseObservation]] = defaultdict(list)
    object_by_id = {item.object.norad_cat_id: item for item in objects}
    current = analysis_time

    while current <= end_time:
        grid: dict[tuple[int, int, int], list[tuple[ScreenedObject, list[float]]]] = defaultdict(list)
        for item in objects:
            error_code, position, _ = _state(item.satrec, current)
            if error_code == 0:
                grid[_cell(position, config.broad_phase_gate_km)].append((item, position))

        for cell, members in grid.items():
            for neighbor in _neighbor_cells(cell):
                if neighbor not in grid or neighbor < cell:
                    continue
                pairs = combinations(members, 2) if neighbor == cell else (
                    (left, right) for left in members for right in grid[neighbor]
                )
                for (left, left_position), (right, right_position) in pairs:
                    if not _envelopes_can_overlap(left, right, config.broad_phase_gate_km):
                        continue
                    distance = _distance(left_position, right_position)
                    if distance <= config.broad_phase_gate_km:
                        key = tuple(sorted((left.object.norad_cat_id, right.object.norad_cat_id)))
                        observations[key].append(CoarseObservation(current, distance))
        current += timedelta(seconds=config.coarse_step_seconds)

    candidates: list[dict] = []
    for pair, pair_observations in observations.items():
        # Separate distant observations into independent local approaches so a
        # pair can yield multiple events over a longer screening horizon.
        groups: list[list[CoarseObservation]] = []
        for observation in pair_observations:
            if not groups or (
                observation.timestamp - groups[-1][-1].timestamp
            ).total_seconds() > config.coarse_step_seconds * 2:
                groups.append([observation])
            else:
                groups[-1].append(observation)
        for group in groups:
            best = min(group, key=lambda item: item.distance_km)
            refined = _refine_tca(
                object_by_id[pair[0]],
                object_by_id[pair[1]],
                best.timestamp,
                config.coarse_step_seconds,
                analysis_time,
                end_time,
            )
            if (
                refined is not None
                and not _is_co_propagating(refined)
                and refined[1] <= config.screening_threshold_km
            ):
                candidates.append(_candidate_response(object_by_id[pair[0]], object_by_id[pair[1]], refined, config))

    candidates.sort(key=lambda candidate: (candidate["tca"], candidate["miss_distance_km"]))
    return {
        "analysis_time": analysis_time,
        "eligible_objects": len(objects),
        "excluded_objects": excluded,
        "candidates": candidates,
    }
