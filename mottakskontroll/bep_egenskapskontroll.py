"""Per-element check of the BIM-manual's HI90_Prosjektinfo requirements on delivered models.

The file-level modellkontroll (bygg_modellkontroll_xlsx.py) says whether a property set
exists in a file. This one says on how many elements, and whether the values have the form
the manual and the downstream flow need. Every check is a share of counted elements, so a
model is greenlit by numbers, not by a glance.

Rules quoted from BIM- og merkemanual 1.2 (converted copy
../HI90_BEP/02_arbeid/tmp/manual_2026-09-02.md, lines 1006-1070): HI90_Prosjektinfo with
HI90_MMI, HI90_Type, HI90_NS3457-8, HI90_NS3451, HI90_Material, HI90_Kopi objekt.
Quantities and typing are what Reduzer and the QTO need, checked alongside.

    python bep_egenskapskontroll.py --prosjekt krav.yaml --runde runde.json --cache CACHE --ut UT
    python bep_egenskapskontroll.py ... HI90_RIE              # one model
    python bep_egenskapskontroll.py ... --ny                  # ignore the cache

The round -- source folder, models, firma, versjon -- is read from the round config.
Writes <cache>/bep/<dato>/<label>.json per model plus the aggregate <cache>/bep/<dato>/data.json,
then <kode>_BEP-egenskapskontroll_<dato>.xlsx and .md in --ut.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as ue
import openpyxl
import yaml
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HER = Path(__file__).resolve().parent
sys.path.insert(0, str(HER))
import stier  # noqa: E402

# Counted set: every IfcProduct carrying a 3D body representation, whatever its class.
# Only subtractive geometry (IfcOpeningElement and other IfcFeatureElementSubtraction) drops out.
# Spatial elements without geometry drop out by the rule itself, not by a class list.
BODY_ID = {"body", "body-fallback"}
SOLID_TYPE = {"Brep", "AdvancedBrep", "SweptSolid", "CSG", "Clipping", "SurfaceModel",
              "Tessellation", "SolidModel", "AdvancedSweptSolid"}
PSET = "hi90_prosjektinfo"
EGENSKAPER = ["HI90_MMI", "HI90_Type", "HI90_NS3457-8", "HI90_NS3451", "HI90_Material", "HI90_Kopi objekt"]
TRE_SIFRE = re.compile(r"^\d{3}$")
FAG = {"ARK", "RIB", "RIV", "RIE", "RIVA", "RIBR", "LARK", "IARK", "RIAKU", "RIBFY"}

# Bumped whenever a check is added or its rule changes, so a cache written by an older set of
# checks is not a hit -- it would silently blank the new check in the report.
# 3 (2026-09-28): the counted set is ifcfast's `has_body` minus IfcFeatureElementSubtraction.
SJEKK_VERSJON = 3

SJEKKER = [
    ("Type", "IfcRelDefinesByType til et IfcTypeObject med navn"),
    ("Typet", "IfcRelDefinesByType til et IfcTypeObject, med eller uten navn"),
    ("Plassert i etasje", "IfcRelContainedInSpatialStructure til en IfcBuildingStorey"),
    ("HI90_Prosjektinfo", "egenskapssettet finnes på objektet eller typen"),
    ("HI90_MMI", "finnes og er tre sifre"),
    ("HI90_NS3451", "finnes og er tre sifre"),
    ("HI90_Type", "finnes og er lik IfcTypeObject.Name"),
    ("HI90_NS3457-8", "finnes, ikke tom"),
    ("HI90_Material", "finnes, ikke tom"),
    ("HI90_Kopi objekt", "finnes; verdien er en fagkode"),
    ("Mengdesett", "IfcElementQuantity med NetVolume og areal eller lengde"),
    ("Materiale", "IfcRelAssociatesMaterial; lagdelte med tykkelse"),
    ("GUID unik", "ingen GlobalId forekommer to ganger i fila"),
]
FYLL = {"ok": "C6EFCE", "delvis": "FFEB9C", "mangler": "FFC7CE", "tom": "D9D9D9"}
HODE = PatternFill("solid", fgColor="1F3864")
HODE_FONT = Font(bold=True, color="FFFFFF")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def les_runde(cfg: Path, rot: Path, ifc: Path | None = None) -> dict:
    """The round config; each model's file resolved by stier.ifc_sti."""
    stier.finnes(cfg)
    runde = json.loads(cfg.read_text(encoding="utf-8"))
    for m in runde["modeller"]:
        m["sti"] = stier.ifc_sti(m, runde["kilde"], rot, ifc)
    runde["_cfg"] = str(cfg)
    return runde


