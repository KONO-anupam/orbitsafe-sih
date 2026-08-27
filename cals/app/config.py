"""Runtime configuration for the Phase 2 backend."""

from __future__ import annotations

import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./space_debris.db")
# GP timestamps are supplied without an offset. This application treats them as UTC.
MAX_ELEMENT_AGE_DAYS = float(os.getenv("MAX_ELEMENT_AGE_DAYS", "30"))
MAX_FUTURE_ELEMENT_HOURS = float(os.getenv("MAX_FUTURE_ELEMENT_HOURS", "24"))

