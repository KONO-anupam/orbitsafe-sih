#!/usr/bin/env python3
"""Initialize the database and ingest all audited raw datasets."""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.database import SessionLocal, init_db  # noqa: E402
from app.services.ingestion import ingest_all  # noqa: E402


def main() -> None:
    init_db()
    with SessionLocal() as db:
        try:
            result = ingest_all(db, PROJECT_ROOT / "data" / "raw")
            db.commit()
        except Exception:
            db.rollback()
            raise
    print("Ingestion complete:")
    for source, count in result.items():
        print(f"  {source}: {count}")


if __name__ == "__main__":
    main()
