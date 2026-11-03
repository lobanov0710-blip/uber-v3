"""PUSH-01A: verify additive schema and actual SQLite D1-style SQL locally.
No Cloudflare credentials, remote database or real FCM delivery.
"""
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATABASE = sqlite3.connect(":memory:")
DATABASE.execute("PRAGMA foreign_keys = ON")

for version in range(1, 7):
    matches = sorted((ROOT / "migrations").glob(f"{version:04d}_*.sql"))
    assert len(matches) == 1, f"migration {version} missing or ambiguous"
    DATABASE.executescript(matches[0].read_text(encoding="utf-8"))

def make_order(order_id, status):
    DATABASE.execute(
        """INSERT INTO orders
           (id, name, phone, route, trip_date, comment, status,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)""",
        (order_id, "Test", "+79990000000", "City A → City B",
         "2026-12-15", status, 1000, 1000),
    )

A = "68516805-d870-4bc9-ac4a-43995df5bc05"
B = "16d9080a-72f1-439b-8d82-1eff62f28df0"
INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030"
OTHER_INSTALL = "de96d36a-f64a-4d22-a31d-7cf80564f78a"

make_order(A, "new")
make_order(B, "done")

UPSERT = """
    INSERT INTO passenger_push_devices (
      installation_id, order_id, platform, fcm_token,
      created_at, updated_at, expires_at, revoked_at
    )
    SELECT ?1, o.id, 'android', ?3, ?4, ?4, ?5, NULL
      FROM orders AS o
     WHERE o.id = ?2
       AND o.status IN ('new', 'taken', 'in_progress')
    ON CONFLICT(installation_id) DO UPDATE SET
      fcm_token = excluded.fcm_token,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
    WHERE passenger_push_devices.order_id = excluded.order_id
      AND passenger_push_devices.revoked_at IS NULL
      AND passenger_push_devices.updated_at <= excluded.updated_at
"""

def upsert(installation, order_id, token, now):
    before = DATABASE.total_changes
    DATABASE.execute(UPSERT, (installation, order_id, token, now, now + 604800000))
    return DATABASE.total_changes - before

assert upsert(INSTALL, A, "fcm-1", 2000) == 1
assert upsert(INSTALL, A, "fcm-2", 2001) == 1
assert DATABASE.execute(
    "SELECT fcm_token FROM passenger_push_devices WHERE installation_id = ?",
    (INSTALL,)
).fetchone() == ("fcm-2",)

# Same installation cannot be attached to another order.
assert upsert(INSTALL, B, "hijack", 3000) == 0

# Terminal order fails atomically even for a new installation.
assert upsert(OTHER_INSTALL, B, "fcm", 3000) == 0

# Revoke only the owning order and retain a tombstone against replay.
bad = DATABASE.execute(
    "UPDATE passenger_push_devices SET revoked_at = ? "
    "WHERE installation_id = ? AND order_id = ? AND revoked_at IS NULL",
    (3000, INSTALL, B)
)
assert bad.rowcount == 0

good = DATABASE.execute(
    "UPDATE passenger_push_devices SET revoked_at = ? "
    "WHERE installation_id = ? AND order_id = ? AND revoked_at IS NULL",
    (3000, INSTALL, A)
)
assert good.rowcount == 1
assert upsert(INSTALL, A, "replay", 4000) == 0

# A newly installed client (new install ID) cannot register after closure.
DATABASE.execute("UPDATE orders SET status = 'done' WHERE id = ?", (A,))
assert upsert(OTHER_INSTALL, A, "not-eligible", 4000) == 0

# The original order row and unrelated staff table are not changed.
assert DATABASE.execute("SELECT status FROM orders WHERE id = ?", (A,)).fetchone() == ("done",)
assert DATABASE.execute(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='staff_push_devices'"
).fetchone() == (1,)
assert DATABASE.execute(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='passenger_push_devices'"
).fetchone() == (1,)
assert DATABASE.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASSENGER_PUSH_MIGRATION_LOCAL_SQLITE=PASS")
