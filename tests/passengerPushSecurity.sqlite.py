"""PUSH-01C: actual SQLite transaction/replay/rate-limit checks, no Cloudflare calls."""
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
DB = sqlite3.connect(":memory:")
DB.execute("PRAGMA foreign_keys=ON")

for v in range(1, 9):
    files = list((ROOT / "migrations").glob(f"{v:04d}_*.sql"))
    assert len(files) == 1, f"missing migration {v}"
    DB.executescript(files[0].read_text(encoding="utf-8"))

ID = "68516805-d870-4bc9-ac4a-43995df5bc05"
INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030"
G1 = "6d9077be-6690-4af6-b1fb-e88c8701847b"
G2 = "fffc5603-07f1-4a8f-b6a6-bdce36f47549"
G3 = "eea07921-11d1-4204-b106-29d9e9521122"
DB.execute("""INSERT INTO orders(id, name, phone, route, trip_date,
    comment, status, created_at, updated_at)
    VALUES (?, 'Test', '+79990000000', 'A to B', '2026-12-15', '',
    'new', 1000, 1000)""", (ID,))

def extract(source, start, end):
    text = (ROOT / source).read_text(encoding="utf-8")
    m = re.search(re.escape(start) + r"([\s\S]*?)" + re.escape(end), text)
    assert m, f"SQL source not found: {source}, {start}"
    sql = m.group(1)
    assert "${" not in sql, "dynamic SQL not allowed"
    return sql

transaction_js = "src/core/passengerPushDeviceTransactions.js"
text = (ROOT / "src/core/passengerPushRateLimit.js").read_text(encoding="utf-8")
rate_sql = re.search(r"\.prepare\(`([\s\S]*?)`\)\.bind", text).group(1)
text = (ROOT / transaction_js).read_text(encoding="utf-8")
claim = re.search(r"return db\.prepare\(`([\s\S]*?)`\)\.bind", text).group(1)
write = re.search(r"const write = db\.prepare\(`([\s\S]*?)`\)\.bind", text).group(1)
revoke = re.search(r"const revoke = db\.prepare\(`([\s\S]*?)`\)\.bind", text).group(1)

now = 1793700000000
def rate_attempt(timestamp):
    from uuid import uuid4
    return DB.execute(
        rate_sql,
        (str(uuid4()), ID, timestamp, timestamp - 60000, 5)
    ).rowcount

for i in range(5):
    assert rate_attempt(now+i) == 1

# A true rolling window denies a sixth attempt even at t=59.999s,
# and permits only one new attempt after the first event expires.
assert rate_attempt(now+59999) == 0
assert rate_attempt(now+60000) == 1
assert rate_attempt(now+60000) == 0
assert rate_attempt(now+60001) == 1

DB.commit()  # Explicit BEGIN below must not nest within Python implicit txn.

def transactional_register(grant, token, at):
    DB.execute("BEGIN")
    try:
        DB.execute(claim, (grant, ID, INSTALL, at))
        cursor = DB.execute(write, (INSTALL, ID, token, at, at + 604800000))
        DB.execute("COMMIT")
        return cursor.rowcount
    except sqlite3.IntegrityError:
        DB.execute("ROLLBACK")
        return None

assert transactional_register(G1, "fcm-first", now) == 1
assert DB.execute(
    "SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
    (INSTALL,)
).fetchone() == ("fcm-first",)

# Same JTI with new token is a rejected transaction and cannot mutate token.
assert transactional_register(G1, "attacker-replay", now+1) is None
assert DB.execute(
    "SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
    (INSTALL,)
).fetchone() == ("fcm-first",)

# A newly issued JTI can rotate the same active installation.
assert transactional_register(G2, "fcm-rotated", now+2) == 1
assert DB.execute(
    "SELECT fcm_token FROM passenger_push_devices WHERE installation_id=?",
    (INSTALL,)
).fetchone() == ("fcm-rotated",)

# Revoke is transactionally tied to another fresh grant, retaining tombstone.
DB.execute("BEGIN")
DB.execute(claim, (G3, ID, INSTALL, now+3))
assert DB.execute(revoke, (INSTALL, ID, now+3)).rowcount == 1
DB.execute("COMMIT")
assert transactional_register(G3, "replay-after-revoke", now+4) is None

# Tombstone also forbids a fresh JTI from reviving the same installation.
assert transactional_register("540ab589-6489-4331-a5d8-804becdfb271",
                              "new-grant", now+5) == 0
assert DB.execute(
    "SELECT fcm_token, revoked_at FROM passenger_push_devices "
    "WHERE installation_id=?", (INSTALL,)
).fetchone() == ("fcm-rotated", now+3)

assert DB.execute("SELECT COUNT(*) FROM staff_push_devices").fetchone() == (0,)
assert DB.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASSENGER_PUSH_SECURITY_SQLITE=PASS")
