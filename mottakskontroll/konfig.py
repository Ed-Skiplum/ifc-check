"""The two configuration layers of the mottakskontroll, merged into one register.

    standard/standard.yaml  the default: where the IFC standard puts each value. Ships with the tool.
    krav.yaml               the project (path from --prosjekt): its required locations, accepted
                            values, requirements and comments, on top. Contract: README.md.

`last()` returns krav.yaml with `blokker`, `seksjoner` and `skjema` replaced by the merged ones.

One location per requirement (edkjo 2026-09-24). The keys `sted`, `sted_telleobjekt` and
`sted_mengdeobjekt` each hold one location. A project that declares one REPLACES the standard's;
nothing is appended. Every location carries `nivaa`, «standard» or «prosjekt», which the report
prints as «IFC» or «prosjekt». No project name is a label. Any other key the project sets overrides
the standard's. A project id the standard does not know is an error: a requirement is defined once,
in the default. An opt-in block of the standard (`valgfri`) exists only where the project lists it.
With `kun_standard=True` the project layer is left out.

The project property set check (`egenskapskontroll()`) reads either of two project keys,
`egenskapskontroll` or `prosjektpsett`, normalised to one shape.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

import yaml

import stier

STANDARD_STI = stier.STANDARD / "standard.yaml"
STEDER = ("sted", "sted_telleobjekt", "sted_mengdeobjekt")
STANDARD = "standard"
PROSJEKT = "prosjekt"
# The template's placeholder (mal/prosjekt.yaml), the same sentinel as src/ids/config-template.ts:
# a project config that still carries one is refused.
MAL_MERKE = "<FROM PROJECT"
# Text the config does not hold yet, printed where it is missing (edkjo's [WRITE] sentinel).
PLASSHOLDER = "[WRITE]"


def ikke_telt() -> tuple[str, ...]:
    """The classes kept out of the whole check, subtypes included: standard.yaml
    `standard.ikke_telt` (IfcGeographicElement, IfcGeographicElementType). Read from the standard
    layer only, so every project gets the same list."""
    std = yaml.safe_load(STANDARD_STI.read_text(encoding="utf-8"))
    return tuple(str(k) for k in std["standard"]["ikke_telt"])


def utelatt(e) -> bool:
    """An entity (occurrence or type) of a class in `ikke_telt()`, subtypes included."""
    return any(e.is_a(k) for k in IKKE_TELT)


IKKE_TELT = ikke_telt()


# The rules a `prosjektpsett` property can carry (bep_egenskapskontroll.py measures them).
PSETT_REGLER = ("tre_sifre", "fagkode", "lik_typenavn", "utfylt")


def prosjektpsett(y: dict) -> dict | None:
    """The project property set (`prosjektpsett`), checked. None when the project declares none:
    nothing of it is measured, and a requirement reading it reports «ikke konfigurert»."""
    ps = y.get("prosjektpsett")
    if not ps:
        return None
    egenskaper = ps.get("egenskaper") or []
    feil = [e.get("navn") for e in egenskaper if e.get("regel") not in PSETT_REGLER]
    if feil or not ps.get("navn"):
        raise SystemExit(f"FEIL: prosjektpsett: mangler navn, eller ukjent regel på {feil} "
                         f"(gyldige: {', '.join(PSETT_REGLER)})")
    for r in ("fagkode", "lik_typenavn"):
        if sum(1 for e in egenskaper if e["regel"] == r) > 1:
            raise SystemExit(f"FEIL: prosjektpsett: mer enn én egenskap med regel {r}")
    return ps


def psett_egenskap(ps: dict | None, regel: str) -> str | None:
    """The name of the project property carrying `regel`, or None when none is configured.
    `ps` is either shape: `prosjektpsett` (rule `regel`) or the normalised `egenskapskontroll()`
    (where «fagkode» is the copy marker, `kopi`, and «lik_typenavn» the type-name property)."""
    for e in (ps or {}).get("egenskaper") or []:
        if "regel" in e:
            if e["regel"] == regel:
                return e["navn"]
        elif (regel == "fagkode" and e.get("kopi")) or (regel == "lik_typenavn" and e.get("lik_typenavn")):
            return e["navn"]
    return None


# Requirement text per `prosjektpsett` rule (the side workbook's «Krav» row).
REGEL_TEKST = {"tre_sifre": "finnes og er tre sifre", "fagkode": "finnes; verdien er en fagkode",
               "lik_typenavn": "finnes og er lik IfcTypeObject.Name", "utfylt": "finnes, ikke tom"}
TRE_SIFRE = r"^\d{3}$"


def egenskapskontroll(y: dict) -> dict | None:
    """The project property set check, normalised. None when the project declares none: only the
    generic checks run, and a requirement reading the set reports «ikke konfigurert».

    Two project keys, one at a time:

        egenskapskontroll:                     (2026-10-05, HI90 and KNM)
          pset: <property set name>            matched ignoring spaces and case
          psetnavn_inneholder: <text>          pset names containing it are tallied (default: pset)
          krav: <krav id>                      the requirement measuring the set (default: «pset», if any)
          egenskaper:                          in report order
            - navn: <property>
              maaler: <one line for the side workbook>
              monster: <regex the value must match>       or
              godtatte: [<accepted values>]               compared ignoring case, or
              kodetabell: <table file>                    its codes are the accepted values, or
              lik_typenavn: true                          the value equals IfcTypeObject.Name
              samle: true                                 tally the values
              kopi: true                                  the value is the object's copy marker

        prosjektpsett:                         (2026-09-28, Palehaven; konfig.prosjektpsett)
          navn, krav, navnedel, egenskaper[{navn, regel}]  rule tre_sifre | fagkode | lik_typenavn | utfylt

    Normalised: {"navn", "krav", "navnedel", "egenskaper": [{navn, maaler, monster, godtatte,
    kodetabell, lik_typenavn, samle, kopi}]}, plain data (cache keys hash it). `godtatte` of a
    `fagkode` rule is the project's `fagkoder`; a `kodetabell` stays a name (stier.tabell_sti)."""
    ek, ps = y.get("egenskapskontroll"), y.get("prosjektpsett")
    if ek and ps:
        raise SystemExit("FEIL: både egenskapskontroll og prosjektpsett er konfigurert; bruk én")
    if ps:
        ps = prosjektpsett(y)
        fag = [str(f) for f in y.get("fagkoder") or []]
        eg = []
        for e in ps.get("egenskaper") or []:
            r = e["regel"]
            eg.append({"navn": str(e["navn"]), "maaler": REGEL_TEKST[r],
                       "monster": TRE_SIFRE if r == "tre_sifre" else None,
                       "godtatte": fag if r == "fagkode" else None, "kodetabell": None,
                       "lik_typenavn": r == "lik_typenavn", "samle": r in ("tre_sifre", "fagkode"),
                       "kopi": r == "fagkode"})
        return {"navn": str(ps["navn"]), "krav": ps.get("krav"),
                "navnedel": str(ps.get("navnedel") or "").lower(), "egenskaper": eg}
    if not ek:
        return None
    if not ek.get("pset"):
        raise SystemExit("FEIL: egenskapskontroll: mangler pset")
    eg = []
    for e in ek.get("egenskaper") or []:
        regler = [k for k in ("monster", "godtatte", "kodetabell", "lik_typenavn") if e.get(k) is not None]
        if len(regler) > 1:
            raise SystemExit(f"FEIL: egenskapskontroll: {e.get('navn')}: mer enn én regel {regler}")
        if e.get("monster"):
            re.compile(e["monster"])
        eg.append({"navn": str(e["navn"]), "maaler": str(e.get("maaler") or ""),
                   "monster": e.get("monster") or None,
                   "godtatte": [str(x) for x in e["godtatte"]] if e.get("godtatte") is not None else None,
                   "kodetabell": e.get("kodetabell") or None,
                   "lik_typenavn": bool(e.get("lik_typenavn")), "samle": bool(e.get("samle")),
                   "kopi": bool(e.get("kopi"))})
    for k in ("kopi", "lik_typenavn"):
        if sum(1 for e in eg if e[k]) > 1:
            raise SystemExit(f"FEIL: egenskapskontroll: mer enn én egenskap med {k}")
    pset = str(ek["pset"])
    # The requirement that measures the set itself: `krav`, else the project requirement «pset»
    # when there is one (the HI90 engine's fixed id).
    krav = ek.get("krav") or ("pset" if any(k.get("id") == "pset" for k in y.get("krav") or []) else None)
    return {"navn": pset, "krav": krav,
            "navnedel": str(ek.get("psetnavn_inneholder") or pset).lower(), "egenskaper": eg}


