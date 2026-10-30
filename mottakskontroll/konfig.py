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
STANDARD_EN = stier.STANDARD / "standard_en.yaml"
# Report languages: Norwegian (the standard layer as written) and English (standard_en.yaml).
SPRAAK = ("nb", "en")
STEDER = ("sted", "sted_telleobjekt", "sted_mengdeobjekt")
STANDARD = "standard"
PROSJEKT = "prosjekt"
# The template's placeholder (mal/prosjekt.yaml), the same sentinel as src/ids/config-template.ts:
# a project config that still carries one is refused.
MAL_MERKE = "<FROM PROJECT"
# Text the config does not hold yet, printed where it is missing (edkjo's [WRITE] sentinel).
PLASSHOLDER = "[WRITE]"


def _omfang() -> tuple[str, dict[str, str], dict[str, str]]:
    """The check's scope from standard.yaml `standard`: `fysisk_klasse` (IfcElement), `ikke_telt`
    (class -> reason) and `ikke_telt_del_av` (owner class -> reason). Read from the standard layer
    only, so every project gets the same scope."""
    std = yaml.safe_load(STANDARD_STI.read_text(encoding="utf-8"))["standard"]
    return (str(std["fysisk_klasse"]), {str(k): str(v) for k, v in std["ikke_telt"].items()},
            {str(k): str(v) for k, v in (std.get("ikke_telt_del_av") or {}).items()})


FYSISK, IKKE_TELT, DEL_AV = _omfang()


def utelatt(e) -> str | None:
    """The `ikke_telt` class an entity falls under (subtypes included), or None. A class the
    file's schema lacks (IfcGeographicElement in IFC2X3) matches nothing."""
    return next((k for k in IKKE_TELT if e.is_a(k)), None)


def eier(e):
    """The object `e` is a part of, when it is decomposed from one of the `ikke_telt_del_av` owner
    classes through IfcRelAggregates (2026-10-30: a stair flight, stringer or railing of an IfcStair,
    a plate of an IfcCurtainWall, anything in an IfcElementAssembly); else None. A part aggregated
    into the spatial structure (storey, space) has no such owner."""
    for rel in getattr(e, "Decomposes", None) or []:
        if rel.is_a("IfcRelAggregates"):
            o = rel.RelatingObject
            if o is not None and any(o.is_a(k) for k in DEL_AV):
                return o
    return None


def i_omfang(e) -> bool:
    """A physical object in the check: an IfcElement of no `ikke_telt` class, and not a part of
    another element (`ikke_telt_del_av`): the owner is the object reported."""
    return e.is_a(FYSISK) and utelatt(e) is None and eier(e) is None


# The rules a `prosjektpsett` property can carry (bep_egenskapskontroll.py measures them).
PSETT_REGLER = ("tre_sifre", "fagkode", "ns3451", "ns3457", "lik_typenavn", "utfylt")


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
               "ns3451": "finnes og er en tresifret kode i NS 3451",
               "ns3457": "finnes og er en komponentkode i NS 3457-8",
               "lik_typenavn": "finnes og er lik IfcTypeObject.Name", "utfylt": "finnes, ikke tom"}
