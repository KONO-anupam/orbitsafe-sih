# Data Audit — Space Debris Tracking & Satellite Collision Risk Prediction

Audit date: 2026-08-27. All findings below were computed directly from the five source files in `data/raw/`; none were modified.

## Dataset inventory

| Source | Format | Records | NORAD CAT ID range | Exact duplicate records | Duplicate NORAD IDs | Six-digit IDs |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| `active_satellites.json` | JSON list, GP/OMM-style | 16,418 | 900–100,471 | 0 | 0 | 363 (100,000–100,471) |
| `cosmos_2251_debris.json` | JSON list, GP/OMM-style | 587 | 22,675–53,093 | 0 | 0 | 0 |
| `fengyun_1c_debris.json` | JSON list, GP/OMM-style | 1,950 | 25,730–49,389 | 0 | 0 | 0 |
| `iridium_33_debris.json` | JSON list, GP/OMM-style | 111 | 24,946–46,979 | 0 | 0 | 0 |
| `satcat.csv` | CSV | 70,392 data rows (plus header) | 1–100,472 | 0 | 0 | 394 |

The four GP datasets contain 19,066 records and 19,066 unique NORAD IDs. Their ID sets are mutually disjoint, so a single normalized object collection is safe without source-record collisions.

Representative GP records inspected:

| Source | NORAD ID | Object name | International designator | Epoch |
| --- | ---: | --- | --- | --- |
| Active | 900 | CALSPHERE 1 | 1964-063C | `2026-08-26T21:32:22.276320` |
| COSMOS 2251 | 22,675 | COSMOS 2251 | 1993-036A | `2026-08-26T21:18:29.903040` |
| FENGYUN 1C | 25,730 | FENGYUN 1C | 1999-025A | `2026-08-26T04:55:26.185152` |
| IRIDIUM 33 | 24,946 | IRIDIUM 33 | 1997-051C | `2026-08-26T12:04:19.407360` |

## GP / OMM schema findings

Every JSON list has exactly the same 17 fields, with no missing values:

| Field | Actual JSON types observed |
| --- | --- |
| `OBJECT_NAME`, `OBJECT_ID`, `EPOCH`, `CLASSIFICATION_TYPE` | string |
| `NORAD_CAT_ID`, `EPHEMERIS_TYPE`, `ELEMENT_SET_NO`, `REV_AT_EPOCH` | integer |
| `MEAN_MOTION`, `ECCENTRICITY`, `INCLINATION`, `RA_OF_ASC_NODE`, `ARG_OF_PERICENTER`, `MEAN_ANOMALY` | float, with a few whole-number values encoded as integer |
| `BSTAR`, `MEAN_MOTION_DOT`, `MEAN_MOTION_DDOT` | float, with zero values sometimes encoded as integer |

All records have `CLASSIFICATION_TYPE = "U"`, `EPHEMERIS_TYPE = 0`, and `ELEMENT_SET_NO = 999`. The epochs are naïve ISO-8601 timestamps with six fractional-second digits: `YYYY-MM-DDTHH:MM:SS.ffffff`; no timezone suffix is present.

Epoch ranges are:

| Source | Minimum epoch | Maximum epoch |
| --- | --- | --- |
| Active | 2026-07-29T12:58:17.745024 | 2026-09-07T15:41:18.581856 |
| COSMOS 2251 | 2026-07-30T14:11:57.777216 | 2026-08-26T23:57:19.040256 |
| FENGYUN 1C | 2026-07-28T06:25:15.697920 | 2026-08-26T23:55:14.992320 |
| IRIDIUM 33 | 2026-08-08T11:10:23.842272 | 2026-08-26T23:52:41.405952 |

These are OMM/GP key-value fields, not literal TLE records: there are no `TLE_LINE0`, `TLE_LINE1`, `TLE_LINE2`, line checksums, or two-digit TLE epoch values. The orbital and drag values correspond directly to TLE concepts: `MEAN_MOTION` (rev/day), eccentricity, inclination/RAAN/argument of perigee/mean anomaly (degrees), `BSTAR`, first and second mean-motion derivatives, and revolution number. `OBJECT_ID` is the international designator.

## SATCAT schema and data quality

CSV stores every value as text. Parsing results and empty-value counts are:

| Column | Non-empty inferred values | Missing |
| --- | --- | ---: |
| `OBJECT_NAME`, `OBJECT_ID`, `OBJECT_TYPE`, `OWNER`, `LAUNCH_DATE`, `LAUNCH_SITE`, `ORBIT_TYPE` | string | 0 |
| `NORAD_CAT_ID` | integer | 0 |
| `OPS_STATUS_CODE` | string | 16,480 |
| `DECAY_DATE` | ISO date string | 34,885 |
| `PERIOD`, `INCLINATION`, `RCS` | float | 2,044; 2,055; 37,461 respectively |
| `APOGEE`, `PERIGEE` | integer | 2,044 each |
| `DATA_STATUS_CODE` | string | 69,100 |
| `ORBIT_CENTER` | string (15 values are numeric-looking catalog references) | 0 |

SATCAT object classifications are `DEB` 35,838, `PAY` 27,503, `R/B` 6,885, and `UNK` 166. `ORBIT_TYPE` values are `IMP`, `ORB`, `LAN`, and `DOC`. All non-empty launch/decay dates parse as ISO dates; no exact-record or NORAD-ID duplicates were found.

