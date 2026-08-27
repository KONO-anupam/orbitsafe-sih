"""Adapter from normalized GP elements to an SGP4 Satrec; no TLE text is created."""

from __future__ import annotations

from sgp4 import omm
from sgp4.api import Satrec

from app.models import OrbitalElementSet
from app.services.validation import utc_datetime


def element_set_to_omm_fields(element: OrbitalElementSet) -> dict[str, object]:
    """Build the OMM dictionary expected by sgp4.omm.initialize()."""
    epoch = utc_datetime(element.epoch_utc).replace(tzinfo=None)
    return {
        "CLASSIFICATION_TYPE": element.classification_type,
        "OBJECT_ID": element.raw_object_id,
        "EPHEMERIS_TYPE": element.ephemeris_type,
        "ELEMENT_SET_NO": element.element_set_no,
        "REV_AT_EPOCH": element.rev_at_epoch,
        "EPOCH": epoch.strftime("%Y-%m-%dT%H:%M:%S.%f"),
        "ARG_OF_PERICENTER": element.arg_perigee_deg,
        "BSTAR": element.bstar,
        "ECCENTRICITY": element.eccentricity,
        "INCLINATION": element.inclination_deg,
        "MEAN_ANOMALY": element.mean_anomaly_deg,
        "MEAN_MOTION_DDOT": element.mean_motion_ddot_rev_day3,
        "MEAN_MOTION_DOT": element.mean_motion_dot_rev_day2,
        "MEAN_MOTION": element.mean_motion_rev_per_day,
        "RA_OF_ASC_NODE": element.raan_deg,
        "NORAD_CAT_ID": element.norad_cat_id,
    }


def satrec_from_element_set(element: OrbitalElementSet) -> Satrec:
    satrec = Satrec()
    omm.initialize(satrec, element_set_to_omm_fields(element))
    return satrec
