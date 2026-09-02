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
from app.services.screening import (
    MAX_RELATIVE_SPEED_KM_S,
    MU_EARTH_KM3_S2,
    ScreeningConfig,
    _distance,
    _object_type,
    _relative_speed,
    _select_screened_objects,
    _state,
    screen_catalog,
)
from app.services.scoring import score_candidate
from app.services.validation import utc_datetime

_STATIC_NOTES = [
    "Post-burn trajectory uses unperturbed two-body (Keplerian) propagation, "
    "not SGP4 — J2 and drag are not modeled after the burn.",
    "Burn is modeled as instantaneous (impulsive); finite-duration thruster effects are ignored.",
    "Near-circular orbits are modeled with a small eccentricity floor to keep "
    "the orbital-element parameterization well defined.",
    "Only encounters within the requested search window are considered.",
]


def _vadd(a: list[float], b: list[float]) -> list[float]:
    return [x + y for x, y in zip(a, b)]


def _vscale(a: list[float], s: float) -> list[float]:
    return [x * s for x in a]


def _vnorm(a: list[float]) -> float:
    return math.sqrt(sum(x * x for x in a))


def _two_body_accel(position: list[float]) -> list[float]:
    r = _vnorm(position)
    return _vscale(position, -MU_EARTH_KM3_S2 / (r ** 3))


def _rk4_step(position: list[float], velocity: list[float], dt: float) -> tuple[list[float], list[float]]:
    def deriv(pos: list[float], vel: list[float]) -> tuple[list[float], list[float]]:
        return vel, _two_body_accel(pos)

    k1p, k1v = deriv(position, velocity)
    k2p, k2v = deriv(_vadd(position, _vscale(k1p, dt / 2)), _vadd(velocity, _vscale(k1v, dt / 2)))
    k3p, k3v = deriv(_vadd(position, _vscale(k2p, dt / 2)), _vadd(velocity, _vscale(k2v, dt / 2)))
    k4p, k4v = deriv(_vadd(position, _vscale(k3p, dt)), _vadd(velocity, _vscale(k3v, dt)))

    new_position = _vadd(
        position,
        _vscale(_vadd(_vadd(k1p, _vscale(k2p, 2)), _vadd(_vscale(k3p, 2), k4p)), dt / 6),
    )
    new_velocity = _vadd(
        velocity,
        _vscale(_vadd(_vadd(k1v, _vscale(k2v, 2)), _vadd(_vscale(k3v, 2), k4v)), dt / 6),
    )
    return new_position, new_velocity


def _propagate_maneuvered(
    position0: list[float],
    velocity0: list[float],
    start_time: datetime,
    end_time: datetime,
    step_seconds: int,
) -> list[tuple[datetime, list[float], list[float]]]:
    trace: list[tuple[datetime, list[float], list[float]]] = [(start_time, position0, velocity0)]
    position, velocity = position0, velocity0
    current = start_time
    integration_step = min(30.0, float(step_seconds))
    while current < end_time:
        next_sample_time = min(current + timedelta(seconds=step_seconds), end_time)
        remaining = (next_sample_time - current).total_seconds()
        while remaining > 1e-6:
            dt = min(integration_step, remaining)
            position, velocity = _rk4_step(position, velocity, dt)
            remaining -= dt
        current = next_sample_time
        trace.append((current, position, velocity))
    return trace


def _parabolic_minimum(
    t0: datetime, d0: float, t1: datetime, d1: float, t2: datetime, d2: float, step_seconds: float
) -> tuple[datetime, float]:
    denom = d0 - 2 * d1 + d2
    if abs(denom) < 1e-9:
        return t1, d1
    delta = max(-1.0, min(1.0, 0.5 * (d0 - d2) / denom))
    t_min = t1 + timedelta(seconds=delta * step_seconds)
    return t_min, max(0.0, d1 - 0.25 * (d0 - d2) * delta)


