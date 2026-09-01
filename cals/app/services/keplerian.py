"""Unperturbed (two-body) Keplerian propagation from a perturbed state vector.

Used only for the what-if maneuver feature: after an instantaneous delta-v is
applied to a primary object's TEME state, its post-burn trajectory can no
longer be represented by the original SGP4 mean elements (SGP4 propagates
mean elements, not injected state vectors). This module instead derives
classical orbital elements from the post-burn TEME state and propagates them
analytically via Kepler's equation.

This is real two-body physics, but it is NOT SGP4: it excludes J2 oblateness,
atmospheric drag, and all other perturbations SGP4 models. It is only valid
for the maneuvered object, only for the (hours-scale) what-if window, and
only for elliptical orbits (e < 1). These limitations are surfaced in the
API response, not hidden.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

MU_EARTH_KM3_S2 = 398600.4418
_EPS = 1e-10


class NonEllipticalOrbitError(ValueError):
    """Raised when the post-burn state is parabolic/hyperbolic (e >= 1)."""


def _clamp(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _cross(a: list[float], b: list[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def _norm(a: list[float]) -> float:
    return math.sqrt(_dot(a, a))


@dataclass(frozen=True)
class ClassicalElements:
    """Osculating elements at the epoch the state vector was sampled."""

    semi_major_axis_km: float
    eccentricity: float
    inclination_rad: float
    raan_rad: float
    arg_perigee_rad: float
    true_anomaly_rad: float
    mean_motion_rad_s: float


def state_to_elements(position_km: list[float], velocity_km_s: list[float]) -> ClassicalElements:
    """Standard state-vector -> classical-element conversion (Vallado Alg. 9)."""
    r_vec, v_vec = position_km, velocity_km_s
    r = _norm(r_vec)
    v = _norm(v_vec)
    if r < _EPS:
        raise ValueError("Position vector is degenerate (near zero)")

    h_vec = _cross(r_vec, v_vec)
    h = _norm(h_vec)
    if h < _EPS:
        raise ValueError("Angular momentum is degenerate; state is not orbital")

    n_vec = _cross([0.0, 0.0, 1.0], h_vec)
    n = _norm(n_vec)

    e_vec = [
        (1 / MU_EARTH_KM3_S2)
        * ((v * v - MU_EARTH_KM3_S2 / r) * r_vec[i] - _dot(r_vec, v_vec) * v_vec[i])
        for i in range(3)
    ]
    e = _norm(e_vec)

    energy = v * v / 2 - MU_EARTH_KM3_S2 / r
    if e >= 1.0 - 1e-9:
        raise NonEllipticalOrbitError(
            f"Post-burn orbit is non-elliptical (e={e:.4f}) — this delta-v is too large "
            "for the two-body what-if model to remain valid."
        )
    a = -MU_EARTH_KM3_S2 / (2 * energy)

    inclination = math.acos(_clamp(h_vec[2] / h))

    if n < _EPS:
        raan = 0.0  # equatorial orbit — node undefined, fixed by convention
    else:
        raan = math.acos(_clamp(n_vec[0] / n))
        if n_vec[1] < 0:
            raan = 2 * math.pi - raan

    e_safe = max(e, 1e-6)
    if n < _EPS:
        arg_perigee = math.atan2(e_vec[1], e_vec[0])
        if arg_perigee < 0:
            arg_perigee += 2 * math.pi
    else:
        arg_perigee = math.acos(_clamp(_dot(n_vec, e_vec) / (n * e_safe)))
        if e_vec[2] < 0:
            arg_perigee = 2 * math.pi - arg_perigee

    true_anomaly = math.acos(_clamp(_dot(e_vec, r_vec) / (e_safe * r)))
    if _dot(r_vec, v_vec) < 0:
        true_anomaly = 2 * math.pi - true_anomaly

    mean_motion = math.sqrt(MU_EARTH_KM3_S2 / a**3)

    return ClassicalElements(
        semi_major_axis_km=a,
        eccentricity=e_safe,
        inclination_rad=inclination,
        raan_rad=raan,
        arg_perigee_rad=arg_perigee,
        true_anomaly_rad=true_anomaly,
        mean_motion_rad_s=mean_motion,
    )


def _solve_kepler(mean_anomaly_rad: float, eccentricity: float, tolerance: float = 1e-10, max_iter: int = 50) -> float:
    """Newton-Raphson solution of Kepler's equation M = E - e sin E."""
    m = mean_anomaly_rad % (2 * math.pi)
    e_anomaly = m if eccentricity < 0.8 else math.pi
    for _ in range(max_iter):
        delta = (e_anomaly - eccentricity * math.sin(e_anomaly) - m) / (1 - eccentricity * math.cos(e_anomaly))
        e_anomaly -= delta
        if abs(delta) < tolerance:
            break
    return e_anomaly


