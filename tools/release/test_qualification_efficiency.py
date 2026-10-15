"""Guard that qualification removes duplicate work, never race/coverage gates."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class QualificationEfficiencyTest(unittest.TestCase):
    def test_combined_race_coverage_preserves_all_gates(self):
        for component, target in (("admin", "verify-admin-preview"), ("mss-boot", "verify-framework")):
            with self.subTest(component=component):
                output = subprocess.check_output(["make", "-n", target], cwd=ROOT, text=True)
                full_tests = [line for line in output.splitlines() if "go test" in line and "./..." in line]
                self.assertEqual(len(full_tests), 1, full_tests)
                for flag in ("-race", "-shuffle=on", "-count=1", "-covermode=atomic", "-coverpkg=./...", "-coverprofile="):
                    self.assertIn(flag, full_tests[0])
                self.assertIn(f"--component {component} --summary", output)
                self.assertIn("go vet ./...", output)
                self.assertIn("go mod tidy" if component == "mss-boot" else "verify-admin-module-metadata.sh", output)

    def test_focused_diagnostics_remain_available(self):
        for target in ("test-admin-race", "coverage-admin", "test-framework-race", "coverage-framework"):
            subprocess.run(["make", "-n", target], cwd=ROOT, check=True, capture_output=True)

if __name__ == "__main__":
    unittest.main()
