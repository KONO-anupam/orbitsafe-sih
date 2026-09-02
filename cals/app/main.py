"""FastAPI interface for catalog lookup and SGP4 propagation."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import json
import time

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_db, init_db
from app.models import OrbitalElementSet, OrbitalObject
from app.schemas import (
    CandidateConjunctionResponse,
    CascadeManeuverCandidateResponse,
    CascadeManeuverComparisonRow,
    CascadeManeuverRequest,
    CascadeManeuverSimulationResponse,
    ElementResponse,
    ManeuverRequest,
    ManeuverResponse,
    ObjectPage,
    ObjectResponse,
    PositionRequest,
    ScreeningRequest,
    ScreeningResponse,
    StateVectorResponse,
    TrajectoryRequest,
    TrajectoryResponse,
)
from app.services.maneuver import ManeuverConfig, ManeuverTargetNotFoundError, evaluate_maneuver, simulate_maneuver
from app.services.propagation import (
    ElementEpochPolicyError,
    ObjectNotFoundError,
    generate_trajectory,
    propagate_position,
)
from app.services.scoring import MissionProfile as ScoringMissionProfile
from app.services.screening import ScreeningConfig, screen_catalog


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="Space Debris Tracking API",
    version="0.1.0",
    description="Catalog lookup and SGP4 propagation from validated GP/OMM data.",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://orbitsafe-sih-mdna.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Return service readiness."""
    return {"status": "ok"}


@app.get("/api/v1/objects", response_model=ObjectPage, tags=["objects"])
def list_objects(
    norad_cat_id: int | None = Query(default=None, gt=0),
    name: str | None = None,
    object_type: str | None = None,
    source_category: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ObjectPage:
    query = db.query(OrbitalObject)
    if norad_cat_id is not None:
        query = query.filter(OrbitalObject.norad_cat_id == norad_cat_id)
    if name:
        query = query.filter(OrbitalObject.object_name.ilike(f"%{name}%"))
    if object_type:
        query = query.filter(OrbitalObject.object_type == object_type.upper())
    if source_category:
        query = query.filter(OrbitalObject.source_category == source_category)
    total = query.with_entities(func.count()).scalar() or 0
    items = query.order_by(OrbitalObject.norad_cat_id).offset(offset).limit(limit).all()
    return ObjectPage(items=[ObjectResponse.model_validate(item) for item in items], total=total, limit=limit, offset=offset)


@app.get("/api/v1/objects/{norad_cat_id}", response_model=ObjectResponse, tags=["objects"])
def get_object(norad_cat_id: int, db: Session = Depends(get_db)) -> ObjectResponse:
    item = db.get(OrbitalObject, norad_cat_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Object not found")
    return ObjectResponse.model_validate(item)


@app.get("/api/v1/objects/{norad_cat_id}/elements", response_model=list[ElementResponse], tags=["objects"])
def get_elements(norad_cat_id: int, db: Session = Depends(get_db)) -> list[ElementResponse]:
    if db.get(OrbitalObject, norad_cat_id) is None:
        raise HTTPException(status_code=404, detail="Object not found")
    items = db.query(OrbitalElementSet).filter_by(norad_cat_id=norad_cat_id).order_by(OrbitalElementSet.epoch_utc).all()
    return [ElementResponse.model_validate(item) for item in items]


def _propagation_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ObjectNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ElementEpochPolicyError, ValueError)):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail="Unexpected propagation error")


@app.post("/api/v1/propagation/position", response_model=StateVectorResponse, tags=["propagation"])
def position(request: PositionRequest, db: Session = Depends(get_db)) -> StateVectorResponse:
    try:
        return StateVectorResponse.model_validate(propagate_position(db, request.norad_cat_id, request.timestamp))
    except Exception as exc:
        raise _propagation_http_error(exc) from exc


@app.post("/api/v1/propagation/trajectory", response_model=TrajectoryResponse, tags=["propagation"])
def trajectory(request: TrajectoryRequest, db: Session = Depends(get_db)) -> TrajectoryResponse:
    try:
        states = generate_trajectory(db, request.norad_cat_id, request.start_time, request.end_time, request.step_seconds)
        return TrajectoryResponse(norad_cat_id=request.norad_cat_id, states=states)
    except Exception as exc:
        raise _propagation_http_error(exc) from exc


# --- Screening cache ---
#
# A minimal in-memory cache, not a real precompute/background-job system —
# that's the actual fix for production, out of scope for a hackathon
# timeline. This buys two things cheaply: (1) repeated requests with the
# same rounded params (e.g. re-opening the dashboard, or two judges hitting
# it back to back) return instantly instead of re-running the full screen,
# and (2) accidental double-fires (e.g. React StrictMode double-invoke in
# dev) don't double the backend load.
#
# NOT safe for multi-worker/multi-process deployment (each process gets its
# own cache) — fine for a single `uvicorn --reload` demo process.
_SCREEN_CACHE: dict[str, tuple[float, dict]] = {}
_SCREEN_CACHE_TTL_SECONDS = 120
# analysis_time is intentionally excluded from the cache key and rounded to
# the nearest 5 minutes server-side before use, so that requests a few
# seconds apart (e.g. from slider debouncing or a retry) hit the same
# cache entry instead of each computing a "fresh" result that isn't
# meaningfully different.
_ANALYSIS_TIME_BUCKET_SECONDS = 300


