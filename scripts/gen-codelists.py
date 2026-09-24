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


# NS 3451:2022 names whose PDF text layer is broken: the name cell carries
# zero-width glyphs (a run of characters stacked at one x, followed by a
# spacer), so every text extractor reads them wrong ("overfla te",
# "vanntåk ke", "fjernva rme"). Each name below was read off the rendered
# page image at 170 dpi, 2026-09-24. The build refuses a zero-width name that
# is not listed here, and a listed name that is no longer zero-width.
NS3451_READ_FROM_IMAGE = {
    "226": ("Kledning og overflate", 10),
    "235": ("Utvendig kledning og overflate", 11),
    "236": ("Innvendig overflate", 11),
    "246": ("Kledning og overflate", 11),
    "253": ("Oppfôret gulv og påstøp", 11),
    "255": ("Gulvoverflate", 12),
    "256": ("Faste himlinger og overflatebehandling", 12),
    "266": ("Himling og innvendig overflate", 12),
    "333": ("Installasjon for brannslokking med vanntåke", 20),
    "3331": ("Ledninger i grunnen for brannslokking med vanntåke", 20),
    "3332": ("Ledningsnett for brannslokking med vanntåke", 20),
    "3334": ("Armaturer for brannslokking med vanntåke", 20),
    "3335": ("Utstyr for brannslokking med vanntåke", 20),
    "3336": ("Isolasjon for brannslokking med vanntåke", 20),
    "5562": ("Sentralutstyr og styretablåer for informasjons- og AV-installasjoner", 35),
    "631": ("Dokument- og småvaretransportører", 37),
    "783": ("Utendørs tilknytning til eksterne nett for vannforsyning, avløp og fjernvarme", 46),
}

# Where the PDF and the earlier table (ns3451_table.csv, built from a damaged
# extraction) disagree. Every entry was checked against the rendered page
# image; the build stops if the set of disagreements changes.
NS3451_CORRECTED = {"226", "235", "236", "246", "253", "255", "256", "266", "285", "631", "775", "783", "5562"}
# In the PDF, missing from ns3451_table.csv. Checked against the page image.
NS3451_ADDED = {"374", "632", "762"}

RESERVED_NAME = "(Reservert)"


def _is_subsequence(needle: str, hay: str) -> bool:
    it = iter(hay)
    return all(ch in it for ch in needle)