def _rep_3d(sr, dybde: int = 0) -> bool:
    """True if this IfcShapeRepresentation is a 3D body. MappedRepresentation is resolved
    through Items[i].MappingSource.MappedRepresentation and gets the same test.
    Curve2D / Annotation2D / FootPrint / Axis alone do not count."""
    if sr is None or dybde > 4 or not sr.is_a("IfcShapeRepresentation"):
        return False
    ident = (sr.RepresentationIdentifier or "").strip().lower()
    if ident in BODY_ID:
        return True
    rt = (sr.RepresentationType or "").strip()
    if rt == "MappedRepresentation":
        return any(_rep_3d(i.MappingSource.MappedRepresentation, dybde + 1)
                   for i in (sr.Items or []) if i.is_a("IfcMappedItem"))
    return not ident and rt in SOLID_TYPE


def har_3d(p) -> bool:
    """The denominator rule: the product's shape holds at least one 3D body representation."""
    r = getattr(p, "Representation", None)
    if r is None or not r.is_a("IfcProductRepresentation"):
        return False
    return any(_rep_3d(sr) for sr in (r.Representations or []))


def telte(sti: Path) -> tuple[list[int], dict]:
    """The counted set (2026-09-28, ifcfast #201-#203 resolved): every IfcProduct row in ifcfast's
    products table with `has_body` true, minus IfcFeatureElementSubtraction. Read from the STEP
    representations without meshing. Returns the step ids, ascending, and the reasons the other
    rows were not counted. IfcSite / IfcBuilding / IfcBuildingStorey have no row in that table,
    so a site body is not counted (ifcfast coverage boundary). `har_3d` above is the earlier
    ifcopenshell rule and is no longer the denominator."""
    import ifcfast
    from ifcfast.classify import subtypes_of
    m = ifcfast.open(str(sti))
    df = m.products_df
    sub = df.entity.isin(subtypes_of("IfcFeatureElementSubtraction", m.schema))
    ids = sorted(int(x) for x in df[df.has_body & ~sub].step_id)
    info = {"grunnlag": f"ifcfast {ifcfast.__version__} has_body, uten IfcFeatureElementSubtraction",
            "rader": int(len(df)), "uten_3d": int((~df.has_body).sum()),
            "aapning": int((df.has_body & sub).sum()),
            "rad_ids": set(int(x) for x in df.step_id)}
    return ids, info


def prosjektinfo(psets: dict) -> dict:
    for k, v in psets.items():
        if k.replace(" ", "").lower() == PSET.replace(" ", ""):
            return v
    return {}


def hent(pi: dict, navn: str):
    """Property value, tolerant of spacing/case in the name (HI90_Kopi objekt vs HI90_KopiObjekt)."""
    n = navn.replace(" ", "").lower()
    for k, v in pi.items():
        if k.replace(" ", "").lower() == n:
            return v
    return None


def finnes_nokkel(pi: dict, navn: str) -> bool:
    """The property key is present on the object, whatever its value -- blank included.

    hent() cannot answer this: it returns None both for an absent property and for one that
    is present with no value. Absent is «mangler», present-but-unusable is «avvik», and the
    report has to keep them apart."""
    n = navn.replace(" ", "").lower()
    return any(k.replace(" ", "").lower() == n for k in pi)