def propagate_elements(elements: ClassicalElements, dt_seconds: float) -> tuple[list[float], list[float]]:
    """Propagate classical elements forward dt_seconds and return a TEME state vector."""
    e = elements.eccentricity
    a = elements.semi_major_axis_km

    e0 = 2 * math.atan2(
        math.sqrt(1 - e) * math.sin(elements.true_anomaly_rad / 2),
        math.sqrt(1 + e) * math.cos(elements.true_anomaly_rad / 2),
    )
    m0 = e0 - e * math.sin(e0)
    m = m0 + elements.mean_motion_rad_s * dt_seconds
    e_anomaly = _solve_kepler(m, e)

    true_anomaly = 2 * math.atan2(
        math.sqrt(1 + e) * math.sin(e_anomaly / 2),
        math.sqrt(1 - e) * math.cos(e_anomaly / 2),
    )
    p = a * (1 - e * e)
    r = a * (1 - e * math.cos(e_anomaly))

    x_pf = r * math.cos(true_anomaly)
    y_pf = r * math.sin(true_anomaly)
    mu_over_p = math.sqrt(MU_EARTH_KM3_S2 / p)
    vx_pf = -mu_over_p * math.sin(true_anomaly)
    vy_pf = mu_over_p * (e + math.cos(true_anomaly))

    i, raan, argp = elements.inclination_rad, elements.raan_rad, elements.arg_perigee_rad
    cos_o, sin_o = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(i), math.sin(i)
    cos_w, sin_w = math.cos(argp), math.sin(argp)

    r11 = cos_o * cos_w - sin_o * sin_w * cos_i
    r12 = -cos_o * sin_w - sin_o * cos_w * cos_i
    r21 = sin_o * cos_w + cos_o * sin_w * cos_i
    r22 = -sin_o * sin_w + cos_o * cos_w * cos_i
    r31 = sin_w * sin_i
    r32 = cos_w * sin_i

    position = [r11 * x_pf + r12 * y_pf, r21 * x_pf + r22 * y_pf, r31 * x_pf + r32 * y_pf]
    velocity = [r11 * vx_pf + r12 * vy_pf, r21 * vx_pf + r22 * vy_pf, r31 * vx_pf + r32 * vy_pf]
    return position, velocity


def rtn_delta_v_to_teme(
    position_km: list[float],
    velocity_km_s: list[float],
    radial_km_s: float,
    transverse_km_s: float,
    normal_km_s: float,
) -> list[float]:
    """Convert an RTN-frame delta-v (radial / in-track / cross-track) to TEME."""
    r_vec, v_vec = position_km, velocity_km_s
    r_hat = [x / _norm(r_vec) for x in r_vec]
    h_vec = _cross(r_vec, v_vec)
    n_hat = [x / _norm(h_vec) for x in h_vec]
    t_hat = _cross(n_hat, r_hat)

    return [
        radial_km_s * r_hat[i] + transverse_km_s * t_hat[i] + normal_km_s * n_hat[i]
        for i in range(3)
    ]