`ORBIT_CENTER` is semantically heterogeneous: it is usually a body code such as `EA`, but 15 rows hold an object catalog ID (for example `25544`, the ISS) and must remain a string or be split into a typed reference field during ingestion.

## Catalog-ID relationships

All 19,066 GP records match a SATCAT record by `NORAD_CAT_ID`: 100.0000% by record and by unique ID. Per source, the result is also 100%: 16,418/16,418 active, 587/587 COSMOS, 1,950/1,950 FENGYUN, and 111/111 IRIDIUM.

The GP source labels are useful provenance, not a replacement for SATCAT classification. The matched SATCAT types are: active 16,416 `PAY` and 2 `R/B`; COSMOS 586 `DEB` and 1 `PAY`; FENGYUN 1,949 `DEB` and 1 `PAY`; IRIDIUM 110 `DEB` and 1 `PAY`.

Six-digit catalog numbers are real in this data and must be modeled as unrestricted positive integers, never as legacy five-character TLE text. The installed `sgp4` package accepts an integer six-digit satnum when initialized from OMM fields.

## Suspicious or operationally important findings

- No structural or orbital-domain violations were found: all eccentricities are in `[0, 1)`, inclinations are in `[0, 180]`, angular values are in `[0, 360)`, mean motion is positive, and GP epochs parse.
- The active file has epochs through 2026-09-07, which is after the audit date (2026-08-27); epochs across all files also span several weeks. Treat the files as a mixed-epoch snapshot, not a synchronized conjunction screen. Future or stale epochs should be flagged at ingestion relative to a requested analysis time.
- Large magnitudes occur in some valid numeric drag/derivative fields (for example active `BSTAR` ranges from -3.5585 to 0.24098511). Do not reject solely because `BSTAR` or derivatives are negative or unusually large; apply propagation error handling and an epoch-age policy.
- SATCAT has expected sparse operational/orbital metadata, especially `RCS` (37,461 missing), `DECAY_DATE` (34,885), and `DATA_STATUS_CODE` (69,100).

## Proposed normalized internal schema

Keep durable catalog metadata separate from time-versioned orbital element sets.

`orbital_objects`

| Field | Type | Notes |
| --- | --- | --- |
| `norad_cat_id` | integer, primary key | Supports six or more digits. |
| `object_name`, `international_designator` | text | From current GP/SATCAT data. |
| `object_type`, `ops_status_code`, `owner`, `launch_site` | nullable text | SATCAT metadata. |
| `launch_date`, `decay_date` | nullable date | SATCAT dates. |
| `period_min`, `inclination_deg`, `apogee_km`, `perigee_km`, `rcs_m2` | nullable numeric | SATCAT derived/catalog values. |
| `data_status_code`, `orbit_center`, `orbit_type` | nullable text | Preserve raw semantics of `orbit_center`. |
| `source_category` | text | `active`, `cosmos_2251_debris`, `fengyun_1c_debris`, or `iridium_33_debris`. |
| `created_at`, `updated_at` | timezone-aware timestamp | Ingestion bookkeeping. |

`orbital_element_sets`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID/bigint primary key | Element-set identity. |
| `norad_cat_id` | integer foreign key | Object identity. |
| `epoch_utc` | timezone-aware timestamp | Interpret supplied naïve timestamps as the feed's declared UTC convention, and record that assumption. |
| `mean_motion_rev_per_day`, `eccentricity`, `inclination_deg`, `raan_deg`, `arg_perigee_deg`, `mean_anomaly_deg` | numeric | GP mean elements. |
| `bstar`, `mean_motion_dot_rev_day2`, `mean_motion_ddot_rev_day3` | numeric | Keep original units. |
| `ephemeris_type`, `classification_type`, `element_set_no`, `rev_at_epoch` | integer/text | SGP4 provenance inputs. |
| `raw_object_id`, `raw_record_json`, `source_file`, `ingested_at` | text/JSON/timestamp | Reproducibility and auditing. |
| unique key | (`norad_cat_id`, `epoch_utc`, `source_file`) | Prevent duplicate ingests while retaining history. |

## GP/OMM → SGP4 compatibility

Installed dependency: `sgp4==2.27`. Its `sgp4.omm.initialize(Satrec(), fields)` consumes exactly the supplied fields: `CLASSIFICATION_TYPE`, `OBJECT_ID`, `EPHEMERIS_TYPE`, `ELEMENT_SET_NO`, `REV_AT_EPOCH`, `EPOCH`, six mean-element fields, `BSTAR`, both mean-motion derivatives, and `NORAD_CAT_ID`.

Before propagation, validate/coerce numeric values, parse `EPOCH` using `%Y-%m-%dT%H:%M:%S.%f`, and state the UTC assumption explicitly because the feed omits a timezone. Use the returned SGP4 error code for each state-vector calculation. No TLE conversion is necessary or recommended; reconstructing fixed-width legacy TLE lines would introduce unnecessary five-digit-catalog constraints and rounding/checksum concerns.

## Recommended next implementation steps

1. Implement an idempotent read-only ingestion/normalization service from `data/raw` into the two-schema model, with validation and epoch-age/future-epoch flags.
2. Add a GP-to-`Satrec` adapter plus unit tests using one record from each source and a six-digit NORAD record.
3. Add FastAPI endpoints for catalog object lookup, filtering, element-set retrieval, and on-demand propagated state vectors with explicit time/UTC input.
4. Establish an analysis-time policy and synchronized element-set selection before implementing conjunction detection, risk scoring, ML, persistence migrations, or workers.