def kontroll(label: str, sti: Path) -> dict:
    f = ifcopenshell.open(str(sti))
    h = f.header
    ut: dict = {"label": label, "fil": sti.name, "sha256": sha(sti), "bytes": sti.stat().st_size,
                "schema": f.schema, "mvd": (h.file_description.description or ("",))[0][:80],
                "eksportert": h.file_name.time_stamp, "system": h.file_name.originating_system,
                "klasser": {}, "sjekk": {}, "verdier": {}, "funn": []}
    produkter = f.by_type("IfcProduct")
    ids, info = telte(sti)
    elementer: list = [f.by_id(i) for i in ids]
    n = len(elementer)
    ut["n"] = n
    ut["ikke_telt"] = len(produkter) - n
    ut["ikke_telt_grunn"] = {"uten_3d": info["uten_3d"], "aapning": info["aapning"],
                             "romlig_struktur": len(produkter) - info["rader"]}
    ut["tellegrunnlag"] = info["grunnlag"]
    # Products ifcfast has no row for, beyond the spatial structure it keeps in its own tables.
    # Any class here would be missing from every requirement (the ifcfast #201 failure), so the
    # run stops rather than report a smaller counted set.
    utenfor = collections.Counter(p.is_a() for p in produkter if p.id() not in info["rad_ids"]
                                  and not p.is_a("IfcSite") and not p.is_a("IfcBuilding")
                                  and not p.is_a("IfcBuildingStorey"))
    if utenfor:
        raise SystemExit(f"FEIL: {label}: IfcProduct uten rad i ifcfast: {dict(utenfor)}")
    treff = collections.Counter()
    per_klasse: dict = collections.defaultdict(collections.Counter)
    verdier = {k: collections.Counter() for k in ("HI90_MMI", "HI90_NS3451", "HI90_Kopi objekt")}
    # Alongside sjekk (valid values): does the key exist at all, and is it filled in.
    finnes = collections.Counter()
    utfylt = collections.Counter()
    avvik = {k: collections.Counter() for k in EGENSKAPER}
    psetnavn = collections.Counter()
    guids = collections.Counter(e.GlobalId for e in elementer)
    guid_kopi: dict[str, str] = {}
    par = collections.Counter()  # (IfcTypeObject.Name, HI90_Type) -> elements, for the 1:1 check
    upar = collections.Counter()
    typebruk = collections.Counter()  # IfcTypeObject -> instances, for instances per type
    hierarki = collections.Counter()  # where in the spatial tree the elements hang
    for e in elementer:
        kl = e.is_a()
        per_klasse[kl]["n"] += 1
        psets = ue.get_psets(e) or {}
        for k in psets:
            if "prosjektinfo" in k.lower():
                psetnavn[k] += 1
        t = ue.get_type(e)
        type_name = (t.Name or "").strip() if t is not None else ""
        if t is not None:
            treff["Typet"] += 1
            per_klasse[kl]["Typet"] += 1
            typebruk[t.GlobalId] += 1
        if type_name:
            treff["Type"] += 1
            per_klasse[kl]["Type"] += 1
        plass = i_hierarkiet(e)
        hierarki[plass] += 1
        if plass == "etasje":
            treff["Plassert i etasje"] += 1
            per_klasse[kl]["Plassert i etasje"] += 1
        pi = prosjektinfo(psets)
        if pi:
            treff["HI90_Prosjektinfo"] += 1
            per_klasse[kl]["HI90_Prosjektinfo"] += 1
        hi90_type = ""
        for navn in EGENSKAPER:
            v = hent(pi, navn)
            s = str(v).strip() if v not in (None, "") else ""
            har = finnes_nokkel(pi, navn)
            if har:
                finnes[navn] += 1
                if s:
                    utfylt[navn] += 1
            if navn in verdier:
                verdier[navn][s or "(tom)"] += 1
            # HI90_Type: same string as IfcTypeObject.Name (IfcRoot.Name), not merely non-empty.
            if navn in ("HI90_MMI", "HI90_NS3451"):
                ok = bool(s) and TRE_SIFRE.match(s) is not None
            elif navn == "HI90_Kopi objekt":
                ok = bool(s) and s.upper() in FAG
            elif navn == "HI90_Type":
                hi90_type = s
                ok = bool(s) and bool(type_name) and s == type_name
            else:
                ok = bool(s)
            if ok:
                treff[navn] += 1
                per_klasse[kl][navn] += 1
            elif har and s:
                avvik[navn][s] += 1
        qto = [v for k, v in psets.items() if "Quantities" in k or k.lower().startswith("qto")]
        harvol = any("NetVolume" in q for q in qto) or any("GrossVolume" in q for q in qto)
        harflate = any(any(x in q for x in ("NetSideArea", "NetArea", "GrossSideArea", "GrossArea", "Length", "NetFootprintArea")) for q in qto)
        if harvol and harflate:
            treff["Mengdesett"] += 1
            per_klasse[kl]["Mengdesett"] += 1
        mat = ue.get_material(e)
        if mat is not None:
            treff["Materiale"] += 1
            per_klasse[kl]["Materiale"] += 1
            if mat.is_a("IfcMaterialLayerSetUsage") or mat.is_a("IfcMaterialLayerSet"):
                treff["Materiale_lag"] += 1
        kopi_v = hent(pi, "HI90_Kopi objekt")
        guid_kopi[e.GlobalId] = str(kopi_v).strip() if kopi_v not in (None, "") else ""
        if type_name and hi90_type:
            par[(type_name, hi90_type)] += 1
        elif not type_name and not hi90_type:
            upar["begge"] += 1
        else:
            upar["uten_hi90_type" if type_name else "uten_typenavn"] += 1
    dup = sum(c - 1 for c in guids.values() if c > 1)
    treff["GUID unik"] = n - dup
    ut["klasser"] = {k: dict(v) for k, v in sorted(per_klasse.items(), key=lambda x: -x[1]["n"])}
    ut["sjekk"] = {navn: treff.get(navn, 0) for navn, _ in SJEKKER}
    ut["sjekk"]["Materiale_lag"] = treff.get("Materiale_lag", 0)
    ut["verdier"] = {k: dict(v.most_common(12)) for k, v in verdier.items()}
    ut["finnes"] = {navn: finnes.get(navn, 0) for navn in EGENSKAPER}
    ut["utfylt"] = {navn: utfylt.get(navn, 0) for navn in EGENSKAPER}
    # The single most common value that exists but does not satisfy the rule, so the report can
    # name what is actually in the file instead of showing a bare 0 %.
    ut["vanligste_avvik"] = {navn: (list(c.most_common(1)[0]) if c else None) for navn, c in avvik.items()}
    ut["psetnavn"] = dict(psetnavn)
    ut["dupliserte_guid"] = dup
    ut["guid_kopi"] = guid_kopi
    ut["type_1til1"] = en_til_en(par, upar)
    ut["sjekk_versjon"] = SJEKK_VERSJON
    ut["hierarki"] = dict(hierarki)
    en_instans = sum(1 for c in typebruk.values() if c == 1)
    ut["typebruk"] = {"typer": len(typebruk), "instanser": sum(typebruk.values()),
                      "per_type": round(sum(typebruk.values()) / len(typebruk), 1) if typebruk else None,
                      "en_instans": en_instans,
                      "en_instans_andel": round(100 * en_instans / len(typebruk), 1) if typebruk else None}
    return ut


