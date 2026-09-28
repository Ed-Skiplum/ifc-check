"""Per-object measurement of the ten blocks (docs/begreper.md) for one mottakskontroll round.

    python blokkdata.py --prosjekt krav.yaml --runde runde.json --cache CACHE [--ifc DIR]  # cached per file sha
    python blokkdata.py ... --ny                                                            # ignore the cache

Every rule, location and table this reads is declared in the merged configuration (konfig.py:
standard/standard.yaml with the project config on top) or in the two mengdetype tables; this module holds the procedures only, and no discipline name.
The counted set is bep_egenskapskontroll's `telte()`: ifcfast's `has_body`, minus
IfcFeatureElementSubtraction, so `n` here and `n` in <cache>/bep/<dato>/data.json are one number, and
the builder refuses to run when they differ. ifcopenshell reads properties, materials,
classifications and containment only; no geometry is processed here.

Output: <cache>/blokker/<dato>/<prosjekt|standard>/<label>.json, one per model. Per block: the objects in each bucket
(oppfylt / avvik / mangler / gjelder_ikke), the source that supplied the value (the cascade split),
and the value distribution. Plus the type register (types by name + IFC class, begreper §1), the
per-class counts, the storeys, and the full Type 1:1 breach lists.

Nothing is filled in to make a number look complete: an object whose value is not found in any
source of its cascade is «mangler», and a value that is there but not usable is «avvik».
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as ue
import ifcopenshell.util.unit as uu
import yaml

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HER = Path(__file__).resolve().parent
sys.path.insert(0, str(HER))
import bep_egenskapskontroll as B  # noqa: E402
import konfig  # noqa: E402
import stier  # noqa: E402

# Bumped when a procedure here changes, so an older cache is not a hit.
# 6 (2026-09-28): one location per requirement (`sted`), ifcfast counted set, material gallery,
# code tallies and per-element findings.
BLOKK_VERSJON = 6

# Distinct values kept per property for the pset gallery's examples; beyond it only counts grow.
PSET_MAKS_VERDIER = 200

QTY_FOR_ENHET = {"m": ("IfcQuantityLength",), "m2": ("IfcQuantityArea",),
                 "m3": ("IfcQuantityVolume",), "kg": ("IfcQuantityWeight",)}
QTY_ALLE = ("IfcQuantityLength", "IfcQuantityArea", "IfcQuantityVolume", "IfcQuantityWeight")


def norm(s: str) -> str:
    return str(s).replace(" ", "").lower()


def tekst(v) -> str:
    return "" if v is None else str(v).strip()


# ---------------------------------------------------------------- register
def kildeetikett(spec: dict) -> str:
    """How a cascade source is named in data and print: pset.egenskap as declared in krav.yaml.
    A regex source is printed as its pattern without anchors, a wildcard or an open end as *."""
    def monster(m: str) -> str:
        s = m.replace(" ?", " ").replace("\\w*", "*").replace(".*", "*")
        s = s[1:] if s.startswith("^") else s
        return s[:-1] if s.endswith("$") else s + "*"
    if "pset" in spec or "pset_monster" in spec:
        ps = spec["pset"] if "pset" in spec else monster(spec["pset_monster"])
        eg = spec["egenskap"] if "egenskap" in spec else monster(spec["egenskap_monster"])
        return f"{ps}.{eg}"
    return spec["navn"]


class Oppslag:
    """One source in a block's lookup cascade, compiled from krav.yaml."""

    def __init__(self, spec: dict, gren: str = ""):
        self.spec = spec
        self.navn: str = (f"{gren}|" if gren else "") + kildeetikett(spec)
        self.nivaa: str = spec.get("nivaa", "")
        self.system_re = re.compile(spec["system_monster"], re.I) if "system_monster" in spec else None
        self.ifc: str | None = spec.get("ifc")
        self.pset = norm(spec["pset"]) if "pset" in spec else None
        self.egenskap = norm(spec["egenskap"]) if "egenskap" in spec else None
        self.pset_re = re.compile(spec["pset_monster"], re.I) if "pset_monster" in spec else None
        self.egenskap_re = re.compile(spec["egenskap_monster"], re.I) if "egenskap_monster" in spec else None
        self.lag_re = re.compile(spec["lag"]) if "lag" in spec else None

    def er_egenskap(self) -> bool:
        return bool(self.pset or self.pset_re)

    def verdi(self, e, psets: dict, f=None) -> str:
        """The value this source gives for the object: a property, a classification reference
        or a presentation layer."""
        if self.system_re is not None:
            for system, v in klassifikasjoner(e):
                if v and self.system_re.search(system):
                    return v
            return ""
        if self.lag_re is not None:
            for la in ue.get_layers(f, e) or []:
                mm = self.lag_re.search(la.Name or "")
                if mm:
                    return mm.group(1)
            return ""
        return self.les(psets)[1]

    def les(self, psets: dict) -> tuple[bool, str]:
        """(key present, value). Present-but-empty is (True, '')."""
        for pnavn, props in psets.items():
            if self.pset is not None and norm(pnavn) != self.pset:
                continue
            if self.pset_re is not None and not self.pset_re.search(pnavn):
                continue
            for k, v in props.items():
                if k == "id":
                    continue
                if self.egenskap is not None and norm(k) != self.egenskap:
                    continue
                if self.egenskap_re is not None and not self.egenskap_re.search(k.strip()):
                    continue
                return True, tekst(v)
        return False, ""


