"""PUSH-01H fail-closed staging identity preflight regression."""
import copy
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import push01h_staging_preflight as preflight  # noqa: E402

PROD_ID = "00000000-0000-4000-8000-000000000001"
STAGE_ID = "00000000-0000-4000-8000-000000000002"


def fixtures():
    production = {
        "name": "uber-v3",
        "main": "src/index.js",
        "d1_databases": [{
            "binding": "DB",
            "database_name": "transfer-servis52-core",
            "database_id": PROD_ID,
        }],
        "kv_namespaces": [{
            "binding": "DRIVERS", "id": "production-kv-only"
        }],
    }
    staging = {
        "name": "uber-v3-staging",
        "main": "src/index.js",
        "vars": {"APP_ENV": "staging"},
        "d1_databases": [{
            "binding": "DB",
            "database_name": "transfer-servis52-staging",
            "database_id": STAGE_ID,
            "migrations_dir": "migrations",
        }],
        "kv_namespaces": [{
            "binding": "DRIVERS", "id": "test-kv-only"
        }],
    }
    return staging, production


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.staging, self.production = fixtures()

    def expect_block(self, message):
        with self.assertRaisesRegex(preflight.PreflightError, message):
            preflight.verify(self.staging, self.production, STAGE_ID)

    def test_exact_staging_identity_and_migrations_pass(self):
        preflight.verify(self.staging, self.production, STAGE_ID)

    def test_reject_production_database_even_with_stage_name(self):
        self.staging["d1_databases"][0]["database_id"] = PROD_ID
        self.expect_block("differs|production")

    def test_reject_unverified_database_id(self):
        with self.assertRaises(preflight.PreflightError):
            preflight.verify(self.staging, self.production, PROD_ID)

    def test_reject_production_worker_name(self):
        self.staging["name"] = "uber-v3"
        self.expect_block("name")

    def test_reject_wrong_environment(self):
        self.staging["vars"]["APP_ENV"] = "production"
        self.expect_block("APP_ENV")

    def test_reject_missing_environment(self):
        self.staging["vars"].pop("APP_ENV")
        self.expect_block("APP_ENV")

    def test_reject_enabled_push_flag_without_approval(self):
        for name in ("PASSENGER_PUSH_API_ENABLED", "PASSENGER_PUSH_DEVICES_ENABLED"):
            with self.subTest(name=name):
                staging = copy.deepcopy(self.staging)
                staging["vars"][name] = "true"
                with self.assertRaises(preflight.PreflightError):
                    preflight.verify(staging, self.production, STAGE_ID)

    def test_reject_credentials_in_config(self):
        for name in ("PASSENGER_ORDER_SECRET", "FIREBASE_SERVICE_KEY",
                     "PROXY_HMAC_SECRET", "GOOGLE_CREDENTIALS"):
            with self.subTest(name=name):
                staging = copy.deepcopy(self.staging)
                staging["vars"][name] = "must-not-commit"
                with self.assertRaises(preflight.PreflightError):
                    preflight.verify(staging, self.production, STAGE_ID)

    def test_reject_accidental_production_kv_binding(self):
        self.staging["kv_namespaces"][0]["id"] = "production-kv-only"
        self.expect_block("DRIVERS|production")

    def test_reject_missing_db_binding(self):
        self.staging["d1_databases"] = []
        self.expect_block("Exactly one DB")

    def test_reject_extra_production_db(self):
        self.staging["d1_databases"].append({
            "binding": "UNSAFE", "database_id": PROD_ID,
            "database_name": "transfer-servis52-core"
        })
        self.expect_block("production binding")

    def test_reject_bad_migrations_directory(self):
        self.staging["d1_databases"][0]["migrations_dir"] = "other"
        self.expect_block("migration directory")

    def test_cli_missing_staging_file_exits_nonzero_without_remote_actions(self):
        with tempfile.TemporaryDirectory() as folder:
            missing = pathlib.Path(folder) / "wrangler.staging.toml"
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/push01h_staging_preflight.py"),
                 "--staging-config", str(missing),
                 "--expected-staging-db-id", STAGE_ID],
                text=True, capture_output=True, check=False
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("STAGING_PREFLIGHT=BLOCKED", result.stderr)
        self.assertIn("REMOTE_ACTIONS=NONE", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
