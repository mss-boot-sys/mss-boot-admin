#!/usr/bin/env python3
"""Check pinned Foundation module sums against the public checksum database.

`mss new app` copies templates/application/go.sum into every generated
project. Those hashes were historically computed from the local release
candidate tree before tagging; any later change to a module directory (v1.5.0:
removing stray SQLite WAL files from admin/ after the sum was pinned) left a
hash that no published module matches, so every new project failed `go mod
download` with a checksum mismatch.

This check compares every pinned github.com/mss-boot-sys/mss-boot-admin/*
entry with sum.golang.org. Versions the checksum database does not know yet
(an unpublished release candidate) are reported and skipped; once a version
is published, any difference fails. Root Release runs it after the Framework
and Admin tags exist and before the CLI that embeds the template is published.
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

MODULE_PREFIX = "github.com/mss-boot-sys/mss-boot-admin/"
DEFAULT_FILES = ("templates/application/go.sum", "admin/go.sum")
SUMDB = "https://sum.golang.org/lookup/"

Lookup = Callable[[str, str], Optional[dict[str, str]]]


def parse_pinned(text: str) -> dict[tuple[str, str], str]:
    """Return {(module, version-or-version/go.mod): hash} for Foundation modules."""
    pinned: dict[tuple[str, str], str] = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 3 or not fields[0].startswith(MODULE_PREFIX):
            continue
        pinned[(fields[0], fields[1])] = fields[2]
    return pinned


def sumdb_lookup(module: str, version: str) -> Optional[dict[str, str]]:
    """Return the checksum database lines for module@version, or None if unknown."""
    try:
        with urllib.request.urlopen(f"{SUMDB}{module}@{version}", timeout=30) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            return None
        raise
    found: dict[str, str] = {}
    for line in body.splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0] == module:
            found[fields[1]] = fields[2]
    return found


def check(files: dict[str, str], lookup: Lookup) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    skipped: list[str] = []
    cache: dict[tuple[str, str], Optional[dict[str, str]]] = {}
    for name, text in files.items():
        for (module, entry), pinned_hash in sorted(parse_pinned(text).items()):
            version = entry.removesuffix("/go.mod")
            key = (module, version)
            if key not in cache:
                cache[key] = lookup(module, version)
            published = cache[key]
            if published is None:
                skipped.append(f"{name}: {module} {version} is not published yet")
                continue
            expected = published.get(entry)
            if expected != pinned_hash:
                failures.append(
                    f"{name}: {module} {entry} pins {pinned_hash}, "
                    f"sum.golang.org has {expected}"
                )
    return failures, sorted(set(skipped))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("files", nargs="*", default=list(DEFAULT_FILES))
    args = parser.parse_args(argv)
    texts = {name: (args.root / name).read_text(encoding="utf-8") for name in args.files}
    failures, skipped = check(texts, sumdb_lookup)
    for line in skipped:
        print(f"skip: {line}")
    if failures:
        for line in failures:
            print(f"mismatch: {line}", file=sys.stderr)
        return 1
    print("Pinned Foundation module sums match sum.golang.org.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