TRE_SIFRE = r"^\d{3}$"
# Code-table rules (2026-10-20): a code in the standard's table, not just the form. 360 has three
# digits, but 36 is the group Luftbehandling and 361 its first code.
REGEL_TABELL = {"ns3451": "kodetabell_ns3451.yaml", "ns3457": "mengdetype_ns3457.yaml"}


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
          navn, krav, navnedel, egenskaper[{navn, regel}]  rule tre_sifre | fagkode | ns3451 | ns3457 |
                                                           lik_typenavn | utfylt

    Normalised: {"navn", "krav", "navnedel", "egenskaper": [{navn, maaler, monster, godtatte,
    kodetabell, lik_typenavn, samle, kopi}]}, plain data (cache keys hash it). `godtatte` of a
    `fagkode` rule is the project's `fagkoder`; a `kodetabell` stays a name (stier.tabell_sti).
    `ns3451` is the form and its table together (both must hold), `ns3457` its table."""
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
                       "monster": TRE_SIFRE if r in ("tre_sifre", "ns3451") else None,
                       "godtatte": fag if r == "fagkode" else None, "kodetabell": REGEL_TABELL.get(r),
                       "lik_typenavn": r == "lik_typenavn",
                       "samle": r in ("tre_sifre", "fagkode", "ns3451", "ns3457"),
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


# Requirements a project may gate by MMI (`gjelder_fra_mmi`), besides every opt-in block: the ones
# blokkdata.py measures per object with a value of their own. Not the IFC structure blocks, and not
# MMI itself, which the gate reads.
MMI_PORT = ("systemkode", "funksjonskode", "produkt", "materiale", "kopiobjekt")


def mmi_terskler(blokker: list[dict]) -> None:
    """Check `gjelder_fra_mmi` (2026-10-30, KNM BEP «Properties by MMI level»): a whole number, on a
    block that can carry it, and read at the MMI requirement's one location, which must then exist.
    An object whose MMI there is below the number is outside the requirement, as an out-of-scope
    class is; an object with no MMI, or one that is not a number, counts as due."""
    gated = [b for b in blokker if b.get("gjelder_fra_mmi") is not None and not b.get("utelatt")]
    if not gated:
        return
    for b in gated:
        t = b["gjelder_fra_mmi"]
        if isinstance(t, bool) or not isinstance(t, int):
            raise SystemExit(f"FEIL: {b['id']}: gjelder_fra_mmi må være et heltall, ikke {t!r}")
        if b["id"] not in MMI_PORT and not b.get("valgfri"):
            raise SystemExit(f"FEIL: {b['id']}: gjelder_fra_mmi gjelder ikke dette kravet "
                             f"(gyldige: {', '.join(MMI_PORT)} og de valgfrie)")
    m = next((b for b in blokker if b["id"] == "mmi"), None)
    if m is None or m.get("utelatt") or not m.get("sted"):
        raise SystemExit(f"FEIL: gjelder_fra_mmi på {', '.join(b['id'] for b in gated)}, men MMI har ikke sted")


def spraak(std: dict, prj: dict) -> str:
    """The report language, project key `spraak` (2026-10-30, KNM: English first): «nb», the
    default, or «en». For «en» the standard layer's words are replaced by its English table
    (standard_en.yaml) before the project layer goes on top, so a project's own `etiketter`,
    `verdiktord`, titles and texts still win."""
    sp = str(prj.get("spraak") or "nb")
    if sp not in SPRAAK:
        raise SystemExit(f"FEIL: spraak {sp!r} er ikke støttet (gyldige: {', '.join(SPRAAK)})")
    if sp == "en":
        oversett(std, yaml.safe_load(STANDARD_EN.read_text(encoding="utf-8")))
    return sp


def oversett(std: dict, en: dict) -> None:
    """The standard layer in English, in place. A Norwegian word with no English entry stops the
    run: an English report never carries a stray Norwegian label."""
    mangler = [f"etiketter.{k}" for k in std["etiketter"] if k not in en["etiketter"]]
    mangler += [f"verdiktord.{k}" for k in std["verdiktord"] if k not in en["verdiktord"]]
    mangler += [f"seksjoner.{s['id']}" for s in std["seksjoner"] if s["id"] not in en["seksjoner"]]
    mangler += [f"blokker.{b['id']}.{k}" for b in std["blokker"]
                for k in ("tittel", "krav_tekst", "krav_tekst_mmi_fase")
                if b.get(k) and k not in (en["blokker"].get(b["id"]) or {})]
    mangler += [f"kpi_alle.{k['id']}" for k in std["kpi_alle"] if k["id"] not in en["kpi_alle"]]
    mangler += [f"standard.{k}" for k in ("telte_objekter", "navnematching") if k not in en["standard"]]
    if mangler:
        raise SystemExit(f"FEIL: {STANDARD_EN.name} mangler {', '.join(mangler)}")
    std["etiketter"] = {**std["etiketter"], **en["etiketter"]}
    std["verdiktord"] = {**std["verdiktord"], **en["verdiktord"]}
    for s in std["seksjoner"]:
        s["tittel"] = en["seksjoner"][s["id"]]
    for b in std["blokker"]:
        b.update(en["blokker"].get(b["id"]) or {})
    for k in std["kpi_alle"]:
        k.update(en["kpi_alle"][k["id"]])
    std["standard"] = {**std["standard"], **en["standard"]}


def prosjektseksjoner(prj_s: list, std_s: list[dict], blokker: list[dict],
                      prj_rekke: list[str]) -> tuple[list[dict], list[dict]]:
    """A project's own `seksjoner` (2026-10-30, KNM: the requirements grouped by pset as in its BEP
    attachment): the list REPLACES the standard's, in its order. `tittel` may be left out for a
    standard section id, which then keeps the standard's title. Every block in the report must name
    one of them in `seksjon`. Blocks are ordered by section, then in the order the project lists
    them in `blokker`, then in the standard's order."""
    std_tittel = {s["id"]: s["tittel"] for s in std_s}
    seksjoner = []
    for s in prj_s:
        sid = str((s or {}).get("id") or "")
        tittel = (s or {}).get("tittel") or std_tittel.get(sid)
        if not sid or not tittel:
            raise SystemExit(f"FEIL: seksjoner: {s!r} mangler id eller tittel")
        seksjoner.append({"id": sid, "tittel": str(tittel)})
    ids = [s["id"] for s in seksjoner]
    if len(set(ids)) != len(ids):
        raise SystemExit(f"FEIL: seksjoner: samme id to ganger i {ids}")
    uten = [b["id"] for b in blokker if not b.get("utelatt") and b.get("seksjon") not in ids]
    if uten:
        raise SystemExit(f"FEIL: seksjoner: {', '.join(uten)} har ingen seksjon i prosjektets liste {ids}")
    pos = {bid: i for i, bid in enumerate(prj_rekke)}
    rekke = sorted(blokker, key=lambda b: (ids.index(b["seksjon"]) if b.get("seksjon") in ids else len(ids),
                                           pos.get(b["id"], len(pos))))
    return seksjoner, rekke


def last(krav_sti: Path, kun_standard: bool = False) -> dict:
    std = yaml.safe_load(STANDARD_STI.read_text(encoding="utf-8"))
    tekst = krav_sti.read_text(encoding="utf-8")
    if MAL_MERKE in tekst:
        raise SystemExit(f"FEIL: {krav_sti}: {tekst.count(MAL_MERKE)} unfilled {MAL_MERKE}> placeholder(s) "
                         "from the template")
    prj = yaml.safe_load(tekst)
    sp = spraak(std, prj)
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
    mmi_terskler(blokker)
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
    if not kun_standard and prj.get("seksjoner"):
        ut["seksjoner"], ut["blokker"] = prosjektseksjoner(prj["seksjoner"], std["seksjoner"], blokker,
                                                           list(prj_blokker))
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
    ut["spraak"] = sp
    ut["_lag"] = {"standard": str(STANDARD_STI), "prosjekt": None if kun_standard else str(krav_sti)}
    # Relative table paths in the project config resolve here (stier.tabell_sti).
    ut["_rot"] = None if kun_standard else krav_sti.resolve().parent
    return ut
