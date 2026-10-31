#!/usr/bin/env python3
"""Builds src/lists.json from the per-model debloat lists of the upstream project
(github.com/Gathin23/cleanyourtv, MIT), pinned in scripts/build-launcher.sh.

    git clone --depth 1 --branch v3.2.0 https://github.com/Gathin23/cleanyourtv.git /tmp/upstream
    python3 -I scripts/build-lists.py /tmp/upstream
"""
import json
import re
import sys
from pathlib import Path

PKG_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$")


def parse(text):
    pkgs, bad = [], []
    for raw in text.lstrip("﻿").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if not PKG_RE.match(line):
            bad.append(line)
        elif line not in pkgs:
            pkgs.append(line)
    return pkgs, bad


def header(text):
    out = []
    for raw in text.splitlines():
        if raw.startswith("#") and not re.match(r"#\s*(Apply|Undo)", raw):
            out.append(raw.lstrip("# ").strip())
        elif raw.strip():
            break
        if len(out) >= 3:
            break
    return " ".join(out)[:300]


def main(root):
    base = Path(root) / "examples"
    out, skipped = [], []
    for d in sorted(p for p in base.iterdir() if p.is_dir()):
        try:
            meta = json.loads((d / "tv.json").read_text(encoding="utf-8"))
            text = (d / "debloat.txt").read_text(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            skipped.append(d.name)
            continue
        pkgs, bad = parse(text)
        if bad:
            print(f"{d.name}: ignored {len(bad)} invalid line(s): {bad[:3]}", file=sys.stderr)
        if not pkgs:
            skipped.append(d.name)
            continue
        out.append({
            "id": d.name,
            "tv": str(meta.get("tv", d.name)),
            "brand": str(meta.get("brand", "")),
            "os": str(meta.get("os", "")),
            "hint": header(text),
            "packages": pkgs,
        })
    dest = Path(__file__).resolve().parent.parent / "src" / "lists.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} lists, skipped {skipped}, {dest.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
