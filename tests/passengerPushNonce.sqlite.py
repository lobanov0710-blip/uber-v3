"""PUSH-01F real SQLite uniqueness/expiry test. No remote D1 credentials."""
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for n in range(1, 9):
    candidates = list((root / "migrations").glob(f"{n:04d}_*.sql"))
    assert len(candidates) == 1, f"missing or ambiguous migration: {n}"
    db.executescript(candidates[0].read_text(encoding="utf8"))

nonce_a = "a" * 32
nonce_b = "b" * 32
now = 1793700000000

def claim(nonce, ms):
    result = db.execute(
        """INSERT OR IGNORE INTO passenger_push_proxy_nonces(nonce, seen_at)
           VALUES (?1, ?2)""",
        (nonce, ms)
    )
    return result.rowcount

assert claim(nonce_a, now) == 1
assert claim(nonce_a, now+1) == 0
assert claim(nonce_b, now) == 1
assert db.execute("SELECT COUNT(*) FROM passenger_push_proxy_nonces").fetchone()[0] == 2

# A nonce can only be forgotten after its timestamp's 5-minute HMAC
# acceptance window is long past. The cleanup threshold is 20 minutes.
assert db.execute(
    "DELETE FROM passenger_push_proxy_nonces WHERE seen_at <= ?1",
    (now + 1199999 - 1200000,)
).rowcount == 0
assert db.execute(
    "DELETE FROM passenger_push_proxy_nonces WHERE seen_at <= ?1",
    (now + 1200000 - 1200000,)
).rowcount == 2
assert claim(nonce_a, now + 1200001) == 1  # Fresh auth still needs valid timestamp
assert db.execute(
    "SELECT COUNT(*) FROM staff_push_devices"
).fetchone() == (0,)
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print("PASSENGER_PUSH_NONCE_SQLITE=PASS")