def klassifikasjoner(e) -> list[tuple[str, str]]:
    """(classification system, value) of every IfcClassificationReference on the object or its
    type, through IfcRelAssociatesClassification. The value is Identification (IFC4) or
    ItemReference (IFC2X3); the system is the Name of each ReferencedSource up to the
    IfcClassification."""
    ut = []
    kilder = [e]
    t = ue.get_type(e)
    if t is not None:
        kilder.append(t)
    for o in kilder:
        for rel in getattr(o, "HasAssociations", None) or []:
            if not rel.is_a("IfcRelAssociatesClassification"):
                continue
            c = rel.RelatingClassification
            if c is None or not c.is_a("IfcClassificationReference"):
                continue
            verdi = getattr(c, "Identification", None) if hasattr(c, "Identification") else None
            verdi = verdi or getattr(c, "ItemReference", None) or ""
            navn, src, dybde = [], getattr(c, "ReferencedSource", None), 0
            while src is not None and dybde < 8:
                if getattr(src, "Name", None):
                    navn.append(src.Name)
                if src.is_a("IfcClassification"):
                    break
                src, dybde = getattr(src, "ReferencedSource", None), dybde + 1
            ut.append((" ".join(navn), str(verdi).strip()))
    return ut


def les_register(prosjekt: Path, kun_standard: bool = False) -> dict:
    """The merged configuration (konfig.py), one location per requirement: each block's `sted`
    compiled to one Oppslag. Produkt and Materiale are measured together as `materialprodukt`,
    switched by mengdetype, each branch at its own requirement's one location."""
    y = konfig.last(prosjekt, kun_standard)
    per_id = {b["id"]: b for b in y["blokker"]}
    blokker = {}
    for b in y["blokker"]:
        if b["id"] in ("produkt", "materiale"):
            continue
        blokker[b["id"]] = {**b, "_sted": Oppslag(b["sted"]) if b.get("sted") else None}
    p, m = per_id["produkt"], per_id["materiale"]
    if (p.get("mengdetype") or []) != (m.get("mengdetype") or []):
        raise SystemExit("FEIL: Produkt og Materiale har ulik mengdetype-analyse i konfigurasjonen")
    blokker["materialprodukt"] = {
        "id": "materialprodukt", "ikke_konfigurert": p["ikke_konfigurert"] and m["ikke_konfigurert"],
        "_telle": Oppslag(p["sted"], "telleobjekt") if p.get("sted") else None,
        "_mengde": Oppslag(m["sted"], "mengdeobjekt") if m.get("sted") else None,
        "_mengdetype": [Oppslag(s, "mengdetype") for s in p.get("mengdetype") or []],
        "ikke_materiale": m.get("ikke_materiale") or [],
        "aapne": (p.get("aapne") or []) + (m.get("aapne") or [])}
    return {"y": y, "blokker": blokker, "kun_standard": kun_standard}


def tabell(navn: str, nokkel: str, rot: Path | None) -> dict:
    """A code table as named in the config (stier.tabell_sti), keyed by `nokkel`."""
    rader = yaml.safe_load(stier.tabell_sti(navn, rot).read_text(encoding="utf-8"))
    return {str(r[nokkel]): r for r in rader}


