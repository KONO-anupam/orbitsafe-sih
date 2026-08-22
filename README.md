# ORBITSAFE

## Space Debris Tracking and Conjunction Risk Screening Dashboard

ORBITSAFE is an open, explainable dashboard that uses publicly available
orbital data to identify and visualize potential close approaches between
satellites and space-debris objects.

It is designed as an accessible first-pass screening tool for students,
researchers, and smaller institutions.

> Important: ORBITSAFE is not an operational collision-avoidance system.
> It reports nominal close-approach screening results, not a rigorous
> probability of collision.

---

## 1. Problem statement

Low Earth Orbit is becoming increasingly congested with active satellites,
rocket bodies, and orbital debris.

Satellite operators need to know:

- Which objects may come close to one another?
- When will the closest approach occur?
- What is the estimated miss distance?
- Which events deserve attention first?
- How reliable is the estimate?

Many existing conjunction-assessment systems are expensive, restricted, or
too complex for students and smaller institutions.

ORBITSAFE addresses this gap by combining public orbital data, orbital
propagation, close-approach screening, explainable scoring, and
interactive visualization in one dashboard.

---

## 2. Project objectives

The project aims to:

- Ingest public orbital data from CelesTrak.
- Track selected active satellites and debris objects.
- Propagate their positions into the future using SGP4.
- Detect pairs whose predicted separation falls below a selected threshold.
- Estimate time of closest approach.
- Calculate nominal miss distance and relative velocity.
- Rank events using an explainable screening risk score.
- Visualize objects and flagged events in 2D and optionally 3D.
- Provide a clear list of upcoming high-priority events.
- Display data age and prediction confidence.

---

## 3. MVP scope

The minimum viable product includes:

- CelesTrak data ingestion.
- Cached orbital data for offline demonstration.
- SGP4-based propagation.
- Screening of a configurable object set.
- A configurable forecast horizon.
- Close-approach detection.
- Time-of-closest-approach estimation.
- Nominal miss-distance calculation.
- Relative-velocity calculation.
- Explainable risk score from 0 to 100.
- Confidence label based partly on data freshness.
- Alert table.
- Event detail view.
- Separation-versus-time chart.
- 2D orbit visualization.
- Synthetic test cases.
- API and frontend documentation.

### Optional features

- CesiumJS 3D globe.
- Object search and filtering.
- CSV/JSON export.
- Event replay.
- Orbital-data anomaly detection.
- Natural-language event explanation.
- Historical event comparison.
- Space-Track or CDM integration.

---

## 4. What ORBITSAFE does not claim

ORBITSAFE does not:

- Guarantee that an object will collide.
- Guarantee that an object is safe.
- Replace official conjunction-assessment services.
- Recommend orbital maneuvers.
- Track every physical debris fragment.
- Provide operational flight-safety decisions.
- Calculate a scientifically valid probability of collision from TLEs alone.
- Use a black-box ML model as a substitute for orbital mechanics.

The system is intended for education, research, visualization, and
first-pass screening.

---

## 5. Scientific method

### 5.1 Data ingestion

ORBITSAFE retrieves public orbital data from CelesTrak using group-based
queries or cached datasets.

The ingestion pipeline:

1. Fetches orbital data.
2. Validates the response.
3. Parses the records.
4. Normalizes them into a common internal schema.
5. Stores the latest successful data locally.
6. Records the source and data timestamp.
7. Uses cached data if the live source is temporarily unavailable.

### 5.2 Orbital propagation

The system uses an SGP4-compatible propagator to estimate satellite
positions at future timestamps.

For a forecast period, positions are calculated at a sequence of common
UTC timestamps:

```text
t0, t0 + Δt, t0 + 2Δt, ..., t0 + forecast horizon
```

All objects in a candidate pair are evaluated at the same timestamp and in
the same coordinate frame.

### 5.3 Conjunction screening

For each candidate pair:

```text
relative_position = position_primary - position_secondary
separation = norm(relative_position)
```

The system identifies the minimum separation during the forecast window and
records:

- Time of closest approach.
- Minimum nominal separation.
- Relative velocity.
- Object altitudes.
- Data age.
- Propagation status.
- Risk score.
- Confidence level.

For larger object sets, a broad-phase filter reduces unnecessary pairwise
comparisons before fine screening.

### 5.4 TCA refinement

The initial screening uses a coarse time step. Around the smallest detected
separation, the system performs a finer search to improve the estimate of the
time and distance of closest approach.

The coarse and refined results are kept separate for validation.

---

## 6. Risk-score interpretation

The risk score is an explainable prioritization score, not a probability.

The score considers factors such as:

- Minimum nominal miss distance.
- Relative velocity.
- Time remaining until closest approach.
- Orbital-data freshness.
- Propagation status.
- Object category.
- Prediction confidence.

Example output:

```text
Risk score: 82/100
Severity: HIGH
Confidence: MEDIUM

Reasons:
- Predicted separation: 3.42 km
- Relative velocity: 13.1 km/s
- Time to closest approach: 7.2 hours
- Orbital data age: 5.2 hours
```

