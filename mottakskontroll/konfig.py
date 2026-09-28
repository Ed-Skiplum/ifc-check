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
in the default. With `kun_standard=True` the project layer is left out.
"""
from __future__ import annotations

import copy
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
    """The name of the project property carrying `regel`, or None when none is configured."""
    return next((e["navn"] for e in (ps or {}).get("egenskaper") or [] if e["regel"] == regel), None)


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
    for sb in std["blokker"]:
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