def ns3451() -> dict:
    """NS 3451:2022 Bygningsdelstabell, tables 2 to 7 (1 to 4 digit codes).

    Extracted from the standard's PDF with PyMuPDF: `find_tables` for the
    cells, the characters inside the Navn cell for the name. Table 8
    (Systemkoder, 4 digit system codes) is a different list and not included.

    The PDF text layer is damaged in 17 names (zero-width glyphs); those are
    taken from NS3451_READ_FROM_IMAGE, each read off the page image. The
    result is cross-checked against ns3451_table.csv, the earlier table whose
    names were damaged by a different extraction: every disagreement must be
    in NS3451_CORRECTED or NS3451_ADDED, so a change on either side stops the
    build.

    `(Reservert)` codes are shipped and listed in `reserved`, so a lookup can
    tell a reserved code from an unknown one.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit("ns3451: needs PyMuPDF (pip install pymupdf)")

    folder = STANDARDS / "ns3451"
    source = folder / "ns-3451_2022_no_001.pdf"
    table = STANDARDS / "mappings" / "ebkph" / "ns3451_table.csv"
    if not source.exists():
        sys.exit(f"ns3451: source PDF missing: {source}")

    doc = fitz.open(source)
    pages = [i for i in range(doc.page_count) if re.search(r"Tabell [2-7] —", doc[i].get_text())]
    codes: dict[str, str] = {}
    page_of: dict[str, int] = {}
    zero_width: dict[str, str] = {}
    for i in pages:
        page = doc[i]
        chars = [
            c
            for b in page.get_text("rawdict")["blocks"]
            for ln in b.get("lines", [])
            for s in ln["spans"]
            for c in s["chars"]
        ]

        def inside(rect, c):
            x = (c["bbox"][0] + c["bbox"][2]) / 2
            y = (c["bbox"][1] + c["bbox"][3]) / 2
            return rect.x0 <= x <= rect.x1 and rect.y0 <= y <= rect.y1

        for tab in page.find_tables().tables:
            for row in tab.rows:
                cells = row.cells
                if len(cells) != 6:
                    sys.exit(f"ns3451: page {i + 1}: a row with {len(cells)} cells, expected 6")
                texts = []
                for cell in cells:
                    if cell is None:
                        texts.append(None)
                        continue
                    rect = fitz.Rect(cell)
                    texts.append([c for c in chars if inside(rect, c)])
                code = "".join("".join(c["c"] for c in t) for t in texts[:4] if t).strip()
                if code == "Kode" or texts[4] is None:
                    continue
                name_chars = texts[4]
                if not re.fullmatch(r"\d{1,4}", code):
                    if code or "".join(c["c"] for c in name_chars).strip():
                        sys.exit(f"ns3451: page {i + 1}: unexpected row code {code!r}")
                    continue  # guidance continued from the previous page
                lines: dict[int, list] = {}
                for c in name_chars:
                    lines.setdefault(round(c["bbox"][1]), []).append(c)
                name = " ".join(
                    "".join(c["c"] for c in sorted(v, key=lambda c: c["bbox"][0])).strip()
                    for _, v in sorted(lines.items())
                )
                name = re.sub(r"\s+", " ", name).strip()
                if code in codes:
                    sys.exit(f"ns3451: code {code} twice (pages {page_of[code]} and {i + 1})")
                if any(c["c"] != " " and c["bbox"][2] - c["bbox"][0] < 0.05 for c in name_chars):
                    zero_width[code] = name
                codes[code] = name
                page_of[code] = i + 1

    if set(zero_width) != set(NS3451_READ_FROM_IMAGE):
        sys.exit(
            "ns3451: zero-width names changed; not read from image "
            f"{sorted(set(zero_width) - set(NS3451_READ_FROM_IMAGE))}, "
            f"listed but clean {sorted(set(NS3451_READ_FROM_IMAGE) - set(zero_width))}"
        )
    for code, (name, page) in NS3451_READ_FROM_IMAGE.items():
        if page_of[code] != page:
            sys.exit(f"ns3451: {code} is on page {page_of[code]}, the image reading says {page}")
        # The damaged text layer still holds every letter of the true name.
        if not _is_subsequence(name.replace(" ", ""), zero_width[code].replace(" ", "")):
            sys.exit(f"ns3451: {code} image reading {name!r} does not fit the text layer {zero_width[code]!r}")
        codes[code] = name

    with table.open(encoding="utf-8-sig", newline="") as fh:
        earlier = {row["code"]: row["name_no"] for row in csv.DictReader(fh)}
    only_table = sorted(set(earlier) - set(codes))
    if only_table:
        sys.exit(f"ns3451: codes in {table.name} but not in the PDF {only_table}")
    added = set(codes) - set(earlier)
    corrected = {c for c in earlier if earlier[c] != codes[c]}
    if added != NS3451_ADDED or corrected != NS3451_CORRECTED:
        sys.exit(
            f"ns3451: disagreements with {table.name} changed; "
            f"added {sorted(added, key=int)}, corrected {sorted(corrected, key=int)}"
        )

    bad = [c for c in codes if not re.fullmatch(r"[2-7]\d{0,3}", c)]
    if bad:
        sys.exit(f"ns3451: unexpected code shapes {bad}")
    empty = [c for c, name in codes.items() if not name.strip()]
    if empty:
        sys.exit(f"ns3451: codes without a name {empty}")
    for c in codes:
        if len(c) > 1 and c[:-1] not in codes:
            sys.exit(f"ns3451: {c} has no parent {c[:-1]}")
    damaged = [c for c, n in codes.items() if re.search(r"Ã|â€|Â|\(cid:|\s{2,}|\w- [a-zæøå]", n) and "- og" not in n and "- eller" not in n]
    if damaged:
        sys.exit(f"ns3451: damaged names {[(c, codes[c]) for c in damaged]}")

    reserved = sorted((c for c, n in codes.items() if n == RESERVED_NAME), key=lambda c: (len(c), c))
    corrections = [
        {"code": c, "was": earlier[c], "now": codes[c], "page": page_of[c]}
        for c in sorted(NS3451_CORRECTED, key=lambda c: (c[0], c))
    ]
    corrections += [
        {"code": c, "was": None, "now": codes[c], "page": page_of[c]}
        for c in sorted(NS3451_ADDED)
    ]
    return {
        "id": "ns3451",
        "label": "NS 3451",
        "edition": "NS 3451:2022 (tables 2–7)",
        "source": source.as_posix(),
        "sha256": sha256(source),
        "crossChecked": table.as_posix(),
        "corrections": corrections,
        "readFromImage": sorted(NS3451_READ_FROM_IMAGE, key=lambda c: (c[0], c)),
        "unverified": [],
        "codes": dict(sorted(codes.items())),
        "reserved": reserved,
    }


LISTS = [ns3457_8, ns3451]


def module(data: dict) -> str:
    codes = data.pop("codes")
    reserved = data.pop("reserved", None)
    meta = {**data, "generated": date.today().isoformat(), "count": len(codes)}
    if reserved is not None:
        meta["reservedCount"] = len(reserved)
    meta_json = json.dumps(meta, ensure_ascii=False)
    header = f" * {meta['edition']}: {meta['count']} codes"
    if reserved is not None:
        header += f" ({len(reserved)} reserved)"
    lines = [
        "/* GENERATED FILE — do not edit by hand.",
        f" * Source: scripts/gen-codelists.py, {meta['generated']}.",
        f"{header} from {meta['source']}",
        f" * (sha256 {meta['sha256']}).",
        " */",
        "",
        'import type { CodeList } from "./types.ts";',
        "",
        f"export const {data['id'].upper().replace('-', '_')}: CodeList = {{",
        f"  meta: {meta_json},",
        "  codes: {",
    ]
    for code, name in codes.items():
        lines.append(f"    {json.dumps(code, ensure_ascii=False)}: {json.dumps(name, ensure_ascii=False)},")
    lines.append("  },")
    if reserved is not None:
        lines.append(f"  reserved: {json.dumps(reserved, ensure_ascii=False)},")
    lines += ["};", ""]
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