def registerhash(reg: dict) -> str:
    """The cache key covers everything the procedures read besides the IFC file."""
    h = hashlib.sha256()
    h.update(json.dumps(reg["y"]["blokker"], ensure_ascii=False, sort_keys=True).encode())
    for k in ("mmi", "fase", "typenavn"):
        h.update(json.dumps(reg["y"]["forventet"].get(k), ensure_ascii=False, sort_keys=True).encode())
    h.update(json.dumps(konfig.prosjektpsett(reg["y"]), ensure_ascii=False, sort_keys=True).encode())
    rot = reg["y"]["_rot"]
    for b in reg["y"]["blokker"]:
        for s in b.get("mengdetype") or []:
            if s.get("tabell"):
                h.update(stier.tabell_sti(s["tabell"], rot).read_bytes())
        if b.get("kodetabell"):
            h.update(stier.tabell_sti(b["kodetabell"], rot).read_bytes())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- per-object readers
def materialer(e, skala_mm: float = 1.0) -> tuple[str, str, list[str], dict[str, list[float]]]:
    """(kind, entity, names, layer thicknesses per name in mm) of the associated material.

    kind: «materiallag» when the association is a layer set with at least one layer thicker than
    zero, «material» for any other material entity, «» when nothing is associated. entity: the
    material definition as associated, a usage resolved to its set (IfcMaterialLayerSet,
    IfcMaterialProfileSet, IfcMaterialConstituentSet, IfcMaterialList, IfcMaterial)."""
    m = ue.get_material(e)
    if m is None:
        return "", "", [], {}
    navn: list[str] = []
    lag: dict[str, list[float]] = {}

    def legg(mat) -> None:
        if mat is not None and getattr(mat, "Name", None):
            n = mat.Name.strip()
            if n and n not in navn:
                navn.append(n)

    if m.is_a("IfcMaterialLayerSetUsage"):
        m = m.ForLayerSet
    if m.is_a("IfcMaterialProfileSetUsage"):
        m = m.ForProfileSet
    entitet = m.is_a()
    if m.is_a("IfcMaterialLayerSet"):
        lagliste = [l for l in (m.MaterialLayers or [])]
        for l in lagliste:
            legg(l.Material)
            if l.Material is not None and getattr(l.Material, "Name", None) and l.LayerThickness:
                lag.setdefault(l.Material.Name.strip(), []).append(round(float(l.LayerThickness) * skala_mm, 1))
        tykk = any((l.LayerThickness or 0) > 0 for l in lagliste)
        return ("materiallag" if tykk else "material"), entitet, navn, lag
    if m.is_a("IfcMaterialProfileSet"):
        for pr in m.MaterialProfiles or []:
            legg(pr.Material)
    elif m.is_a("IfcMaterialConstituentSet"):
        for c in m.MaterialConstituents or []:
            legg(c.Material)
    elif m.is_a("IfcMaterialList"):
        for x in m.Materials or []:
            legg(x)
    elif m.is_a("IfcMaterial"):
        legg(m)
    return "material", entitet, navn, lag


def etasje(e):
    """The storey an object is placed on, by the same climb as B.i_hierarkiet."""
    c = ue.get_container(e)
    if c is None:
        return None
    if c.is_a("IfcSpace"):
        opp = ue.get_aggregate(c)
        return opp if opp is not None and opp.is_a("IfcBuildingStorey") else None
    return c if c.is_a("IfcBuildingStorey") else None


class Blokk:
    """Buckets, location split and distribution for one requirement in one model. One location
    per requirement: `kildenavn` holds the location label (two for materialprodukt, one per
    branch)."""

    def __init__(self, kildenavn: list[str], ikke_konfigurert: bool = False):
        self.ikke_konfigurert = ikke_konfigurert
        self.bøtter = collections.Counter()           # oppfylt / avvik / mangler / gjelder_ikke
        self.kilder = collections.Counter()           # location label -> oppfylt objects
        self.kilder_alle = collections.Counter()      # location label -> objects that carry it
        self.verdier = collections.Counter()          # value -> objects
        self.verdi_status = {}                        # value -> oppfylt | avvik
        self.verdi_typer: dict[str, set] = {}         # value -> types (name + class) carrying it
        self.gren_verdier: dict[str, collections.Counter] = {}
        self.ekstra = collections.Counter()           # a block's additional reading
        self.kildenavn = kildenavn

    def sett(self, botte: str, kilde: str | None = None, verdier=(), typenokkel=None, gren: str = "") -> None:
        if self.ikke_konfigurert:
            return
        self.bøtter[botte] += 1
        if kilde:
            self.kilder_alle[kilde] += 1
            if botte == "oppfylt":
                self.kilder[kilde] += 1
        for v in verdier:
            self.verdier[v] += 1
            if gren:
                self.gren_verdier.setdefault(gren, collections.Counter())[v] += 1
            if typenokkel is not None:
                self.verdi_typer.setdefault(v, set()).add(typenokkel)
            else:
                self.verdi_typer.setdefault(v, set())
            if botte in ("oppfylt", "avvik"):
                if self.verdi_status.get(v) != "oppfylt":
                    self.verdi_status[v] = botte

    def ut(self) -> dict:
        return {"botter": dict(self.bøtter), "kilder": dict(self.kilder),
                "kilder_alle": dict(self.kilder_alle), "kildenavn": self.kildenavn,
                "ekstra": dict(self.ekstra), "ikke_konfigurert": self.ikke_konfigurert,
                "verdier": [[v, n, self.verdi_status.get(v, "")] for v, n in self.verdier.most_common()],
                "verdier_gren": {g: [[v, n, self.verdi_status.get(v, "")] for v, n in c.most_common()]
                                 for g, c in self.gren_verdier.items()},
                "typer_per_verdi": {v: len(t) for v, t in self.verdi_typer.items()}}


