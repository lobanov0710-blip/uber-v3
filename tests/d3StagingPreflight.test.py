#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SPEC = importlib.util.spec_from_file_location(
    "d3_staging_preflight",
    ROOT / "tools" / "d3_staging_preflight.py",
)

MODULE = importlib.util.module_from_spec(
    SPEC
)

assert SPEC.loader is not None
SPEC.loader.exec_module(
    MODULE
)


def production_config() -> dict:
    return {
        "name": "uber-v3",
        "main": "src/index.js",
        "workers_dev": True,
        "kv_namespaces": [
            {
                "binding": "DRIVERS",
                "id": "a0b3ddaecec4476f983eb28cc3d8a1e5",
            }
        ],
        "d1_databases": [
            {
                "binding": "DB",
                "database_name": "transfer-servis52-core",
                "database_id": "c1d490e4-68f0-4f78-8f53-7d10df7c3395",
                "migrations_dir": "migrations",
            }
        ],
    }


def staging_config() -> dict:
    return {
        "name": "uber-v3-staging",
        "main": "src/index.js",
        "workers_dev": True,
        "triggers": {
            "crons": [
                "0 * * * *",
            ]
        },
        "kv_namespaces": [
            {
                "binding": "DRIVERS",
                "id": MODULE.STAGING_KV_ID,
            }
        ],
        "d1_databases": [
            {
                "binding": "DB",
                "database_name": MODULE.STAGING_DB_NAME,
                "database_id": MODULE.STAGING_DB_ID,
                "migrations_dir": "migrations",
            }
        ],
        "r2_buckets": [
            {
                "binding": "DRIVER_PRIVATE_FILES",
                "bucket_name": "transfer-servis52-driver-private-staging",
            }
        ],
        "vars": {
            "APP_ENV": "staging",
            "DRIVER_UPLOAD_MAX_BYTES": "10485760",
        },
    }


class D3StagingPreflightTest(
    unittest.TestCase
):

    def test_valid_staging_config_passes(
        self
    ):
        result = MODULE.verify(
            staging_config(),
            production_config(),
            ROOT / "migrations",
        )

        self.assertEqual(
            MODULE.STAGING_DB_ID,
            result["database_id"],
        )

        self.assertEqual(
            "transfer-servis52-driver-private-staging",
            result["r2_bucket"],
        )


    def test_missing_private_r2_is_blocked(
        self
    ):
        config = staging_config()
        config["r2_buckets"] = []

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )


    def test_production_d1_or_kv_is_blocked(
        self
    ):
        config = staging_config()
        config["d1_databases"][0]["database_id"] = (
            production_config()["d1_databases"][0]["database_id"]
        )

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )

        config = staging_config()
        config["kv_namespaces"][0]["id"] = (
            production_config()["kv_namespaces"][0]["id"]
        )

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )


    def test_unscoped_bucket_and_bad_upload_limit_are_blocked(
        self
    ):
        config = staging_config()
        config["r2_buckets"][0]["bucket_name"] = (
            "transfer-servis52-driver-private"
        )

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )

        config = staging_config()
        config["vars"]["DRIVER_UPLOAD_MAX_BYTES"] = "100"

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )


    def test_secret_like_vars_and_custom_routes_are_blocked(
        self
    ):
        config = staging_config()
        config["vars"]["SOME_TOKEN"] = "must-not-be-here"

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )

        config = staging_config()
        config["routes"] = [
            "transfer-servis52.ru/*",
        ]

        with self.assertRaises(
            MODULE.PreflightError
        ):
            MODULE.verify(
                config,
                production_config(),
                ROOT / "migrations",
            )


    def test_destructive_pending_sql_is_blocked(
        self
    ):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(
                directory
            )

            for number in range(
                1,
                18,
            ):
                sql = (
                    "CREATE TABLE IF NOT EXISTS "
                    f"t_{number}(id INTEGER);"
                )

                if number == 17:
                    sql += " DELETE FROM t_17;"

                (
                    path
                    / f"{number:04d}_fixture.sql"
                ).write_text(
                    sql,
                    encoding="utf-8",
                )

            with self.assertRaises(
                MODULE.PreflightError
            ):
                MODULE.audit_migrations(
                    path
                )


if __name__ == "__main__":
    unittest.main()
