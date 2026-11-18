"""Aggregate a local SQLite snapshot only; never decide admission or migrate data."""
import json
import sqlite3
import sys
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


REQUIRED = {
    "vehicles": {"id", "make", "model", "color", "class", "status"},
    "vehicle_classification_bindings": {"vehicle_id", "input_revision", "make", "model", "model_year", "rule_version"},
    "vehicle_trusted_assessments": {"vehicle_id"},
    "vehicle_current_trusted_assessments": {"vehicle_id", "outcome", "class"},
    "vehicle_reverification_assignment_holds": {"assignment_id"},
    "driver_availability": {"active_vehicle_id", "state"},
    "order_assignments": {"id", "vehicle_id", "state", "revoked_at"},
}

# Fixed aggregate expressions. No row identifiers, documents, credentials or
# free-form SQL can be selected through the CLI.
QUERY = """
WITH vehicle_source AS ({vehicles}), latest_bindings AS ({bindings}),
assessment_history AS ({history}), current_trusted AS ({trusted}), holds AS ({holds}), facts AS (
 SELECT v.id,v.model_year,v.powertrain,v.color,v.class,v.status,
 b.vehicle_id AS bound_id, b.rule_version,
 b.make IS v.make AND b.model IS v.model AND b.model_year IS v.model_year AS binding_matches,
 t.outcome AS trusted_outcome, t.class AS trusted_class
 FROM vehicle_source v LEFT JOIN latest_bindings b ON b.vehicle_id=v.id
 LEFT JOIN current_trusted t ON t.vehicle_id=v.id
), active_assignments AS (
 SELECT a.id,a.vehicle_id,h.assignment_id AS hold_id
 FROM order_assignments a LEFT JOIN holds h ON h.assignment_id=a.id
 WHERE a.state='active' AND a.revoked_at IS NULL
)
SELECT COUNT(*) AS vehicles,
 COUNT(CASE WHEN model_year IS NULL THEN 1 END) AS missing_year,
 COUNT(CASE WHEN color IS NULL OR trim(color,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))='' THEN 1 END) AS missing_color,
 COUNT(CASE WHEN bound_id IS NULL THEN 1 END) AS missing_binding,
 COUNT(CASE WHEN bound_id IS NOT NULL AND NOT binding_matches THEN 1 END) AS binding_input_mismatch,
 COUNT(CASE WHEN bound_id IS NOT NULL AND rule_version IS NULL THEN 1 END) AS binding_without_rule,
 COUNT(CASE WHEN NOT EXISTS(SELECT 1 FROM assessment_history a WHERE a.vehicle_id=facts.id) THEN 1 END) AS never_assessed,
 COUNT(CASE WHEN trusted_outcome IS NULL THEN 1 END) AS without_current_trusted_assessment,
 COUNT(CASE WHEN trusted_outcome='candidate' THEN 1 END) AS current_candidate,
 COUNT(CASE WHEN trusted_outcome='manual_review' THEN 1 END) AS current_manual_review,
 COUNT(CASE WHEN trusted_outcome='excluded' THEN 1 END) AS current_excluded,
 COUNT(CASE WHEN powertrain='battery_electric' THEN 1 END) AS declared_battery_electric,
 COUNT(CASE WHEN status='approved' AND (trusted_outcome IS NOT 'candidate' OR class IS NOT trusted_class) THEN 1 END) AS approved_without_matching_candidate,
 (SELECT COUNT(*) FROM driver_availability WHERE state='on_line') AS online_drivers,
 (SELECT COUNT(*) FROM driver_availability d JOIN facts f ON f.id=d.active_vehicle_id
  WHERE d.state='on_line' AND (f.trusted_outcome IS NOT 'candidate' OR f.class IS NOT f.trusted_class)) AS online_without_matching_candidate,
 (SELECT COUNT(*) FROM active_assignments) AS active_assignments,
 (SELECT COUNT(*) FROM active_assignments WHERE hold_id IS NOT NULL) AS active_assignments_with_hold,
 (SELECT COUNT(*) FROM active_assignments a JOIN facts f ON f.id=a.vehicle_id
  WHERE f.trusted_outcome IS NOT 'candidate' OR f.class IS NOT f.trusted_class) AS active_assignments_without_matching_candidate
FROM facts
"""


def read_only_authorizer(action, first, second, database, source):
    if action == sqlite3.SQLITE_FUNCTION:
        return sqlite3.SQLITE_OK if second in {"count", "max", "trim", "char", "json_extract", "julianday"} else sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK if action in {
        sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_TRANSACTION,
    } else sqlite3.SQLITE_DENY


