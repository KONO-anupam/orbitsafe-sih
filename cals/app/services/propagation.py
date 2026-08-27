"""SGP4 propagation and clearly-labelled coordinate conversions.

SGP4 returns TEME (True Equator, Mean Equinox) position and velocity.  TEME is
not GCRF/ICRF, so this module does not call its state vectors generic "ECI".
Geodetic output is an approximate TEME -> PEF rotation using GMST and WGS-84;
it omits polar-motion and high-precision Earth-orientation corrections.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import math

from sgp4.api import jday
from sgp4.propagation import gstime
from sqlalchemy.orm import Session

from app.config import MAX_ELEMENT_AGE_DAYS, MAX_FUTURE_ELEMENT_HOURS
from app.models import OrbitalElementSet, OrbitalObject
from app.services.sgp4_adapter import satrec_from_element_set
from app.services.validation import utc_datetime


class ObjectNotFoundError(LookupError):
    pass


class ElementEpochPolicyError(ValueError):
    pass


def select_element_set(
    db: Session,
    norad_cat_id: int,
    analysis_time: datetime,
    max_age_days: float = MAX_ELEMENT_AGE_DAYS,
    max_future_hours: float = MAX_FUTURE_ELEMENT_HOURS,
) -> OrbitalElementSet:
    """Choose latest eligible set and enforce stale/future epoch policy.

    A set may lead the requested analysis instant by no more than
    ``max_future_hours``. The latest eligible epoch is selected; it must then be
    no older than ``max_age_days``. This prevents silent propagation with data
    that is wildly stale or future-dated.
    """
    requested = utc_datetime(analysis_time)
    if db.get(OrbitalObject, norad_cat_id) is None:
        raise ObjectNotFoundError(f"NORAD catalog ID {norad_cat_id} was not found")
    sets = db.query(OrbitalElementSet).filter_by(norad_cat_id=norad_cat_id).all()
    if not sets:
        raise ElementEpochPolicyError("No GP element set is available for this object")
    cutoff = requested + timedelta(hours=max_future_hours)
    eligible = [item for item in sets if utc_datetime(item.epoch_utc) <= cutoff]
    if not eligible:
        nearest = min(utc_datetime(item.epoch_utc) for item in sets)
        raise ElementEpochPolicyError(
            f"Closest element epoch ({nearest.isoformat()}) is too far in the future"
        )
    selected = max(eligible, key=lambda item: utc_datetime(item.epoch_utc))
    age = requested - utc_datetime(selected.epoch_utc)
    if age > timedelta(days=max_age_days):
        raise ElementEpochPolicyError(
            f"Selected element epoch is stale by {age.total_seconds() / 86400:.2f} days"
        )
    return selected


def _julian_date(timestamp: datetime) -> tuple[float, float]:
    stamp = utc_datetime(timestamp)
    second = stamp.second + stamp.microsecond / 1_000_000
    return jday(stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, second)


def teme_to_geodetic(position_teme_km: list[float], jd: float, fr: float) -> dict[str, float]:
    """Approximate TEME-to-geodetic conversion through a GMST PEF rotation."""
    theta = gstime(jd + fr)
    x, y, z = position_teme_km
    x_ecef = math.cos(theta) * x + math.sin(theta) * y
    y_ecef = -math.sin(theta) * x + math.cos(theta) * y
    # WGS-84 ellipsoid, kilometres.
    a = 6378.137
    f = 1 / 298.257223563
    e2 = f * (2 - f)
    p = math.hypot(x_ecef, y_ecef)
    longitude = math.atan2(y_ecef, x_ecef)
    latitude = math.atan2(z, p * (1 - e2))
    for _ in range(8):
        sin_lat = math.sin(latitude)
        n = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
        altitude = p / math.cos(latitude) - n
        latitude = math.atan2(z, p * (1 - e2 * n / (n + altitude)))
    sin_lat = math.sin(latitude)
    n = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
    altitude = p / math.cos(latitude) - n
    return {
        "latitude_deg": math.degrees(latitude),
        "longitude_deg": ((math.degrees(longitude) + 180) % 360) - 180,
        "altitude_km": altitude,
    }


def propagate_element(element: OrbitalElementSet, timestamp: datetime) -> dict:
    timestamp = utc_datetime(timestamp)
    jd, fr = _julian_date(timestamp)
    error_code, position, velocity = satrec_from_element_set(element).sgp4(jd, fr)
    result = {
        "timestamp": timestamp,
        "position_teme_km": list(position),
        "velocity_teme_km_s": list(velocity),
        "sgp4_error_code": error_code,
        "coordinate_frame": "TEME",
        "geodetic": None,
    }
    if error_code == 0:
        result["geodetic"] = teme_to_geodetic(list(position), jd, fr)
    return result


def propagate_position(db: Session, norad_cat_id: int, timestamp: datetime) -> dict:
    element = select_element_set(db, norad_cat_id, timestamp)
    return propagate_element(element, timestamp)


def generate_trajectory(
    db: Session, norad_cat_id: int, start_time: datetime, end_time: datetime, step_seconds: int
) -> list[dict]:
    start, end = utc_datetime(start_time), utc_datetime(end_time)
    if end < start:
        raise ValueError("end_time must be on or after start_time")
    if step_seconds <= 0:
        raise ValueError("step_seconds must be positive")
    states: list[dict] = []
    current = start
    while current <= end:
        states.append(propagate_position(db, norad_cat_id, current))
        current += timedelta(seconds=step_seconds)
    return states
