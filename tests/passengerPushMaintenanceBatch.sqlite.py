"""PUSH-01M: execute the actual bounded cleanup SQL against in-memory SQLite."""
import pathlib
import re
import sqlite3
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = (ROOT / "src/core/passengerPushMaintenanceBatch.js").read_text(encoding="utf-8")
SQL = re.findall(r"db\.prepare\(`([\s\S]*?)`\)\.bind", SRC)
assert len(SQL) == 2, "Expected exact preview and bounded UPDATE"
PREVIEW, UPDATE = SQL

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for version in range(1, 9):
    paths = list((ROOT / "migrations").glob(f"{version:04d}_*.sql"))
    assert len(paths) == 1
    db.executescript(paths[0].read_text(encoding="utf-8"))

now = 1793700000000
orders = {status: str(uuid4()) for status in ("new", "done", "canceled")}
for status, order in orders.items():
    db.execute("""INSERT INTO orders
       (id,name,phone,route,trip_date,comment,status,created_at,updated_at)
       VALUES (?,'test','+79990000000','A to B','2026-12-15','',?,1000,1000)""",
       (order, status))

def device(status, token, expired=False, revoked=False):
    installation = str(uuid4())
    created = now - 10000
    expires = now - 1 if expired else now + 3600000
    db.execute("""INSERT INTO passenger_push_devices
      (installation_id,order_id,platform,fcm_token,created_at,
       updated_at,expires_at,revoked_at)
       VALUES (?,?,'android',?,?,?,?,?)""",
       (installation, orders[status], token, created, created,
        expires, now - 100 if revoked else None))
    return installation

expired_ids = [device("new", f"expired-{i}", expired=True) for i in range(105)]
done = device("done", "done-plaintext")
canceled = device("canceled", "canceled-plaintext")
revoked = device("new", "old-revoked-plaintext", revoked=True)
active = device("new", "active-valid")
redacted = device("new", "__REDACTED__", revoked=True)
db.commit()

def count(limit):
    return db.execute(PREVIEW, ("__REDACTED__", now, limit)).fetchone()[0]

def redact(limit):
    return db.execute(UPDATE, ("__REDACTED__", now, limit)).rowcount

# Dry-run query alone must not mutate any token.
assert count(100) == 100
assert db.execute("SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
                  (expired_ids[0],)).fetchone()[0].startswith("expired-")

# Every invocation redacts at most the caller-bound cap.
assert redact(100) == 100
assert count(100) == 8
assert redact(100) == 8
assert count(100) == 0
assert redact(100) == 0

assert db.execute("SELECT COUNT(*) FROM passenger_push_devices "
                  "WHERE fcm_token='__REDACTED__'").fetchone()[0] == 109
for ident in (done, canceled, revoked, expired_ids[0], expired_ids[-1]):
    token, revoked_at = db.execute(
        "SELECT fcm_token, revoked_at FROM passenger_push_devices WHERE installation_id=?",
        (ident,)
    ).fetchone()
    assert token == "__REDACTED__"
    assert revoked_at is not None

assert db.execute("SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
                  (active,)).fetchone()[0] == "active-valid"

# Changing order status BETWEEN preview and UPDATE must be seen by UPDATE.
assert count(1) == 0
db.execute("UPDATE orders SET status='done' WHERE id=?", (orders["new"],))
assert count(1) == 1
assert redact(1) == 1
assert db.execute("SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
                  (active,)).fetchone()[0] == "__REDACTED__"
assert count(1) == 0
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("SELECT COUNT(*) FROM staff_push_devices").fetchone()[0] == 0

print("PASSENGER_PUSH_BOUNDED_MAINTENANCE_SQLITE=PASS")
