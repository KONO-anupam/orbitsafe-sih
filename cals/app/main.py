"""FastAPI interface for catalog lookup and SGP4 propagation."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from app.database import get_db, init_db
from app.models import OrbitalElementSet, OrbitalObject
from app.schemas import (
    CandidateConjunctionResponse,
    ElementResponse,
    ObjectPage,
    ObjectResponse,
    PositionRequest,
    ScreeningRequest,
    ScreeningResponse,
    StateVectorResponse,
    TrajectoryRequest,
    TrajectoryResponse,
)
from app.services.propagation import (
    ElementEpochPolicyError,
    ObjectNotFoundError,
    generate_trajectory,
    propagate_position,
)
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
    allow_origins=["http://localhost:3000"],
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


@app.post("/api/v1/screen", response_model=ScreeningResponse, tags=["screening"])
def screen(request: ScreeningRequest, db: Session = Depends(get_db)) -> ScreeningResponse:
    """Generate nominal close-approach candidates; this does not assign risk scores."""
    analysis_time = request.analysis_time or datetime.now(timezone.utc)
    result = screen_catalog(
        db,
        ScreeningConfig(
            analysis_time=analysis_time,
            forecast_horizon_hours=request.forecast_horizon_hours,
            screening_threshold_km=request.screening_threshold_km,
            coarse_step_seconds=request.coarse_step_seconds,
            object_limit=request.object_limit,
        ),
    )
    return ScreeningResponse(
        analysis_time=result["analysis_time"],
        eligible_objects=result["eligible_objects"],
        excluded_objects=result["excluded_objects"],
        candidates=[CandidateConjunctionResponse.model_validate(item) for item in result["candidates"]],
    )