### Screening bands

The exact thresholds are configurable.

| Severity | Example nominal separation | Interpretation |
|---|---:|---|
| CRITICAL | Below 1 km | Extremely close nominal approach |
| HIGH | 1–5 km | Requires attention in screening |
| MEDIUM | 5–25 km | Monitor |
| LOW | 25–100 km | Informational candidate |

These categories must not be interpreted as official collision-probability
thresholds.

---

## 7. Data and uncertainty limitations

Standard TLE/OMM-style public orbital data provides a nominal orbit, but does
not provide all the uncertainty and covariance information needed for a
rigorous collision-probability calculation.

Therefore, ORBITSAFE reports:

- Nominal miss distance.
- Estimated time of closest approach.
- Relative velocity.
- Screening risk score.
- Data freshness.
- Confidence level.

It does not report a true probability of collision.

Prediction quality can be affected by:

- Orbital-data age.
- Atmospheric drag.
- Solar activity.
- Maneuvers.
- TLE fit errors.
- Propagation horizon.
- Numerical time-step selection.
- Missing object dimensions.
- Missing covariance information.

---

## 8. Technology stack

### Backend

- Python
- FastAPI
- NumPy
- Skyfield and/or `sgp4`
- Pydantic
- SQLite
- Pytest

### Frontend

- React
- TypeScript
- Vite
- Plotly, Recharts, or D3
- CesiumJS for optional 3D visualization

### Development

- GitHub
- Docker
- GitHub Actions
- Claude Code, Claude, Cursor, or Copilot for assisted development

AI-generated code is reviewed, tested, and validated by the team. AI tools
must not be treated as authorities for orbital mechanics, numerical
assumptions, or scientific claims.

---

## 9. System architecture

```text
CelesTrak orbital data
          |
          v
Data ingestion and validation
          |
          v
Local cache and normalized object store
          |
          v
SGP4 propagation engine
          |
          v
Candidate-pair screening
          |
          v
TCA refinement
          |
          v
Risk scoring and confidence estimation
          |
          +--------------------+
          v                    v
FastAPI backend          Cached event results
          |
          v
React dashboard
          |
          +--------------------+
          v                    v
2D orbit view          Optional CesiumJS 3D view
```

---

## 10. Repository structure

```text
orbitsafe/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   └── services/
│   │       ├── ingestion.py
│   │       ├── propagation.py
│   │       ├── screening.py
│   │       ├── scoring.py
│   │       └── validation.py
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   ├── mocks/
│   │   └── types/
│   └── public/
├── data/
│   ├── sample/
│   └── cache/
├── docs/
│   ├── api-contract.md
│   ├── architecture.md
│   ├── scientific-method.md
│   └── validation.md
├── .env.example
├── .gitignore
├── CONTRIBUTING.md
├── docker-compose.yml
└── README.md
```

---

## 11. Requirements

Install:

- Python 3.11 or later.
- Node.js 20 or later.
- npm.
- Git.

Optional:

- Docker Desktop.
- A Cesium ion token if the final 3D implementation requires one.

---

## 12. Quick start

### Clone the repository

```bash
git clone https://github.com/<organization-or-user>/orbitsafe-sih.git
cd orbitsafe-sih
```

### Start the backend

```bash
cd backend

python -m venv .venv
```

#### Linux/macOS

```bash
source .venv/bin/activate
```

#### Windows PowerShell

```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn app.main:app --reload
```

Backend URLs:

```text
Health check: http://localhost:8000/health
API docs:     http://localhost:8000/docs
```

### Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local frontend URL printed by Vite.

---

## 13. Environment variables

Create a `.env` file only if required.

Example:

```env
ORBIT_DATA_SOURCE=https://celestrak.org
DATA_CACHE_DIR=../data/cache
DEFAULT_FORECAST_HOURS=24
DEFAULT_TIME_STEP_SECONDS=300
DEFAULT_SCREENING_THRESHOLD_KM=100
API_BASE_URL=http://localhost:8000
```

Never commit:

- API keys.
- Access tokens.
- Passwords.
- Private credentials.
- Personal data.

Use `.env.example` to document required variables without exposing secrets.

---

## 14. API endpoints

