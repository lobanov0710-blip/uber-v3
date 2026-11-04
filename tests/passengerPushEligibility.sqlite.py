"""PUSH-01K: execute the ACTUAL eligibility SQL with additive migrations in isolated SQLite."""
import pathlib
import re
import sqlite3
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "src/core/passengerPushDeliveryEligibility.js").read_text(encoding="utf-8")
match = re.search(r"env\.DB\.prepare\(\x60([\s\S]*?)\x60\)\.bind", SOURCE)
assert match, "Actual Worker SQL eligibility query missing"
SQL = match.group(1)

DB = sqlite3.connect(":memory:")
DB.row_factory = sqlite3.Row
DB.execute("PRAGMA foreign_keys=ON")
for version in range(1, 9):
    files = list((ROOT / "migrations").glob(f"{version:04d}_*.sql"))
    assert len(files) == 1, f"Missing migration {version}"
    DB.executescript(files[0].read_text(encoding="utf-8"))

NOW = 1793700000000
ORDERS = {status: str(uuid4()) for status in ("new", "taken", "in_progress", "done", "canceled")}
for status, order_id in ORDERS.items():
    DB.execute("""INSERT INTO orders
       (id,name,phone,route,trip_date,comment,status,created_at,updated_at)
       VALUES (?,'test','+79990000000','From to To','2026-12-15','',?,1000,1000)""",
       (order_id, status))

def add_device(order, token, expiry=NOW + 60000, revoked=None, updated=NOW - 1000):
    installation = str(uuid4())
    born = NOW - 2000
    assert updated >= born
    DB.execute("""INSERT INTO passenger_push_devices
      (installation_id,order_id,platform,fcm_token,
       created_at,updated_at,expires_at,revoked_at)
      VALUES (?,?,'android',?,?,?,?,?)""",
      (installation, order, token, born, updated, expiry, revoked))
    return installation

def eligible(order, installation, now=NOW):
    return DB.execute(SQL, (order, installation, now, "__REDACTED__")).fetchone()

active = {}
for status in ("new", "taken", "in_progress"):
    active[status] = add_device(ORDERS[status], "local-fcm-" + status)
    row = eligible(ORDERS[status], active[status])
    assert row is not None
    assert row["fcm_token"] == "local-fcm-" + status
    assert row["order_status"] == status

terminal = [add_device(ORDERS[s], "local-fcm-" + s)
            for s in ("done", "canceled")]
for status, installation in zip(("done", "canceled"), terminal):
    assert eligible(ORDERS[status], installation) is None

expired = add_device(ORDERS["new"], "expired", expiry=NOW)
revoked = add_device(ORDERS["new"], "revoked", revoked=NOW - 500)
redacted = add_device(ORDERS["new"], "__REDACTED__")
future = add_device(ORDERS["new"], "future", updated=NOW + 1)
assert eligible(ORDERS["new"], expired) is None
assert eligible(ORDERS["new"], revoked) is None
assert eligible(ORDERS["new"], redacted) is None
assert eligible(ORDERS["new"], future) is None
assert eligible(ORDERS["taken"], active["new"]) is None
assert eligible(ORDERS["new"], str(uuid4())) is None
assert eligible(ORDERS["new"], active["new"], NOW + 60001) is None

# State can change BETWEEN requests. A fresh query must observe that state.
assert eligible(ORDERS["taken"], active["taken"]) is not None
DB.execute("UPDATE orders SET status='canceled' WHERE id=?", (ORDERS["taken"],))
assert eligible(ORDERS["taken"], active["taken"]) is None
DB.execute("UPDATE passenger_push_devices SET revoked_at=? WHERE installation_id=?",
           (NOW, active["new"]))
assert eligible(ORDERS["new"], active["new"]) is None

# Maintenance does not create false eligibility: revoked/terminal/expired
# registrations can be redacted and will remain ineligible.
life = (ROOT / "src/core/passengerPushLifecycle.js").read_text(encoding="utf-8")
mutations = re.findall(r"db\.prepare\(\x60([\s\S]*?)\x60\)\.bind", life)
assert len(mutations) == 4
DB.execute(mutations[1], ("__REDACTED__", NOW))
assert eligible(ORDERS["new"], expired) is None
assert eligible(ORDERS["taken"], active["taken"]) is None
assert DB.execute("PRAGMA foreign_key_check").fetchall() == []

print("PASSENGER_PUSH_ELIGIBILITY_SQLITE=PASS")
