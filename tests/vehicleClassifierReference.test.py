"""Check approved reference data; this does not verify runtime eligibility."""
import csv
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_BEV = {
    ("Mercedes-Benz", "EQS"), ("BMW", "i5"), ("BMW", "i7"),
    ("NIO", "ET7"), ("IM Motors", "L7"), ("Luxeed", "S7"),
    ("Xpeng", "P7"), ("Xiaomi", "SU7"), ("Zeekr", "001"),
    ("Zeekr", "009"),
}
MIXED_MODELS = {
    ("BYD", "Han"), ("Voyah", "Passion"), ("Exlantix", "ES"),
    ("Stelato", "S9"), ("Voyah", "Dream"), ("Denza", "D9"),
    ("Citroën", "SpaceTourer"), ("Opel", "Zafira Life"),
}


def read(name):
    with (ROOT / "docs" / name).open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        if reader.fieldnames != ["tariff", "brand", "model", "min_year", "status", "notes"]:
            raise ValueError("Unexpected classifier columns")
        return list(reader)


class ClassifierReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = read("vehicle-classifier-v1.csv")
        cls.rows = read("vehicle-classifier-v2-proposed.csv")
        cls.models = {(r["brand"], r["model"]): r for r in cls.rows}

    def test_only_approved_classes_and_unique_pairs(self):
        self.assertEqual(len(self.rows), 121)
        self.assertEqual(len(self.models), len(self.rows))
        self.assertEqual(Counter(r["tariff"] for r in self.rows),
                         {"Комфорт": 76, "Бизнес": 22, "Минивэн": 23})
        for row in self.rows:
            self.assertEqual(row["status"], "approved")
            self.assertTrue(row["min_year"].isascii() and row["min_year"].isdigit())
            self.assertTrue(1900 <= int(row["min_year"]) <= 2100)

    def test_verified_battery_electric_models_are_absent(self):
        self.assertTrue(EXCLUDED_BEV.isdisjoint(self.models))

    def test_mixed_powertrain_models_remain_for_variant_review(self):
        self.assertTrue(MIXED_MODELS.issubset(self.models))

    def test_owner_approved_li_auto_exceptions(self):
        for name in ("L7", "L9"):
            row = self.models[("Li Auto", name)]
            self.assertEqual((row["tariff"], row["min_year"], row["status"]),
                             ("Бизнес", "2023", "approved"))
            self.assertEqual(row["notes"], "Только комфортные комплектации; проверка салона")

    def test_original_approved_rules_preserve_fields(self):
        self.assertEqual(len(self.archive), 116)
        archived = {(r["brand"], r["model"]): r for r in self.archive}
        self.assertEqual(len(archived), 116)
        missing = set(archived) - set(self.models)
        self.assertEqual(missing, EXCLUDED_BEV & set(archived))
        for key in set(archived) & set(self.models):
            for field in ("tariff", "brand", "model", "min_year", "notes"):
                self.assertEqual(self.models[key][field], archived[key][field], (key, field))

    def test_approved_china_extensions_preserve_conditions(self):
        path = ROOT / "docs" / "VEHICLE_CLASSIFIER_CHINA_EXTENSION_PROPOSAL_2026-11-16.json"
        candidates = json.loads(path.read_text(encoding="utf-8"))["candidates"]
        self.assertEqual(len(candidates), 15)
        tariff = {"comfort": "Комфорт", "business": "Бизнес", "minivan": "Минивэн"}
        for item in candidates:
            key = (item["brand"], item["model"])
            if key in EXCLUDED_BEV:
                self.assertNotIn(key, self.models)
                continue
            row = self.models[key]
            self.assertEqual(row["tariff"], tariff[item["proposedTariff"]], key)
            self.assertEqual(row["min_year"], str(item["minYear"]), key)
            self.assertEqual(row["notes"],
                             "Утверждённые условия: " + item["proposedConditions"]
                             + "; требуется проверка конкретного автомобиля", key)


if __name__ == "__main__":
    unittest.main()