# ---------------------------------------------------------------- one model
def mål(label: str, sti: Path, reg: dict) -> dict:
    y = reg["y"]
    bl = reg["blokker"]
    rot = y["_rot"]
    mp = bl["materialprodukt"]
    # The mengdetype tables are the ones the Produkt/Materiale config names, per analysis step.
    mt_tab = {o.ifc: o.spec.get("tabell") for o in mp["_mengdetype"]}
    klasse_tab = tabell(mt_tab["ifcklasse"], "klasse", rot) if mt_tab.get("ifcklasse") else {}
    kode_tab = tabell(mt_tab["komponentkode"], "kode", rot) if mt_tab.get("komponentkode") else {}
    funk_tab = bl["funksjonskode"].get("kodetabell")
    kodetabell_3457 = {str(k).strip().upper() for k in tabell(funk_tab, "kode", rot)} if funk_tab else set()
    ps = konfig.prosjektpsett(y)
    type_egenskap = konfig.psett_egenskap(ps, "lik_typenavn")
    sk = bl["systemkode"]
    gyldig_3451 = re.compile(sk["gyldig"]) if sk.get("gyldig") else None
    ikke_mat = [re.compile(p, re.I) for p in mp["ikke_materiale"]]
    fase_via_mmi = bool(bl["fase"].get("mmi_fase"))
    fase_gyldig = {str(x).casefold() for x in bl["fase"].get("gyldige") or []}
    mmi_koder = {str(x) for x in ((y["forventet"].get("mmi") or {}).get("koder") or [])}
    mmi_fase = {str(k): v for k, v in (bl["fase"].get("mmi_fase") or {}).items()}

    f = ifcopenshell.open(str(sti))
    skala_mm = uu.calculate_unit_scale(f) * 1000.0
    ids, info = B.telte(sti)
    elementer = [f.by_id(i) for i in ids]
    n = len(elementer)

    def navn_(b_: dict) -> str:
        return b_["_sted"].navn if b_.get("_sted") else ""

    b = {bid: Blokk([navn_(v)] if v.get("_sted") else [], v["ikke_konfigurert"])
         for bid, v in bl.items() if bid != "materialprodukt"}
    b["materialprodukt"] = Blokk([o.navn for o in (mp["_telle"], mp["_mengde"]) if o], mp["ikke_konfigurert"])
    per_klasse: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    typer: dict[tuple[str, str], dict] = {}
    etasjetall = collections.Counter()
    etasjenavn: dict[str, dict] = {}
    hierarki = collections.Counter()
    par = collections.Counter()
    upar = collections.Counter()
    mengde_klasse = collections.Counter()   # (klasse, mengdetype, ledeenhet) -> objects
    aapne_klasser = {k for a in mp.get("aapne", []) for k in a["klasser"]}
    # Per-element findings for the avviksliste: block -> [guid, value, reason]; reason is
    # mangler | tom | ugyldig | ikke_i_etasje. `objekter` names every GlobalId listed.
    funn: dict[str, list] = collections.defaultdict(list)
    objekter: dict[str, list] = {}
    mat_galleri: dict[str, dict] = {}

    def husk(e, typenavn: str, st) -> None:
        if e.GlobalId not in objekter:
            objekter[e.GlobalId] = [e.is_a(), (getattr(e, "Name", None) or "").strip(), typenavn,
                                    (st.Name or "").strip() if st is not None else ""]

    # 1 typeobjekt: over every IfcProduct in the file, not only the counted set
    alle = f.by_type("IfcProduct")
    typer_alle = collections.Counter()
    utypet_klasse = collections.Counter()
    # Every property and quantity set on every IfcProduct, own or through its type, unfiltered.
    pset_tall: dict[str, collections.Counter] = {}
    pset_klasser: dict[str, collections.Counter] = {}
    egenskap_fylt: dict[str, collections.Counter] = {}
    egenskap_verdier: dict[tuple[str, str], collections.Counter] = {}
    psets_for: dict[int, dict] = {}
    telte_id = set(ids)
    for pr in alle:
        ps_ = ue.get_psets(pr) or {}
        if pr.id() in telte_id:
            psets_for[pr.id()] = ps_
        for pnavn, props in ps_.items():
            pset_tall.setdefault(pnavn, collections.Counter())["n"] += 1
            pset_klasser.setdefault(pnavn, collections.Counter())[pr.is_a()] += 1
            fylt = egenskap_fylt.setdefault(pnavn, collections.Counter())
            for k, verdi in props.items():
                if k == "id":
                    continue
                t_ = tekst(verdi)
                fylt[k] += 0
                if t_:
                    fylt[k] += 1
                    c_ = egenskap_verdier.setdefault((pnavn, k), collections.Counter())
                    if t_ in c_ or len(c_) < PSET_MAKS_VERDIER:
                        c_[t_[:60]] += 1

    tb = b["typeobjekt"]
    for pr in alle:
        tt = ue.get_type(pr)
        if tt is None:
            tb.sett("mangler")
            utypet_klasse[pr.is_a()] += 1
            if tb.kildenavn:
                funn["typeobjekt"].append([pr.GlobalId, "", "mangler"])
                husk(pr, "", None)
            continue
        tn_ = (tt.Name or "").strip()
        typer_alle[(tt.is_a(), tn_)] += 1
        tb.sett("oppfylt" if tn_ else "avvik", tb.kildenavn[0] if tb.kildenavn else None)
        if not tn_ and tb.kildenavn:
            funn["typeobjekt"].append([pr.GlobalId, tt.is_a(), "tom"])
            husk(pr, "", None)

    # The project's declared type-naming rule (forventet.typenavn), stricter from a given MMI.
    tn = y["forventet"].get("typenavn")
    tn_regler = sorted(((int(r["mmi"]), re.compile(r["monster"])) for r in (tn or {}).get("fra_mmi", [])),
                       reverse=True)
    tn_standard = re.compile(tn["monster"]) if tn else None

    def navneregel(mmi: str):
        if mmi.isdigit():
            for fra, rx in tn_regler:
                if int(mmi) >= fra:
                    return rx
        return tn_standard

    def brukbar(v: str) -> bool:
        return bool(v) and not any(r.search(v) for r in ikke_mat)

    for e in elementer:
        kl = e.is_a()
        per_klasse[kl]["n"] += 1
        psets = psets_for[e.id()]
        t = ue.get_type(e)
        typenavn = (t.Name or "").strip() if t is not None else ""
        tk = (t.is_a(), typenavn) if t is not None else None
        rad: dict[str, str] = {}
        st = etasje(e)
        gid = e.GlobalId

        if typenavn:
            per_klasse[kl]["typeobjekt"] += 1

        # 2 systemkode, at its one location: valid, carried but invalid (avvik), or absent/empty
        o = sk.get("_sted")
        if o is not None:
            v = o.verdi(e, psets, f)
            if v and (gyldig_3451 is None or gyldig_3451.match(v)):
                b["systemkode"].sett("oppfylt", o.navn, [v], tk)
                per_klasse[kl]["systemkode"] += 1
                rad["systemkode"] = v
            elif v:
                b["systemkode"].sett("avvik", o.navn, [v], tk)
                rad["systemkode"] = v
                funn["systemkode"].append([gid, v, "ugyldig"])
                husk(e, typenavn, st)
            else:
                b["systemkode"].sett("mangler")
                funn["systemkode"].append([gid, "", "mangler"])
                husk(e, typenavn, st)

        # 3 funksjonskode: present and not empty; validity against the code table is read by
        # the report from the distribution
        funk = None
        o = bl["funksjonskode"].get("_sted")
        if o is not None:
            v = o.verdi(e, psets, f)
            if v:
                funk = (o.navn, v)
                b["funksjonskode"].sett("oppfylt", o.navn, [v], tk)
                per_klasse[kl]["funksjonskode"] += 1
                rad["funksjonskode"] = v
                if funk_tab and v.strip().upper() not in kodetabell_3457:
                    funn["funksjonskode"].append([gid, v, "ugyldig"])
                    husk(e, typenavn, st)
            else:
                b["funksjonskode"].sett("mangler")
                funn["funksjonskode"].append([gid, "", "mangler"])
                husk(e, typenavn, st)

        # 6 Materiale / Produkt, switched by mengdetype (the analysis, not a requirement)
        mt = enhet = mt_kilde = None
        klasse_rad = klasse_tab.get(kl)
        for o in mp["_mengdetype"]:
            if o.ifc == "ifcklasse":
                if klasse_rad and klasse_rad["mengdetype"] in ("telleobjekt", "mengdeobjekt", "ikke_relevant"):
                    mt, enhet, mt_kilde = klasse_rad["mengdetype"], klasse_rad.get("ledeenhet"), o.navn
                    break
            elif o.ifc == "komponentkode" and funk:
                kode = funk[1].strip().upper()
                treff = None
                for lengde in (len(kode), 3, 2):
                    treff = kode_tab.get(kode[:lengde])
                    if treff:
                        break
                if treff and treff["mengdetype"] in ("telleobjekt", "mengdeobjekt", "ikke_relevant"):
                    mt, enhet, mt_kilde = treff["mengdetype"], treff.get("ledeenhet"), o.navn
                    break
        if mt is None:
            mt = klasse_rad["mengdetype"] if klasse_rad else "ukjent"
        if mt_kilde:
            b["materialprodukt"].ekstra[mt_kilde] += 1
        mengde_klasse[(kl, mt, enhet or "")] += 1
        rad["mengdetype"] = mt + (f" · {enhet}" if enhet else "")

        kind, entitet, matnavn, lag = materialer(e, skala_mm)
        for nv in matnavn:
            g_ = mat_galleri.setdefault(nv, {"navn": nv, "objekter": 0, "klasser": collections.Counter(),
                                             "typer": set(), "kilde": collections.Counter(), "lag_mm": set()})
            g_["objekter"] += 1
            g_["klasser"][kl] += 1
            if tk is not None:
                g_["typer"].add(tk)
            g_["kilde"][entitet] += 1
            g_["lag_mm"].update(lag.get(nv, []))

        mpb = b["materialprodukt"]
        if mt == "ikke_relevant":
            mpb.sett("gjelder_ikke")
        elif mt == "telleobjekt" and mp["_telle"] is not None:
            o = mp["_telle"]
            vv = o.verdi(e, psets, f)
            if vv:
                mpb.sett("oppfylt", o.navn, [vv], tk, "telleobjekt")
                per_klasse[kl]["materialprodukt"] += 1
                rad["produkt"] = vv
            else:
                mpb.sett("mangler")
                funn["produkt"].append([gid, "", "mangler"])
                husk(e, typenavn, st)
        elif mt == "mengdeobjekt" and mp["_mengde"] is not None:
            o = mp["_mengde"]
            if o.ifc == "materialtilknytning":
                verdier = matnavn
            else:
                vv = o.verdi(e, psets, f)
                verdier = [vv] if vv else []
            bra = [x for x in verdier if brukbar(x)]
            if bra:
                mpb.sett("oppfylt", o.navn, bra, tk, "mengdeobjekt")
                per_klasse[kl]["materialprodukt"] += 1
                rad["materiale"] = " + ".join(bra)
            elif verdier:
                mpb.sett("avvik", o.navn, verdier, tk, "mengdeobjekt")
                rad["materiale"] = " + ".join(verdier)
                funn["materiale"].append([gid, " + ".join(verdier), "ugyldig"])
                husk(e, typenavn, st)
            else:
                mpb.sett("mangler")
                funn["materiale"].append([gid, "", "mangler"])
                husk(e, typenavn, st)
        else:
            # avhenger / ukjent, or no location for the branch: neither reading is there
            mpb.sett("mangler")

        # 7 MMI and 8 kopiobjekt: dekning is the field being there, at the one location
        for bid in ("mmi", "kopiobjekt"):
            o = bl[bid].get("_sted")
            if o is None:
                continue
            har, v = o.les(psets)
            if har:
                b[bid].sett("oppfylt", o.navn, [v or "(tom)"], tk)
                per_klasse[kl][bid] += 1
                rad[bid] = v or "(tom)"
            else:
                b[bid].sett("mangler")
            if bid == "mmi":
                if not har:
                    funn["mmi"].append([gid, "", "mangler"])
                elif not v:
                    funn["mmi"].append([gid, "", "tom"])
                elif mmi_koder and v not in mmi_koder:
                    funn["mmi"].append([gid, v, "ugyldig"])
                if fase_via_mmi:
                    if not har:
                        funn["fase"].append([gid, "", "mangler"])
                    elif not v:
                        funn["fase"].append([gid, "", "tom"])
                    elif v.strip() not in mmi_fase:
                        funn["fase"].append([gid, v, "ugyldig"])
                if not har or not v or (mmi_koder and v not in mmi_koder) or \
                        (fase_via_mmi and v.strip() not in mmi_fase):
                    husk(e, typenavn, st)

        # 9 fase at its own location (a run without MMI phasing): a value the standard accepts,
        # a carried value outside it (avvik), or absent
        o = bl["fase"].get("_sted")
        if o is not None and not fase_via_mmi:
            vv = o.verdi(e, psets, f)
            if vv and vv.casefold() in fase_gyldig:
                b["fase"].sett("oppfylt", o.navn, [vv], tk)
                per_klasse[kl]["fase"] += 1
                rad["fase"] = vv
            elif vv:
                b["fase"].sett("avvik", o.navn, [vv], tk)
                rad["fase"] = vv
                funn["fase"].append([gid, vv, "ugyldig"])
                husk(e, typenavn, st)
            else:
                b["fase"].sett("mangler")
                funn["fase"].append([gid, "", "mangler"])
                husk(e, typenavn, st)
        elif fase_via_mmi:
            rad["fase"] = mmi_fase.get(rad.get("mmi", "").strip(), "")

        # 3, in addition: type name against the declared rule, and its code part against the
        # object's component code (begreper §3). Only objects carrying both are compared.
        if tn_standard is not None and typenavn and funk:
            rx = navneregel(rad.get("mmi", ""))
            samsvar = bool(rx.match(typenavn)) and typenavn.split("-")[0].upper() == funk[1].strip().upper()
            b["funksjonskode"].ekstra["samsvar" if samsvar else "ikke_samsvar"] += 1

        # 10 etasjer
        plass = B.i_hierarkiet(e)
        hierarki[plass] += 1
        eb = b["etasjer"]
        if (plass == "etasje") != (st is not None):
            raise SystemExit(f"FEIL: {label} {gid}: i_hierarkiet={plass}, etasje={st}")
        if st is not None:
            elev = round(float(st.Elevation) * skala_mm, 1) if st.Elevation is not None else None
            nokkel = f"{(st.Name or '').strip()}|{elev}"
            etasjetall[nokkel] += 1
            etasjenavn[nokkel] = {"navn": (st.Name or "").strip(), "elevation_mm": elev}
            eb.sett("oppfylt", eb.kildenavn[0] if eb.kildenavn else None)
            per_klasse[kl]["etasjer"] += 1
        elif plass == "ingen":
            eb.sett("mangler")
            funn["etasjer"].append([gid, "", "mangler"])
            husk(e, typenavn, st)
        else:
            c = ue.get_container(e)
            eb.sett("avvik", eb.kildenavn[0] if eb.kildenavn else None)
            funn["etasjer"].append([gid, c.is_a() if c is not None else plass, "ikke_i_etasje"])
            husk(e, typenavn, st)

        # type register: identity is name + IFC class of the type (begreper §1)
        if t is not None:
            tr = typer.setdefault(tk, {"klasse": t.is_a(), "navn": typenavn, "instanser": 0,
                                       "objektklasser": collections.Counter(),
                                       **{f_: collections.Counter() for f_ in
                                          ("systemkode", "funksjonskode", "materiale", "produkt",
                                           "mengdetype", "mmi", "fase")}})
            tr["instanser"] += 1
            tr["objektklasser"][kl] += 1
            for felt in ("systemkode", "funksjonskode", "materiale", "produkt", "mengdetype", "mmi", "fase"):
                tr[felt][rad.get(felt, "")] += 1

        # Type 1:1, the same pairing as bep_egenskapskontroll, kept whole for the workbook; only
        # with a project type property (prosjektpsett, rule lik_typenavn)
        if type_egenskap:
            hv = B.hent(B.prosjektinfo(psets, ps["navn"]), type_egenskap)
            egen_type = str(hv).strip() if hv not in (None, "") else ""
            if typenavn and egen_type:
                par[(typenavn, egen_type)] += 1
            elif not typenavn and not egen_type:
                upar["begge"] += 1
            else:
                upar["uten_verdi" if typenavn else "uten_typenavn"] += 1

    typeliste = []
    for tr in sorted(typer.values(), key=lambda x: (-x["instanser"], x["klasse"], x["navn"])):
        typeliste.append({k: (dict(v.most_common()) if isinstance(v, collections.Counter) else v)
                          for k, v in tr.items()})
    typede = sum(tr["instanser"] for tr in typeliste)
    en = sum(1 for tr in typeliste if tr["instanser"] == 1)
    return {
        "label": label, "fil": sti.name, "sha256": B.sha(sti), "n": n, "n_alle": len(alle),
        "tellegrunnlag": info["grunnlag"], "ett_sted": True,
        "typer_alle": [[k, nn, c] for (k, nn), c in typer_alle.most_common()],
        "psett": [{"navn": pn, "objekter": pset_tall[pn]["n"],
                   "klasser": dict(pset_klasser[pn].most_common()),
                   "egenskaper": [{"navn": k, "fylt": egenskap_fylt[pn][k],
                                   "eksempler": egenskap_verdier.get((pn, k), collections.Counter()).most_common(5),
                                   "ulike": len(egenskap_verdier.get((pn, k), {})),
                                   "ulike_tak": len(egenskap_verdier.get((pn, k), {})) >= PSET_MAKS_VERDIER}
                                  for k in egenskap_fylt[pn]]}
                  for pn in sorted(pset_tall, key=lambda x: -pset_tall[x]["n"])],
        "utypet_klasse": dict(utypet_klasse.most_common()),
        "blokk_versjon": BLOKK_VERSJON, "register": registerhash(reg),
        "blokker": {k: v.ut() for k, v in b.items()},
        "mengdeklasser": [[kl, mt, en_, c, kl in aapne_klasser]
                          for (kl, mt, en_), c in mengde_klasse.most_common()],
        "per_klasse": {k: dict(v) for k, v in sorted(per_klasse.items(), key=lambda x: -x[1]["n"])},
        "hierarki": dict(hierarki),
        "etasjer": [{**etasjenavn[k], "objekter": c} for k, c in etasjetall.items()],
        "typeregister": {"typer": len(typeliste), "typede": typede,
                         "per_type": round(typede / len(typeliste), 1) if typeliste else None,
                         "en_instans": en,
                         "en_instans_andel": round(100 * en / len(typeliste), 1) if typeliste else None,
                         "liste": typeliste},
        "materialer": [{"navn": g_["navn"], "objekter": g_["objekter"], "klasser": dict(g_["klasser"].most_common()),
                        "typer": len(g_["typer"]), "kilde": g_["kilde"].most_common(1)[0][0],
                        "lag_mm": sorted(g_["lag_mm"])}
                       for g_ in sorted(mat_galleri.values(), key=lambda x: -x["objekter"])],
        "funn": dict(funn),
        "objekter": objekter,
        "type_1til1": B.en_til_en(par, upar, maks=None),
    }


