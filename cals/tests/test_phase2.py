from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import OrbitalElementSet
from app.services.ingestion import ingest_all
from app.services.propagation import (
    ElementEpochPolicyError,
    generate_trajectory,
    propagate_element,
    propagate_position,
    select_element_set,
)
from app.services.sgp4_adapter import satrec_from_element_set
from app.services.screening import ScreeningConfig, screen_catalog
from app.services.scoring import score_candidate
from app.services.validation import DataValidationError, utc_datetime, validate_gp_record


@pytest.fixture(scope="module")
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    ingest_all(session, Path(__file__).resolve().parents[1] / "data" / "raw")
    session.commit()
    yield session
    session.close()


@pytest.mark.parametrize("norad", [900, 22675, 25730, 24946, 100000])
def test_audited_examples_initialize_and_propagate(db, norad):
    element = db.query(OrbitalElementSet).filter_by(norad_cat_id=norad).one()
    assert satrec_from_element_set(element).satnum == norad
    state = propagate_position(db, norad, element.epoch_utc)
    assert state["sgp4_error_code"] == 0
    assert state["coordinate_frame"] == "TEME"
    assert len(state["position_teme_km"]) == 3
    assert state["geodetic"] is not None


def test_invalid_gp_values_are_rejected():
    raw = {
        "NORAD_CAT_ID": 1,
        "OBJECT_NAME": "TEST",
        "OBJECT_ID": "2026-001A",
        "EPOCH": "2026-01-01T00:00:00.000000",
        "MEAN_MOTION": -1,
        "ECCENTRICITY": 0.1,
        "INCLINATION": 10,
        "RA_OF_ASC_NODE": 10,
        "ARG_OF_PERICENTER": 10,
        "MEAN_ANOMALY": 10,
        "BSTAR": -0.1,
        "MEAN_MOTION_DOT": 0,
        "MEAN_MOTION_DDOT": 0,
        "EPHEMERIS_TYPE": 0,
        "ELEMENT_SET_NO": 1,
        "REV_AT_EPOCH": 1,
    }
    with pytest.raises(DataValidationError, match="MEAN_MOTION"):
        validate_gp_record(raw)
    raw["MEAN_MOTION"] = 1
    raw["ECCENTRICITY"] = 1
    with pytest.raises(DataValidationError, match="ECCENTRICITY"):
        validate_gp_record(raw)


def test_sgp4_error_code_is_returned_not_hidden(db):
    element = db.query(OrbitalElementSet).filter_by(norad_cat_id=900).one()
    original = element.eccentricity
    element.eccentricity = 1.1  # bypass raw validation to exercise SGP4's own error path
    state = propagate_element(element, element.epoch_utc)
    element.eccentricity = original
    assert state["sgp4_error_code"] != 0
    assert state["geodetic"] is None


def test_trajectory_timestamps_and_epoch_policy(db):
    element = db.query(OrbitalElementSet).filter_by(norad_cat_id=900).one()
    start = utc_datetime(element.epoch_utc)
    states = generate_trajectory(db, 900, start, start + timedelta(minutes=2), 60)
    assert [state["timestamp"] for state in states] == [start, start + timedelta(minutes=1), start + timedelta(minutes=2)]
    with pytest.raises(ElementEpochPolicyError, match="stale"):
        select_element_set(db, 900, start + timedelta(days=31))
    with pytest.raises(ElementEpochPolicyError, match="future"):
        select_element_set(db, 900, start - timedelta(hours=25))


def test_ingestion_is_idempotent(db):
    before = db.query(OrbitalElementSet).count()
    ingest_all(db, Path(__file__).resolve().parents[1] / "data" / "raw")
    db.commit()
    assert db.query(OrbitalElementSet).count() == before == 19066


def test_screening_generates_refined_nominal_candidate(db):
    """The spatial broad phase feeds a refined event with scorer-ready facts."""
    first_epoch = db.query(OrbitalElementSet).filter_by(norad_cat_id=900).one().epoch_utc
    result = screen_catalog(
        db,
        ScreeningConfig(
            analysis_time=utc_datetime(first_epoch),
            forecast_horizon_hours=1,
            # A deliberately wide threshold makes this an algorithm-contract
            # test rather than relying on a real-world close approach in the
            # static audit fixture.
            screening_threshold_km=20_000,
            coarse_step_seconds=60,
            object_limit=2,
        ),
    )
    assert result["eligible_objects"] == 2
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["primary"]["norad_id"] == "900"
    assert candidate["secondary"]["norad_id"] == "902"
    assert candidate["miss_distance_km"] <= 20_000
    assert candidate["relative_velocity_km_s"] > 0
    assert candidate["tca"].tzinfo is not None
    assert 0 <= candidate["risk_score"] <= 100
    assert candidate["severity"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert candidate["confidence"] in {"HIGH", "MEDIUM", "LOW"}
    assert candidate["score_breakdown"]


def test_risk_score_is_explainable_and_penalizes_stale_data():
    analysis = utc_datetime("2026-08-26T12:00:00Z")
    close = score_candidate(
        miss_distance_km=2.4,
        relative_velocity_km_s=13.8,
        tca=analysis + timedelta(hours=2),
        analysis_time=analysis,
        data_age_hours=4,
        primary_object_type="PAYLOAD",
        secondary_object_type="DEBRIS",
    )
    stale_distant = score_candidate(
        miss_distance_km=80,
        relative_velocity_km_s=1,
        tca=analysis + timedelta(hours=72),
        analysis_time=analysis,
        data_age_hours=80,
        primary_object_type="DEBRIS",
        secondary_object_type="DEBRIS",
    )
    assert close.score > stale_distant.score
    assert close.severity == "CRITICAL"
    assert close.confidence == "HIGH"
    assert stale_distant.confidence == "LOW"
    assert stale_distant.limitations