def ikke_konfigurert(b: dict) -> bool:
    """No location for the requirement in either layer."""
    return not any(b.get(k) for k in STEDER)


def last(krav_sti: Path, kun_standard: bool = False) -> dict:
    std = yaml.safe_load(STANDARD_STI.read_text(encoding="utf-8"))
    tekst = krav_sti.read_text(encoding="utf-8")
    if MAL_MERKE in tekst:
        raise SystemExit(f"FEIL: {krav_sti}: {tekst.count(MAL_MERKE)} unfilled {MAL_MERKE}> placeholder(s) "
                         "from the template")
    prj = yaml.safe_load(tekst)
    prj_blokker = {b["id"]: b for b in prj.get("blokker") or []}
    ukjent = set(prj_blokker) - {b["id"] for b in std["blokker"]}
    if ukjent:
        raise SystemExit(f"FEIL: krav.yaml har krav standard.yaml ikke kjenner: {sorted(ukjent)}")
    blokker = []
    krav_def = {k["id"]: k for k in prj.get("krav") or []}
    for sb in std["blokker"]:
        # An opt-in requirement (`valgfri`) exists only where the project lists it.
        if sb.get("valgfri") and (kun_standard or sb["id"] not in prj_blokker):
            continue
        b = copy.deepcopy(sb)
        for k in STEDER:
            if b.get(k):
                b[k] = {**b[k], "nivaa": STANDARD}
        pb = prj_blokker.get(sb["id"], {})
        for k, v in pb.items():
            if k == "id":
                continue
            if k in STEDER:
                if not kun_standard:
                    b[k] = {**v, "nivaa": PROSJEKT}
            elif not kun_standard or k == "krav":
                b[k] = copy.deepcopy(v)
        b["ikke_konfigurert"] = ikke_konfigurert(b)
        if b.get("valgfri"):
            # An opt-in block carries no wording of its own: its title and requirement text are the
            # `tittel` and `maaler` of the project requirement it ties, so the wording is the
            # project's. None there: a visible placeholder, never a made-up line.
            kd = next((krav_def[k] for k in b.get("krav") or [] if k in krav_def), {})
            b.setdefault("tittel", kd.get("tittel") or f"{PLASSHOLDER} {b['id']}")
            b.setdefault("krav_tekst", " ".join(str(kd.get("maaler") or PLASSHOLDER).split()))
        blokker.append(b)
    # Fase through MMI phasing (edkjo 2026-09-25): a declared `forventet.mmi.fase` makes the MMI
    # requirement's location Fase's one location; the mapping is the accepted values.
    fase_kart = {} if kun_standard else (((prj.get("forventet") or {}).get("mmi") or {}).get("fase") or {})
    if fase_kart:
        bl = {b["id"]: b for b in blokker}
        f, m = bl.get("fase"), bl.get("mmi")
        if not f or not m or not m.get("sted"):
            raise SystemExit("FEIL: forventet.mmi.fase er konfigurert, men MMI har ikke sted")
        f["sted"] = copy.deepcopy(m["sted"])
        f["mmi_fase"] = {str(k): str(v) for k, v in fase_kart.items()}
        f["krav_tekst"] = f.get("krav_tekst_mmi_fase") or f.get("krav_tekst", "")
        f.pop("gyldige", None)
        f["ikke_konfigurert"] = False
    if kun_standard:
        # Zero project context (edkjo 2026-09-25: a standard-only run must never fail). Only the
        # round's identity (`prosjekt`: code and name, for file names and the header) comes from
        # the project; every rule, value list, model/group config and label is left out, and the
        # sections that exist only because of them are omitted.
        ut = {"prosjekt": prj["prosjekt"], "fagkoder": [], "kpi": [], "krav": [], "forventet": {},
              "bruk": [], "merknader": {}, "merknader_modell": {}, "modeller": {}, "faggrupper": {},
              "uten_rapport": []}
    else:
        ut = dict(prj)
    # Generic framework settings: standard.yaml, a project key overrides.
    for k in ("standard", "kpi_band", "kpi_alle"):
        ut[k] = copy.deepcopy(std[k]) if kun_standard or k not in prj else prj[k]
    ut["blokker"] = blokker
    ut["seksjoner"] = std["seksjoner"]
    skjema = dict(std.get("skjema") or {})
    if not kun_standard:
        skjema.update(prj.get("skjema") or {})
    ut["skjema"] = skjema
    ut["etiketter"] = {**(std.get("etiketter") or {}),
                       **({} if kun_standard else (prj.get("etiketter") or {}))}
    ut["verdiktord"] = {**(std.get("verdiktord") or {}),
                        **({} if kun_standard else (prj.get("verdiktord") or {}))}
    ut["kpi_terskler"] = {**(std.get("kpi_terskler") or {}),
                          **({} if kun_standard else (prj.get("kpi_terskler") or {}))}
    ut["terskel_gyldig"] = {**(std.get("terskel_gyldig") or {}),
                            **({} if kun_standard else (prj.get("terskel_gyldig") or {}))}
    ut["_lag"] = {"standard": str(STANDARD_STI), "prosjekt": None if kun_standard else str(krav_sti)}
    # Relative table paths in the project config resolve here (stier.tabell_sti).
    ut["_rot"] = None if kun_standard else krav_sti.resolve().parent
    return ut