def en_til_en(par: collections.Counter, upar: collections.Counter, maks: int | None = 12) -> dict:
    """Cardinality between IfcTypeObject.Name and HI90_Type, both directions.

    Aggregating on type only holds when each type name carries exactly one HI90_Type value
    (otherwise: splitt) and each value belongs to exactly one type name (otherwise: samling).
    Only elements that carry both sides can be paired; the rest are counted, never assumed 1:1.
    Grouping is case- and whitespace-insensitive, so «Vegg 200» and «vegg 200» are one name and
    the difference is reported as skrivemåte rather than as two names.
    `maks` caps the listed breaches (data.json keeps 12); None keeps every one, for the workbook.
    """
    def retning(fra: int, til: int) -> tuple[list, int, int]:
        kart: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        vist: dict[str, str] = {}
        for (a, b), antall in par.items():
            k = (a, b)[fra].strip().lower()
            vist.setdefault(k, (a, b)[fra])
            kart[k][(a, b)[til]] += antall
        brudd, skrivemate = [], 0
        for k, c in kart.items():
            if len(c) == 1:
                continue
            if len({x.strip().lower() for x in c}) == 1:
                skrivemate += 1
            brudd.append({"nokkel": vist[k], "motparter": dict(c.most_common()),
                          "objekter": sum(c.values()),
                          "kun_skrivemate": len({x.strip().lower() for x in c}) == 1})
        brudd.sort(key=lambda b: -b["objekter"])
        return brudd, len(kart), skrivemate

    splitt, typenavn, splitt_skrivemate = retning(0, 1)
    samling, verdier, samling_skrivemate = retning(1, 0)
    rene = typenavn - len(splitt)
    return {"parret": sum(par.values()), "typenavn": typenavn, "verdier": verdier,
            "splitt": splitt[:maks], "samling": samling[:maks],
            "splitt_n": len(splitt), "samling_n": len(samling),
            "splitt_skrivemate": splitt_skrivemate, "samling_skrivemate": samling_skrivemate,
            "rene_typenavn": rene, "uten_hi90_type": upar["uten_hi90_type"],
            "uten_typenavn": upar["uten_typenavn"], "mangler_begge": upar["begge"]}


