"""Stability checks for refined conjunction candidates.

Not covariance-based uncertainty — this re-runs local TCA refinement with
perturbed numerical settings (alternate coarse step sizes) around the same
bracket, and reports whether the result changes materially. A result that's
stable under these perturbations is more trustworthy; instability is a
signal to re-screen with tighter settings before acting on the number.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

# Diffs at or below these are numerical noise, not a meaningful change.
STABLE_TCA_SECONDS = 60.0
STABLE_MISS_DISTANCE_KM = 0.5


@dataclass(frozen=True)
class RobustnessResult:
    stable: bool
    max_tca_diff_seconds: float
    max_miss_distance_diff_km: float
    checks: list[dict[str, str]]


def assess_robustness(
    *,
    baseline_tca: datetime,
    baseline_miss_km: float,
    perturbed: list[tuple[int, tuple[datetime, float, float] | None]],
) -> RobustnessResult:
    """Compare a baseline refined result against alternate-step re-refinements.

    `perturbed` is a list of (step_seconds, refine_result) pairs, where
    refine_result is whatever `_refine_tca` returned for that step (or None
    if it failed to converge in that bracket).
    """
    checks: list[dict[str, str]] = [
        {"label": "Baseline", "tca": baseline_tca.isoformat(), "miss_distance_km": f"{baseline_miss_km:.2f}"}
    ]
    max_tca_diff = 0.0
    max_miss_diff = 0.0

    for step_seconds, result in perturbed:
        if result is None:
            checks.append({"label": f"{step_seconds}s step", "tca": "no result", "miss_distance_km": "no result"})
            max_tca_diff = max(max_tca_diff, STABLE_TCA_SECONDS + 1)
            max_miss_diff = max(max_miss_diff, STABLE_MISS_DISTANCE_KM + 1)
            continue
        tca, miss_km, _ = result
        tca_diff = abs((tca - baseline_tca).total_seconds())
        miss_diff = abs(miss_km - baseline_miss_km)
        max_tca_diff = max(max_tca_diff, tca_diff)
        max_miss_diff = max(max_miss_diff, miss_diff)
        checks.append({"label": f"{step_seconds}s step", "tca": tca.isoformat(), "miss_distance_km": f"{miss_km:.2f}"})

    stable = max_tca_diff <= STABLE_TCA_SECONDS and max_miss_diff <= STABLE_MISS_DISTANCE_KM
    return RobustnessResult(
        stable=stable,
        max_tca_diff_seconds=max_tca_diff,
        max_miss_distance_diff_km=max_miss_diff,
        checks=checks,
    )
