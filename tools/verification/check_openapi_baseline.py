#!/usr/bin/env python3
"""Compare the generated Admin OpenAPI operations with the v1.5.0 baseline.

The baseline records, per operation, the HTTP method, path, security schemes,
parameters (in/name/required) and declared response codes. Prose is ignored so
documentation edits do not trip the gate, but any added/removed operation or
changed auth/parameter contract does. Regenerate intentionally with --update.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

DEFAULT_BASELINE = Path(__file__).resolve().parents[2] / "admin/router/testdata/baseline/openapi-operations.txt"
METHODS = ("get", "put", "post", "delete", "patch", "head", "options")


def summarize(spec: dict) -> list[str]:
    global_security = spec.get("security")
    lines = []
    for path, item in sorted(spec.get("paths", {}).items()):
        shared = item.get("parameters", [])
        for method in METHODS:
            op = item.get(method)
            if op is None:
                continue
            security = op.get("security", global_security) or []
            schemes = sorted({name for req in security for name in req}) or ["none"]
            params = sorted(
                f"{p.get('in')}:{p.get('name')}{'!' if p.get('required') else ''}"
                for p in shared + op.get("parameters", [])
            )
            codes = sorted(str(code) for code in op.get("responses", {}))
            lines.append(
                f"{method.upper()} {path} security={','.join(schemes)} "
                f"params=[{' '.join(params)}] responses=[{' '.join(codes)}]"
            )
    return lines


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("swagger", type=Path, help="generated admin/docs/swagger.json")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--update", action="store_true", help="rewrite the baseline")
    args = parser.parse_args(argv)

    got = summarize(json.loads(args.swagger.read_text(encoding="utf-8")))
    if not got:
        print(f"{args.swagger}: no operations found", file=sys.stderr)
        return 1
    rendered = "\n".join(got) + "\n"
    if args.update:
        args.baseline.write_text(rendered, encoding="utf-8")
        print(f"wrote {len(got)} operations to {args.baseline}")
        return 0
    want = args.baseline.read_text(encoding="utf-8")
    if want == rendered:
        print(f"OpenAPI baseline OK ({len(got)} operations)")
        return 0
    sys.stderr.writelines(
        difflib.unified_diff(want.splitlines(True), rendered.splitlines(True), "baseline", "generated")
    )
    print("\nAdmin OpenAPI drifted from the baseline; if intentional run with --update and review.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
