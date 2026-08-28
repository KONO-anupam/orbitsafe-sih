# Space Debris Tracking Backend

Phase 2 provides validated catalog ingestion, GP/OMM-to-SGP4 adaptation, on-demand state propagation, trajectory generation, a conservative nominal conjunction-screening endpoint, and a FastAPI interface. It does not implement collision probability, ML, frontend work, or background workers.

## Setup and ingestion

Use the repository's existing virtual environment; do not create another one.

```bash
envactive
uv pip install sgp4 pytest
python scripts/ingest_data.py
```

The default development database is `space_debris.db` in the working directory. Set `DATABASE_URL` to use another SQLAlchemy-supported database later (for example PostgreSQL). The ingestion command initializes its tables and is idempotent: re-running it updates catalog metadata and does not duplicate element records.

Source files under `data/raw/` are read only. SATCAT is loaded first into `orbital_objects`; its `OBJECT_TYPE` (`PAY`, `DEB`, `R/B`, or `UNK`) remains authoritative. The four GP source groups update a separate `source_category` and insert time-versioned `orbital_element_sets` records. Each preserves its source filename, raw orbital JSON, and ingestion time.

## Run and test

```bash
envactive
uvicorn app.main:app --reload
python -m pytest -q
```

OpenAPI documentation is available at `http://127.0.0.1:8000/docs`.

## API examples

```bash
curl 'http://127.0.0.1:8000/api/v1/objects?object_type=PAY&limit=10'
curl 'http://127.0.0.1:8000/api/v1/objects/900/elements'
curl -X POST http://127.0.0.1:8000/api/v1/propagation/position \
  -H 'content-type: application/json' \
  -d '{"norad_cat_id":900,"timestamp":"2026-08-26T21:32:22.276320Z"}'
curl -X POST http://127.0.0.1:8000/api/v1/propagation/trajectory \
  -H 'content-type: application/json' \
  -d '{"norad_cat_id":900,"start_time":"2026-08-26T21:32:22.276320Z","end_time":"2026-08-26T21:42:22.276320Z","step_seconds":60}'
curl -X POST http://127.0.0.1:8000/api/v1/screen \
  -H 'content-type: application/json' \
  -d '{"forecast_horizon_hours":24,"screening_threshold_km":50,"coarse_step_seconds":60,"object_limit":1000}'
```

`GET /api/v1/objects` supports exact `norad_cat_id`, substring `name`, `object_type`, `source_category`, `limit`, and `offset`. Object and element endpoints return 404 for an unknown NORAD ID.

`POST /api/v1/screen` freezes one eligible GP element set per object at the requested analysis time, samples shared UTC timestamps, spatially hashes propagated TEME positions, and then refines each local candidate minimum with SGP4. It returns nominal TCA, miss distance, relative velocity, data age, an explainable 0–100 nominal screening-risk score, severity, confidence, and limitations. The score is not a collision probability: it prioritizes candidates using nominal separation, relative velocity, time to TCA, protected-object context, and data freshness. Its default 60-second step and motion-inflated broad-phase gate favour retaining candidates over speed; use a smaller object limit for interactive demos.

## GP/OMM and time policy

The raw JSON data is modern GP/OMM-style data, not TLE text. The adapter builds an OMM field mapping from a normalized element set and calls `sgp4.omm.initialize()` directly; it never reconstructs legacy TLE lines. NORAD IDs use SQL integer storage and support six-digit catalog numbers.

The source epochs have no offset. This service explicitly treats a naïve GP `EPOCH` as UTC and normalizes API timestamps to UTC. For a requested analysis timestamp, it chooses the latest element epoch no more than 24 hours in the future and rejects it if it is more than 30 days old. Configure `MAX_FUTURE_ELEMENT_HOURS` and `MAX_ELEMENT_AGE_DAYS` for a different policy. This safeguards against silently propagating wildly future-dated or stale sets.

## Coordinate frames and limitations

SGP4 returns **TEME** position/velocity, and the API labels them `position_teme_km` and `velocity_teme_km_s`; they are not misrepresented as GCRF/ICRF ECI coordinates. The optional latitude/longitude/altitude is an approximate TEME→PEF rotation using GMST followed by WGS-84 geodetic conversion. It omits polar motion and precise Earth-orientation parameters, so it is suitable for dashboard visualization, not precision astrometry.

The supplied element epochs are a mixed snapshot (and some may be future-dated relative to an analysis date). No synchronization, covariance, conjunction screening, risk scoring, ML, or orbital maneuver modeling is included in this phase. See [DATA_AUDIT.md](DATA_AUDIT.md) for source-level findings.
