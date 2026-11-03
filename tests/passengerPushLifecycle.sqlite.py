"""PUSH-01D isolated SQLite verification; no Worker, Cloudflare or FCM calls."""
import pathlib
import re
import sqlite3
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[1]
DB = sqlite3.connect(":memory:")
DB.execute("PRAGMA foreign_keys=ON")
for version in range(1, 9):
    candidates = list((ROOT / "migrations").glob(f"{version:04d}_*.sql"))
    assert len(candidates) == 1, f"Migration {version} must be unique"
    DB.executescript(candidates[0].read_text(encoding="utf-8"))

A = "68516805-d870-4bc9-ac4a-43995df5bc05"
B = "16d9080a-72f1-439b-8d82-1eff62f28df0"
C = "eea07921-11d1-4204-b106-29d9e9521122"
now = 1793700000000
sentinel = "__REDACTED__"

def make_order(id_, status):
    DB.execute("""INSERT INTO orders
      (id,name,phone,route,trip_date,comment,status,created_at,updated_at)
      VALUES (?,'test','+79990000000','A to B','2026-12-15','',?,1000,1000)
    """, (id_, status))

make_order(A, "new")
make_order(B, "done")
make_order(C, "canceled")

def make_device(order, kind, expired=False, revoked=False):
    install = str(uuid4())
    born = now - 200000
    expiry = now - 1000 if expired else now + 900000
    DB.execute("""INSERT INTO passenger_push_devices
      (installation_id,order_id,platform,fcm_token,
       created_at,updated_at,expires_at,revoked_at)
       VALUES (?,?,'android',?,?,?,?,?)""",
       (install, order, "fcm-"+kind, born, born, expiry,
        (now - 2000) if revoked else None))
    return install

active = make_device(A, "active")
expired = make_device(A, "expired", expired=True)
revoked = make_device(A, "revoked", revoked=True)
finished = make_device(B, "finished")
canceled = make_device(C, "canceled")

# Retention fixtures; only old replay records/events may be deleted.
old_grant, fresh_grant = str(uuid4()), str(uuid4())
for grant, created in [(old_grant, now - 3600001), (fresh_grant, now - 60000)]:
    DB.execute("""INSERT INTO passenger_push_grant_uses
       (grant_id,order_id,installation_id,used_at) VALUES (?,?,?,?)""",
       (grant, A, active, created))
old_event, fresh_event = str(uuid4()), str(uuid4())
for event, created in [(old_event, now - 300001), (fresh_event, now - 60000)]:
    DB.execute("""INSERT INTO passenger_push_grant_events
       (event_id,order_id,created_at) VALUES (?,?,?)""",
       (event, A, created))
DB.commit()

# Run the ACTUAL inline SQL strings from the JavaScript lifecycle module,
# rather than manually reconstructing expected SQL.
source = (ROOT / "src/core/passengerPushLifecycle.js").read_text(encoding="utf-8")
sqls = re.findall(r"db\.prepare\(`([\s\S]*?)`\)\.bind", source)
assert len(sqls) == 4, len(sqls)
preview, redact, purge_events, purge_grants = sqls

assert DB.execute(preview, (sentinel, now)).fetchone()[0] == 4
assert DB.execute(redact, (sentinel, now)).rowcount == 4
assert DB.execute(purge_events, (now - 300000,)).rowcount == 1
assert DB.execute(purge_grants, (now - 3600000,)).rowcount == 1
DB.commit()

def token(installation):
    return DB.execute(
        "SELECT fcm_token, revoked_at FROM passenger_push_devices WHERE installation_id=?",
        (installation,)
    ).fetchone()

assert token(active) == ("fcm-active", None)
for installation in (expired, revoked, finished, canceled):
    value, revoked_at = token(installation)
    assert value == sentinel and revoked_at is not None

assert DB.execute(preview, (sentinel, now)).fetchone()[0] == 0
assert DB.execute(redact, (sentinel, now)).rowcount == 0

# Tombstones remain present. Even a brand-new one-use grant cannot update
# an expired registration after maintenance.
transaction_js = (
    ROOT / "src/core/passengerPushDeviceTransactions.js"
).read_text(encoding="utf-8")
match = re.search(
    r"const write = db\.prepare\(`([\s\S]*?)`\)\.bind", transaction_js
)
assert match, "Atomic register SQL not found"
registration_sql = match.group(1)
attempt = DB.execute(registration_sql,
    (expired, A, "new-token", now + 10, now + 900000))
assert attempt.rowcount == 0
assert token(expired)[0] == sentinel

assert DB.execute(
    "SELECT COUNT(*) FROM passenger_push_grant_uses WHERE grant_id=?",
    (fresh_grant,)
).fetchone()[0] == 1
assert DB.execute(
    "SELECT COUNT(*) FROM passenger_push_grant_events WHERE event_id=?",
    (fresh_event,)
).fetchone()[0] == 1
assert DB.execute("SELECT COUNT(*) FROM staff_push_devices").fetchone() == (0,)
assert DB.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASSENGER_PUSH_LIFECYCLE_SQLITE=PASS")
