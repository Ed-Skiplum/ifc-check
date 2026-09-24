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


"""The two mengdetype tables (Ed-Skiplum/ifc-check#1, gap 3): telleobjekt or
mengdeobjekt per IFC class and per NS 3457-8 component code, generated from the
HI90 mottakskontroll's hand-set YAML tables, plus the open rulings on them from
its krav.yaml. Not code lists: nothing registers them in CODE_LISTS, so no
code-lookup rule can name them. Read by src/engine/standard-layer.ts only.
"""

HI90 = Path(
    "C:/workspace/skiplum/client-projects/10021-henrik-ibsens-gate-90/underprosjekter/HI90_Mottakskontroll/02_Arbeid"
)
MENGDETYPER = {"telleobjekt", "mengdeobjekt", "avhenger", "ikke_relevant"}
LEDEENHETER = {"stk", "m", "m2", "m3", "kg", None}


def _yaml(path: Path):
    import yaml  # only this generator needs PyYAML

    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _rows(path: Path, key: str, pattern: str, expected: int) -> dict:
    rows = _yaml(path)
    out: dict = {}
    for row in rows:
        k = str(row[key])
        if not re.fullmatch(pattern, k):
            sys.exit(f"{path.name}: unexpected {key} {k!r}")
        if k in out:
            sys.exit(f"{path.name}: {key} {k} twice")
        if row["mengdetype"] not in MENGDETYPER:
            sys.exit(f"{path.name}: {k} has mengdetype {row['mengdetype']!r}")
        if row.get("ledeenhet") not in LEDEENHETER:
            sys.exit(f"{path.name}: {k} has ledeenhet {row.get('ledeenhet')!r}")
        out[k] = {"mengdetype": row["mengdetype"], "ledeenhet": row.get("ledeenhet")}
    # The counts the tables' own headers and begreper.md §6 state. A different
    # count means the table changed; regenerate on purpose, never silently.
    if len(out) != expected:
        sys.exit(f"{path.name}: {len(out)} rows, expected {expected}")
    return out


def mengdetype_tables() -> list[tuple[str, str]]:
    klasse_src = HI90 / "mengdetype_ifcklasse.yaml"
    kode_src = HI90 / "mengdetype_ns3457.yaml"
    krav_src = HI90 / "krav.yaml"
    klasser = _rows(klasse_src, "klasse", r"Ifc[A-Za-z]+", 155)
    koder = _rows(kode_src, "kode", r"[A-ZÆØÅ]{1,3}", 789)

    krav = _yaml(krav_src)
    block = next((b for b in krav.get("blokker") or [] if b.get("id") == "materialprodukt"), None)
    aapne = (block or {}).get("aapne")
    if not aapne:
        sys.exit("krav.yaml: materialprodukt has no `aapne` list")
    rulings = []
    for a in aapne:
        unknown = [k for k in a["klasser"] if k not in klasser]
        if unknown:
            sys.exit(f"krav.yaml: open ruling {a['tittel']!r} names classes the class table lacks: {unknown}")
        rulings.append({"tittel": a["tittel"], "klasser": list(a["klasser"])})

    today = date.today().isoformat()

    def meta(id_: str, label: str, src: Path, count: int) -> str:
        return json.dumps(
            {"id": id_, "label": label, "source": src.as_posix(), "sha256": sha256(src),
             "generated": today, "count": count},
            ensure_ascii=False,
        )

    def header(what: str, src: Path) -> list[str]:
        return [
            "/* GENERATED FILE — do not edit by hand.",
            f" * Source: scripts/gen-codelists.py, {today}.",
            f" * {what} from {src.as_posix()}",
            f" * (sha256 {sha256(src)}).",
            " */",
            "",
        ]

    klasse_ts = header(f"Mengdetype per IFC class: {len(klasser)} classes", klasse_src) + [
        'import type { MengdetypeTable, OpenRulings } from "./types.ts";',
        "",
        "export const MENGDETYPE_IFCKLASSE: MengdetypeTable = {",
        f"  meta: {meta('mengdetype-ifcklasse', 'Mengdetype per IFC-klasse', klasse_src, len(klasser))},",
        "  rows: {",
    ]
    for k, v in sorted(klasser.items()):
        klasse_ts.append(f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    klasse_ts += [
        "  },",
        "};",
        "",
        "/** The open rulings on the tables, not decided here: the report says «åpen»",
        f" *  where they touch the switch. From {krav_src.as_posix()}",
        f" *  (sha256 {sha256(krav_src)}), materialprodukt.aapne. */",
        "export const MENGDETYPE_AAPNE: OpenRulings = {",
        f"  meta: {meta('mengdetype-aapne', 'Åpne kjennelser, mengdetype', krav_src, len(rulings))},",
        f"  rulings: {json.dumps(rulings, ensure_ascii=False)},",
        "};",
        "",
    ]
    kode_ts = header(f"Mengdetype per NS 3457-8 component code: {len(koder)} codes", kode_src) + [
        'import type { MengdetypeTable } from "./types.ts";',
        "",
        "export const MENGDETYPE_NS3457: MengdetypeTable = {",
        f"  meta: {meta('mengdetype-ns3457', 'Mengdetype per komponentkode', kode_src, len(koder))},",
        "  rows: {",
    ]
    for k, v in sorted(koder.items()):
        kode_ts.append(f"    {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},")
    kode_ts += ["  },", "};", ""]
    return [("mengdetype-ifcklasse", "\n".join(klasse_ts)), ("mengdetype-ns3457", "\n".join(kode_ts))]


def main() -> None:
    """With ids as arguments, only those modules are regenerated
    (`ns3457-8`, `mengdetype`); with none, all of them."""
    only = set(sys.argv[1:])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for build in LISTS:
        if only and build.__name__.replace("_", "-") not in only:
            continue
        data = build()
        count = len(data["codes"])
        out = OUT_DIR / f"{data['id']}.ts"
        out.write_text(module(data), encoding="utf-8", newline="\n")
        print(f"{out.relative_to(REPO).as_posix()}: {count} codes")
    if not only or "mengdetype" in only:
        for id_, text in mengdetype_tables():
            out = OUT_DIR / f"{id_}.ts"
            out.write_text(text, encoding="utf-8", newline="\n")
            print(f"{out.relative_to(REPO).as_posix()}: written")


if __name__ == "__main__":
    main()