def simulate_maneuver(db: Session, config: ManeuverConfig) -> dict:
    analysis_time = utc_datetime(config.analysis_time)
    end_time = analysis_time + timedelta(hours=config.forecast_horizon_hours)
    maneuver_time = analysis_time + timedelta(hours=config.maneuver_lead_hours)
    if maneuver_time >= end_time:
        maneuver_time = end_time - timedelta(seconds=config.sample_step_seconds)

    screening_config = ScreeningConfig(
        analysis_time=analysis_time,
        forecast_horizon_hours=config.forecast_horizon_hours,
        screening_threshold_km=config.screening_threshold_km,
        coarse_step_seconds=config.sample_step_seconds,
        object_limit=config.object_limit,
    )
    objects, _excluded = _select_screened_objects(db, screening_config)
    target = next((item for item in objects if item.object.norad_cat_id == config.norad_cat_id), None)
    if target is None:
        raise ManeuverTargetNotFoundError(
            f"NORAD catalog ID {config.norad_cat_id} is not in the current eligible screening set"
        )
    others = [item for item in objects if item.object.norad_cat_id != config.norad_cat_id]
    other_by_id = {item.object.norad_cat_id: item for item in others}

    baseline_result = screen_catalog(db, screening_config)
    target_id_str = str(config.norad_cat_id)
    baseline_events: list[dict] = []
    baseline_by_secondary: dict[int, dict] = {}
    for candidate in baseline_result["candidates"]:
        if candidate["primary"]["norad_id"] != target_id_str and candidate["secondary"]["norad_id"] != target_id_str:
            continue
        secondary_ref = candidate["secondary"] if candidate["primary"]["norad_id"] == target_id_str else candidate["primary"]
        entry = {
            "secondary": secondary_ref,
            "tca": candidate["tca"],
            "miss_distance_km": candidate["miss_distance_km"],
            "relative_velocity_km_s": candidate["relative_velocity_km_s"],
            "risk_score": candidate["risk_score"],
            "severity": candidate["severity"],
            "confidence": candidate["confidence"],
        }
        baseline_events.append(entry)
        baseline_by_secondary[int(secondary_ref["norad_id"])] = entry

    error_code, position_at_maneuver, velocity_at_maneuver = _state(target.satrec, maneuver_time)
    if error_code != 0:
        raise ManeuverTargetNotFoundError("Target's SGP4 state could not be evaluated at the maneuver time")
    speed = _vnorm(velocity_at_maneuver)
    if speed <= 0:
        raise ManeuverTargetNotFoundError("Target has zero velocity at the maneuver time")
    prograde_unit = _vscale(velocity_at_maneuver, 1 / speed)
    new_velocity = _vadd(velocity_at_maneuver, _vscale(prograde_unit, config.delta_v_m_s / 1000.0))
    maneuvered_trace = _propagate_maneuvered(position_at_maneuver, new_velocity, maneuver_time, end_time, config.sample_step_seconds)

    gate_km = config.screening_threshold_km + (MAX_RELATIVE_SPEED_KM_S * config.sample_step_seconds / 2)
    observations: dict[int, list[tuple[datetime, float, list[float], list[float]]]] = {}
    for sample_time, target_position, target_velocity in maneuvered_trace:
        for other in others:
            other_error, other_position, other_velocity = _state(other.satrec, sample_time)
            if other_error != 0:
                continue
            distance = _distance(target_position, other_position)
            if distance <= gate_km:
                observations.setdefault(other.object.norad_cat_id, []).append((sample_time, distance, target_velocity, other_velocity))

    post_maneuver_events: list[dict] = []
    post_by_secondary: dict[int, dict] = {}
    target_type = _object_type(target.object.object_type)
    for norad_id, samples in observations.items():
        samples.sort(key=lambda item: item[0])
        groups: list[list[tuple[datetime, float, list[float], list[float]]]] = []
        for sample in samples:
            if not groups or (sample[0] - groups[-1][-1][0]).total_seconds() > config.sample_step_seconds * 2:
                groups.append([sample])
            else:
                groups[-1].append(sample)

        other = other_by_id[norad_id]
        for group in groups:
            best_idx = min(range(len(group)), key=lambda i: group[i][1])
            if 0 < best_idx < len(group) - 1:
                t_min, d_min = _parabolic_minimum(
                    group[best_idx - 1][0],
                    group[best_idx - 1][1],
                    group[best_idx][0],
                    group[best_idx][1],
                    group[best_idx + 1][0],
                    group[best_idx + 1][1],
                    config.sample_step_seconds,
                )
            else:
                t_min, d_min = group[best_idx][0], group[best_idx][1]
            if d_min > config.screening_threshold_km:
                continue

            rel_velocity = _relative_speed(group[best_idx][2], group[best_idx][3])
            oldest_epoch = min(utc_datetime(target.element.epoch_utc), utc_datetime(other.element.epoch_utc))
            data_age = (analysis_time - oldest_epoch).total_seconds() / 3600
            risk = score_candidate(
                miss_distance_km=d_min,
                relative_velocity_km_s=rel_velocity,
                tca=t_min,
                analysis_time=analysis_time,
                data_age_hours=data_age,
                primary_object_type=target_type,
                secondary_object_type=_object_type(other.object.object_type),
            )
            secondary_ref = {
                "norad_id": str(norad_id),
                "name": other.object.object_name,
                "object_type": _object_type(other.object.object_type),
            }
            entry = {
                "secondary": secondary_ref,
                "tca": t_min,
                "miss_distance_km": d_min,
                "relative_velocity_km_s": rel_velocity,
                "risk_score": risk.score,
                "severity": risk.severity,
                "confidence": risk.confidence,
            }
            post_maneuver_events.append(entry)
            post_by_secondary[norad_id] = entry

    baseline_after = {k: v for k, v in baseline_by_secondary.items() if utc_datetime(v["tca"]) >= maneuver_time}
    comparison: list[dict] = []
    for secondary_id in set(baseline_after.keys()) | set(post_by_secondary.keys()):
        before = baseline_after.get(secondary_id)
        after = post_by_secondary.get(secondary_id)
        if before and after:
            status = "unchanged"
            if after["risk_score"] > before["risk_score"] + 5:
                status = "worsened"
            elif after["risk_score"] < before["risk_score"] - 5:
                status = "improved"
            comparison.append(
                {
                    "secondary": after["secondary"],
                    "status": status,
                    "before_miss_distance_km": before["miss_distance_km"],
                    "after_miss_distance_km": after["miss_distance_km"],
                    "before_risk_score": before["risk_score"],
                    "after_risk_score": after["risk_score"],
                }
            )
        elif before:
            comparison.append(
                {
                    "secondary": before["secondary"],
                    "status": "resolved",
                    "before_miss_distance_km": before["miss_distance_km"],
                    "after_miss_distance_km": None,
                    "before_risk_score": before["risk_score"],
                    "after_risk_score": None,
                }
            )
        else:
            comparison.append(
                {
                    "secondary": after["secondary"],
                    "status": "new",
                    "before_miss_distance_km": None,
                    "after_miss_distance_km": after["miss_distance_km"],
                    "before_risk_score": None,
                    "after_risk_score": after["risk_score"],
                }
            )
    rank = {"new": 0, "worsened": 1, "resolved": 2, "improved": 3, "unchanged": 4}
    comparison.sort(key=lambda row: rank[row["status"]])

    return {
        "target": {"norad_id": target_id_str, "name": target.object.object_name, "object_type": target_type},
        "maneuver_time": maneuver_time,
        "delta_v_m_s": config.delta_v_m_s,
        "analysis_time": analysis_time,
        "forecast_horizon_hours": config.forecast_horizon_hours,
        "baseline_events": baseline_events,
        "post_maneuver_events": post_maneuver_events,
        "comparison": comparison,
        "limitations": [
            "Post-maneuver trajectory uses two-body nominal propagation only — no J2, drag, or third-body perturbations.",
            "No covariance-based collision probability is available; this is a nominal hypothetical exploration tool, not a maneuver-planning system.",
        ],
    }


class ManeuverTargetNotFoundError(LookupError):
    """The requested target is not part of the eligible screening set."""


class ManeuverInfeasibleError(ValueError):
    """The requested burn cannot be evaluated (bad geometry, SGP4 failure, etc.)."""


@dataclass(frozen=True)
class ManeuverConfig:
    norad_cat_id: int
    delta_v_m_s: float
    maneuver_lead_hours: float
    analysis_time: datetime
    forecast_horizon_hours: float = 24.0
    screening_threshold_km: float = 50.0
    sample_step_seconds: int = 120
    object_limit: int = 150


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
