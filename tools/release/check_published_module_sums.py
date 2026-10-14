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
is published, any difference fails. Root Release runs it with --strict after
the Framework and Admin tags exist and before the CLI that embeds the template
is published: a version the checksum database still does not know after
retries fails, and a run that verified nothing fails, so the gate cannot pass
without checking anything. Every run prints verified/skipped/mismatched counts.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

MODULE_PREFIX = "github.com/mss-boot-sys/mss-boot-admin/"
DEFAULT_FILES = ("templates/application/go.sum", "admin/go.sum")
SUMDB = "https://sum.golang.org/lookup/"

Lookup = Callable[[str, str], Optional[dict[str, str]]]


class PinnedSumError(ValueError):
    """A Foundation module entry in go.sum is malformed or duplicated."""


def parse_pinned(text: str) -> dict[tuple[str, str], str]:
    """Return {(module, version-or-version/go.mod): hash} for Foundation modules.

    Lines for other modules are ignored. A Foundation module line that is not
    exactly `module version h1:hash`, or that repeats an entry, raises
    PinnedSumError instead of being silently dropped or overwritten.
    """
    pinned: dict[tuple[str, str], str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        fields = line.split()
        if not fields or not fields[0].startswith(MODULE_PREFIX):
            continue
        if len(fields) != 3 or not fields[1].startswith("v") or not fields[2].startswith("h1:"):
            raise PinnedSumError(f"line {number}: malformed Foundation module entry: {line.strip()!r}")
        key = (fields[0], fields[1])
        if key in pinned:
            raise PinnedSumError(f"line {number}: duplicate entry for {fields[0]} {fields[1]}")
        pinned[key] = fields[2]
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


def retrying_lookup(
    lookup: Lookup, attempts: int, delay: float, sleep: Callable[[float], None] = time.sleep
) -> Lookup:
    """Retry versions the checksum database does not know yet, with exponential backoff."""

    def wrapped(module: str, version: str) -> Optional[dict[str, str]]:
        for attempt in range(attempts):
            found = lookup(module, version)
            if found is not None:
                return found
            if attempt + 1 < attempts:
                sleep(delay * (2**attempt))
        return None

    return wrapped


def check(files: dict[str, str], lookup: Lookup) -> tuple[list[str], list[str]]:
    failures, skipped, _ = check_counts(files, lookup)
    return failures, skipped


def check_counts(
    files: dict[str, str], lookup: Lookup
) -> tuple[list[str], list[str], int]:
    """Return (mismatches, skipped versions, number of verified entries)."""
    verified = 0
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
            else:
                verified += 1
    return failures, sorted(set(skipped)), verified


def main(
    argv: list[str] | None = None,
    lookup: Lookup = sumdb_lookup,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail on versions still unpublished after retries and when nothing was verified",
    )
    parser.add_argument("--retries", type=int, default=5, help="lookup attempts in strict mode")
    parser.add_argument("--retry-delay", type=float, default=10.0, help="initial backoff seconds")
    parser.add_argument("files", nargs="*", default=list(DEFAULT_FILES))
    args = parser.parse_args(argv)
    if args.strict:
        lookup = retrying_lookup(lookup, max(1, args.retries), args.retry_delay, sleep)
    try:
        texts = {name: (args.root / name).read_text(encoding="utf-8") for name in args.files}
        failures, skipped, verified = check_counts(texts, lookup)
    except PinnedSumError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for line in skipped:
        print(f"{'missing' if args.strict else 'skip'}: {line}")
    for line in failures:
        print(f"mismatch: {line}", file=sys.stderr)
    print(f"verified={verified} skipped={len(skipped)} mismatched={len(failures)}")
    if failures:
        return 1
    if args.strict and skipped:
        print("strict: versions are still missing from sum.golang.org after retries", file=sys.stderr)
        return 1
    if args.strict and verified == 0:
        print("strict: no pinned Foundation module sum was verified", file=sys.stderr)
        return 1
    print("Pinned Foundation module sums match sum.golang.org.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
