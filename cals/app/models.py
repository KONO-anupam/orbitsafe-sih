"""Internal persistence models; never return these directly from the API."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class OrbitalObject(Base):
    __tablename__ = "orbital_objects"

    norad_cat_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    object_name: Mapped[str] = mapped_column(Text, nullable=False)
    international_designator: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str] = mapped_column(String(8), nullable=False)
    ops_status_code: Mapped[str | None] = mapped_column(String(8))
    owner: Mapped[str | None] = mapped_column(Text)
    launch_date: Mapped[date | None] = mapped_column(Date)
    launch_site: Mapped[str | None] = mapped_column(Text)
    decay_date: Mapped[date | None] = mapped_column(Date)
    period_min: Mapped[float | None] = mapped_column(Float)
    inclination_deg: Mapped[float | None] = mapped_column(Float)
    apogee_km: Mapped[float | None] = mapped_column(Float)
    perigee_km: Mapped[float | None] = mapped_column(Float)
    rcs_m2: Mapped[float | None] = mapped_column(Float)
    data_status_code: Mapped[str | None] = mapped_column(String(16))
    orbit_center: Mapped[str | None] = mapped_column(String(32))
    orbit_type: Mapped[str | None] = mapped_column(String(8))
    source_category: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    element_sets: Mapped[list["OrbitalElementSet"]] = relationship(
        back_populates="orbital_object", cascade="all, delete-orphan"
    )


class OrbitalElementSet(Base):
    __tablename__ = "orbital_element_sets"
    __table_args__ = (
        UniqueConstraint("norad_cat_id", "epoch_utc", "source_file", name="uq_element_source_epoch"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    norad_cat_id: Mapped[int] = mapped_column(ForeignKey("orbital_objects.norad_cat_id"), nullable=False, index=True)
    epoch_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    mean_motion_rev_per_day: Mapped[float] = mapped_column(Float, nullable=False)
    eccentricity: Mapped[float] = mapped_column(Float, nullable=False)
    inclination_deg: Mapped[float] = mapped_column(Float, nullable=False)
    raan_deg: Mapped[float] = mapped_column(Float, nullable=False)
    arg_perigee_deg: Mapped[float] = mapped_column(Float, nullable=False)
    mean_anomaly_deg: Mapped[float] = mapped_column(Float, nullable=False)
    bstar: Mapped[float] = mapped_column(Float, nullable=False)
    mean_motion_dot_rev_day2: Mapped[float] = mapped_column(Float, nullable=False)
    mean_motion_ddot_rev_day3: Mapped[float] = mapped_column(Float, nullable=False)
    ephemeris_type: Mapped[int] = mapped_column(Integer, nullable=False)
    classification_type: Mapped[str] = mapped_column(String(8), nullable=False)
    element_set_no: Mapped[int] = mapped_column(Integer, nullable=False)
    rev_at_epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_object_id: Mapped[str] = mapped_column(Text, nullable=False)
    raw_record_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_file: Mapped[str] = mapped_column(String(128), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    orbital_object: Mapped[OrbitalObject] = relationship(back_populates="element_sets")
