"""Idempotent ingestion of audited SATCAT and GP/OMM source files."""

from __future__ import annotations

import csv
from datetime import date, datetime, timezone
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OrbitalElementSet, OrbitalObject
from app.services.validation import DataValidationError, utc_datetime, validate_gp_record

GP_SOURCES = {
    "active_satellites.json": "active",
    "cosmos_2251_debris.json": "cosmos_2251_debris",
    "fengyun_1c_debris.json": "fengyun_1c_debris",
    "iridium_33_debris.json": "iridium_33_debris",
}


def _blank(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _optional_float(value: str | None) -> float | None:
    value = _blank(value)
    return float(value) if value is not None else None


def _optional_date(value: str | None) -> date | None:
    value = _blank(value)
    return date.fromisoformat(value) if value is not None else None


def ingest_satcat(db: Session, path: Path, now: datetime) -> int:
    """Upsert every SATCAT row and return the number processed."""
    count = 0
    existing_objects = {item.norad_cat_id: item for item in db.scalars(select(OrbitalObject)).all()}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            norad = int(row["NORAD_CAT_ID"])
            if norad <= 0:
                raise DataValidationError("SATCAT NORAD_CAT_ID must be positive")
            obj = existing_objects.get(norad)
            values = dict(
                object_name=row["OBJECT_NAME"].strip(),
                international_designator=row["OBJECT_ID"].strip(),
                object_type=row["OBJECT_TYPE"].strip(),
                ops_status_code=_blank(row["OPS_STATUS_CODE"]),
                owner=_blank(row["OWNER"]),
                launch_date=_optional_date(row["LAUNCH_DATE"]),
                launch_site=_blank(row["LAUNCH_SITE"]),
                decay_date=_optional_date(row["DECAY_DATE"]),
                period_min=_optional_float(row["PERIOD"]),
                inclination_deg=_optional_float(row["INCLINATION"]),
                apogee_km=_optional_float(row["APOGEE"]),
                perigee_km=_optional_float(row["PERIGEE"]),
                rcs_m2=_optional_float(row["RCS"]),
                data_status_code=_blank(row["DATA_STATUS_CODE"]),
                orbit_center=_blank(row["ORBIT_CENTER"]),
                orbit_type=_blank(row["ORBIT_TYPE"]),
                updated_at=now,
            )
            if obj is None:
                obj = OrbitalObject(norad_cat_id=norad, source_category="satcat_only", created_at=now, **values)
                db.add(obj)
                existing_objects[norad] = obj
            else:
                for key, value in values.items():
                    setattr(obj, key, value)
            count += 1
    db.flush()
    return count


def ingest_gp_source(db: Session, path: Path, source_category: str, now: datetime) -> int:
    """Validate, join, and insert GP element history without duplicate records."""
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise DataValidationError(f"{path.name} must contain a JSON list")
    count = 0
    objects = {item.norad_cat_id: item for item in db.scalars(select(OrbitalObject)).all()}
    existing_keys = {
        (item.norad_cat_id, utc_datetime(item.epoch_utc))
        for item in db.scalars(
            select(OrbitalElementSet).where(OrbitalElementSet.source_file == path.name)
        ).all()
    }
    for raw in records:
        record = validate_gp_record(raw)
        norad = record["NORAD_CAT_ID"]
        obj = objects.get(norad)
        if obj is None:
            raise DataValidationError(f"GP NORAD_CAT_ID {norad} has no SATCAT metadata")
        # SATCAT remains authoritative for object_type; GP source is independent provenance.
        obj.source_category = source_category
        obj.updated_at = now
        epoch = utc_datetime(record["EPOCH"])
        if (norad, epoch) not in existing_keys:
            db.add(OrbitalElementSet(
                norad_cat_id=norad,
                epoch_utc=epoch,
                mean_motion_rev_per_day=record["MEAN_MOTION"],
                eccentricity=record["ECCENTRICITY"],
                inclination_deg=record["INCLINATION"],
                raan_deg=record["RA_OF_ASC_NODE"],
                arg_perigee_deg=record["ARG_OF_PERICENTER"],
                mean_anomaly_deg=record["MEAN_ANOMALY"],
                bstar=record["BSTAR"],
                mean_motion_dot_rev_day2=record["MEAN_MOTION_DOT"],
                mean_motion_ddot_rev_day3=record["MEAN_MOTION_DDOT"],
                ephemeris_type=record["EPHEMERIS_TYPE"],
                classification_type=record["CLASSIFICATION_TYPE"],
                element_set_no=record["ELEMENT_SET_NO"],
                rev_at_epoch=record["REV_AT_EPOCH"],
                raw_object_id=record["OBJECT_ID"],
                raw_record_json=json.dumps(raw, sort_keys=True, separators=(",", ":")),
                source_file=path.name,
                ingested_at=now,
            ))
            existing_keys.add((norad, epoch))
        count += 1
    db.flush()
    return count


def ingest_all(db: Session, raw_dir: Path) -> dict[str, int]:
    """Ingest SATCAT first, then all GP sources in one transaction controlled by caller."""
    now = datetime.now(timezone.utc)
    result = {"satcat": ingest_satcat(db, raw_dir / "satcat.csv", now)}
    for filename, category in GP_SOURCES.items():
        result[filename] = ingest_gp_source(db, raw_dir / filename, category, now)
    return result