def i_hierarkiet(e) -> str:
    """Where the element hangs in the spatial tree: etasje, bygg, tomt, rom or ingen.

    get_container climbs aggregation, so a part of an assembly inherits its parent's container.
    An IfcSpace is resolved to the storey it belongs to; a space is a place, not a level.
    «bygg» and «tomt» are the fork: the element is in the model's tree, but not on a storey.
    """
    c = ue.get_container(e)
    if c is None:
        return "ingen"
    if c.is_a("IfcSpace"):
        opp = ue.get_aggregate(c)
        return "etasje" if opp is not None and opp.is_a("IfcBuildingStorey") else "rom"
    if c.is_a("IfcBuildingStorey"):
        return "etasje"
    if c.is_a("IfcBuilding"):
        return "bygg"
    if c.is_a("IfcSite"):
        return "tomt"
    return "annet"


def andel(r: dict, navn: str) -> float:
    return (r["sjekk"].get(navn, 0) / r["n"]) if r["n"] else 0.0


def status(a: float) -> str:
    return "ok" if a >= 0.999 else "delvis" if a > 0 else "mangler"


def skriv(resultater: list, dato: str, ut: Path, kode: str) -> None:
    ut.mkdir(parents=True, exist_ok=True)
    xlsx = ut / f"{kode}_BEP-egenskapskontroll_{dato}.xlsx"
    md = ut / f"{kode}_BEP-egenskapskontroll_{dato}.md"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sammendrag"
    hdr = ["Modell", "Fag", "Versjon", "Elementer telt"] + [s for s, _ in SJEKKER]
    ws.append(hdr)
    for c in ws[1]:
        c.fill, c.font, c.alignment = HODE, HODE_FONT, Alignment(wrap_text=True, vertical="center")
    for r in resultater:
        fag, ver = r["firma"], r["versjon"]
        row = [r["label"], fag, ver, r["n"]] + [round(andel(r, s) * 100, 1) for s, _ in SJEKKER]
        ws.append(row)
        for i, (s, _) in enumerate(SJEKKER, start=5):
            cell = ws.cell(row=ws.max_row, column=i)
            cell.fill = PatternFill("solid", fgColor=FYLL[status(andel(r, s))])
            cell.number_format = "0.0"
    ws.append([])
    ws.append(["Tall er prosent av telte objekter (IfcProduct med 3D-geometri, uten åpninger). Grønn = 100 %, gul = delvis, rød = 0."])
    ws.append(["Krav", *[f"{s}: {k}" for s, k in SJEKKER]])
    ws.freeze_panes = "E2"
    for i in range(1, len(hdr) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 16
    ws.column_dimensions["A"].width = 20
    # per model: per class
    for r in resultater:
        w2 = wb.create_sheet(r["label"][:28])
        hdr2 = ["IFC-klasse", "n"] + [s for s, _ in SJEKKER if s != "GUID unik"]
        w2.append(hdr2)
        for c in w2[1]:
            c.fill, c.font = HODE, HODE_FONT
        for kl, d in r["klasser"].items():
            w2.append([kl, d["n"]] + [round(100 * d.get(s, 0) / d["n"], 1) for s in hdr2[2:]])
            for i, s in enumerate(hdr2[2:], start=3):
                a = d.get(s, 0) / d["n"]
                w2.cell(row=w2.max_row, column=i).fill = PatternFill("solid", fgColor=FYLL[status(a)])
        w2.append([])
        w2.append(["Verdier"])
        for navn, vals in r["verdier"].items():
            w2.append([navn] + [f"{k}: {v}" for k, v in vals.items()])
        w2.append(["Pset-navn funnet"] + [f"{k}: {v}" for k, v in r["psetnavn"].items()])
        k1 = r.get("type_1til1") or {}
        w2.append([])
        w2.append(["Type 1:1", f"typenavn {k1.get('typenavn', 0)}", f"HI90_Type {k1.get('verdier', 0)}",
                   f"splitt {k1.get('splitt_n', 0)}", f"samling {k1.get('samling_n', 0)}",
                   f"parret {k1.get('parret', 0)}", f"uten HI90_Type {k1.get('uten_hi90_type', 0)}",
                   f"uten typenavn {k1.get('uten_typenavn', 0)}"])
        for retning, nokkel in (("ett typenavn, flere verdier", "splitt"),
                                ("én verdi, flere typenavn", "samling")):
            for b in k1.get(nokkel, []):
                w2.append([retning, b["nokkel"], b["objekter"],
                           " | ".join(f"{v} ×{n}" for v, n in b["motparter"].items())])
        w2.append(["Fil", r["fil"], "sha256", r["sha256"], "schema", r["schema"], "eksportert", r["eksportert"], r["system"]])
        w2.freeze_panes = "C2"
        w2.auto_filter.ref = f"A1:{get_column_letter(len(hdr2))}{len(r['klasser']) + 1}"
        for i in range(1, len(hdr2) + 1):
            w2.column_dimensions[get_column_letter(i)].width = 15
        w2.column_dimensions["A"].width = 26
    wb.save(xlsx)

    L = [f"# BEP-egenskapskontroll {dato}", "",
         "Telte objekter: alle IfcProduct med 3D-geometri, uten åpninger. Prosent = andel av telte objekter som oppfyller kravet.", "",
         "| Krav | " + " | ".join(r["label"].replace("HI90_", "") for r in resultater) + " |",
         "|---|" + "--:|" * len(resultater)]
    for s, _ in SJEKKER:
        L.append(f"| {s} | " + " | ".join(f"{andel(r, s) * 100:.0f} %" for r in resultater) + " |")
    L.append("| Elementer telt | " + " | ".join(str(r["n"]) for r in resultater) + " |")
    L += ["", "## Verdier", ""]
    for r in resultater:
        for navn in ("HI90_MMI", "HI90_NS3451", "HI90_Kopi objekt"):
            v = r["verdier"].get(navn, {})
            L.append(f"- {r['label']} {navn}: " + ", ".join(f"{k} ×{n}" for k, n in v.items()))
    L += ["", "## Type 1:1", "",
          "Ett IfcTypeObject.Name skal bære én HI90_Type-verdi, og én verdi skal høre til ett typenavn.", "",
          "| Modell | Typenavn | HI90_Type-verdier | Ett navn, flere verdier | Én verdi, flere navn | Parret | Uten HI90_Type |",
          "|---|--:|--:|--:|--:|--:|--:|"]
    for r in resultater:
        k = r.get("type_1til1") or {}
        L.append(f"| {r['label']} | {k.get('typenavn', 0)} | {k.get('verdier', 0)} | "
                 f"{k.get('splitt_n', 0)} | {k.get('samling_n', 0)} | {k.get('parret', 0)} | "
                 f"{k.get('uten_hi90_type', 0)} |")
    L.append("")
    for r in resultater:
        k = r.get("type_1til1") or {}
        for retning, nokkel in (("flere verdier", "splitt"), ("flere typenavn", "samling")):
            for b in k.get(nokkel, [])[:5]:
                mot = list(b["motparter"].items())
                tekst = ", ".join(f"{v} ×{n}" for v, n in mot[:8])
                if len(mot) > 8:
                    tekst += f" … (+{len(mot) - 8}, se regnearket)"
                L.append(f"- {r['label']} {retning}: {b['nokkel']} → {tekst}")
    L += ["", "## Filer", "", "| Modell | Fil | sha256 | Schema | Eksportert | System |", "|---|---|---|---|---|---|"]
    for r in resultater:
        L.append(f"| {r['label']} | {r['fil']} | {r['sha256']} | {r['schema']} | {r['eksportert']} | {r['system'][:50]} |")
    md.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(xlsx)
    print(md)


def kjør(prosjekt: Path, runde_sti: Path, cache: Path, ut: Path, ifc: Path | None = None,
         valgte: list[str] | None = None, ny: bool = False) -> int:
    kode = yaml.safe_load(prosjekt.read_text(encoding="utf-8"))["prosjekt"]["kode"]
    runde = les_runde(runde_sti, prosjekt.resolve().parent, ifc)
    dato = runde["dato"]
    tmp = cache / "bep" / dato
    tmp.mkdir(parents=True, exist_ok=True)
    valgte = valgte or []
    modeller = [m for m in runde["modeller"] if not valgte or m["label"] in valgte]
    ukjent = set(valgte) - {m["label"] for m in runde["modeller"]}
    if ukjent:
        raise SystemExit(f"ukjent modell i runde {dato}: {', '.join(sorted(ukjent))}")
    print(f"runde {dato} ({runde['_cfg']}), {len(modeller)} modeller")
    resultater = []
    for m in modeller:
        label, sti = m["label"], m["sti"]
        cachefil = tmp / f"{label}.json"
        if cachefil.exists() and not ny:
            r = json.loads(cachefil.read_text(encoding="utf-8"))
            if r.get("sha256") == sha(sti) and r.get("sjekk_versjon") == SJEKK_VERSJON:
                r["firma"], r["versjon"], r["lastet_opp"] = m["firma"], m["versjon"], m["lastet_opp"]
                resultater.append(r)
                print(f"{label}: fra cache")
                continue
        print(f"{label}: leser {sti.name} ({sti.stat().st_size / 1e6:.1f} MB)")
        r = kontroll(label, sti)
        if r["sha256"] != m["sha16"]:
            print(f"   NB: sha256[:16] {r['sha256']} != konfig {m['sha16']}")
        r["firma"], r["versjon"], r["lastet_opp"] = m["firma"], m["versjon"], m["lastet_opp"]
        cachefil.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        resultater.append(r)
        print("   " + ", ".join(f"{s} {andel(r, s) * 100:.0f}%" for s, _ in SJEKKER))
    (tmp / "data.json").write_text(json.dumps(resultater, ensure_ascii=False, indent=1), encoding="utf-8")
    print(tmp / "data.json")
    skriv(resultater, dato, ut, kode)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    stier.argumenter(ap)
    ap.add_argument("--ifc", type=Path, metavar="DIR", help="IFC folder of the round (replaces the round's `kilde`)")
    ap.add_argument("--ny", action="store_true", help="ignore the cache")
    ap.add_argument("modeller", nargs="*")
    a = ap.parse_args()
    return kjør(a.prosjekt, a.runde, a.cache, a.ut, a.ifc, a.modeller, a.ny)


if __name__ == "__main__":
    raise SystemExit(main())
