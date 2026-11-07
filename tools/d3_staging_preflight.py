#!/usr/bin/env python3
"""Fail-closed D3 STAGING configuration preflight.

This tool reads local files only. It does not call Wrangler, Cloudflare APIs,
apply migrations, deploy Workers, read secrets, or mutate remote resources.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]

STAGING_WORKER = "uber-v3-staging"
STAGING_DB_NAME = "transfer-servis52-staging"
STAGING_DB_ID = "66474481-a123-47f9-81b4-12af7565ec8d"
STAGING_KV_ID = "b8fdeb74fda8415ab06b3b1c86c78e8f"

R2_BINDING = "DRIVER_PRIVATE_FILES"
UPLOAD_LIMIT_VAR = "DRIVER_UPLOAD_MAX_BYTES"

MIN_UPLOAD_BYTES = 1 * 1024 * 1024
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

REQUIRED_CRON = "0 * * * *"

SECRET_LABELS = (
    "SECRET",
    "PASSWORD",
    "TOKEN",
    "PRIVATE_KEY",
    "HMAC",
    "FIREBASE",
    "GOOGLE_CREDENTIALS",
)

DESTRUCTIVE_STATEMENT_PREFIXES = (
    "DROP ",
    "DELETE ",
    "UPDATE ",
    "INSERT ",
    "REPLACE ",
    "TRUNCATE ",
)


class PreflightError(Exception):
    pass


def load_toml(path: pathlib.Path) -> dict:
    if not path.is_file():
        raise PreflightError(f"required config missing: {path}")
    try:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise PreflightError(f"cannot parse config: {path}") from exc
    if not isinstance(data, dict):
        raise PreflightError("invalid config structure")
    return data


def single_binding(config: dict, section: str, binding: str) -> dict:
    rows = config.get(section, [])
    if not isinstance(rows, list):
        raise PreflightError(f"{section} must be an array")

    matches = [
        row
        for row in rows
        if isinstance(row, dict)
        and row.get("binding") == binding
    ]

    if len(matches) != 1:
        raise PreflightError(
            f"exactly one {binding} binding required in {section}"
        )

    return matches[0]


def parse_upload_limit(value: object) -> int:
    if isinstance(value, bool):
        raise PreflightError("invalid driver upload byte limit")

    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise PreflightError("invalid driver upload byte limit") from exc

    if not MIN_UPLOAD_BYTES <= parsed <= MAX_UPLOAD_BYTES:
        raise PreflightError(
            "driver upload byte limit outside approved safety range"
        )

    return parsed


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", "", sql)
    return sql


def audit_migrations(migrations_dir: pathlib.Path) -> None:
    files: list[pathlib.Path] = []

    for number in range(1, 18):
        matches = sorted(
            migrations_dir.glob(
                f"{number:04d}_*.sql"
            )
        )

        if len(matches) != 1:
            raise PreflightError(
                f"missing or ambiguous migration {number:04d}"
            )

        files.append(matches[0])

    for path in files[4:]:
        sql = strip_sql_comments(
            path.read_text(
                encoding="utf-8"
            )
        )

        for raw in sql.split(";"):
            statement = " ".join(
                raw.split()
            ).strip()

            if not statement:
                continue

            upper = statement.upper()

            if upper.startswith(
                DESTRUCTIVE_STATEMENT_PREFIXES
            ):
                raise PreflightError(
                    f"destructive SQL blocked in {path.name}"
                )

            if upper.startswith("ALTER TABLE"):
                if " ADD COLUMN " not in f" {upper} ":
                    raise PreflightError(
                        f"unsafe ALTER blocked in {path.name}"
                    )


def verify(
    staging: dict,
    production: dict,
    migrations_dir: pathlib.Path,
) -> dict:
    if staging.get("name") != STAGING_WORKER:
        raise PreflightError("staging Worker name mismatch")

    if staging.get("main") != production.get("main"):
        raise PreflightError("staging entrypoint differs from production source")

    if staging.get("workers_dev") is not True:
        raise PreflightError("staging Worker must remain workers.dev-only")

    routes = staging.get("routes")
    if routes not in (None, []):
        raise PreflightError("staging custom routes are not allowed")

    triggers = staging.get("triggers", {})
    crons = triggers.get("crons", []) if isinstance(triggers, dict) else []

    if REQUIRED_CRON not in crons:
        raise PreflightError("required D3 hourly cron is missing")

    variables = staging.get("vars", {})
    if not isinstance(variables, dict):
        raise PreflightError("staging vars must be a table")

    if variables.get("APP_ENV") != "staging":
        raise PreflightError("APP_ENV=staging is required")

    for name in variables:
        if any(label in name.upper() for label in SECRET_LABELS):
            raise PreflightError(
                "credential-like value must not be stored in [vars]"
            )

    upload_limit = parse_upload_limit(
        variables.get(
            UPLOAD_LIMIT_VAR
        )
    )

    staging_db = single_binding(
        staging,
        "d1_databases",
        "DB",
    )

    production_db = single_binding(
        production,
        "d1_databases",
        "DB",
    )

    if staging_db.get("database_name") != STAGING_DB_NAME:
        raise PreflightError("staging D1 name mismatch")

    if staging_db.get("database_id") != STAGING_DB_ID:
        raise PreflightError("staging D1 id mismatch")

    if staging_db.get("database_id") == production_db.get("database_id"):
        raise PreflightError("staging D1 points to production")

    if staging_db.get("migrations_dir", "migrations") != "migrations":
        raise PreflightError("staging migrations_dir mismatch")

    staging_kv = single_binding(
        staging,
        "kv_namespaces",
        "DRIVERS",
    )

    production_kv = single_binding(
        production,
        "kv_namespaces",
        "DRIVERS",
    )

    if staging_kv.get("id") != STAGING_KV_ID:
        raise PreflightError("staging KV id mismatch")

    if staging_kv.get("id") == production_kv.get("id"):
        raise PreflightError("staging KV points to production")

    staging_r2 = single_binding(
        staging,
        "r2_buckets",
        R2_BINDING,
    )

    bucket_name = str(
        staging_r2.get(
            "bucket_name",
            "",
        )
    ).strip()

    if (
        not bucket_name
        or "staging" not in bucket_name.lower()
        or "replace" in bucket_name.lower()
        or "<" in bucket_name
        or ">" in bucket_name
    ):
        raise PreflightError(
            "private R2 bucket must be explicitly staging-scoped"
        )

    audit_migrations(
        migrations_dir
    )

    return {
        "worker": STAGING_WORKER,
        "database": STAGING_DB_NAME,
        "database_id": STAGING_DB_ID,
        "kv_id": STAGING_KV_ID,
        "r2_bucket": bucket_name,
        "upload_limit": upload_limit,
        "cron": REQUIRED_CRON,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__
    )

    parser.add_argument(
        "--staging-config",
        type=pathlib.Path,
        required=True,
    )

    parser.add_argument(
        "--production-config",
        type=pathlib.Path,
        default=ROOT / "wrangler.toml",
    )

    parser.add_argument(
        "--migrations-dir",
        type=pathlib.Path,
        default=ROOT / "migrations",
    )

    args = parser.parse_args()

    try:
        result = verify(
            load_toml(
                args.staging_config
            ),
            load_toml(
                args.production_config
            ),
            args.migrations_dir,
        )
    except PreflightError as exc:
        print(
            f"D3_STAGING_PREFLIGHT=BLOCKED: {exc}",
            file=sys.stderr,
        )
        print(
            "REMOTE_ACTIONS=NONE",
            file=sys.stderr,
        )
        return 2

    print("D3_STAGING_PREFLIGHT=PASS")
    print(f"WORKER={result['worker']}")
    print(f"D1={result['database']}")
    print(f"R2={result['r2_bucket']}")
    print(f"UPLOAD_LIMIT={result['upload_limit']}")
    print("REMOTE_ACTIONS=NONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(
        main()
    )