def _screen_cache_key(request: ScreeningRequest, bucketed_time: datetime) -> str:
    payload = {
        "analysis_time_bucket": bucketed_time.isoformat(),
        "forecast_horizon_hours": request.forecast_horizon_hours,
        "screening_threshold_km": request.screening_threshold_km,
        "coarse_step_seconds": request.coarse_step_seconds,
        "object_limit": request.object_limit,
        "mission_profile": request.mission_profile.model_dump() if request.mission_profile else None,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@app.post("/api/v1/screen", response_model=ScreeningResponse, tags=["screening"])
def screen(request: ScreeningRequest, db: Session = Depends(get_db)) -> ScreeningResponse:
    """Generate nominal close-approach candidates; this does not assign risk scores."""
    analysis_time = request.analysis_time or datetime.now(timezone.utc)
    bucket_epoch = int(analysis_time.timestamp() // _ANALYSIS_TIME_BUCKET_SECONDS) * _ANALYSIS_TIME_BUCKET_SECONDS
    bucketed_time = datetime.fromtimestamp(bucket_epoch, tz=timezone.utc)
    cache_key = _screen_cache_key(request, bucketed_time)

    cached = _SCREEN_CACHE.get(cache_key)
    if cached is not None:
        cached_at, cached_result = cached
        if time.monotonic() - cached_at < _SCREEN_CACHE_TTL_SECONDS:
            return ScreeningResponse(**cached_result)

    mission_profile = None
    if request.mission_profile is not None:
        mission_profile = ScoringMissionProfile(
            distance_weight=request.mission_profile.distance_weight,
            velocity_weight=request.mission_profile.velocity_weight,
            urgency_weight=request.mission_profile.urgency_weight,
            context_weight=request.mission_profile.context_weight,
        )

    result = screen_catalog(
        db,
        ScreeningConfig(
            analysis_time=analysis_time,
            forecast_horizon_hours=request.forecast_horizon_hours,
            screening_threshold_km=request.screening_threshold_km,
            coarse_step_seconds=request.coarse_step_seconds,
            object_limit=request.object_limit,
            mission_profile=mission_profile,
        ),
    )
    response = ScreeningResponse(
        analysis_time=result["analysis_time"],
        eligible_objects=result["eligible_objects"],
        excluded_objects=result["excluded_objects"],
        candidates=[CandidateConjunctionResponse.model_validate(item) for item in result["candidates"]],
    )
    _SCREEN_CACHE[cache_key] = (time.monotonic(), response.model_dump())
    return response


@app.post("/api/v1/whatif/maneuver", response_model=ManeuverResponse, tags=["screening"])
def whatif_maneuver(request: ManeuverRequest, db: Session = Depends(get_db)) -> ManeuverResponse:
    """Return a what-if assessment after an instantaneous RTN delta-v burn."""
    try:
        outcome = evaluate_maneuver(
            db,
            primary_norad_cat_id=request.primary_norad_cat_id,
            secondary_norad_cat_id=request.secondary_norad_cat_id,
            burn_time=request.burn_time,
            radial_km_s=request.radial_m_s / 1000.0,
            transverse_km_s=request.transverse_m_s / 1000.0,
            normal_km_s=request.normal_m_s / 1000.0,
            search_start=request.search_start,
            search_end=request.search_end,
            step_seconds=request.step_seconds,
            screening_threshold_km=request.screening_threshold_km,
            baseline_miss_distance_km=request.baseline_miss_distance_km,
        )
        return ManeuverResponse(
            burn_time=outcome.burn_time,
            new_tca=outcome.new_tca,
            new_miss_distance_km=outcome.new_miss_distance_km,
            new_relative_velocity_km_s=outcome.new_relative_velocity_km_s,
            baseline_miss_distance_km=outcome.baseline_miss_distance_km,
            cleared_threshold=outcome.cleared_threshold,
            sample_count=outcome.sample_count,
            notes=outcome.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - safety net; keep surface explicit.
        raise HTTPException(status_code=500, detail=f"Maneuver evaluation failed: {exc}") from exc


@app.post("/api/v1/maneuver/simulate", response_model=CascadeManeuverSimulationResponse, tags=["maneuver"])
def maneuver_simulate(
    request: CascadeManeuverRequest,
    confirm: bool = Query(default=False, description="Must be true to pay the cost of the re-screen."),
    db: Session = Depends(get_db),
) -> CascadeManeuverSimulationResponse:
    """Simulate a hypothetical along-track burn and then re-screen the target against the catalog."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Pass confirm=true — this endpoint re-screens the target against the catalog.")

    analysis_time = request.analysis_time or datetime.now(timezone.utc)
    try:
        result = simulate_maneuver(
            db,
            ManeuverConfig(
                norad_cat_id=request.norad_cat_id,
                delta_v_m_s=request.delta_v_m_s,
                maneuver_lead_hours=request.maneuver_lead_hours,
                analysis_time=analysis_time,
                forecast_horizon_hours=request.forecast_horizon_hours,
                screening_threshold_km=request.screening_threshold_km,
                sample_step_seconds=request.sample_step_seconds,
                object_limit=request.object_limit,
            ),
        )
    except ManeuverTargetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return CascadeManeuverSimulationResponse(
        target=result["target"],
        maneuver_time=result["maneuver_time"],
        delta_v_m_s=result["delta_v_m_s"],
        analysis_time=result["analysis_time"],
        forecast_horizon_hours=result["forecast_horizon_hours"],
        baseline_events=[CascadeManeuverCandidateResponse.model_validate(item) for item in result["baseline_events"]],
        post_maneuver_events=[CascadeManeuverCandidateResponse.model_validate(item) for item in result["post_maneuver_events"]],
        comparison=[CascadeManeuverComparisonRow.model_validate(item) for item in result["comparison"]],
        limitations=result["limitations"],
    )