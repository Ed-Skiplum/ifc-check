"""Generate the bundled code lists in src/codelists/ from their source tables.

A code list here is a plain lookup, code -> Norwegian name, used by the
`code-lookup` extended rule. Each generated module carries its own provenance
(source file, its SHA-256, generation date, code count) so a lookup result can
always be traced back to the table it came from.

    PYTHONUTF8=1 python scripts/gen-codelists.py

Sources live outside this repo, in the workspace standards folder. The script
fails loudly rather than writing a partial list: a lookup that silently lost
codes would turn valid codes into findings.
"""

import csv
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "src" / "codelists"
STANDARDS = Path("C:/workspace/resources/standards")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ns3457_8() -> dict:
    """NS 3457-8:2021 Komponentkoder, all three levels.

    `ns3457_pdf_extract.json` is the visual transcription of the standard with
    the 2026-06-10 QA fixes applied; its HANDOVER marks it the authoritative
    Norwegian source, and every other table in that folder (ns3457_full.json,
    ns3457_en_full.json, ns3457_table.csv) was merged or built from it. The
    reviewed table `ns3457_table.csv` is cross-checked here code by code, so a
    later edit to one that did not reach the other stops the build.
    """
    folder = STANDARDS / "ns3457"
    source = folder / "ns3457_pdf_extract.json"
    table = folder / "ns3457_table.csv"

    extract = json.loads(source.read_text(encoding="utf-8"))["codes"]
    codes = {code: row["komponentfunksjon"] for code, row in extract.items()}

    with table.open(encoding="utf-8-sig", newline="") as fh:
        reviewed = {row["code"]: row["name_no"] for row in csv.DictReader(fh)}
    if set(reviewed) != set(codes):
        only_src = sorted(set(codes) - set(reviewed))
        only_tab = sorted(set(reviewed) - set(codes))
        sys.exit(f"ns3457-8: code sets differ; only in extract {only_src}, only in table {only_tab}")
    differ = [c for c in codes if codes[c] != reviewed[c]]
    if differ:
        sys.exit(f"ns3457-8: names differ between extract and table for {differ}")

    bad = [c for c in codes if not re.fullmatch(r"[A-ZÆØÅ]{1,3}", c)]
    if bad:
        sys.exit(f"ns3457-8: unexpected code shapes {bad}")
    empty = [c for c, name in codes.items() if not name.strip()]
    if empty:
        sys.exit(f"ns3457-8: codes without a name {empty}")

    return {
        "id": "ns3457-8",
        "label": "NS 3457-8",
        "edition": "NS 3457-8:2021",
        "source": source.as_posix(),
        "sha256": sha256(source),
        "crossChecked": table.as_posix(),
        "codes": dict(sorted(codes.items())),
    }


LISTS = [ns3457_8]


def module(data: dict) -> str:
    codes = data.pop("codes")
    meta = {**data, "generated": date.today().isoformat(), "count": len(codes)}
    lines = [
        "/* GENERATED FILE — do not edit by hand.",
        f" * Source: scripts/gen-codelists.py, {meta['generated']}.",
        f" * {meta['edition']}: {meta['count']} codes from {meta['source']}",
        f" * (sha256 {meta['sha256']}).",
        " */",
        "",
        'import type { CodeList } from "./types.ts";',
        "",
        f"export const {data['id'].upper().replace('-', '_')}: CodeList = {{",
        f"  meta: {json.dumps(meta, ensure_ascii=False)},",
        "  codes: {",
    ]
    for code, name in codes.items():
        lines.append(f"    {json.dumps(code, ensure_ascii=False)}: {json.dumps(name, ensure_ascii=False)},")
    lines += ["  },", "};", ""]
    return "\n".join(lines)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for build in LISTS:
        data = build()
        count = len(data["codes"])
        out = OUT_DIR / f"{data['id']}.ts"
        out.write_text(module(data), encoding="utf-8", newline="\n")
        print(f"{out.relative_to(REPO).as_posix()}: {count} codes")


if __name__ == "__main__":
    main()