def inventory(path):
    snapshot = Path(path).resolve(strict=True)
    if not snapshot.is_file():
        raise ValueError("not a local snapshot")
    # A closed, self-contained backup only. Immutable readers never create WAL
    # sidecars; reject WAL-mode/live files instead of silently ignoring WAL data.
    with snapshot.open("rb") as handle:
        header = handle.read(20)
    if (header[:16] != b"SQLite format 3\x00" or header[18:20] != b"\x01\x01"
            or any(Path(str(snapshot) + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))):
        raise ValueError("a closed self-contained snapshot is required")
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=5)) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        deadline = time.monotonic() + 10
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        db.execute("BEGIN")
        present = {}
        for name, required in REQUIRED.items():
            columns = {row[1] for row in db.execute(f"PRAGMA table_info({name})")}
            optional = name.startswith("vehicle_")
            if (columns or not optional) and not required <= columns:
                raise ValueError("unsupported snapshot schema")
            present[name] = bool(columns)
            if name == "vehicles":
                vehicle_columns = columns
        bindings = present["vehicle_classification_bindings"]
        trusted = present["vehicle_current_trusted_assessments"]
        if (trusted != present["vehicle_trusted_assessments"] or (trusted and not bindings)
                or (present["vehicle_reverification_assignment_holds"] and not trusted)):
            raise ValueError("incomplete classification storage")
        capabilities = {
            "modelYearField": "model_year" in vehicle_columns,
            "declaredPowertrainField": "powertrain" in vehicle_columns,
            "ruleBindings": bindings,
            "trustedAssessments": trusted,
            "assignmentHolds": present["vehicle_reverification_assignment_holds"],
        }
        if (capabilities["modelYearField"] != capabilities["declaredPowertrainField"]
                or (bindings and not capabilities["modelYearField"])):
            raise ValueError("incomplete registration storage")
        # These fragments are fixed program constants selected by schema
        # presence, never SQL or identifiers supplied by an operator.
        fragments = {
            "vehicles": "SELECT id,make,model,color,class,status,"
            + ("model_year,powertrain" if capabilities["modelYearField"] else "NULL AS model_year,NULL AS powertrain")
            + " FROM vehicles",
            "bindings": """SELECT b.* FROM vehicle_classification_bindings b
                WHERE b.input_revision=(SELECT MAX(input_revision) FROM vehicle_classification_bindings WHERE vehicle_id=b.vehicle_id)"""
            if bindings else "SELECT NULL AS vehicle_id,NULL AS rule_version,NULL AS make,NULL AS model,NULL AS model_year WHERE 0",
            "history": "SELECT vehicle_id FROM vehicle_trusted_assessments" if trusted else "SELECT NULL AS vehicle_id WHERE 0",
            "trusted": "SELECT vehicle_id,outcome,class FROM vehicle_current_trusted_assessments"
            if trusted else "SELECT NULL AS vehicle_id,NULL AS outcome,NULL AS class WHERE 0",
            "holds": "SELECT assignment_id FROM vehicle_reverification_assignment_holds"
            if capabilities["assignmentHolds"] else "SELECT NULL AS assignment_id WHERE 0",
        }
        # Initialize SQLite's built-in virtual table before installing the
        # deny-write authorizer; no extensions are loaded.
        db.execute("SELECT value FROM json_each('[]')").fetchall()
        db.set_authorizer(read_only_authorizer)
        result = db.execute(QUERY.format(**fragments))
        values = result.fetchone()
        if any(type(value) is not int or value < 0 for value in values):
            raise ValueError("invalid aggregate result")
        metrics = dict(zip((column[0] for column in result.description), values))
        if (metrics["current_candidate"] + metrics["current_manual_review"]
                + metrics["current_excluded"] + metrics["without_current_trusted_assessment"] != metrics["vehicles"]):
            raise ValueError("inconsistent assessment counts")
        db.rollback()
    return {
        "formatVersion": 1,
        "scope": "local_read_only_snapshot",
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "activationAuthorized": False,
        "admissionEvaluated": False,
        "schemaCapabilities": capabilities,
        "metrics": metrics,
    }


def main():
    try:
        if len(sys.argv) != 2:
            raise ValueError("one local snapshot is required")
        result = inventory(sys.argv[1])
    except (OSError, ValueError, sqlite3.Error):
        print("VEHICLE_INVENTORY=FAIL local snapshot unavailable or unsupported; no changes made", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
