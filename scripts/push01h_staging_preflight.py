#!/usr/bin/env python3
"""PUSH-01H: READ-ONLY staging Wrangler config verification.

No Wrangler subprocesses, network requests, Cloudflare API, credential reads,
migrations, deployments, or remote mutations. This checks only TOML on disk.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
STAGING_WORKER = "uber-v3-staging"
STAGING_DB = "transfer-servis52-staging"
PRODUCTION_DB = "transfer-servis52-core"

class PreflightError(Exception):
    pass


def load_config(filename: pathlib.Path) -> dict:
    if not filename.is_file():
        raise PreflightError(f"Required Wrangler config is missing: {filename.name}")
    if filename.suffix != ".toml":
        raise PreflightError("Wrangler config must be TOML")
    try:
        with filename.open("rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise PreflightError("Wrangler config cannot be parsed") from exc
    if not isinstance(data, dict):
        raise PreflightError("Invalid Wrangler structure")
    return data


def single_binding(data: dict, key: str, name: str) -> dict:
    found = [x for x in data.get(key, []) if isinstance(x, dict)
             and x.get("binding") == name]
    if len(found) != 1:
        raise PreflightError(f"Exactly one {name} binding required in {key}")
    return found[0]


def verify(staging: dict, production: dict, expected_id: str,
           migration_dir: pathlib.Path = ROOT / "migrations") -> None:
    if not UUID.fullmatch(expected_id):
        raise PreflightError("Expected staging database UUID must be explicit")
    if staging.get("name") != STAGING_WORKER:
        raise PreflightError("Staging Worker name does not match the locked name")
    if production.get("name") == staging.get("name"):
        raise PreflightError("Staging Worker name equals production Worker")
    if staging.get("main") != production.get("main"):
        raise PreflightError("Staging entrypoint differs from reviewed source")

    variables = staging.get("vars", {})
    if not isinstance(variables, dict):
        raise PreflightError("Staging vars must be a table")
    if variables.get("APP_ENV") != "staging":
        raise PreflightError("APP_ENV=staging is required to suppress staff FCM")
    if variables.get("PASSENGER_PUSH_API_ENABLED") == "true" or (
        variables.get("PASSENGER_PUSH_DEVICES_ENABLED") == "true"
    ):
        raise PreflightError("Passenger push flags must remain disabled in preflight")

    # Never commit keys in [vars]. Secrets belong in controlled secret storage.
    restricted = ("SECRET", "PASSWORD", "TOKEN", "PRIVATE_KEY", "FCM",
                  "FIREBASE", "GOOGLE_CREDENTIALS", "HMAC")
    for name in variables:
        if any(label in name.upper() for label in restricted):
            raise PreflightError("Credential-like name present in staging vars")

    current = single_binding(staging, "d1_databases", "DB")
    production_db = single_binding(production, "d1_databases", "DB")
    stage_id = current.get("database_id")
    prod_id = production_db.get("database_id")
    if not isinstance(stage_id, str) or not UUID.fullmatch(stage_id):
        raise PreflightError("Staging DB ID missing/invalid")
    if not isinstance(prod_id, str) or not UUID.fullmatch(prod_id):
        raise PreflightError("Production DB binding invalid")
    if stage_id.lower() != expected_id.lower():
        raise PreflightError("Staging DB ID differs from independently confirmed UUID")
    if stage_id.lower() == prod_id.lower():
        raise PreflightError("Staging DB is the production DB")
    if current.get("database_name") != STAGING_DB:
        raise PreflightError("Staging DB name incorrect")
    if production_db.get("database_name") != PRODUCTION_DB:
        raise PreflightError("Production DB identity incorrect")
    if current.get("migrations_dir", "migrations") != "migrations":
        raise PreflightError("Staging migration directory must be migrations")

    stage_kv = single_binding(staging, "kv_namespaces", "DRIVERS")
    prod_kv = single_binding(production, "kv_namespaces", "DRIVERS")
    if not stage_kv.get("id") or stage_kv.get("id") == prod_kv.get("id"):
        raise PreflightError("Staging DRIVERS KV binding must be independent")

    # No ambiguous additional DB or KV binding can accidentally target prod.
    for kind, field in (("d1_databases", "database_id"),
                        ("kv_namespaces", "id")):
        prod_values = {x.get(field) for x in production.get(kind, [])
                       if isinstance(x, dict)}
        for row in staging.get(kind, []):
            if not isinstance(row, dict) or row.get(field) in prod_values:
                raise PreflightError(f"Staging {kind} includes a production binding")

    for number in range(1, 9):
        found = list(migration_dir.glob(f"{number:04d}_*.sql"))
        if len(found) != 1:
            raise PreflightError(f"Missing or ambiguous migration {number:04d}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging-config", type=pathlib.Path,
                        default=ROOT / "wrangler.staging.toml")
    parser.add_argument("--production-config", type=pathlib.Path,
                        default=ROOT / "wrangler.toml")
    parser.add_argument("--expected-staging-db-id", required=True,
                        help="Independently verified staging D1 UUID (not copied from TOML)")
    args = parser.parse_args()

    try:
        staging = load_config(args.staging_config)
        production = load_config(args.production_config)
        verify(staging, production, args.expected_staging_db_id)
    except PreflightError as exc:
        print(f"STAGING_PREFLIGHT=BLOCKED: {exc}", file=sys.stderr)
        print("REMOTE_ACTIONS=NONE", file=sys.stderr)
        return 2

    print("STAGING_PREFLIGHT=PASS")
    print("ENVIRONMENT=staging")
    print("PASSENGER_PUSH_FLAGS=DISABLED")
    print("MIGRATIONS=0001..0008_PRESENT_ONLY")
    print("REMOTE_ACTIONS=NONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
