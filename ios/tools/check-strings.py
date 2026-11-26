#!/usr/bin/env python3
"""Checks App/Resources/Localizable.xcstrings against the strings the app's code uses.

SwiftUI extracts the English source strings at build time (.stringsdata). Run after a build:

    ./build.sh sim && python3 tools/check-strings.py

Fails when a string in the code has no Russian translation, or the catalog keeps a string the code no longer uses.
The catalog is the only place translations live (the repository is otherwise English-only).
"""
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["ru"]


def extracted_keys():
    keys = set()
    pattern = ROOT / "build/dd/Build/Intermediates.noindex/AuthBackup.build/**/*.stringsdata"
    for f in glob.glob(str(pattern), recursive=True):
        with open(f, encoding="utf-8") as fh:
            for entries in json.load(fh).get("tables", {}).values():
                keys.update(e["key"] for e in entries)
    return keys


def main():
    found = extracted_keys()
    if not found:
        sys.exit("no .stringsdata found: build the app first (./build.sh sim)")
    with open(ROOT / "App/Resources/Localizable.xcstrings", encoding="utf-8") as fh:
        strings = json.load(fh)["strings"]
    problems = []
    for key in sorted(found):
        for lang in LANGS:
            if lang not in strings.get(key, {}).get("localizations", {}):
                problems.append(f"no {lang} translation: {key!r}")
    problems += [f"no longer used: {key!r}" for key in sorted(set(strings) - found)]
    print("\n".join(problems) if problems else f"strings: OK ({len(found)} keys)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
