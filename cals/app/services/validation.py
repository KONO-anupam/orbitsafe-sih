"""Validation and parsing for raw GP/OMM and SATCAT values."""

from __future__ import annotations

from datetime import datetime, timezone
import math


class DataValidationError(ValueError):
    """A raw catalog/GP record violates a required data contract."""


def utc_datetime(value: str | datetime) -> datetime:
    """Parse ISO-8601 and normalize to UTC.

    The source GP timestamps are offset-naive. Per the documented source policy,
    naive input is interpreted as UTC rather than server-local time.
    """
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise DataValidationError("EPOCH/timestamp must be ISO-8601") from exc
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _number(record: dict, key: str) -> float:
    try:
        value = float(record[key])
    except (KeyError, TypeError, ValueError) as exc:
        raise DataValidationError(f"{key} must be numeric") from exc
    if not math.isfinite(value):
        raise DataValidationError(f"{key} must be finite")
    return value


def validate_gp_record(record: dict) -> dict:
    """Validate the audited GP fields and return a normalized copy."""
    try:
        norad = int(record["NORAD_CAT_ID"])
    except (KeyError, TypeError, ValueError) as exc:
        raise DataValidationError("NORAD_CAT_ID must be a positive integer") from exc
    if norad <= 0 or isinstance(record.get("NORAD_CAT_ID"), bool):
        raise DataValidationError("NORAD_CAT_ID must be a positive integer")
    for key in ("OBJECT_NAME", "OBJECT_ID"):
        if not isinstance(record.get(key), str) or not record[key].strip():
            raise DataValidationError(f"{key} must be a non-empty string")
    normalized = dict(record)
    normalized["NORAD_CAT_ID"] = norad
    normalized["EPOCH"] = utc_datetime(record.get("EPOCH")).isoformat()
    constraints = {
        "MEAN_MOTION": lambda x: x > 0,
        "ECCENTRICITY": lambda x: 0 <= x < 1,
        "INCLINATION": lambda x: 0 <= x <= 180,
        "RA_OF_ASC_NODE": lambda x: 0 <= x < 360,
        "ARG_OF_PERICENTER": lambda x: 0 <= x < 360,
        "MEAN_ANOMALY": lambda x: 0 <= x < 360,
    }
    for key, predicate in constraints.items():
        value = _number(record, key)
        if not predicate(value):
            raise DataValidationError(f"{key} is outside its orbital domain")
        normalized[key] = value
    # BSTAR and derivatives may validly be negative; only finite numeric values are required.
    for key in ("BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"):
        normalized[key] = _number(record, key)
    for key in ("EPHEMERIS_TYPE", "ELEMENT_SET_NO", "REV_AT_EPOCH"):
        try:
            normalized[key] = int(record[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise DataValidationError(f"{key} must be an integer") from exc
    normalized["CLASSIFICATION_TYPE"] = str(record.get("CLASSIFICATION_TYPE", "U"))
    return normalized