The current API includes:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/objects` | List tracked objects |
| `GET` | `/objects/{norad_id}` | Get object details |
| `GET` | `/conjunctions` | List detected events |
| `GET` | `/conjunctions/{event_id}` | Get event details |
| `POST` | `/screen` | Run a screening job |
| `GET` | `/config` | Get active screening configuration |

Example:

```bash
curl http://localhost:8000/health
```

Example response:

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

---

## 15. Configuration

The screening engine supports:

```text
Object group: active, stations, debris, custom
Forecast horizon: 1–72 hours
Broad-phase threshold: configurable
Final threshold: configurable
Coarse time step: configurable
Refinement time step: configurable
Maximum object count: configurable
```

Recommended demo defaults:

```text
Forecast horizon: 24 hours
Coarse time step: 5 minutes
Fine time step: 1 minute
Screening threshold: 100 km
Object count: 500–2,000
```

---

## 16. Testing

Run backend tests:

```bash
cd backend
pytest -q
```

Run frontend checks:

```bash
cd frontend
npm run lint
npm run build
```

Tests cover:

- Orbital-data parsing.
- Timestamps and UTC conversion.
- SGP4 propagation.
- Coordinate-frame consistency.
- Distance calculation.
- TCA estimation.
- Event deduplication.
- Risk-score boundaries.
- Stale-data confidence.
- API responses.
- Frontend loading and empty states.

### Synthetic validation cases

The project includes deterministic tests for:

- A known close approach.
- Clearly separated orbits.
- Invalid propagation.
- Stale orbital data.
- Brief threshold crossings.
- Multiple detections of the same event.

---

## 17. Performance evaluation

Performance is reported using:

- Number of orbital objects.
- Forecast horizon.
- Coarse time step.
- Refinement time step.
- Number of candidate pairs.
- Total runtime.
- Peak memory use.

Example benchmark format:

```text
Objects:                <measured value>
Forecast horizon:       24 hours
Coarse step:            5 minutes
Refinement step:        1 minute
Candidate pairs:        <measured value>
Total runtime:          <measured value>
```

Benchmark values must be generated from the actual implementation and should
not be estimated without measurement.

---

## 18. AI-assisted development policy

AI coding tools may be used for:

- Project scaffolding.
- Boilerplate code.
- Unit-test generation.
- Refactoring.
- Documentation drafts.
- Static-review assistance.
- UI component generation.

All AI-generated code must be:

- Reviewed by a teammate.
- Tested locally.
- Checked for package/API correctness.
- Checked for units and coordinate frames.
- Checked for security issues.
- Checked against official documentation.

AI tools must not be used to invent orbital results, validation metrics,
collision probabilities, or scientific conclusions.

---

## 19. Git workflow

Do not push directly to `main`.

Create a feature branch:

```bash
git checkout -b feat/propagation-engine
```

Make focused commits:

```bash
git add .
git commit -m "feat: add SGP4 propagation service"
git push -u origin feat/propagation-engine
```

Then open a pull request.

Every pull request should include:

- What changed.
- Why it changed.
- How it was tested.
- Screenshots for UI changes.
- Any changed assumptions.
- Any changes to the API contract.

---

## 20. Team ownership

| Member | Responsibility |
|---|---|
| Developer 1 | Data ingestion, caching, backend API |
| Developer 2 | SGP4 propagation, screening engine, frontend integration |
| ML member 1 | Risk scoring, features, prioritization |
| ML member 2 | Validation, anomaly detection, benchmarking |
| Presentation member 1 | UX, slides, storytelling, demo flow |
| Presentation member 2 | Research, documentation, deployment, judge FAQ |

Everyone reviews important changes related to:

- Physics.
- Scoring.
- API contracts.
- Scientific terminology.
- Final demo functionality.

---

## 21. Demo flow

The final demo follows this sequence:

1. Show the data source and freshness timestamp.
2. Show the number of tracked objects.
3. Show upcoming conjunction alerts.
4. Sort by highest screening risk.
5. Select one event.
6. Highlight the two objects in the orbit view.
7. Show separation over time.
8. Show TCA, miss distance, relative velocity, and confidence.
9. Change the threshold or forecast horizon.
10. Explain the scientific limitation.
11. Show cached-demo fallback if required.

---

## 22. Known limitations

- TLE/OMM propagation is not equivalent to high-fidelity operational
  ephemeris propagation.
- Covariance information is not available in the basic public dataset.
- A true collision probability is not calculated.
- Object sizes and hard-body radii may be unavailable or approximated.
- Atmospheric drag and space-weather effects are not fully modelled.
- Maneuvers may make predictions stale.
- Results become less reliable as orbital data ages and the prediction
  horizon increases.
- The system is not intended for operational flight decisions.

---

## 23. Future work

- Ingest CCSDS Conjunction Data Messages.
- Support covariance-based probability of collision.
- Add higher-fidelity propagators.
- Add atmospheric-density and space-weather models.
- Support maneuver simulation.
- Add protected-asset monitoring.
- Add historical conjunction replay.
- Add operator-specific thresholds.
- Scale screening to larger catalogs.
- Integrate authoritative operational data sources.

---

## 24. Team

| Name | Role |
|---|---|
| Name | Backend/data |
| Name | Propagation/frontend |
| Name | ML/scoring |
| Name | ML/validation |
| Name | Product/presentation |
| Name | Research/deployment |

---

## 25. Sources

- CelesTrak GP data documentation: <official-link>
- Skyfield satellite documentation: <official-link>
- NASA conjunction-assessment guidance: <official-link>
- SGP4 documentation: <official-link>

---

## 26. License

Add your selected license here, for example:

```text
This project is developed for educational and research purposes.
```

If you use third-party code or assets, document their licenses here.