"""Synthetic SQLite snapshots only; no provider connection or credential input."""
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/vehicle_readiness_inventory.py"
spec = importlib.util.spec_from_file_location("inventory_tool", TOOL)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "snapshot ? # synthetic.sqlite"
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8-sig"))
        for account, role in (("driver_fixture", "driver"), ("owner_fixture", "admin")):
            self.db.execute("""INSERT INTO staff_accounts
                (id,login,display_name,role,status,password_algorithm,password_iterations,password_salt,password_hash,password_changed_at,created_at,updated_at)
                VALUES(?,?,?,?,'active','pbkdf2-sha256',100000,?,?,1,1,1)""",
                (account, account, "PRIVATE_FIXTURE_NAME", role, "s" * 16, "h" * 32))
        self.db.execute("INSERT INTO driver_profiles(staff_account_id,normalized_phone,created_at,updated_at) VALUES('driver_fixture','+19990000000',1,1)")
        self.db.execute("INSERT INTO staff_owner_binding VALUES(1,'owner_fixture',1)")
        self.db.execute("INSERT INTO vehicle_classification_rules VALUES('synthetic_rule','Toyota','Camry',1,2020,'comfort','',1)")
        self.db.execute("INSERT INTO vehicle_classification_current_rules VALUES('Toyota','Camry','synthetic_rule')")
        self.db.commit()

    def vehicle(self, name, year=2023, powertrain=None, color="White"):
        self.db.execute("""INSERT INTO vehicles
            (id,driver_id,vin,plate,make,model,color,capacity,model_year,powertrain,created_at,updated_at)
            VALUES(?,'driver_fixture','SYNTHETICVIN00001','PRIVATE_PLATE','Toyota','Camry',?,4,?,?,1,1)""",
            (name, color, year, powertrain))

    def assessment(self, name, expired=False, outcome="candidate"):
        self.vehicle(name)
        expires = int(time.time() * 1000) - 1000 if expired else None
        evidence = []
        for kind in ("sts_front", "sts_back"):
            document = name + kind
            self.db.execute("""INSERT INTO document_resources
                (id,owner_driver_id,vehicle_id,kind,private_object_key,status,expires_at,created_at,updated_at)
                VALUES(?,'driver_fixture',?,? ,?,'verified',?,1,1)""", (document, name, kind, "PRIVATE_OBJECT_KEY_" + document, expires))
            evidence.append({"documentId": document, "expectedRevision": 1})
        self.db.execute("INSERT INTO audit_events VALUES(?,'owner_fixture','admin.vehicle_assessment_recorded','vehicle',?,'success',NULL,1)", (name + "_audit", name))
        self.db.execute("""INSERT INTO vehicle_trusted_assessments
            (id,vehicle_id,sequence,vehicle_revision,input_revision,pinned_rule_version,rule_version,make,model,model_year,
             declared_powertrain,powertrain,body_type,mode,evidence_json,conditions_json,outcome,class,reason_codes_json,reason,actor_account_id,audit_event_id,created_at)
            VALUES(?,?,1,1,1,'synthetic_rule','synthetic_rule','Toyota','Camry',2023,NULL,?,'sedan','standard',?,'[]',
              ?,?,?,'PRIVATE_REVIEW_REASON','owner_fixture',?,1)""",
            (name + "_assessment", name, "battery_electric" if outcome == "excluded" else "hybrid", json.dumps(evidence),
             outcome, "comfort" if outcome == "candidate" else None,
             "[]" if outcome == "candidate" else '["synthetic_review_reason"]', name + "_audit"))
        if outcome == "candidate":
            self.db.execute("UPDATE vehicles SET class='comfort',status='approved' WHERE id=?", (name,))

    def collect(self):
        self.db.commit()
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        report = module.inventory(self.path)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        self.assertFalse(report["activationAuthorized"])
        self.assertFalse(report["admissionEvaluated"])
        self.assertTrue(all(type(value) is int for value in report["metrics"].values()))
        serialized = json.dumps(report)
        for forbidden in ("PRIVATE_", "+1999", "driver_fixture", "synthetic_rule", "SYNTHETICVIN", str(self.path)):
            self.assertNotIn(forbidden, serialized)
        return report["metrics"]

    def test_empty_snapshot_returns_zero_counts_without_writes(self):
        self.assertEqual(set(self.collect().values()), {0})

    def test_required_color_with_only_unicode_whitespace_is_missing(self):
        self.vehicle("blank_color", color="\u00a0\t \ufeff")
        self.assertEqual(self.collect()["missing_color"], 1)

    def test_legacy_missing_fields_and_current_unknown_rule_are_separate(self):
        # A legacy row genuinely predates binding migration; no invented history.
        other = Path(self.temp.name) / "legacy.sqlite"
        db = sqlite3.connect(other)
        db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8-sig"))
            if migration.name.startswith("0020_"):
                for table in ("staff_accounts", "driver_profiles"):
                    for row in self.db.execute("SELECT * FROM " + table):
                        db.execute("INSERT INTO " + table + " VALUES(" + ",".join("?" for _ in row) + ")", row)
                db.execute("INSERT INTO vehicles(id,driver_id,vin,plate,make,model,capacity,class,status,created_at,updated_at) VALUES('legacy','driver_fixture','SYNTHETICVIN00001','PRIVATE_PLATE','Unknown','Unknown',4,'comfort','approved',1,1)")
                db.commit()
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        db.close()
        metrics = module.inventory(other)["metrics"]
        self.assertEqual((metrics["missing_binding"], metrics["missing_year"], metrics["missing_color"], metrics["approved_without_matching_candidate"]), (1, 1, 1, 1))
        self.vehicle("new_unknown")
        self.db.execute("UPDATE vehicles SET model='Unknown' WHERE id='new_unknown'")
        metrics = self.collect()
        self.assertEqual((metrics["missing_binding"], metrics["binding_without_rule"]), (0, 1))

    def test_pre_classifier_schema_is_read_without_fake_year_or_trust(self):
        other = Path(self.temp.name) / "before-classifier.sqlite"
        db = sqlite3.connect(other)
        db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            if migration.name.startswith("0019_"):
                break
            db.executescript(migration.read_text(encoding="utf-8-sig"))
        for table in ("staff_accounts", "driver_profiles"):
            for row in self.db.execute("SELECT * FROM " + table):
                db.execute("INSERT INTO " + table + " VALUES(" + ",".join("?" for _ in row) + ")", row)
        db.execute("INSERT INTO vehicles(id,driver_id,vin,plate,make,model,capacity,class,status,created_at,updated_at) VALUES('legacy','driver_fixture','SYNTHETICVIN00001','PRIVATE_PLATE','Toyota','Camry',4,'comfort','approved',1,1)")
        db.commit()
        db.close()
        before = other.read_bytes()
        report = module.inventory(other)
        self.assertEqual(other.read_bytes(), before)
        self.assertEqual(set(report["schemaCapabilities"].values()), {False})
        metrics = report["metrics"]
        self.assertEqual((metrics["vehicles"], metrics["missing_year"], metrics["missing_binding"], metrics["without_current_trusted_assessment"], metrics["current_candidate"]), (1, 1, 1, 1, 0))

    def test_partial_trust_storage_fails_closed(self):
        self.db.execute("DROP VIEW vehicle_current_trusted_assessments")
        self.db.commit()
        with self.assertRaises(ValueError):
            module.inventory(self.path)

    def test_candidate_is_counted_without_claiming_admission(self):
        self.assessment("candidate")
        metrics = self.collect()
        self.assertEqual((metrics["vehicles"], metrics["current_candidate"], metrics["without_current_trusted_assessment"]), (1, 1, 0))
        self.assertEqual(metrics["approved_without_matching_candidate"], 0)

    def test_outcome_counts_partition_vehicles_and_unmatched_pin_is_visible(self):
        self.assessment("candidate")
        self.assessment("manual_car", outcome="manual_review")
        self.assessment("excluded_car", outcome="excluded")
        self.vehicle("stale_input")
        # Synthetic inconsistent snapshot: never repair the history during read.
        self.db.execute("INSERT INTO vehicle_classification_bindings VALUES('stale_input',2,1,'Toyota','Other',2023,NULL,1)")
        metrics = self.collect()
        self.assertEqual((metrics["vehicles"], metrics["current_candidate"], metrics["current_manual_review"],
                          metrics["current_excluded"], metrics["without_current_trusted_assessment"],
                          metrics["binding_input_mismatch"]), (4, 1, 1, 1, 1, 1))

    def test_successful_cli_emits_only_the_aggregate_json(self):
        self.vehicle("private_vehicle")
        self.db.commit()
        result = subprocess.run([sys.executable, str(TOOL), str(self.path)], capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual(json.loads(result.stdout)["metrics"]["vehicles"], 1)
        self.assertNotIn("PRIVATE_", result.stdout)

    def test_expired_evidence_is_not_current_without_an_invalidation_row(self):
        self.assessment("expired_car", expired=True)
        metrics = self.collect()
        self.assertEqual((metrics["never_assessed"], metrics["current_candidate"], metrics["without_current_trusted_assessment"]), (0, 0, 1))
        self.assertEqual(metrics["approved_without_matching_candidate"], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM vehicle_assessment_invalidations").fetchone()[0], 0)

    def test_changed_evidence_retains_active_assignment_hold(self):
        self.assessment("held_car")
        self.db.execute("INSERT INTO orders(id,name,phone,route,trip_date,status,created_at,updated_at) VALUES('private_order','PRIVATE_NAME','19990000000','PRIVATE_ROUTE','2026-11-18','taken',1,1)")
        self.db.execute("INSERT INTO order_assignments(id,order_id,driver_id,vehicle_id,assigned_by,reason,created_at) VALUES('private_assignment','private_order','driver_fixture','held_car','owner_fixture','PRIVATE_REASON',1)")
        self.db.execute("INSERT INTO driver_availability VALUES('driver_fixture','held_car','on_line',1,1)")
        self.db.execute("UPDATE document_resources SET revision=revision+1 WHERE id='held_carsts_front'")
        metrics = self.collect()
        self.assertEqual((metrics["active_assignments"], metrics["active_assignments_with_hold"], metrics["active_assignments_without_matching_candidate"]), (1, 1, 1))
        self.assertEqual(metrics["online_drivers"], 0)

    def test_declared_bev_and_online_without_evidence_are_visible(self):
        self.vehicle("bev_car", powertrain="battery_electric")
        self.db.execute("INSERT INTO driver_availability VALUES('driver_fixture','bev_car','on_line',1,1)")
        metrics = self.collect()
        self.assertEqual((metrics["declared_battery_electric"], metrics["online_without_matching_candidate"]), (1, 1))

    def broken_legacy_snapshot(self):
        # Read-only inventory must report damaged/imported legacy references too.
        # This minimal supported schema deliberately predates classification/FKs.
        path = Path(self.temp.name) / "PRIVATE_legacy_orphans.sqlite"
        db = sqlite3.connect(path)
        try:
            db.executescript("""CREATE TABLE vehicles(id,make,model,color,class,status);
                CREATE TABLE driver_availability(active_vehicle_id,state);
                CREATE TABLE order_assignments(id,vehicle_id,state,revoked_at);
                INSERT INTO vehicles VALUES('PRIVATE_vehicle','Toyota','Camry','White','comfort','approved');""")
            for target in ("PRIVATE_vehicle", "PRIVATE_missing", None):
                db.execute("INSERT INTO driver_availability VALUES(?,'on_line')", (target,))
                db.execute("INSERT INTO order_assignments VALUES(?,?,'active',NULL)", ("PRIVATE_assignment_" + str(target), target))
            db.execute("INSERT INTO driver_availability VALUES('PRIVATE_offline_missing','off_line')")
            db.execute("INSERT INTO order_assignments VALUES('PRIVATE_revoked','PRIVATE_missing','active',1)")
            db.commit()
        finally:
            db.close()
        before = path.read_bytes()
        report = module.inventory(path)
        self.assertEqual(path.read_bytes(), before)
        self.assertNotIn("PRIVATE_", json.dumps(report))
        self.assertFalse(report["activationAuthorized"])
        self.assertFalse(report["admissionEvaluated"])
        return report["metrics"]

    def test_orphan_and_null_online_vehicle_references_are_not_healthy(self):
        metrics = self.broken_legacy_snapshot()
        self.assertEqual(metrics["online_drivers"], 3)
        self.assertEqual(metrics["online_without_matching_candidate"], 3)

    def test_orphan_and_null_active_assignments_are_not_healthy(self):
        metrics = self.broken_legacy_snapshot()
        self.assertEqual(metrics["active_assignments"], 3)
        self.assertEqual(metrics["active_assignments_without_matching_candidate"], 3)

    def test_authorizer_denies_mutation_attach_and_extension_loading(self):
        self.db.set_authorizer(module.read_only_authorizer)
        for query in ("DELETE FROM vehicles", "PRAGMA query_only=OFF", "ATTACH ':memory:' AS extra", "SELECT load_extension('PRIVATE_PROVIDER')"):
            with self.assertRaises(sqlite3.Error):
                self.db.execute(query)
        self.db.set_authorizer(None)

    def test_live_wal_and_journal_sidecars_are_rejected_without_output(self):
        self.db.execute("PRAGMA journal_mode=WAL")
        with self.assertRaises(ValueError):
            module.inventory(self.path)
        self.db.execute("PRAGMA journal_mode=DELETE")
        sidecar = Path(str(self.path) + "-journal")
        sidecar.write_text("PRIVATE_UNFINISHED_TRANSACTION")
        result = subprocess.run([sys.executable, str(TOOL), str(self.path)], capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout), (1, ""))
        self.assertNotIn("PRIVATE_", result.stderr)
        self.assertEqual(sidecar.read_text(), "PRIVATE_UNFINISHED_TRANSACTION")

    def test_cli_fails_safely_for_missing_invalid_or_incompatible_file(self):
        invalid = Path(self.temp.name) / "PRIVATE_bad.sqlite"
        invalid.write_text("PRIVATE_PROVIDER_DATA")
        for path in (invalid, invalid.with_name("PRIVATE_missing.sqlite")):
            result = subprocess.run([sys.executable, str(TOOL), str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("PRIVATE_", result.stderr)
            self.assertNotIn(str(self.temp.name), result.stderr)
        invalid.unlink()
        sqlite3.connect(invalid).close()
        result = subprocess.run([sys.executable, str(TOOL), str(invalid)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
