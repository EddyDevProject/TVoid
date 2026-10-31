#!/usr/bin/env python3
"""Builds src/lists.json and src/packages.json from the per-model debloat lists of the upstream project
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
    """Returns (packages, invalid lines, notes, groups).

    notes:  package -> trailing `# comment` on its line
    groups: package -> the comment block right above its section (e.g. "Ads, sponsored rows")
    """
    pkgs, bad, notes, groups = [], [], {}, {}
    block, group = [], ""
    for raw in text.lstrip("\ufeff").splitlines():
        body, _, comment = raw.partition("#")
        line, comment = body.strip(), comment.strip()
        if not line:
            if comment:                       # a pure comment line
                block.append(comment)
            else:                             # blank line ends the block
                joined = " ".join(block).strip()
                if joined and not re.search(r"Apply:|Undo:|Everything is DISABLED", joined):
                    group = joined[:160]
                else:
                    group = ""
                block = []
            continue
        # a package line: a comment block glued to it is its section header
        if block:
            joined = " ".join(block).strip()
            group = "" if re.search(r"Apply:|Undo:|Everything is DISABLED", joined) else joined[:160]
            block = []
        if not PKG_RE.match(line):
            bad.append(line)
            continue
        if line not in pkgs:
            pkgs.append(line)
            if comment:
                notes[line] = comment[:200]
            if group:
                groups[line] = group
    return pkgs, bad, notes, groups


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
    from collections import Counter, defaultdict

    base = Path(root) / "examples"
    out, skipped = [], []
    seen_notes = defaultdict(Counter)
    seen_count = Counter()
    for d in sorted(p for p in base.iterdir() if p.is_dir()):
        try:
            meta = json.loads((d / "tv.json").read_text(encoding="utf-8"))
            text = (d / "debloat.txt").read_text(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            skipped.append(d.name)
            continue
        pkgs, bad, notes, groups = parse(text)
        if bad:
            print(f"{d.name}: ignored {len(bad)} invalid line(s): {bad[:3]}", file=sys.stderr)
        if not pkgs:
            skipped.append(d.name)
            continue
        for p in pkgs:
            seen_count[p] += 1
            if p in notes:
                seen_notes[p][notes[p]] += 1
        entry = {
            "_notes": notes, "_groups": groups,
            "id": d.name,
            "tv": str(meta.get("tv", d.name)),
            "brand": str(meta.get("brand", "")),
            "os": str(meta.get("os", "")),
            "hint": header(text),
            "packages": pkgs,
        }
        out.append(entry)

    # package -> how many lists disable it, and its most common note
    index = {}
    for p, c in seen_count.items():
        item = {"c": c}
        if seen_notes[p]:
            item["n"] = min(seen_notes[p].most_common(3), key=lambda x: (-x[1], len(x[0])))[0]
        index[p] = item

    # per-list extras, kept small: a note only when it differs from the global one,
    # section headers as a table plus one index per package (parallel to "packages")
    for e in out:
        notes, groups = e.pop("_notes"), e.pop("_groups")
        own = {p: n for p, n in notes.items() if index[p].get("n") != n}
        if own:
            e["notes"] = own
        if groups:
            table = sorted(set(groups.values()))
            e["groups"] = table
            e["g"] = [table.index(groups[p]) if p in groups else -1 for p in e["packages"]]

    root_dir = Path(__file__).resolve().parent.parent / "src"
    (root_dir / "lists.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (root_dir / "packages.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = lambda n: (root_dir / n).stat().st_size // 1024
    print(f"{len(out)} lists ({kb('lists.json')} KB), {len(index)} packages ({kb('packages.json')} KB), skipped {skipped}")


if __name__ == "__main__":
    main(sys.argv[1])