def kjør(prosjekt: Path, runde_sti: Path, cache: Path, ifc: Path | None = None, ny: bool = False,
         valgte: list[str] | None = None, kun_standard: bool = False) -> dict[str, dict]:
    """Measure the round. `kun_standard` measures against the default layer alone (standard.yaml),
    cached separately, for comparing what the IFC default finds with what the project config adds."""
    reg = les_register(prosjekt, kun_standard)
    runde = B.les_runde(runde_sti, prosjekt.resolve().parent, ifc)
    ut = cache / "blokker" / runde["dato"] / ("standard" if kun_standard else "prosjekt")
    ut.mkdir(parents=True, exist_ok=True)
    rh = registerhash(reg)
    res: dict[str, dict] = {}
    for m in runde["modeller"]:
        if valgte and m["label"] not in valgte:
            continue
        cache = ut / f"{m['label']}.json"
        if cache.exists() and not ny:
            r = json.loads(cache.read_text(encoding="utf-8"))
            if (r.get("sha256") == m["sha16"] and r.get("blokk_versjon") == BLOKK_VERSJON
                    and r.get("register") == rh):
                res[m["label"]] = r
                print(f"{m['label']}: blokker fra cache")
                continue
        print(f"{m['label']}: måler {m['sti'].name}", flush=True)
        r = mål(m["label"], m["sti"], reg)
        if r["sha256"] != m["sha16"]:
            raise SystemExit(f"FEIL: {m['label']}: sha256[:16] {r['sha256']} ≠ runde {m['sha16']}")
        cache.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        res[m["label"]] = r
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    stier.argumenter(ap, ut=False)
    ap.add_argument("--ifc", type=Path, metavar="DIR", help="IFC folder of the round (replaces the round's `kilde`)")
    ap.add_argument("--ny", action="store_true")
    ap.add_argument("--kun-standard", action="store_true", help="the standard layer only (standard/standard.yaml)")
    ap.add_argument("modeller", nargs="*")
    a = ap.parse_args()
    kjør(a.prosjekt, a.runde, a.cache, a.ifc, a.ny, a.modeller, a.kun_standard)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
