import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"

files = sorted(MIGRATIONS.glob("*.sql"))
if not files:
    raise SystemExit("MIGRATION_SMOKE=FAIL no migrations")

db = sqlite3.connect(":memory:")
try:
    db.execute("PRAGMA foreign_keys = ON")
    for path in files:
        sql = path.read_text(encoding="utf-8-sig")
        try:
            db.executescript(sql)
        except Exception as exc:
            raise RuntimeError(f"{path.name}: {exc}") from exc

    fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
    if fk_errors:
        raise RuntimeError(f"foreign_key_check: {fk_errors}")

    print(f"MIGRATION_SMOKE=PASS count={len(files)}")
finally:
    db.close()
