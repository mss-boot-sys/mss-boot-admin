import json
import tempfile
import unittest
from pathlib import Path

from tools.verification import check_openapi_baseline as mod

SPEC = {
    "paths": {
        "/admin/api/users": {
            "get": {"security": [{"Bearer": []}], "parameters": [{"in": "query", "name": "page"}], "responses": {"200": {}}},
        }
    }
}


class CheckOpenAPIBaselineTest(unittest.TestCase):
    def run_check(self, spec, *extra):
        tmp = Path(tempfile.mkdtemp())
        swagger = tmp / "swagger.json"
        swagger.write_text(json.dumps(spec))
        return mod.main([str(swagger), "--baseline", str(tmp / "b.txt"), *extra])

    def test_update_then_clean(self):
        tmp = Path(tempfile.mkdtemp())
        swagger, baseline = tmp / "s.json", tmp / "b.txt"
        swagger.write_text(json.dumps(SPEC))
        self.assertEqual(mod.main([str(swagger), "--baseline", str(baseline), "--update"]), 0)
        self.assertEqual(mod.main([str(swagger), "--baseline", str(baseline)]), 0)
        drift = json.loads(json.dumps(SPEC))
        drift["paths"]["/admin/api/users"]["get"]["security"] = []
        swagger.write_text(json.dumps(drift))
        self.assertEqual(mod.main([str(swagger), "--baseline", str(baseline)]), 1)

    def test_prose_ignored(self):
        a = mod.summarize(SPEC)
        b = json.loads(json.dumps(SPEC))
        b["paths"]["/admin/api/users"]["get"]["summary"] = "changed"
        self.assertEqual(a, mod.summarize(b))

    def test_empty_spec_fails(self):
        self.assertEqual(self.run_check({"paths": {}}), 1)


if __name__ == "__main__":
    unittest.main()
