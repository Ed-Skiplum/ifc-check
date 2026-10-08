"""Mottakskontroll: one PDF per delivered model, one project PDF and one workbook per round.

    python mottakskontroll/kjor.py ...                    measure and render (the entrypoint)
    python mottakskontroll/bygg_mottakskontroll.py ...    render only, same arguments

The framework is docs/rapport-rammeverk.md (settled 2026-09-23) and the ten blocks are
docs/begreper.md, both in the HI90 project repo. The project config (--prosjekt, krav.yaml shape)
on standard/standard.yaml is the single source of rules, lookup cascades, thresholds,
applicability, expected values and comments; this module holds procedures and layout only, and no
discipline name.

Chain, all read from the round's frozen inputs under --cache:

    bep/<dato>/data.json                bep_egenskapskontroll.py  counted set, GUIDs, Type 1:1,
                                                                  the requirements outside the blocks
    struktur/<dato>/struktur_*.json     struktur.py               storeys, site, georeferencing
    blokker/<dato>/<lag>/<modell>.json  blokkdata.py              the ten blocks per object, the
                                                                  type register (run from here,
                                                                  cached per file sha)

`beregn()` turns these into one computed dict, frozen as <ut>/data/beregnet.json.
The model reports, the project report and the workbook all render from that dict, so a number
cannot exist twice with two definitions.

Outputs, in --ut (<kode> is the project config's `prosjekt.kode`):

    <kode>_Mottakskontroll_<modell>.pdf title, Nøkkeltall, the ten blocks, the hygiene strip on
                                        one page (the build fails otherwise), then the type
                                        gallery on as many pages as the model has types
    <kode>_Mottakskontroll_Prosjekt.pdf Leveransen, Krav × modell, Bruk, GUID på tvers
    <kode>_Mottakskontroll.xlsx         the workbook template of the framework, plus Typer
    html/                               the build vehicle, never delivered

The treatment is rapport/mottakskontroll.css on rapport/tokens.css; --css swaps in another.
The per-discipline and federated reports of the 2026-09-06 form are gone.

Fields this renderer reads from the register
--------------------------------------------
`blokker` (the ten blocks: krav, oppslag, gyldig, ikke_materiale, grunnlag, aapne, dekning),
`kpi_band`, `kpi`, `krav` with `datanokkel`/`finnes_nokkel`/`grunnlag`/`terskel`/`gjelder`,
`bruk`, `merknader`, and under `forventet`: filnavn, etasjer (with severities and per_fag),
typenavn, mmi, koordineringsobjekt, plassering, georeferering, kopi_objekt.

Deals, accepted deviations and explanations live in `merknader`, keyed by requirement id and
scoped to a model label, a fagkode or «alle». They render as the comment slot of the block that
answers for the requirement, and are the only sentences in the report.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

import collections
import os
import shutil

import blokkdata
import konfig
import stier
from bep_egenskapskontroll import SJEKK_VERSJON as SJEKK_VERSJON_KREVD

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BREDDE = 186  # mm, A4 minus 12 mm margins

SYM = {"ok": "●", "warn": "◐", "bad": "○", "na": "–"}

# data.json key names, 2026-09-07 onward -> what the rendering code reads
NYE_NAVN = {"label": "id", "sha256": "sha", "firma": "fag", "lastet_opp": "levert",
            "dupliserte_guid": "dup"}


# ---------------------------------------------------------------- formatting
def esc(s) -> str:
    return html.escape(str(s), quote=False)


def pct(n: float, d: float) -> float:
    return 100.0 * n / d if d else 0.0


def fmt_pct(p: float) -> str:
    s = f"{p:.1f}".replace(".", ",")
    return s[:-2] if s.endswith(",0") else s


def fmt_n(v) -> str:
    return f"{v:,}".replace(",", " ")


def fmt_mm(v: float) -> str:
    return f"{v:+,.0f}".replace(",", " ")


def m_(v_mm: float, dec: int = 2) -> str:
    return f"{v_mm/1000:.{dec}f}".replace(".", ",")


def brytbar(s: str) -> str:
    """Zero-width space after every underscore, so a long Pset name wraps inside its column."""
    return s.replace("_", "_\u200b")


def kutt(s: str, maks: int = 22) -> str:
    s = str(s).strip()
    return s if len(s) <= maks else s[:maks - 1] + "…"


def colgroup(w: list[float]) -> str:
    assert abs(sum(w) - BREDDE) < 0.01, (w, sum(w))
    return "<colgroup>" + "".join(f'<col style="width:{x:g}mm">' for x in w) + "</colgroup>"


def bredder(fast: list[float], n: int) -> list[float]:
    """Fixed label columns, then n equal model columns filling the print width."""
    rest = BREDDE - sum(fast)
    w = round(rest / n, 3)
    kol = [w] * n
    kol[-1] = round(rest - w * (n - 1), 3)
    return fast + kol


# ---------------------------------------------------------------- register
def hent_tall(d: dict, sti):
    """Resolve a datanokkel against one model's data.json entry.

    A list is summed. A dotted name is a path from the model root (typebruk.per_type). A bare
    name is a path too when the model carries it at the root (n, dupliserte_guid, schema), and
    otherwise a key in the `sjekk` block, which is where most checks land."""
    if isinstance(sti, (list, tuple)):
        return sum(hent_tall(d, s) or 0 for s in sti)
    deler = str(sti).split(".")
    if deler[0] in d:
        v = d[deler[0]]
        for k in deler[1:]:
            if not isinstance(v, dict):
                return None
            v = v.get(k)
        return v
    return (d.get("sjekk") or {}).get(str(sti))


class Register:
    """The merged configuration (konfig.py): standard.yaml, the IFC default, with krav.yaml, the
    project's rules, expected values, use cases and comments, on top."""

    def __init__(self, sti: Path, kun_standard: bool = False):
        y = konfig.last(sti, kun_standard)
        self.kun_standard = kun_standard
        self.prosjekt: dict = y["prosjekt"]
        self.fagkoder: list[str] = y["fagkoder"]
        self.standard: dict = y["standard"]
        self.kpi: list[dict] = y["kpi"]
        self.krav: list[dict] = y["krav"]
        self.forventet: dict = y["forventet"]
        self.bruk: list[dict] = y["bruk"]
        self.merknader: dict = y.get("merknader") or {}
        self.uten_rapport: set[str] = set(y.get("uten_rapport") or [])
        self.modeller: dict[str, dict] = y.get("modeller") or {}
        self.faggrupper: dict[str, list[str]] = y.get("faggrupper") or {}
        self.pr_id = {k["id"]: k for k in self.krav}
        self.blokker: list[dict] = y.get("blokker") or []
        # Fase through MMI phasing reads the same property as MMI: as a requirement of its own it
        # repeats MMI's Dekning and Gyldig and lists every MMI deviation twice. It is a rollup of the
        # MMI reading instead, a Fase line inside the MMI block, and has no block or verdict.
        fase = next((b for b in self.blokker if b["id"] == "fase" and b.get("mmi_fase")), None)
        if fase:
            self.blokker = [{**b, "fase_kart": fase["mmi_fase"], "fase_tittel": fase["tittel"]}
                            if b["id"] == "mmi" else b for b in self.blokker if b["id"] != "fase"]
        self.kpi_band: list[str] = y.get("kpi_band") or []
        self.seksjoner: list[dict] = y.get("seksjoner") or []
        self.skjema: dict = y.get("skjema") or {}
        self.terskel_gyldig: dict = y.get("terskel_gyldig") or {}
        VERDIKT_ORD.update(y.get("verdiktord") or {})
        last_etiketter(y.get("etiketter") or {})
        TERSKLER["dekning"] = dict(self.standard["terskel"])
        if self.terskel_gyldig:
            TERSKLER["gyldig"] = dict(self.terskel_gyldig)
        self.kpi_alle: list[dict] = y.get("kpi_alle") or []
        self.kpi_terskler: dict = y.get("kpi_terskler") or {}
        self.merknader_modell: dict = y.get("merknader_modell") or {}
        self.rot: Path | None = y["_rot"]
        # The project property set (konfig.prosjektpsett); its `krav` is the requirement that
        # measures the set itself, the one others name in `krever`. None: not configured.
        self.prosjektpsett: dict | None = konfig.prosjektpsett(y)
        self.psett_krav: str | None = (self.prosjektpsett or {}).get("krav")
        if self.psett_krav and self.psett_krav not in self.pr_id:
            raise SystemExit(f"FEIL: prosjektpsett.krav {self.psett_krav} finnes ikke i `krav`")
        self._filnavn: re.Pattern | None = None

    def i_seksjon(self, *seksjoner: str) -> list[dict]:
        return [k for k in self.krav if k.get("seksjon") in seksjoner]

    def terskel(self, k: dict) -> dict:
        return {**self.standard["terskel"], **(k.get("terskel") or {})}

    def tittel(self, krav_id: str) -> str:
        return self.pr_id[krav_id]["tittel"]

    def filnavn_monster(self) -> re.Pattern:
        """<prosjektkode>_<fagkode>[_<suffiks>].ifc, assembled from the register."""
        if self._filnavn is None:
            f = self.forventet["filnavn"]
            suffiks = (self.pr_id["filnavn"].get("verdier") or {}).get("suffiks_monster", "[^.]+")
            skille = re.escape(f.get("skille", "_"))
            self._filnavn = re.compile(
                rf"^{re.escape(self.prosjekt['kode'])}{skille}"
                rf"(?:{'|'.join(re.escape(c) for c in self.fagkoder)})"
                rf"(?:{skille}(?:{suffiks}))?{re.escape(f['endelse'])}$", re.IGNORECASE)
        return self._filnavn

    def etasjeregler(self, fag: str) -> dict:
        """The register's storey rules, with the discipline's override kept separate: it only
        takes effect when its own condition holds, which match_etasjer decides."""
        e = self.forventet.get("etasjer") or {}   # empty in a standard-only run
        regler = {k: v for k, v in e.items() if k != "per_fag"}
        regler["override"] = (e.get("per_fag") or {}).get(fag)
        return regler

    def merknad_rader(self, krav_id: str, omfang: set[str]) -> list[dict]:
        return [m for m in (self.merknader.get(krav_id) or []) if m.get("gjelder") in omfang]


# ---------------------------------------------------------------- round
class Runde:
    """One round of the mottakskontroll: the config plus the paths it derives."""

    def __init__(self, sti: Path, cache: Path, rot: Path, ifc: Path | None = None):
        """`cache` holds the measurements, `rot` is the project config's directory (relative
        `kilde` paths resolve there), `ifc` the IFC folder, which replaces `kilde` when given."""
        self.sti, self.rot, self.ifc = sti, rot, ifc
        cfg = json.loads(sti.read_text(encoding="utf-8"))
        self.dato: str = cfg["dato"]
        self.eksport: str = cfg.get("eksport", "")
        self.kilde: str = cfg.get("kilde", "")
        self.modeller: list[dict] = cfg["modeller"]
        self.labels = [m["label"] for m in self.modeller]
        self.cfg = {m["label"]: m for m in self.modeller}
        self.data_sti = cache / "bep" / self.dato / "data.json"
        self.struktur_sti = cache / "struktur" / self.dato / f"struktur_{self.dato}.json"
        self.blokk_sti = cache / "blokker" / self.dato

    def ifc_sti(self, m: str) -> Path:
        return stier.ifc_sti(self.cfg[m], self.kilde, self.rot, self.ifc)

    def firma(self, m: str) -> str:
        return self.cfg[m].get("firma", "")

    def bind(self, reg: Register) -> None:
        """Every model of the round must be in krav.yaml `modeller`; its fagkode is looked up
        there, never read from the name. Fails loudly on a missing model."""
        if reg.kun_standard:
            # Standard-only: no model config, so no fagkode; nothing is derived from the name.
            self._fag = {m: "" for m in self.labels}
            return
        mangler = [m for m in self.labels if m not in reg.modeller]
        if mangler:
            raise SystemExit(f"FEIL: modeller mangler i krav.yaml `modeller`: {', '.join(mangler)}")
        self._fag = {m: str(reg.modeller[m]["fagkode"]) for m in self.labels}

    def fag(self, m: str) -> str:
        """The model's configured fagkode (krav.yaml `modeller`)."""
        return self._fag[m]

    def hoved(self, reg: Register) -> list[str]:
        """The models this round reports on. `uten_rapport` in the register says which
        discipline codes are controlled elsewhere and drop out here; matched on the configured
        fagkode."""
        return [m for m in self.labels if self.fag(m) not in reg.uten_rapport]

    def labels_for(self, reg: Register, fag: str) -> list[str]:
        return [m for m in self.hoved(reg) if self.fag(m) == fag]

    def fag_rekkefolge(self, reg: Register) -> list[str]:
        out: list[str] = []
        for m in self.hoved(reg):
            f = self.fag(m)
            if f not in out:
                out.append(f)
        return out

    def kort_i_fag(self, m: str) -> str:
        """X_ARK_MMI700 → MMI700, X_ARK → ARK. Prefix is the report."""
        fag = self.fag(m)
        rest = (m.split("_", 1)[1] if "_" in m else m).removeprefix(fag).lstrip("_")
        return rest or fag

    def modell_linje(self, labels: list[str]) -> str:
        d = []
        for lab in labels:
            m = self.cfg[lab]
            s = f"{self.kort_i_fag(lab)} {m.get('versjon', '')}".strip()
            if m.get("merknad"):
                s += f" ({m['merknad']})"
            d.append(s)
        return " · ".join(d)


def normaliser(d: dict) -> dict:
    """data.json renamed its identity keys on 2026-09-07. Rename them back here so the rest of
    the builder reads one shape; bytes -> mb because the key changed unit as well as name."""
    d = dict(d)
    for ny, gml in NYE_NAVN.items():
        if ny in d and gml not in d:
            d[gml] = d[ny]
    if "bytes" in d and "mb" not in d:
        d["mb"] = round(d["bytes"] / 1e6, 1)
    return d




# ---------------------------------------------------------------- verdicts
@dataclass
class Vurdering:
    """One cell: the verdict, the found value, its explanation and the three shares."""
    status: str                                   # ok | warn | bad | na
    tekst: str = ""
    sub: list[str] = field(default_factory=list)
    andeler: tuple[float, float, float] | None = None   # oppfylt, avvik, mangler, in percent


def status_andel(reg: Register, krav: dict, p: float) -> str:
    t = reg.terskel(krav)
    return "ok" if p >= t["ok"] else "warn" if p >= t["warn"] else "bad"


def gjelder_ikke(krav: dict, ctx: dict) -> str | None:
    """Applicability is declared, not excused: outside `gjelder` the cell is neutral."""
    g = krav.get("gjelder")
    if not g:
        return None
    for felt, godtatte in g.items():
        v = ctx.get(felt)
        if v is None:
            continue
        if not any(str(v).upper() == str(x).upper() for x in godtatte):
            return krav.get("gjelder_ikke_tekst", "")
    return None


def krever_mangler(reg: Register, d: dict, krav: dict) -> str | None:
    """`krever` names a requirement without which this one is not measurable."""
    kid = krav.get("krever")
    if not kid:
        return None
    annen = reg.pr_id[kid]
    if (hent_tall(d, annen["datanokkel"]) or 0) > 0:
        return None
    return f"{annen['tittel']} mangler"


def pset_funnet(reg: Register, d: dict) -> str:
    """The property set name the file carries instead of the required one, or ''."""
    if not reg.psett_krav:
        return ""
    navn = reg.pr_id[reg.psett_krav]["datanokkel"]
    andre = [k for k in (d.get("psetnavn") or {}) if k != navn]
    return andre[0] if andre else ""


def vurder_data(reg: Register, d: dict, krav: dict) -> Vurdering:
    """A requirement measured against data.json: share, or a count with a denominator."""
    n = d["n"] or 0
    if hent_tall(d, krav["datanokkel"]) is None:
        # Not measured: the project config does not declare what it reads (e.g. `prosjektpsett`).
        return Vurdering("na", VERDIKT_ORD["ikke_konfigurert"])
    grunn = krever_mangler(reg, d, krav)
    if grunn:
        sub = ([brytbar(pset_funnet(reg, d))] if reg.psett_krav and krav.get("krever") == reg.psett_krav
               and pset_funnet(reg, d) else [])
        return Vurdering("na", "", [grunn] + sub)
    v = hent_tall(d, krav["datanokkel"]) or 0
    if krav.get("enhet") == "tall":
        base = hent_tall(d, krav["grunnlag"]) if krav.get("grunnlag") else n
        if not base:
            return Vurdering("na", "", ["uten grunnlag"])
        maks = reg.terskel(krav).get("maks", 0)
        st = "ok" if v <= maks else "bad"
        andeler = (pct(base - v, base), pct(v, base), 0.0)
        sub = [f"av {fmt_n(base)}"] if v else []
        return Vurdering(st, fmt_n(v), sub, andeler)
    if not n:
        return Vurdering("na", "", ["ingen objekter"])
    finnes = hent_tall(d, krav["finnes_nokkel"]) if krav.get("finnes_nokkel") else \
        (d.get("finnes") or {}).get(krav["datanokkel"])
    finnes = max(int(finnes), v) if finnes is not None else v
    finnes = min(finnes, n)
    p, p_avvik, p_mangler = pct(v, n), pct(finnes - v, n), pct(n - finnes, n)
    st = status_andel(reg, krav, p)
    sub: list[str] = []
    if st != "ok":
        if p_mangler >= p_avvik:
            sub.append(f"mangler {fmt_pct(p_mangler)} %")
        else:
            sub.append(f"avvik {fmt_pct(p_avvik)} %")
            vanlig = (d.get("vanligste_avvik") or {}).get(krav["datanokkel"])
            if vanlig:
                sub.append(kutt(vanlig[0]))
    return Vurdering(st, f"{fmt_pct(p)} %", sub, (p, p_avvik, p_mangler))


# ---------------------------------------------------------------- file-level measurements
def match_etasjer(regler: dict, storeys: list[dict],
                  plukk: list | None = None) -> tuple[list[tuple[str, str]], list[dict]]:
    """Per expected level: (status, text). Then the file's levels that matched nothing.

    Names must match the register. Tolerance is asymmetric: `toleranse_over_mm` is how far above
    the expected kote a level may sit, `toleranse_under_mm` how far below, and null is unbounded.
    A per-fag override with `krev_fullt_navnesamsvar` applies only when every expected level was
    matched by name and the file carries no extra levels.
    `plukk`, when given, receives the file storey picked for each expected level (None when the
    level is missing), in the order of `nivaaer`."""
    nivaaer = regler["nivaaer"]
    naer = regler["naer_mm"]
    vindu = regler["navnevindu_mm"]
    free = list(storeys)
    raw: list[tuple[str | None, str, float | None, bool]] = []
    for niv in nivaaer:
        navn, kote = niv["navn"], niv["kote_mm"]
        exact = [s for s in free if s["name"].strip().casefold() == navn.casefold()
                 and abs(s["elevation_mm"] - kote) <= vindu]
        near = sorted((s for s in free if abs(s["elevation_mm"] - kote) <= naer),
                      key=lambda s: abs(s["elevation_mm"] - kote))
        pick = exact[0] if exact else near[0] if near else None
        if plukk is not None:
            plukk.append(pick)
        if pick is None:
            raw.append(("bad", "mangler", None, False))
            continue
        free.remove(pick)
        raw.append((None, pick["name"].strip(), pick["elevation_mm"] - kote,
                    pick["name"].strip().casefold() == navn.casefold()))
    extras = free
    over, under = regler["toleranse_over_mm"], regler["toleranse_under_mm"]
    ov = regler.get("override")
    if ov:
        fullt = not extras and all(st != "bad" and same for st, _, _, same in raw)
        if fullt or not ov.get("krev_fullt_navnesamsvar"):
            over = ov["toleranse_over_mm"] if "toleranse_over_mm" in ov else over
            under = ov["toleranse_under_mm"] if "toleranse_under_mm" in ov else under
    out: list[tuple[str, str]] = []
    for st, name, d, same_name in raw:
        if st == "bad":
            out.append(("bad", "mangler"))
            continue
        innenfor = ((over is None or d <= over) and (under is None or -d <= under))
        if not same_name:
            parts = [name] + ([f"Δ {fmt_mm(d)} mm"] if not innenfor else [])
            out.append(("bad", " ".join(parts)))
        elif innenfor:
            out.append(("ok", ""))
        elif (over is not None and d > over and under is None) or \
             (under is not None and -d > under and over is None):
            out.append(("bad", f"Δ {fmt_mm(d)} mm"))
        else:
            out.append(("warn", f"Δ {fmt_mm(d)} mm"))
    return out, extras


def vurder_etasjer(reg: Register, r: Runde, s: dict, label: str) -> tuple[Vurdering, list, list]:
    regler = reg.etasjeregler(r.fag(label))
    rader, extras = match_etasjer(regler, s["storeys"])
    mangler = sum(1 for st, txt in rader if txt == "mangler")
    avvik = sum(1 for st, _ in rader if st != "ok") - mangler
    ok_n = sum(1 for st, _ in rader if st == "ok")
    st = "bad" if (mangler or extras or any(x == "bad" for x, _ in rader)) else "warn" if avvik else "ok"
    sub = []
    if mangler:
        sub.append(f"{mangler} mangler")
    if avvik:
        sub.append(f"{avvik} avvik")
    if extras:
        sub.append(f"{len(extras)} andre nivåer")
    return Vurdering(st, f"{ok_n}/{len(rader)}", sub), rader, extras


def vurder_filnavn(reg: Register, r: Runde, label: str) -> Vurdering:
    fil = r.cfg[label].get("fil") or f"{label}{reg.forventet['filnavn']['endelse']}"
    traff = reg.filnavn_monster().match(fil) is not None
    return Vurdering("ok" if traff else "warn", brytbar(fil), [] if traff else ["avvik"])


def vurder_koordineringsobjekt(reg: Register, s: dict) -> Vurdering:
    f = reg.forventet["koordineringsobjekt"]
    tol = float(f["toleranse_mm"])
    navnene = f.get("punktnavn") or [f"punkt {i+1}" for i in range(len(f["punkter_mm"]))]
    objs = [o for o in s.get("basepoint_objects") or []
            if o.get("xyz_mm") and not o["class"].upper().endswith("TYPE")
            and (o["class"].upper() != "IFCSITE"
                 or (f.get("godta_ifcsite_med_geometri") and o.get("lo_mm")))]

    def paa(o, x, y) -> bool:
        lo, hi = o.get("lo_mm") or o["xyz_mm"], o.get("hi_mm") or o["xyz_mm"]
        return lo[0] - tol <= x <= hi[0] + tol and lo[1] - tol <= y <= hi[1] + tol

    treff = [[o for o in objs if paa(o, *p)] for p in f["punkter_mm"]]
    navn = lambda o: o["name"].split(":")[0]
    if all(treff):
        return Vurdering("ok", kutt(navn(treff[0][0])), ["alle punkter"])
    if any(treff):
        i = next(i for i, t in enumerate(treff) if t)
        mangler = [navnene[j] for j, t in enumerate(treff) if not t]
        return Vurdering("warn", kutt(navn(treff[i][0])), ["uten " + ", ".join(mangler)])
    frie = [o for o in objs if o["class"].upper() != "IFCSITE"]
    if frie:
        o = frie[0]
        return Vurdering("warn", kutt(navn(o)),
                         ["avvik", " · ".join(m_(v) for v in o["xyz_mm"]) + " m"])
    return Vurdering("bad", "mangler")


def vurder_plassering(reg: Register, s: dict) -> Vurdering:
    f = reg.forventet["plassering"]
    xyz = s["site"]["abs_xyz_mm"]
    rot = float(s["site"].get("rotation_deg") or 0)
    i_origo = all(abs(v - o) <= float(f["toleranse_mm"]) for v, o in zip(xyz, f["origo_mm"]))
    rett = abs(rot) <= float(f["rotasjon_grader"])
    tekst = ", ".join(str(v) for v in f["origo_mm"]) if i_origo else ", ".join(m_(v) for v in xyz) + " m"
    sub = [] if rett else [f"rotert {rot:.2f}°".replace(".", ",")]
    return Vurdering("ok" if i_origo and rett else "warn", tekst,
                     sub if i_origo else ["avvik"] + sub)


def vurder_georeferering(reg: Register, s: dict) -> Vurdering:
    f = reg.forventet["georeferering"]
    mc = s.get("mapconversion")
    if not mc:
        return Vurdering("bad", "mangler")
    e, n = mc.get("eastings"), mc.get("northings")
    tol = float(f["toleranse"])
    traff = (e is not None and n is not None
             and abs(float(e) - float(f["eastings"])) <= tol
             and abs(float(n) - float(f["northings"])) <= tol)
    crs = (s.get("crs") or {}).get("name") or ""
    epsg_ok = str(f["epsg"]) in crs
    return Vurdering("ok" if traff and epsg_ok else "warn", kutt(crs) or "uten navn",
                     [f"E {e} N {n}"] if traff else ["avvik", f"E {e} N {n}"])


def er_kopi(reg: Register, verdi: str, fag: str, label: str) -> bool:
    """Copy when the value marks it outright, or when it is not one of the values configured as
    naming this model (krav.yaml `modeller.<label>.kopi_eier`)."""
    v = (verdi or "").strip()
    if not v:
        return False
    if v.lower() in {str(x).lower() for x in reg.forventet["kopi_objekt"]["sanne_verdier"]}:
        return True
    norm = lambda x: str(x).replace(" ", "").upper()
    return norm(v) not in {norm(x) for x in reg.modeller[label].get("kopi_eier") or []}


def guid_forekomster(data: dict[str, dict], labels: list[str]) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    for lab in labels:
        for gid, kopi in (data[lab].get("guid_kopi") or {}).items():
            out.setdefault(gid, []).append((lab, kopi))
    return out


def guid_en_eier(reg: Register, r: Runde, occ: list[tuple[str, str]]) -> bool:
    return sum(1 for lab, kopi in occ if not er_kopi(reg, kopi, r.fag(lab), lab)) == 1


def vurder_guid_eier(reg: Register, r: Runde, data: dict[str, dict], label: str,
                     alle: dict[str, list]) -> Vurdering:
    mine = set(data[label].get("guid_kopi") or {})
    delt = [g for g in mine if len(alle.get(g, [])) >= 2]
    if not delt:
        return Vurdering("ok", "0", ["delt"])
    ok_n = sum(1 for g in delt if guid_en_eier(reg, r, alle[g]))
    if ok_n == len(delt):
        return Vurdering("ok", fmt_n(len(delt)), ["delt, én eier"])
    return Vurdering("bad", f"{fmt_n(ok_n)}/{fmt_n(len(delt))}", ["med én eier"])


def vurder_fil(reg: Register, r: Runde, data: dict[str, dict], struktur: dict[str, dict],
               label: str, krav: dict, alle_guid: dict[str, list]) -> Vurdering:
    s = struktur[label]
    ctx = {"schema": s.get("schema") or data[label].get("schema"),
           "fag": r.fag(label), "modell": label}
    grunn = gjelder_ikke(krav, ctx)
    if grunn is not None:
        return Vurdering("na", "gjelder ikke", [grunn] if grunn else [])
    kid = krav["id"]
    if kid == "filnavn":
        return vurder_filnavn(reg, r, label)
    if kid == "etasjer":
        return vurder_etasjer(reg, r, s, label)[0]
    if kid == "koordineringsobjekt":
        return vurder_koordineringsobjekt(reg, s)
    if kid == "plassering":
        return vurder_plassering(reg, s)
    if kid == "georeferering":
        return vurder_georeferering(reg, s)
    if kid == "guid_eier":
        return vurder_guid_eier(reg, r, data, label, alle_guid)
    return vurder_data(reg, data[label], krav)


def vurder(reg: Register, r: Runde, data: dict[str, dict], struktur: dict[str, dict],
           label: str, krav: dict, alle_guid: dict[str, list]) -> Vurdering:
    if krav.get("seksjon") in ("fil", "guid"):
        return vurder_fil(reg, r, data, struktur, label, krav, alle_guid)
    d = data[label]
    grunn = gjelder_ikke(krav, {"schema": d.get("schema"), "fag": r.fag(label), "modell": label})
    if grunn is not None:
        return Vurdering("na", "gjelder ikke", [grunn] if grunn else [])
    return vurder_data(reg, d, krav)


# ================================================================ computed data
# Everything below the measurements: one computed dict per round, read by the model reports,
# the project report and the workbook alike, so no number is defined twice.

RAPPORT = stier.RAPPORT
TOKENS = RAPPORT / "tokens.css"
CSS_STD = RAPPORT / "mottakskontroll.css"
MERKE = RAPPORT / "mark-rest.svg"
# The browser that prints the PDFs: $CHROME when set, else the usual install locations, else PATH.
CHROME_PATH = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge")
CHROME = [Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
          Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
          Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
          Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe")]
NBSP = "\u00a0"
MOJIBAKE = ("Ã", "â€", "Â")
STATUSORD: dict[str, str] = {}   # filled from `etiketter` (status_*) when the labels load
BOTTER = ("oppfylt", "avvik", "mangler", "gjelder_ikke")
MENGDEORD: dict[str, str] = {}   # filled from `etiketter` (mengde_*) when the labels load
NOYTRAL = ["--sk-fordeling-1", "--sk-fordeling-2", "--sk-fordeling-3", "--sk-fordeling-4"]
# Width budget for the distribution labels: cols 2-4 less the row label (mm), two lines.
BRIKKE_BREDDE_MM = 3 * 43.5 + 2 * 4 - 32
BRIKKE_LINJER = 2
BRIKKE_MM_PER_TEGN = 1.12
BRIKKE_LUFT_MM = 4.4


def n_(v) -> str:
    return f"{int(v):,}".replace(",", NBSP)


def p_(p) -> str:
    """A share for print. Never rounds to 100 % or 0 % unless it is exactly that."""
    if p is None:
        return "–"
    if 99.95 <= p < 100:
        p = 99.9
    elif 0 < p < 0.05:
        p = 0.1
    return f"{fmt_pct(p)}{NBSP}%"


def dato_no(iso: str) -> str:
    å, m, d = str(iso)[:10].split("-")
    return f"{d}.{m}.{å}"


def kort_label(label: str, reg: "Register") -> str:
    return label.removeprefix(reg.prosjekt["kode"] + "_")


def les_tokens() -> dict[str, str]:
    """tokens.css custom properties, so the workbook fills read the same colours as the page."""
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", TOKENS.read_text(encoding="utf-8")))


def hex_(tok: dict[str, str], navn: str) -> str:
    v = tok[navn].strip()
    while v.startswith("var("):
        v = tok[v[4:-1].strip()].strip()
    return v.lstrip("#").upper()


def status_fra(reg: Register, andel: float | None, flagget: int = 0) -> str:
    if andel is None:
        return "na"
    st = status_andel(reg, {}, andel)
    return "warn" if st == "ok" and flagget else st


# ---------------------------------------------------------------- distribution
def brikkebredde(tekst: str) -> float:
    return len(tekst) * BRIKKE_MM_PER_TEGN + BRIKKE_LUFT_MM


def samle(elementer: list[dict], ordnet: bool, hale: dict | None = None) -> list[dict]:
    """Label every value while the labels fit; collapse the rest into one «andre» band.

    Flagged values and the largest go first when there is not room for all; the kept ones
    are then shown in their own order (code order for an ordered distribution). A `hale` band
    (the one-instance tail of the type distribution) is always kept."""
    budsjett = BRIKKE_BREDDE_MM * BRIKKE_LINJER
    faste = [hale] if hale else []
    brukt = sum(brikkebredde(e["tekst"]) for e in faste)
    if brukt + sum(brikkebredde(e["tekst"]) for e in elementer) <= budsjett:
        return elementer + faste
    prioritet = sorted(range(len(elementer)),
                       key=lambda i: (0 if elementer[i]["flagg"] else 1, -elementer[i]["n"], i))
    reserve = brikkebredde("andre (999) ×99 999")
    beholdt: set[int] = set()
    for i in prioritet:
        b = brikkebredde(elementer[i]["tekst"])
        if brukt + b + reserve > budsjett:
            break
        beholdt.add(i)
        brukt += b
    rest = [e for i, e in enumerate(elementer) if i not in beholdt]
    ut = [e for i, e in enumerate(elementer) if i in beholdt]
    if rest:
        n = sum(e["n"] for e in rest)
        ut.append(element(f"andre ({len(rest)})", n, farge="--sk-fordeling-andre", andre=True))
    return ut + faste


def element(verdi: str, n: int, flagg: str = "", farge: str = "", tag: str = "",
            tillegg: str = "", andre: bool = False) -> dict:
    tekst = f"{verdi} ×{n_(n)}" if n else verdi
    if tillegg:
        tekst += f" · {tillegg}"
    if tag:
        tekst += f" {tag}"
    return {"verdi": verdi, "n": n, "flagg": flagg, "farge": farge, "tag": tag,
            "tillegg": tillegg, "tekst": tekst, "andre": andre, "raa": verdi}


def farg_noytralt(elementer: list[dict]) -> None:
    i = 0
    for e in elementer:
        if e["farge"]:
            continue
        if e["flagg"] == "avvik":
            e["farge"] = "--sk-avvik-ren"
        elif e["flagg"] == "mangler":
            e["farge"] = "--sk-mangler-ren"
        else:
            e["farge"] = NOYTRAL[i % len(NOYTRAL)]
            i += 1


# ---------------------------------------------------------------- one block
def dekning(bot: dict, n: int, kilder: dict, kildenavn: list[str], nivaa: list[str]) -> dict:
    """Buckets plus the cascade split. Every source of the cascade is listed, in cascade order,
    also at 0 %, so a share always says what it was measured against (rapport-rammeverk,
    «The block»)."""
    o, a, m, na = (int(bot.get(k, 0)) for k in BOTTER)
    if o + a + m + na != n:
        raise SystemExit(f"FEIL: bøttene summerer til {o + a + m + na}, ikke {n}")
    grunn = o + a + m
    kl = kildeliste(kilder, kildenavn, grunn, nivaa)
    return {"n": n, "grunnlag": grunn, "oppfylt": o, "avvik": a, "mangler": m, "gjelder_ikke": na,
            "andel": pct(o, grunn) if grunn else None, "kilder": kl}


_SHA: dict[Path, str] = {}


def sha256_full(sti: Path) -> str:
    """The file's full SHA-256, for machines (the footer line, the workbook, beregnet.json)."""
    if sti not in _SHA:
        import hashlib
        h = hashlib.sha256()
        with open(sti, "rb") as f:
            for blokk_ in iter(lambda: f.read(1 << 20), b""):
                h.update(blokk_)
        _SHA[sti] = h.hexdigest()
    return _SHA[sti]


def les_file_schema(sti: Path) -> str:
    """FILE_SCHEMA from the STEP header, exactly as written («IFC4X3_ADD2», «IFC4 ADD2 TC1»)."""
    hode = b""
    with open(sti, "rb") as f:
        for linje in f:
            hode += linje
            if linje.strip().upper().startswith(b"DATA;") or len(hode) > 200_000:
                break
    m = re.search(rb"FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'", hode, re.I)
    return m.group(1).decode("utf-8", "replace").strip() if m else ""


def skjema_grunn(skrevet: str) -> str:
    """The schema family a declared FILE_SCHEMA belongs to: IFC2X3, IFC4, IFC4X3 …"""
    m = re.match(r"\s*(IFC\d+(?:X\d+)?)", skrevet or "", re.I)
    return m.group(1).upper() if m else ""


def kildeliste(kilder: dict, kildenavn: list[str], grunn: int, nivaa: list[str]) -> list[dict]:
    """The cascade split, every source in cascade order, 0 % included, each with the layer it was
    configured in (standard or the project code). A name «gren|kilde» belongs to one branch of a
    switched requirement; the first source of each branch is its preferred."""
    ut, sett = [], set()
    for navn, niv in zip(kildenavn, nivaa):
        gren, _, etikett = navn.rpartition("|")
        c = int(kilder.get(navn, 0))
        ut.append({"navn": etikett, "gren": gren, "n": c, "andel": pct(c, grunn), "nivaa": niv,
                   "foretrukket": gren not in sett})
        sett.add(gren)
    return ut


VERDIKT_STATUS = {"oppfylt": "ok", "kan_brukes": "warn", "ikke_oppfylt": "bad", "gjelder_ikke": "na",
                  "ikke_konfigurert": "na"}
# The words come from the config (standard.yaml `verdiktord`, edkjo 2026-09-24); these are the
# defaults the register overwrites when it is read.
# Labels from config (standard.yaml `etiketter`, project override in krav.yaml). A missing key
# is a KeyError: fail loudly rather than print a label the config does not hold.
ETIKETTER: dict[str, str] = {}


def E(k: str) -> str:
    return ETIKETTER[k]


def last_etiketter(e: dict) -> None:
    """Load the labels (merged `etiketter`) and the word maps built from them."""
    ETIKETTER.update(e)
    STATUSORD.update({s: E(f"status_{s}") for s in ("ok", "warn", "bad", "na")})
    MENGDEORD.update({s: E(f"mengde_{s}") for s in ("telleobjekt", "mengdeobjekt", "avhenger",
                                                      "ikke_relevant", "ukjent")})
    for kat, (farge, _) in list(PSETT_KATEGORI.items()):
        PSETT_KATEGORI[kat] = (farge, E(f"psett_{kat}"))


def etasjerad(kode: str, **felt) -> dict:
    """A storey-matrix row: `kode` decides (som_registeret, feil_navn, koteavvik, mangler,
    andre_nivaaer, ikke_konfigurert), `status` is its label from config."""
    d_ = felt.get("delta_mm")
    status = E(f"etasje_{kode}") + (f" Δ {fmt_mm(d_)} mm" if kode == "koteavvik" else "")
    return {**felt, "kode": kode, "status": status}


VERDIKT_ORD = {"oppfylt": "Oppfylt", "kan_brukes": "Kan brukes", "ikke_oppfylt": "Ikke oppfylt",
               "gjelder_ikke": "gjelder ikke", "ikke_konfigurert": "ikke konfigurert"}
VERDIKT_SYM = {"oppfylt": "●", "kan_brukes": "◐", "ikke_oppfylt": "○", "gjelder_ikke": "–", "ikke_konfigurert": "∅"}
# One location read through what the earlier cascade cache called it. IfcRelAssociatesMaterial was
# measured as two cascade steps, the named material and the layer set.
STED_ALIAS = {"IfcRelAssociatesMaterial": ["IfcRelAssociatesMaterial", "IfcMaterial", "IfcMaterialLayerSet"]}


def tom_dekning(n: int) -> dict:
    return {"n": n, "grunnlag": 0, "oppfylt": 0, "avvik": 0, "mangler": 0, "gjelder_ikke": 0,
            "andel": None, "kilder": []}


def har_verdiliste(bid: str, bdef: dict) -> bool:
    """Accepted values are declared for the requirement: a pattern, a code table, a value list, an
    exclusion list, the project's MMI codes, the fagkoder, or the project's storeys."""
    return bool(bdef.get("gyldig") or bdef.get("kodetabell") or bdef.get("gyldige")
                or bdef.get("ikke_materiale") or bdef.get("mmi_fase")) and bid != "produkt" \
        or bid in ("mmi", "kopiobjekt")


def tilstede(rad: dict) -> tuple[int, int] | None:
    """Presence: the elements that carry the property, x of N, N being the elements that should.
    Where accepted values are declared, a carried but invalid value is still present (validity reads
    it); where none are, only the accepted form counts. None when there is nothing to check."""
    dk = rad.get("dekning")
    if dk is None or dk.get("andel") is None:
        return None
    x = dk["oppfylt"] + (dk["avvik"] if rad.get("gyldighet") is not None else 0)
    return x, dk["grunnlag"]


def unike_verdier(rad: dict) -> list[tuple[str, int, bool]]:
    """Every distinct value found at the location: (value, objects, valid). A collapsed tail band
    (the one-instance types) counts as the number of values it stands for."""
    ut = []
    for e in rad.get("fordeling_alle") or []:
        if e.get("andre"):
            continue
        if e.get("hale"):
            ut += [(f'{e["verdi"]} #{k}', 1, True) for k in range(int(e["n"]))]
            continue
        ut.append((e.get("raa", e["verdi"]), int(e["n"]), e["flagg"] != "avvik"))
    return ut


def antall_unike(rad: dict) -> int:
    return len(unike_verdier(rad))


def gyldig(rad: dict) -> tuple[int, int, list] | None:
    """Validity: where the requirement is tied to accepted values (a list or a range), the share of
    the objects carrying the property (Dekning's x) whose value is valid, x of n objects. Weighted by
    objects, not unique values (2026-10-08): one empty value on 0.25 % of the objects read 50 % as
    «1 of 2 unique values». None where no list or range is declared. The storey span of Objekter i
    etasje is a range per object with no value list, a share of the contained objects as well."""
    sp = rad.get("spenn")
    if sp:
        tot = sp["oppfylt"] + sp["avvik"] + sp["mangler"]
        return sp["oppfylt"], tot, []
    if rad.get("gyldighet") is None:
        return None
    gy = rad["gyldighet"]
    return gy["innenfor"], gy["innenfor"] + sum(n for _, n in gy["utenfor"]), gy["utenfor"]


TERSKLER = {"dekning": {"ok": 95, "warn": 5}, "gyldig": {"ok": 100, "warn": 95}}  # set from the config


def lys(p: float, t: dict) -> str:
    """Traffic light for a share against a configured threshold: ok ≥ t.ok, warn ≥ t.warn, else bad."""
    return "ok" if p >= float(t["ok"]) else "warn" if p >= float(t["warn"]) else "bad"


def verdikt_fra(rad: dict, terskler: dict | None = None, binaer: bool = False) -> str:
    """The requirement's status from its two numbers and the configured thresholds (the one place):
    oppfylt when Dekning and Gyldig are both green (Gyldig «–» is neutral); kan brukes when neither
    is red and at least one is amber; ikke oppfylt when either is red; gjelder ikke when there is
    nothing to check. With `binaer` (GUID) there is no middle state: anything short of green is
    ikke oppfylt."""
    t_ = terskler or TERSKLER
    t = tilstede(rad)
    if t is None or t[1] == 0:
        return "gjelder_ikke"
    lysene = [lys(pct(t[0], t[1]), t_["dekning"])]
    g = gyldig(rad)
    if g is not None and g[1]:
        lysene.append(lys(pct(g[0], g[1]), t_["gyldig"]))
    if "bad" in lysene:
        return "ikke_oppfylt"
    if "warn" in lysene:
        return "ikke_oppfylt" if binaer else "kan_brukes"
    return "oppfylt"


def guid_verdikt(duplikater: int) -> str:
    """GUID is binary, never «kan brukes»: no duplicate in the file is oppfylt, any duplicate is
    ikke oppfylt. GUIDs shared with other models do not affect it."""
    return "oppfylt" if duplikater == 0 else "ikke_oppfylt"


def rad_verdikt(reg: "Register", rad: dict) -> str:
    return verdikt_fra(rad, {"dekning": reg.standard["terskel"], "gyldig": reg.terskel_gyldig or TERSKLER["gyldig"]})


def etasjedefinisjon_verdikt(em: dict) -> str:
    """Etasjedefinisjon: an extra level or a name mismatch is ikke oppfylt; a kote deviation within
    twice the tolerance is kan brukes, beyond it ikke oppfylt; missing levels alone are oppfylt."""
    t = em["toleranse"]
    verst = "oppfylt"
    for r_ in em["rader"]:
        kode = r_["kode"]
        if kode in ("andre_nivaaer", "feil_navn"):
            return "ikke_oppfylt"
        if kode == "koteavvik":
            d_ = float(r_.get("delta_mm") or 0)
            grense = t["over"] if d_ > 0 else t["under"]
            if grense is not None and abs(d_) > 2 * float(grense):
                return "ikke_oppfylt"
            verst = "kan_brukes"
    return verst


def kpi_lys(verdi: float | None, t: dict | None) -> str:
    """Traffic light for a Nøkkeltall card from its configured threshold (standard.yaml
    `kpi_terskler`): `retning: lav` is green below `gronn`, yellow up to `gul`, red above;
    `retning: hoy` is green at or above `gronn`, yellow from `gul`, red below. No threshold, no
    judgement: neutral."""
    if verdi is None or not t:
        return ""
    if t["retning"] == "lav":
        return "ok" if verdi < t["gronn"] else "warn" if verdi <= t["gul"] else "bad"
    return "ok" if verdi >= t["gronn"] else "warn" if verdi >= t["gul"] else "bad"


def kpi_kort(kpi_alle: list[dict], band: list[str], terskler: dict, typer: int, n_alle: int,
             typede: int, en: int, utypet: int) -> list[dict]:
    """The band's counts over every IfcProduct, each with its traffic light."""
    tall = {"antall_typer": typer, "antall_elementer": n_alle,
            "instanser_per_type_alle": typede / typer if typer else None,
            "typer_med_en_instans_alle": pct(en, typer) if typer else None,
            "utypede_instanser": pct(utypet, n_alle) if n_alle else None}
    tekst = {
        "antall_typer": (n_(typer), ""),
        "antall_elementer": (n_(n_alle), "IfcProduct"),
        "instanser_per_type_alle": (fmt_pct(typede / typer) if typer else "–", f"{n_(typede)} / {n_(typer)}"),
        "typer_med_en_instans_alle": (n_(en), p_(pct(en, typer)) if typer else ""),
        "utypede_instanser": (n_(utypet), p_(pct(utypet, n_alle)) if n_alle else ""),
    }
    titler = {k["id"]: k["tittel"] for k in kpi_alle}
    return [{"id": k, "tittel": titler[k], "tekst": tekst[k][0], "under": tekst[k][1],
             "status": kpi_lys(tall[k], (terskler or {}).get(k))} for k in band]


def fase_fra_mmi(verdier: list[tuple], kart: dict[str, str]) -> list[dict]:
    """Fase read through the project's MMI phasing (krav.yaml `forventet.mmi.fase`): the MMI values
    summed per phase, in the mapping's order; a value that maps to no phase stays as found, outside
    the accepted values. `verdier` is (value, count)."""
    per_fase: dict[str, int] = {}
    utenfor = []
    for v, n in verdier:
        fase = kart.get(str(v).strip())
        if fase:
            per_fase[fase] = per_fase.get(fase, 0) + int(n)
        else:
            utenfor.append((str(v), int(n)))
    rekke = list(dict.fromkeys(kart.values()))
    ut = []
    for f in sorted(per_fase, key=rekke.index):
        e = element(kutt(f, 34), per_fase[f])
        e["raa"] = f
        ut.append(e)
    for v, n in utenfor:
        e = element(kutt(v, 34), n, "avvik")
        e["raa"] = v
        ut.append(e)
    return ut


def telling_rad(sted: dict, linjer: list[tuple[str, str]]) -> dict:
    """A reading told as counts, without coverage or bars."""
    return {"gren": "", "sted": blokkdata.kildeetikett(sted), "nivaa": sted.get("nivaa", konfig.STANDARD),
            "mock": False, "gyldighet": None, "telling": linjer, "fordeling": [], "fordeling_alle": []}


# The template's Nøkkeltall grid (bygg_mal.py KPI_CSS, same rules): seven cards in four columns.
KPI_CSS = """
.mk .kpi { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mk .kpi .flis { flex-wrap: wrap; min-width: 0; }
.mk .kpi .flis .etikett, .mk .kpi .flis .under { white-space: normal; overflow-wrap: break-word; min-width: 0; }
.mk .kpi .flis .under { margin-left: 0; flex-basis: 100%; }
"""


class Modellberegning:
    """The ten blocks, the KPI band, the hygiene strip and the type register of one model."""

    def __init__(self, reg: Register, r: Runde, label: str, d: dict, bd: dict, s: dict,
                 alle_guid: dict, tok: dict, kodetabell: set[str] | None, geo: dict):
        self.reg, self.r, self.label, self.d, self.bd, self.s = reg, r, label, d, bd, s
        self.geo = geo
        m = r.cfg[label]
        fil = r.ifc_sti(label)
        self.skjema_skrevet = les_file_schema(fil)
        self.sha256 = sha256_full(fil)
        if not self.sha256.startswith(m["sha16"]):
            raise SystemExit(f"FEIL: {label}: sha256 {self.sha256[:16]} ≠ runde {m['sha16']}")
        # Applicability elsewhere (georeferering) reads the schema from the requirement, not the dump.
        self.s = {**s, "schema": skjema_grunn(self.skjema_skrevet) or s.get("schema")}
        self.alle_guid, self.tok, self.kodetabell = alle_guid, tok, kodetabell
        self.fag = r.fag(label)
        self.omfang = {label, self.fag, "alle"}

    # -- per block
    # ================================================================ the requirement
    # One location per requirement (standard.yaml, krav.yaml, konfig.py). The block is the minimum
    # edkjo set on 2026-09-24: krav, sted, dekning, fordeling, gyldig (only where accepted values
    # are declared) and one verdict. The numbers are read from the frozen caches, which were
    # measured on the earlier multi-source cascade: a reading is taken as it is only where the
    # cache can give it for the one location exactly, and is labelled MOCK otherwise.

    def krav(self, bdef: dict) -> dict:
        bid = bdef["id"]
        merk = [m for kid in bdef.get("krav", []) for m in self.reg.merknad_rader(kid, self.omfang)]
        base = {"id": bid, "tittel": bdef["tittel"], "kilde": bdef.get("kilde", ""),
                "seksjon": bdef.get("seksjon", ""), "krav_tekst": bdef.get("krav_tekst", ""),
                "merknader": merk, "krav": bdef.get("krav", []), "aapne": [], "bryter": None,
                "fordeling_alle": [], "flagget": 0, "spenn": {}}
        if bdef.get("ikke_konfigurert"):
            return {**base, "verdikt": "ikke_konfigurert", "rader": [], "status": "na",
                    "mock": False, "dekning": tom_dekning(self.d["n"])}
        if bid in self.unntatte():
            return {**base, "verdikt": "gjelder_ikke", "rader": [], "status": "na",
                    "mock": False, "dekning": tom_dekning(self.d["n"])}
        if bid in ("produkt", "materiale"):
            return self.krav_gren(bdef, base)
        if bid == "guid":
            return self.krav_guid(bdef, base)
        if bid == "etasjedefinisjon":
            return self.krav_etasjedefinisjon(bdef, base)
        rad = self.lesing(bid, bdef, bdef["sted"])
        if bdef.get("fase_kart"):
            rad["fase_tittel"] = bdef["fase_tittel"]
            rad["fase_fordeling"] = fase_fra_mmi(
                [(e["raa"], e["n"]) for e in rad["fordeling_alle"] if "raa" in e], bdef["fase_kart"])
        verdikt = rad_verdikt(self.reg, rad)
        ut = {**base, "rader": [rad], "verdikt": verdikt, "status": VERDIKT_STATUS[verdikt],
              "mock": rad["mock"] or rad.get("mock_verdikt", False), "dekning": rad["dekning"],
              "fordeling_alle": rad["fordeling_alle"], "spenn": rad.get("spenn", {})}
        ut["flagget"] = sum(n for _, n in rad["gyldighet"]["utenfor"]) if rad.get("gyldighet") else 0
        return ut

    def lesing(self, bid: str, bdef: dict, sted: dict, gren: str = "", grunnlag: int | None = None) -> dict:
        """One reading of one location: dekning, fordeling and, where accepted values are declared,
        gyldighet. Exact from the cache, or MOCK."""
        n = self.d["n"]
        stedtekst = blokkdata.kildeetikett(sted)
        rad = {"gren": gren, "sted": stedtekst, "nivaa": sted.get("nivaa", konfig.STANDARD),
               "mock": False, "gyldighet": None, "grunnlag_tekst": E("objekter")}
        if bid == "guid":
            dup = int(self.d.get("dup") or 0)
            rad["dekning"] = dekning({"oppfylt": n - dup, "avvik": dup}, n, {}, [], [])
            rad["fordeling_alle"] = self.ford_guid(dup)
            rad["fordeling"] = samle(rad["fordeling_alle"], False)
            farg_noytralt(rad["fordeling"])
            return rad
        # Fase with MMI phasing reads the MMI location's cache: one location, the configured one.
        kilde_bid = "mmi" if bdef.get("mmi_fase") else bid
        bb_ = self.bd["blokker"][kilde_bid if bid not in ("produkt", "materiale") else "materialprodukt"]
        navn = bb_["kildenavn"]
        alias = STED_ALIAS.get(stedtekst, [stedtekst])
        nokler = [f"{gren}|{a}" if gren else a for a in alias]
        andre = [k for k in navn if k not in nokler and (not gren or k.startswith(gren + "|"))]
        fremmede = sum(int(bb_["kilder_alle"].get(k, 0)) for k in andre)
        if gren:
            fremmede += sum(int(bb_["kilder_alle"].get(k, 0)) for k in navn if not k.startswith(gren + "|"))
        finnes = any(k in navn for k in nokler)
        eksakt = finnes and fremmede == 0
        if gren and finnes and sum(int(bb_["kilder_alle"].get(k, 0)) for k in nokler) == 0:
            # Nothing was ever found at the location: its reading is exact whatever else the
            # earlier cascade found elsewhere.
            eksakt = True
        if self.bd.get("ett_sted"):
            # Measured at the configured location and nowhere else (blokkdata 6): exact by
            # construction. A cache measured at another location than the config names is a
            # stale cache, never a reading.
            if not finnes:
                raise SystemExit(f"FEIL: {self.label}: {bid} er målt på {navn}, konfigurasjonen sier {nokler}")
            eksakt = True
        if bdef.get("grunnlag") == "alle_ifcproduct":
            rad["grunnlag_tekst"] = "IfcProduct"
        if not gren:
            nb = self.bd["n_alle"] if bdef.get("grunnlag") == "alle_ifcproduct" else n
            if eksakt:
                rad["dekning"] = dekning(bb_["botter"], nb, {}, [], [])
            else:
                # Oppfylt at the location is exact whenever no source ahead of it in the old
                # cascade supplied anything; the rest cannot be split into avvik and mangler.
                o = sum(int(bb_["kilder"].get(k, 0)) for k in nokler) if finnes else 0
                na = int(bb_["botter"].get("gjelder_ikke", 0))
                rad["dekning"] = dekning({"oppfylt": o, "mangler": nb - na - o, "gjelder_ikke": na},
                                         nb, {}, [], [])
                rad["mock_dekning"] = not finnes
        else:
            o = sum(int(bb_["kilder"].get(k, 0)) for k in nokler)
            carried = sum(int(bb_["kilder_alle"].get(k, 0)) for k in nokler)
            a = carried - o if eksakt else 0
            rad["dekning"] = dekning({"oppfylt": o, "avvik": a, "mangler": grunnlag - o - a},
                                     grunnlag, {}, [], [])
            rad["grunnlag_tekst"] = {"telleobjekt": E("telleobjekter"), "mengdeobjekt": E("mengdeobjekter")}[gren]
        if bid not in ("produkt", "materiale"):
            ford, ordnet = getattr(self, f"ford_{bid}")(bb_)
        elif self.bd.get("ett_sted"):
            # One branch's values only: a product never lands in the material distribution.
            ford, ordnet = self.ford_verdier({"verdier": (bb_.get("verdier_gren") or {}).get(gren, [])}), False
        else:
            ford, ordnet = self.ford_verdier(bb_), False
        if gren and (not eksakt or sum(int(bb_["kilder_alle"].get(k, 0)) for k in nokler) == 0):
            # Nothing found at the location (an exact, empty distribution), or the cache cannot
            # separate this location's values from the rest (MOCK).
            ford = []
        # Etasjespenn (Ed-Skiplum/ifc-check#2) is not measured in v1: no span reading is attached,
        # so Objekter i etasje carries Dekning only. `spenn_mock` stays for the template.
        rad["fordeling_alle"] = ford
        if bid == "typeobjekt":
            hale = next((e for e in ford if e.get("hale")), None)
            rad["fordeling"] = samle([e for e in ford if not e.get("hale")], False, hale)
        else:
            rad["fordeling"] = samle(ford, ordnet)
        # The distribution prints neutral: validity carries the verdict. Copies, so the flags stay
        # on the full distribution the validity row and the workbook read.
        rad["fordeling"] = [dict(e) for e in rad["fordeling"]]
        for e in rad["fordeling"]:
            if e["flagg"] in ("avvik", "mangler") and not e["farge"].startswith("--mmi"):
                e["farge"] = ""
            e["flagg"] = "flagg" if e["flagg"] == "flagg" else ""
        farg_noytralt(rad["fordeling"])
        rad["mock"] = not eksakt and bid not in ("typeobjekt", "etasjer")
        if har_verdiliste(bid, bdef):
            # Within vs outside the declared accepted values, read from the same distribution.
            rad["gyldighet"] = {
                "innenfor": sum(e["n"] for e in ford if e["flagg"] != "avvik"),
                "utenfor": [(e["verdi"] + (f" {e['tillegg']}" if e["tillegg"] else ""), e["n"])
                            for e in ford if e["flagg"] == "avvik"]}
        return rad

    def krav_guid(self, bdef: dict, base: dict) -> dict:
        """Counts, not coverage: duplicates in the file decide (0 = oppfylt); GUIDs shared with other
        models are a reading."""
        dup = int(self.d.get("dup") or 0)
        mine = set(self.d.get("guid_kopi") or {})
        per: dict[str, int] = collections.Counter()
        for g in mine:
            for lab, _ in self.alle_guid.get(g, []):
                if lab != self.label:
                    per[lab] += 1
        delt = sum(1 for g in mine if any(lab != self.label for lab, _ in self.alle_guid.get(g, [])))
        rad = telling_rad(bdef["sted"], [
            (E("duplikater_i_fila"), n_(dup)),
            (E("delt_med_andre_modeller"), n_(delt) + (f" ({' · '.join(f'{kort_label(k, self.reg)} ×{n_(c)}' for k, c in per.most_common())})" if per else ""))])
        verdikt = guid_verdikt(dup)
        return {**base, "rader": [rad], "verdikt": verdikt, "status": VERDIKT_STATUS[verdikt], "mock": False,
                "dekning": tom_dekning(self.d["n"]), "duplikater": dup, "delt": delt}

    def krav_etasjedefinisjon(self, bdef: dict, base: dict) -> dict:
        """The model's storeys against the configured floors: the etasjematrise. Oppfylt with no
        extra level and every matched level's name and kote within tolerance; a missing level is
        allowed and shown."""
        em = self.etasjematrise()
        rad = telling_rad(bdef["sted"], [])
        rad["etasjematrise"] = em
        if not em["konfigurert"]:
            verdikt = "ikke_konfigurert"
        else:
            tall = collections.Counter(r_["status"].split(" ")[0] for r_ in em["rader"])
            rad["telling"] = [(E("etasjer_telling"), f"{E('konfigurert')} {n_(sum(1 for r_ in em['rader'] if r_['k_navn']))} · "
                                                    f"{E('i_modellen')} {n_(sum(1 for r_ in em['rader'] if r_['m_navn']))}")]
            verdikt = etasjedefinisjon_verdikt(em)
        return {**base, "rader": [rad], "verdikt": verdikt, "status": VERDIKT_STATUS[verdikt], "mock": False,
                "dekning": tom_dekning(self.d["n"])}

    def krav_gren(self, bdef: dict, base: dict) -> dict:
        """Produkt (telleobjekter) or Materiale (mengdeobjekter): one location, presence over the
        objects of its kind, «gjelder ikke» when the model has none."""
        gren = bdef["grunnlag"]
        tall = collections.Counter()
        for kl, mt, enhet, c, _ in self.bd["mengdeklasser"]:
            tall[mt] += c
        rad = self.lesing(bdef["id"], bdef, bdef["sted"], gren, tall[gren])
        verdikt = rad_verdikt(self.reg, rad)
        return {**base, "rader": [rad], "verdikt": verdikt, "status": VERDIKT_STATUS[verdikt],
                "mock": rad["mock"], "dekning": rad["dekning"],
                "bryter": {"gren": gren, "antall": tall[gren], "n": self.d["n"]},
                "aapne": self.aapne(bdef), "fordeling_alle": rad["fordeling_alle"],
                "flagget": sum(n for _, n in rad["gyldighet"]["utenfor"]) if rad.get("gyldighet") else 0}

    def spenn_mock(self, bdef: dict) -> dict:
        """MOCK (edkjo 2026-09-24, «template is first, mock data is ok»): the three-state storey
        span of Ed-Skiplum/ifc-check#2 is not measured in this round. The counts are a fixed split
        of the contained objects, 90 / 7 / 3 %, and are labelled MOCK wherever they print."""
        inne = self.bd["blokker"]["etasjer"]["botter"].get("oppfylt", 0)
        a = inne * 7 // 100
        m = inne * 3 // 100
        return {"mock": True, "oppfylt": inne - a - m, "avvik": a, "mangler": m,
                "under_toleranse_m": float(bdef["spenn_under_toleranse_m"])}

    def skjema_tile(self) -> dict:
        """The schema: version as written, and whether it is accepted. With `anbefalt` configured, an
        accepted schema outside it is Kan brukes rather than Oppfylt."""
        cfg = self.reg.skjema
        skrevet = self.skjema_skrevet
        grunn = skjema_grunn(skrevet)
        godtatte = [str(x).upper() for x in cfg.get("godtatte") or []]
        anbefalt = [str(x).upper() for x in cfg.get("anbefalt") or []]
        unntak = cfg.get("unntak") or []
        system = self.d.get("system") or ""
        ok = grunn in godtatte or any(
            grunn == str(u["skjema"]).upper() and re.search(u["system_monster"], system, re.I)
            for u in unntak)
        godtatt = " · ".join(godtatte + [f"{u['skjema']} ({u['system_monster']})" for u in unntak])
        verdikt = "ikke_oppfylt"
        if skrevet and ok:
            verdikt = "kan_brukes" if anbefalt and grunn not in anbefalt else "oppfylt"
        return {"skrevet": skrevet or "–", "verdikt": verdikt, "godtatt": godtatt, "kilde": cfg.get("kilde", "")}

    def kpi_band(self) -> list[dict]:
        """The band's counts, all over every IfcProduct (the grunnlag of Typeobjekt)."""
        tr = self.bd["typer_alle"]
        n_alle = int(self.bd["n_alle"])
        typer = len(tr)
        typede = sum(c for _, _, c in tr)
        en = sum(1 for _, _, c in tr if c == 1)
        utypet = n_alle - typede
        return kpi_kort(self.reg.kpi_alle, self.reg.kpi_band, self.reg.kpi_terskler,
                        typer, n_alle, typede, en, utypet)

    def etasjematrise(self) -> dict:
        """Configured storeys against the model's, ordered by level. Terms from the earlier
        etasjematrise: som registeret, koteavvik (Δ mm), feil navn, mangler, andre nivåer."""
        regler = self.reg.etasjeregler(self.fag)
        storeys = self.s["storeys"]
        e = self.reg.forventet.get("etasjer") or {}
        tol = {"over": regler.get("toleranse_over_mm"), "under": regler.get("toleranse_under_mm")}
        if not regler.get("nivaaer"):
            return {"konfigurert": False, "rader": [etasjerad("ikke_konfigurert", k_navn="", k_kote=None,
                                                             m_navn=s["name"].strip(), m_kote=s["elevation_mm"],
                                                             sym="na") for s in storeys], "toleranse": tol}
        plukk: list = []
        rader_, extras = match_etasjer(regler, storeys, plukk)
        ut = []
        for niv, pick, (st, txt) in zip(regler["nivaaer"], plukk, rader_):
            if pick is None:
                ut.append(etasjerad("mangler", k_navn=niv["navn"], k_kote=niv["kote_mm"], m_navn="", m_kote=None,
                                    sym="na", sortering=niv["kote_mm"]))
                continue
            d_ = (pick["elevation_mm"] or 0) - niv["kote_mm"]
            if st == "ok":
                kode, s_ = "som_registeret", "ok"
            elif pick["name"].strip().casefold() != niv["navn"].casefold():
                kode, s_ = "feil_navn", "warn"
            else:
                kode, s_ = "koteavvik", "warn"
            ut.append(etasjerad(kode, k_navn=niv["navn"], k_kote=niv["kote_mm"], m_navn=pick["name"].strip(),
                                m_kote=pick["elevation_mm"], sym=s_, delta_mm=d_, sortering=niv["kote_mm"]))
        for x in extras:
            ut.append(etasjerad("andre_nivaaer", k_navn="", k_kote=None, m_navn=x["name"].strip(),
                                m_kote=x["elevation_mm"], sym="warn", sortering=x["elevation_mm"] or 0))
        ut.sort(key=lambda r_: (r_["sortering"] if r_["sortering"] is not None else -1e18))
        ov = regler.get("override") or {}
        # The discipline's tolerance, on the same condition as match_etasjer: every level matched by
        # name and no extra levels, when the override requires it (RIB: OK bærende dekke, 2026-09-14).
        fullt = not extras and all(p is not None and p["name"].strip().casefold() == n["navn"].casefold()
                                   for n, p in zip(regler["nivaaer"], plukk))
        if ov and (fullt or not ov.get("krev_fullt_navnesamsvar")):
            tol = {"over": ov.get("toleranse_over_mm", tol["over"]), "under": ov.get("toleranse_under_mm", tol["under"])}
        return {"konfigurert": True, "rader": ut, "toleranse": tol,
                "referanse": ov.get("referanse") or e.get("referanse", "")}

    def modellmerknader(self) -> list[dict]:
        """The model's own comment section: merknader_modell for this model, then model- or
        fagkode-scoped entries under the hygiene requirements."""
        ut = [{**m, "kilde": ""} for m in self.reg.merknader_modell.get(self.label, [])]
        for kid in ("filnavn", "koordineringsobjekt", "plassering", "georeferering"):
            for m in self.reg.merknad_rader(kid, self.omfang):
                ut.append({**m, "kilde": self.reg.tittel(kid)})
        return ut

    def psett(self) -> list[dict]:
        """Every property set read from the model, with its category: (a) IFC, a name in the
        standard list shipped with the default layer (standard_psett.yaml: IFC4 for every file,
        plus IFC2X3 for an IFC2X3 file); (b) krevd, named by a source in the project configuration
        layer; (c) annen. Sorted by category, then by objects."""
        liste = yaml.safe_load(STANDARD_PSETT.read_text(encoding="utf-8"))
        standard_navn = set(liste["IFC4"])
        if (self.s.get("schema") or "").upper() in liste and (self.s.get("schema") or "").upper() != "IFC4":
            standard_navn |= set(liste[self.s["schema"].upper()])
        krevde = []
        for bdef in self.reg.blokker:
            for nokkel in konfig.STEDER:
                for s in [bdef[nokkel]] if bdef.get(nokkel) else []:
                    if s.get("nivaa") != konfig.PROSJEKT:
                        continue
                    if "pset" in s:
                        krevde.append(lambda n, p=s["pset"]: n.replace(" ", "").lower() == p.replace(" ", "").lower())
                    elif "pset_monster" in s:
                        krevde.append(lambda n, rx=re.compile(s["pset_monster"], re.I): bool(rx.search(n)))
        rekke = {"ifc": 0, "krevd": 1, "annen": 2}
        ut = []
        for p in self.bd["psett"]:
            navn = p["navn"]
            if navn in standard_navn:
                kat = "ifc"
            elif any(f(navn) for f in krevde):
                kat = "krevd"
            else:
                kat = "annen"
            eg = [{**e, "andel": pct(e["fylt"], p["objekter"])} for e in p["egenskaper"]]
            ut.append({**p, "egenskaper": eg, "kategori": kat, "kategori_tekst": PSETT_KATEGORI[kat][1]})
        ut.sort(key=lambda x: (rekke[x["kategori"]], -x["objekter"], x["navn"]))
        return ut

    def aapne(self, bdef: dict) -> list[str]:
        """Open rulings where they touch the switch: the objects of their classes in this model.
        A ruling with no class mapping is always shown, since it cannot be told apart."""
        tall = collections.Counter()
        for kl, mt, enhet, c, _ in self.bd["mengdeklasser"]:
            tall[kl] += c
        ut = []
        for a in bdef.get("aapne", []):
            if not a["klasser"]:
                ut.append(a["tittel"])
                continue
            c = sum(tall[k] for k in a["klasser"])
            if c:
                ut.append(f"{a['tittel']} ×{n_(c)}")
        return ut

    def ekstra(self, bid: str, bb: dict, dk: dict) -> list[dict]:
        """A block's additional reading, printed on the source line."""
        ut = []
        if bid == "typeobjekt" and dk["avvik"]:
            ut.append({"tekst": f"typet uten navn {n_(dk['avvik'])}", "flagg": True})
        if bid == "funksjonskode":
            e = bb.get("ekstra") or {}
            ja, nei = int(e.get("samsvar", 0)), int(e.get("ikke_samsvar", 0))
            if ja + nei:
                p = pct(ja, ja + nei)
                ut.append({"tekst": f"samsvar kode og typenavn {p_(p)} av {n_(ja + nei)}",
                           "flagg": status_andel(self.reg, {}, p) != "ok"})
        if bid == "etasjer":
            h = self.bd["hierarki"]
            for k, navn in (("bygg", "bygg"), ("tomt", "tomt"), ("rom", "rom"), ("annet", "annet"),
                            ("ingen", "uten tilknytning")):
                if h.get(k):
                    ut.append({"tekst": f"{navn} {n_(h[k])}", "flagg": True})
        return ut

    # -- distributions
    def ford_typeobjekt(self, bb: dict) -> tuple[list[dict], bool]:
        """Instances per type over every IfcProduct, and the tail of one-instance types."""
        tr = self.bd["typer_alle"]
        fler = [element(nv or "–", c) for kl, nv, c in tr if c > 1]
        en = sum(1 for kl, nv, c in tr if c == 1)
        ut = fler
        if en:
            h = element(f"{E('typer_med_en_instans')} ({en})", en, farge="--sk-fordeling-andre")
            h["hale"] = True
            ut = ut + [h]
        return ut, False

    def ford_verdier(self, bb: dict, flagg_ukjent=None) -> list[dict]:
        ut = []
        for v, n, st in bb["verdier"]:
            fl = "avvik" if st == "avvik" else ""
            if not fl and flagg_ukjent and flagg_ukjent(v):
                fl = "avvik"
            el = element(kutt(v, 34), n, fl)
            el["raa"] = v
            ut.append(el)
        return ut

    def ford_systemkode(self, bb):
        return self.ford_verdier(bb), False

    def ford_funksjonskode(self, bb):
        if self.kodetabell is None:
            return self.ford_verdier(bb), False
        return self.ford_verdier(bb, lambda v: v.strip().upper() not in self.kodetabell), False

    def ford_materialprodukt(self, bb):
        """Products (telleobjekt) and materials (mengdeobjekt) as found, then the classes whose
        mengdetype could not be decided, which have neither reading."""
        ut = self.ford_verdier(bb)
        for kl, mt, enhet, c, _ in self.bd["mengdeklasser"]:
            if mt in ("avhenger", "ukjent"):
                el = element(kl, c, "mangler", tillegg=MENGDEORD[mt])
                ut.append(el)
        return ut, False

    def ford_fase(self, bb):
        kart = next((b.get("mmi_fase") for b in self.reg.blokker if b["id"] == "fase"), None)
        if kart:
            return fase_fra_mmi([(v, n) for v, n, _ in bb["verdier"]], kart), True
        return self.ford_verdier(bb), False

    def ford_mmi(self, bb):
        koder = {str(k) for k in self.reg.forventet["mmi"]["koder"]}
        def nokkel(x):
            return (0, int(x[0]), "") if x[0].isdigit() else (1, 0, x[0])
        ut = []
        for v, n, _ in sorted(bb["verdier"], key=nokkel):
            tok = f"--mmi-{v}" if v.isdigit() and len(v) == 3 else ""
            farge = tok if tok in self.tok else "--mmi-uten-farge"
            el = element(kutt(v, 30), n, "" if v in koder else "avvik", farge=farge)
            el["raa"] = v
            ut.append(el)
        return ut, True

    def ford_kopiobjekt(self, bb):
        godtatte = {f.upper() for f in self.reg.fagkoder}
        sanne = {str(x).lower() for x in self.reg.forventet["kopi_objekt"]["sanne_verdier"]}
        ut = []
        for v, n, _ in bb["verdier"]:
            if v == "(tom)":
                ut.append(element(v, n, "avvik"))
                continue
            gyldig = v.strip().upper() in godtatte or v.strip().lower() in sanne
            rolle = "kopi" if er_kopi(self.reg, v, self.fag, self.label) else "eier"
            ut.append(element(f"{rolle} · {kutt(v, 20)}", n, "" if gyldig else "avvik"))
        return ut, False

    def ford_guid(self, dup: int) -> list[dict]:
        mine = set(self.d.get("guid_kopi") or {})
        per: dict[str, list[str]] = {}
        for g in mine:
            for lab, _ in self.alle_guid.get(g, []):
                if lab != self.label:
                    per.setdefault(lab, []).append(g)
        delt = {g for gs in per.values() for g in gs}
        ut = [element("ikke delt", len(mine) - len(delt))] if len(mine) - len(delt) else []
        for lab in sorted(per, key=lambda x: -len(per[x])):
            gs = per[lab]
            ok_n = sum(1 for g in gs if guid_en_eier(self.reg, self.r, self.alle_guid[g]))
            fl = "" if ok_n == len(gs) else "avvik"
            ut.append(element(f"delt med {kort_label(lab, self.reg)}", len(gs), fl,
                              tillegg="" if not fl else f"{n_(ok_n)}/{n_(len(gs))} med én eier"))
        if dup:
            ut.append(element("duplikat", dup, "avvik"))
        return ut

    def ford_etasjer(self, bb) -> tuple[list[dict], bool]:
        regler = self.reg.etasjeregler(self.fag)
        storeys = self.s["storeys"]
        plukk: list = []
        # Storeys against the configured floors; with none configured (standard-only), no flags.
        rader, extras = match_etasjer(regler, storeys, plukk) if regler.get("nivaaer") else ([], [])
        e = self.reg.forventet.get("etasjer") or {}
        alvor = {"ekstra": e.get("ekstra_nivaer", "avvik"), "mangler": e.get("manglende_nivaer", "flagg"),
                 "kote": e.get("feil_kote", "avvik"), "navn": e.get("feil_navn", "avvik")}
        status: dict[int, tuple[str, str]] = {}
        for niv, pick, (st, txt) in zip(regler.get("nivaaer") or [], plukk, rader):
            if pick is None:
                continue
            if st == "ok":
                status[id(pick)] = ("", "")
            elif pick["name"].strip().casefold() != niv["navn"].casefold():
                status[id(pick)] = (alvor["navn"], f"≠ {niv['navn']}")
            else:
                status[id(pick)] = (alvor["kote"], txt)
        for x in extras:
            status[id(x)] = (alvor["ekstra"], "")
        antall = {}
        for et in self.bd["etasjer"]:
            antall[(et["navn"], et["elevation_mm"])] = et["objekter"]

        def tall(st_: dict) -> int:
            for (nv, el), c in antall.items():
                if nv == st_["name"].strip() and el is not None and st_["elevation_mm"] is not None \
                        and abs(el - st_["elevation_mm"]) <= 1:
                    return c
            return 0

        brukt = 0
        ut = []
        for st_ in storeys:
            fl, till = status.get(id(st_), ("", ""))
            c = tall(st_)
            brukt += c
            ut.append(element(st_["name"].strip() or "–", c, "" if fl == "flagg" else fl,
                              tillegg=till))
        if brukt != self.bd["blokker"]["etasjer"]["botter"].get("oppfylt", 0):
            raise SystemExit(f"FEIL: {self.label}: etasjetall {brukt} ≠ plassert i etasje "
                             f"{self.bd['blokker']['etasjer']['botter'].get('oppfylt', 0)}")
        for niv, pick in zip(regler.get("nivaaer") or [], plukk):
            if pick is None:
                sev = alvor["mangler"]
                el = element(niv["navn"], 0, "flagg" if sev == "flagg" else sev,
                             farge="--sk-na-ren", tillegg="mangler")
                ut.append(el)
        return ut, True

    # -- KPI band
    def kpi(self) -> list[dict]:
        verdier = {**self.d, "typeregister": self.bd["typeregister"]}
        ut = []
        for kid in self.reg.kpi_band:
            k = next(x for x in self.reg.kpi if x["id"] == kid)
            v = hent_tall(verdier, k["datanokkel"])
            st = ""
            under = ""
            if k.get("enhet") == "tall":
                tekst = "–" if v is None else (n_(v) if isinstance(v, int) else fmt_pct(float(v)))
                if kid == "instanser_per_type":
                    tr = self.bd["typeregister"]
                    under = f"{n_(tr['typede'])} / {n_(tr['typer'])} typer"
            elif k.get("enhet") == "prosent":
                tekst = p_(v)
                tr = self.bd["typeregister"]
                under = f"{n_(tr['en_instans'])} av {n_(tr['typer'])}"
            else:
                tekst = "–" if v is None else str(v)
                if str(v).upper() in {str(x).upper() for x in k.get("varsel_verdier") or []}:
                    st = "warn"
            ut.append({"id": kid, "tittel": k["tittel"], "tekst": tekst, "under": under, "status": st})
        return ut

    # -- hygiene strip and krav rows outside the blocks
    def krav_celle(self, kid: str) -> dict:
        krav = self.reg.pr_id[kid]
        v = vurder(self.reg, self.r, {self.label: self.d}, {self.label: self.s}, self.label,
                   krav, self.alle_guid)
        sub = [x.replace("\u200b", "") for x in v.sub if x]
        if v.status == "na" and v.tekst == "gjelder ikke":
            # Rule 3: the reason is the file property outside the declared applicability.
            ctx = {"schema": self.s.get("schema") or self.d.get("schema"), "fag": self.fag,
                   "modell": self.label}
            sub = [str(ctx[f]) for f in (krav.get("gjelder") or {}) if ctx.get(f) is not None]
        return {"status": v.status, "tekst": v.tekst.replace("\u200b", ""), "sub": sub}

    def hygiene(self) -> list[dict]:
        """The hygiene strip: project requirements (krav.yaml `krav`). Only those configured; none
        in a standard-only run, and the section is then omitted."""
        ut = []
        for kid in ("filnavn", "koordineringsobjekt", "plassering", "georeferering"):
            if kid not in self.reg.pr_id:
                continue
            c = self.krav_celle(kid)
            ut.append({"id": kid, "tittel": self.reg.tittel(kid), **c,
                       "merknader": self.reg.merknad_rader(kid, self.omfang)})
        return ut

    # -- type register (the gallery)
    def typer(self, blokker: list[dict]) -> list[dict]:
        """The type register as cards. A value is flagged when its block flagged it: the
        gallery computes nothing of its own."""
        flagget = {b["id"]: {e.get("raa", e["verdi"]) for e in b["fordeling_alle"] if e["flagg"] in ("avvik", "mangler")}
                   for b in blokker}

        def fold(c: dict, bid: str = "") -> dict:
            par = [(k, v) for k, v in c.items()]
            fylt = [(k, v) for k, v in par if k]
            tom = sum(v for k, v in par if not k)
            verdi = fylt[0][0] if fylt else ""
            fl = bool(verdi) and bid in flagget and any(
                x in flagget[bid] for x in ([verdi] + verdi.split(" + ")))
            if bid == "mengdetype" and verdi.split(" ")[0] in ("avhenger", "ukjent"):
                fl = True
            return {"verdi": verdi, "andre": max(len(fylt) - 1, 0), "tom": tom, "flagg": fl,
                    "alle": " | ".join(f"{k or '–'} ×{v}" for k, v in par)}
        ut = []
        for t in self.bd["typeregister"]["liste"]:
            mmi = fold(t["mmi"], "mmi")
            tok = f"--mmi-{mmi['verdi']}"
            ut.append({"navn": t["navn"], "klasse": t["klasse"], "instanser": t["instanser"],
                       "objektklasser": " | ".join(f"{k} ×{v}" for k, v in t["objektklasser"].items()),
                       "systemkode": fold(t["systemkode"], "systemkode"),
                       "funksjonskode": fold(t["funksjonskode"], "funksjonskode"),
                       "materiale": fold(t["materiale"], "materiale"),
                       "produkt": fold(t["produkt"], "produkt"),
                       "mengdetype": fold({(k.replace("m2", "m²").replace("m3", "m³")
                                            .replace("ikke_relevant", "ikke relevant")): v
                                           for k, v in t["mengdetype"].items()}, "mengdetype"),
                       "mmi": mmi,
                       "mmi_farge": tok if tok in self.tok else "--mmi-uten-farge"})
        return ut

    def unntatte(self) -> set[str]:
        """Requirements declared not to apply to this model (`unntatt: {modell: [...], fag: [...]}`)."""
        fag = self.r.fag(self.label)
        return {b["id"] for b in self.reg.blokker
                if self.label in ((b.get("unntatt") or {}).get("modell") or [])
                or fag in ((b.get("unntatt") or {}).get("fag") or [])}

    def materialer(self) -> list[dict]:
        """The material gallery: every material name found on the counted objects, validity by the
        Materiale requirement's non-material filter. Only from a one-location cache."""
        if not self.bd.get("ett_sted"):
            return []
        ikke = next((b.get("ikke_materiale") or [] for b in self.reg.blokker if b["id"] == "materiale"), [])
        return [{**x, "gyldig": er_materiale(x["navn"], ikke)} for x in self.bd.get("materialer") or []]

    def kodelister(self, uten: set[str] = frozenset()) -> list[dict]:
        """The configured code lists: every value found at the requirement's location, with objects
        and types, named and validated against the list's table. `uten`: requirements that do not
        apply to this model, whose lists are left out."""
        ut = []
        for kl in kodelister_konfigurert(self.reg.blokker):
            if kl["id"] in uten:
                continue
            bb_ = self.bd["blokker"].get(kl["id"]) or {}
            tp = bb_.get("typer_per_verdi") or {}
            tellinger = [(v, n, tp.get(v, 0)) for v, n, _ in bb_.get("verdier") or []]
            ut.append({**kl, "rader": kodeliste_rader(tellinger, last_kodetabell(kl["ref"], self.reg.rot))})
        return ut

    def komponenter(self, blokker: list[dict]) -> dict:
        """The template's two components (edkjo 2026-09-25): GUID as a Nøkkeltall card, and
        Etasjedefinisjon as the etasjematrise at the top of IFC-struktur. Both stay requirement
        rows in the project matrix and the workbook."""
        g = next(b for b in blokker if b["id"] == "guid")
        e = next(b for b in blokker if b["id"] == "etasjedefinisjon")
        sg = VERDIKT_STATUS[g["verdikt"]]
        per = collections.Counter()
        for gid in set(self.d.get("guid_kopi") or {}):
            for lab, _ in self.alle_guid.get(gid, []):
                if lab != self.label:
                    per[lab] += 1
        med = f" ({' · '.join(f'{kort_label(k, self.reg)} ×{n_(c)}' for k, c in per.most_common())})" if per else ""
        kort = (f'<div class="flis {sg}"><div class="etikett">{esc(E("duplikater_i_fila"))}</div>'
                f'<div class="verdi"><span class="ksym">{SYM[sg]}</span>{n_(g["duplikater"])}</div>'
                f'<div class="under">{esc(E("delt_med_andre_modeller"))} {n_(g["delt"])}{esc(med)}</div></div>')
        em = e["rader"][0]["etasjematrise"]
        return {"ekstra_kpi": [kort], "komponent_ids": ["guid", "etasjedefinisjon"], "ekstra_css": KPI_CSS,
                "seksjon_start": {"ifc_helse": html_etasjekomponent(em, e["verdikt"])}}

    def alt(self) -> dict:
        m = self.r.cfg[self.label]
        blokker = [self.krav(b) for b in self.reg.blokker]
        mock = [f"{b['tittel']}" for b in blokker if b.get("mock")]
        if any(b.get("spenn", {}).get("mock") for b in blokker):
            mock.append("Etasjer: bunn i etasjen (etasjespenn)")
        # A requirement declared `unntatt` for this model takes its gallery / code list with it.
        uten = {b["id"] for b in blokker if b["verdikt"] == "gjelder_ikke" and b["id"] in self.unntatte()}
        return {**self.komponenter(blokker),
                "materialer": [] if "materiale" in uten else self.materialer(),
                "kodelister": self.kodelister(uten),
                "label": self.label, "kort": kort_label(self.label, self.reg), "fag": self.fag,
                "firma": m.get("firma", ""), "versjon": m.get("versjon", ""),
                "lastet_opp": m.get("lastet_opp", ""), "merknad_runde": m.get("merknad", ""),
                "fil": m["fil"], "sha16": m["sha16"], "sha256": self.sha256,
                "schema": self.d.get("schema"),
                "system": self.d.get("system", ""), "eksportert": self.d.get("eksportert", ""),
                "bytes": self.d.get("bytes"), "n": self.d["n"],
                "eksport": Path(m.get("kilde") or self.r.kilde).name,
                "kpi": self.kpi_band(), "skjema": self.skjema_tile(), "blokker": blokker,
                "hygiene": self.hygiene(), "etasjematrise": self.etasjematrise(),
                "merknader_modell": self.modellmerknader(), "mock": mock,
                "typer": self.typer(blokker), "per_klasse": self.bd["per_klasse"],
                "mengdeklasser": self.bd["mengdeklasser"], "psett": self.psett(),
                "etasjer_fil": self.s["storeys"], "type_1til1": self.bd["type_1til1"]}


# ---------------------------------------------------------------- the round
def matriserader(reg: Register) -> list[dict]:
    """The krav × modell rows: the ten blocks, then every requirement no block answers for."""
    dekket = {k for b in reg.blokker for k in b.get("krav", [])}
    rader = [{"type": "blokk", "id": b["id"], "tittel": b["tittel"], "kilde": b.get("kilde", "")}
             for b in reg.blokker]
    rader += [{"type": "krav", "id": k["id"], "tittel": k["tittel"], "kilde": k.get("kilde", "")}
              for k in reg.krav if k["id"] not in dekket]
    return rader


def celle_blokk(b: dict) -> dict:
    """The project matrix cell: the requirement's verdict, with its coverage."""
    vk = b["verdikt"]
    t = tilstede(b["rader"][0]) if b.get("rader") and "telling" not in b["rader"][0] else None
    tekst = VERDIKT_ORD[vk] if t is None or not t[1] else p_(pct(t[0], t[1]))
    sub = [VERDIKT_ORD[vk]] if t is not None and t[1] else []
    if b.get("mock"):
        sub.append("MOCK")
    return {"status": VERDIKT_STATUS[vk], "tekst": tekst, "sub": sub}


def beregn(reg: Register, r: Runde, data: dict, struktur: dict, blokkdata_: dict, geo: dict) -> dict:
    tok = les_tokens()
    # Funksjonskode's accepted values: the code table its config names; None when it names none.
    ft = next((b.get("kodetabell") for b in reg.blokker if b["id"] == "funksjonskode"), None)
    kodetabell = ({str(x["kode"]).upper() for x in
                   yaml.safe_load(stier.tabell_sti(ft, reg.rot).read_text(encoding="utf-8"))} if ft else None)
    labels = r.hoved(reg)
    alle_guid = guid_forekomster(data, labels)
    modeller = []
    for lab in labels:
        mb = Modellberegning(reg, r, lab, data[lab], blokkdata_[lab], struktur[lab], alle_guid,
                             tok, kodetabell, geo[lab])
        modeller.append(mb.alt())
    rader = matriserader(reg)
    matrise = []
    for rad in rader:
        celler = {}
        for m, lab in zip(modeller, labels):
            if rad["type"] == "blokk":
                celler[lab] = celle_blokk(next(b for b in m["blokker"] if b["id"] == rad["id"]))
            else:
                celler[lab] = Modellberegning(reg, r, lab, data[lab], blokkdata_[lab], struktur[lab],
                                              alle_guid, tok, kodetabell, geo[lab]).krav_celle(rad["id"])
        matrise.append({**rad, "celler": celler})
    rad_for_krav = {}
    for b in reg.blokker:
        for k in b.get("krav", []):
            rad_for_krav[k] = b["id"]
    bruk = []
    for bk in reg.bruk:
        rad_ids = []
        for k in bk["krav"]:
            rid = rad_for_krav.get(k, k)
            if rid not in rad_ids:
                rad_ids.append(rid)
        celler = {}
        for lab in labels:
            feil = []
            verst = "ok"
            for rid in rad_ids:
                c = next(x for x in matrise if x["id"] == rid)["celler"][lab]
                if c["status"] in ("warn", "bad"):
                    feil.append(next(x for x in matrise if x["id"] == rid)["tittel"])
                    verst = "bad" if c["status"] == "bad" or verst == "bad" else "warn"
            celler[lab] = {"status": verst, "tekst": "", "sub": feil}
        bruk.append({"id": bk["id"], "tittel": bk["tittel"],
                     "rader": [next(x for x in matrise if x["id"] == rid)["tittel"] for rid in rad_ids],
                     "celler": celler})
    # GUID på tvers judges ownership through Kopiobjekt (project config): omitted without it.
    guid = []
    for a in (labels if reg.forventet.get("kopi_objekt") else []):
        ga = set(data[a].get("guid_kopi") or {})
        rad = {}
        for b_ in labels:
            if a == b_:
                rad[b_] = {"status": "na", "tekst": "", "sub": []}
                continue
            felles = ga & set(data[b_].get("guid_kopi") or {})
            if not felles:
                rad[b_] = {"status": "ok", "tekst": "0", "sub": []}
                continue
            ok_n = sum(1 for g in felles if guid_en_eier(reg, r, alle_guid[g]))
            rad[b_] = ({"status": "ok", "tekst": n_(len(felles)), "sub": []} if ok_n == len(felles)
                       else {"status": "bad", "tekst": f"{n_(ok_n)}/{n_(len(felles))}",
                             "sub": [E("med_en_eier")]})
        guid.append({"label": a, "objekter": len(ga), "celler": rad})
    return {"prosjekt": reg.prosjekt, "dato": r.dato, "eksport": r.eksport, "runde": r.sti.name,
            "terskel": reg.standard["terskel"], "telte_objekter": reg.standard["telte_objekter"],
            "labels": labels, "modeller": modeller, "matrise": matrise, "bruk": bruk, "guid": guid,
            "seksjoner": reg.seksjoner, "terskel_gyldig": reg.terskel_gyldig}


# ================================================================ HTML
def sym(status: str) -> str:
    return f'<span class="st {status}">{SYM[status]}</span>'


def merke_svg() -> str:
    return MERKE.read_text(encoding="utf-8").strip().replace("<svg ", '<svg aria-hidden="true" ', 1)


def html_dokument(tittel: str, kropp: str, css: Path) -> str:
    return f"""<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><title>{esc(tittel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
{TOKENS.read_text(encoding="utf-8")}
{css.read_text(encoding="utf-8")}
</style></head>
<body><main class="mk">
{kropp}
</main></body></html>
"""


def html_hode(R: dict, over: str, tittel: str, meta: list[tuple[str, str]]) -> str:
    felt = "".join(f"<div><dt>{esc(k)}</dt><dd>{esc(v)}</dd></div>" for k, v in meta)
    return (f'<header class="hode">{merke_svg()}<div><p class="over">{esc(over)}</p>'
            f'<h1>{esc(tittel)}</h1></div><div class="dato">{esc(dato_no(R["dato"]))}</div></header>'
            f'<dl class="meta rad4">{felt}</dl>')


def html_stolpe(dk: dict) -> str:
    n = dk["n"] or 1
    del_ = [("o", dk["oppfylt"]), ("a", dk["avvik"]), ("m", dk["mangler"]), ("n", dk["gjelder_ikke"])]
    return ('<div class="stolpe">' + "".join(
        f'<i class="{k}" style="width:{100 * v / n:.3f}%"></i>' for k, v in del_ if v) + "</div>")


def html_fordeling(b: dict) -> str:
    el = b["fordeling"]
    tot = sum(e["n"] for e in el) or 1
    bar = "".join(f'<i style="width:{100 * e["n"] / tot:.3f}%;background:var({e["farge"]})"></i>'
                  for e in el if e["n"])
    chips = []
    for e in el:
        kl = {"avvik": "avvik", "mangler": "mangler", "flagg": "flagg"}.get(e["flagg"], "")
        s = {"avvik": SYM["warn"] + " ", "mangler": SYM["bad"] + " ", "flagg": SYM["na"] + " "}.get(e["flagg"], "")
        antall = f' <span class="x">×{n_(e["n"])}</span>' if e["n"] else ""
        till = f' · {esc(e["tillegg"])}' if e["tillegg"] else ""
        tag = f'<span class="tag">{esc(e["tag"])}</span>' if e["tag"] else ""
        chips.append(f'<span class="chip {kl}"><span class="sw" style="background:var({e["farge"]})">'
                     f'</span>{s}{esc(e["verdi"])}{antall}{till}{tag}</span>')
    if not el:
        return '<div class="chips tom"><span class="chip na">–</span></div>'
    fbar = f'<div class="fbar">{bar}</div>' if bar else ""
    return f'{fbar}<div class="chips{"" if bar else " tom"}">{"".join(chips)}</div>'


def nivaa_etikett(nivaa: str) -> str:
    """The layer a source was configured in, as printed: «IFC» for the default, «prosjekt» for the
    project configuration. No project name is ever a label."""
    return {konfig.STANDARD: E("niva_standard"), konfig.PROSJEKT: E("niva_prosjekt")}[nivaa]


def html_legende(R: dict) -> str:
    """The requirement verdict is binary (● oppfylt / ○ ikke oppfylt), with two non-verdicts. The
    colours of the dekning bar are readings, not verdicts, and are labelled as the bar's key."""
    t = R["terskel"]
    o = VERDIKT_ORD
    return ('<span class="legende">'
            f'<span>{sym("ok")} {esc(o["oppfylt"])}</span><span>{sym("warn")} {esc(o["kan_brukes"])}</span>'
            f'<span>{sym("bad")} {esc(o["ikke_oppfylt"])}</span>'
            f'<span>{sym("na")} {esc(o["gjelder_ikke"])}</span><span class="st na">∅</span><span>{esc(o["ikke_konfigurert"])}</span>'
            '</span>')


def html_fordeling_tekst(el: list[dict]) -> str:
    """Fordeling as a compact text list: top values ×n · andre (n). MMI values keep their Table 1
    swatch; nothing else is drawn."""
    if not el:
        return "–"
    deler = []
    for e in el:
        sw = (f'<span class="sw" style="background:var({e["farge"]})"></span>'
              if e.get("farge", "").startswith("--mmi") else "")
        till = f' {esc(e["tillegg"])}' if e.get("tillegg") else ""
        antall = f' ×{n_(e["n"])}' if e["n"] else ""
        deler.append(f'<span class="fv">{sw}{esc(e["verdi"])}{antall}{till}</span>')
    return " · ".join(deler)


def html_rad(r_: dict, terskler: dict) -> str:
    """One reading of one location, in the block's minimum anatomy."""
    ut = []
    mock = bool(r_.get("mock"))
    if not r_.get("_uten_sted"):
        hode = f'<span class="gren">{esc(r_["tittel"])}</span>' if r_.get("tittel") else ""
        ut.append(f'<div class="rad-l"><span class="lab">{esc(E("egenskap"))}</span><span>{hode}'
                  f'<span class="niv">{esc(nivaa_etikett(r_["nivaa"]))}</span>{esc(r_["sted"])}</span></div>')
    for lab, tekst in r_.get("telling") or []:
        ut.append(f'<div class="rad-l"><span class="lab"></span><span class="telling">'
                  f'<span class="tlab">{esc(lab)}</span> {esc(tekst)}</span></div>')
    if r_.get("etasjematrise"):
        ut.append(html_etasjematrise(r_["etasjematrise"]))
    if r_.get("dekning") is not None and "telling" not in r_:
        t = tilstede(r_)
        if t is None or not t[1]:
            ut.append(f'<div class="rad-l"><span class="lab">{esc(E("dekning"))}</span><span class="tall">'
                      f'{sym("na")} {esc(VERDIKT_ORD["gjelder_ikke"])} · 0 {esc(r_["grunnlag_tekst"])}</span></div>')
        else:
            # Dekning and Gyldig: two large numbers with a traffic light each (thresholds from the
            # config), «x av N» small beneath, the utenfor list under Gyldig.
            pd = pct(t[0], t[1])
            sd = lys(pd, terskler["dekning"])
            dekning_c = (f'<div class="stort {sd}"><span class="ssym">{SYM[sd]}</span>{esc(p_(pd))}</div>'
                         f'<div class="smatt">{n_(t[0])} {esc(E("av"))} {n_(t[1])} {esc(r_["grunnlag_tekst"])}</div>')
            g = gyldig(r_)
            m = f'<span class="mock">{esc(E("mock"))}</span>' if (mock or (r_.get("spenn") or {}).get("mock")) else ""
            if g is None or not g[1]:
                gyldig_c = '<div class="stort na"><span class="ssym">–</span></div>'
            else:
                pg = pct(g[0], g[1])
                sg = lys(pg, terskler["gyldig"])
                enhet = E("objekter")
                gyldig_c = (f'<div class="stort {sg}"><span class="ssym">{SYM[sg]}</span>{esc(p_(pg))}{m}</div>'
                            f'<div class="smatt">{n_(g[0])} {esc(E("av"))} {n_(g[1])} {esc(enhet)}</div>')
            ut.append(f'<div class="rad-l to talrad"><span class="lab">{esc(E("dekning"))}</span><div>{dekning_c}</div>'
                      f'<span class="lab">{esc(E("gyldig"))}</span><div>{gyldig_c}</div></div>')
        unike = antall_unike(r_)
        ut.append(f'<div class="rad-l"><span class="lab">{esc(E("fordeling"))}</span>'
                  f'<span class="fordeling">{n_(unike)} {esc(E("unike_verdier"))}'
                  f'{"<span class=mock>" + esc(E("mock")) + "</span>" if mock else ""}</span></div>')
        if r_.get("fase_fordeling") is not None:
            # The phase rollup of the MMI values (forventet.mmi.fase): a reading, no verdict.
            ut.append(f'<div class="rad-l"><span class="lab">{esc(r_["fase_tittel"])}</span>'
                      f'<span class="fordeling">{html_fordeling_tekst(r_["fase_fordeling"])}</span></div>')
    return "".join(ut)


def html_blokk(i: int, b: dict, terskler: dict) -> str:
    """The requirement row: a status square at the left edge, full row height, then the title,
    then the minimum anatomy (krav, sted, dekning, fordeling, gyldig)."""
    vk = b["verdikt"]
    kvadrat = (f'<div class="kvadrat {vk}"><span class="ksym">{VERDIKT_SYM[vk]}</span>'
               f'<span class="kord">{esc(VERDIKT_ORD[vk])}</span></div>')
    kilde = f' <span class="sitat">· {esc(b["kilde"])}</span>' if b.get("kilde") else ""
    kropp = []
    rader = b["rader"]
    if b["krav_tekst"] and len(rader) == 1:
        r0 = rader[0]
        kropp.append(f'<div class="rad-l to"><span class="lab">{esc(E("krav"))}</span><span class="kravtekst">'
                     f'{esc(b["krav_tekst"])}{kilde}</span><span class="lab">{esc(E("egenskap"))}</span><span>'
                     f'<span class="niv">{esc(nivaa_etikett(r0["nivaa"]))}</span>{esc(r0["sted"])}</span></div>')
        rader = [{**r0, "_uten_sted": True}]
    elif b["krav_tekst"]:
        kropp.append(f'<div class="rad-l"><span class="lab">{esc(E("krav"))}</span><span class="kravtekst">'
                     f'{esc(b["krav_tekst"])}{kilde}</span></div>')
    if vk == "ikke_konfigurert" and not rader:
        kropp.append(f'<div class="rad-l"><span class="lab">{esc(E("egenskap"))}</span>'
                     f'<span class="st na">∅ {esc(VERDIKT_ORD["ikke_konfigurert"])}</span></div>')
    if b.get("bryter"):
        br = b["bryter"]
        gruppe = {"telleobjekt": E("telleobjekter"), "mengdeobjekt": E("mengdeobjekter")}[br["gren"]]
        aapne = (f' · <span class="tag">{esc(E("aapen"))}</span> ' + " · ".join(esc(a) for a in b["aapne"])) if b["aapne"] else ""
        kropp.append(f'<div class="rad-l"><span class="lab">{esc(E("mengdetype"))}</span><span>{n_(br["antall"])} {esc(gruppe)} '
                     f'{esc(E("av"))} {n_(br["n"])} {esc(E("objekter"))}{aapne}</span></div>')
    for r_ in rader:
        kropp.append(html_rad(r_, terskler))
    kropp += [f'<div class="merknad"><span class="nar">{esc(dato_no(m["dato"]))} · '
              f'{esc(m["gjelder"])}</span>{esc(m["tekst"].strip())}</div>' for m in b["merknader"]]
    return (f'<section class="blokk krav">{kvadrat}'
            f'<div class="navn"><span class="nr">{i}</span>{esc(b["tittel"])}</div>'
            f'<div class="kropp">{"".join(kropp)}</div></section>')


def html_etasjematrise(em: dict) -> str:
    """Configured storeys against the model's: an aligned, borderless grid in two halves."""
    rader = em["rader"]
    if not rader:
        return ""

    def kote(v_):
        return "" if v_ is None else m_(v_, 3)

    def halvdel(del_):
        celler = [f'<span class="emh">{esc(E("em_konfigurert"))}</span>', f'<span class="emh tall">{esc(E("kote"))}</span>',
                  f'<span class="emh">{esc(E("em_modellen"))}</span>', f'<span class="emh tall">{esc(E("kote"))}</span>',
                  f'<span class="emh">{esc(E("status"))}</span>']
        for r_ in del_:
            celler += [f'<span>{esc(r_["k_navn"])}</span>', f'<span class="tall">{kote(r_["k_kote"])}</span>',
                       f'<span>{esc(r_["m_navn"])}</span>', f'<span class="tall">{kote(r_["m_kote"])}</span>',
                       f'<span class="st {r_["sym"]}">{SYM[r_["sym"]]} {esc(r_["status"])}</span>']
        return f'<div class="em-grid">{"".join(celler)}</div>'

    halv = (len(rader) + 1) // 2
    t = em["toleranse"]
    grense = lambda x: "∞" if x is None else f"{x:g}"
    return (f'<div class="rad-l"><span class="lab">{esc(E("etasjematrise"))}</span>'
            f'<span class="em-meta">{esc(E("kote_i_m"))} · {esc(E("toleranse"))} +{grense(t["over"])} / −{grense(t["under"])} mm'
            f'{" · " + esc(em.get("referanse", "")) if em.get("referanse") else ""}</span></div>'
            f'<div class="etasjematrise"><div class="em-deler">{halvdel(rader[:halv])}{halvdel(rader[halv:])}</div></div>')


def etasjecelle_kote(r_: dict, tol: dict) -> str:
    """The Kote cell's state: within tolerance ok, within twice the tolerance warn, beyond bad."""
    if r_["m_kote"] is None or r_["k_kote"] is None:
        return ""
    d_ = float(r_.get("delta_mm") if r_.get("delta_mm") is not None else r_["m_kote"] - r_["k_kote"])
    g = tol["over"] if d_ > 0 else tol["under"]
    if g is None or abs(d_) <= float(g):
        return "ok"
    return "warn" if abs(d_) <= 2 * float(g) else "bad"


def html_etasjekomponent(em: dict, verdikt: str, tittel: str | None = None) -> str:
    """The floors as their own component (edkjo 2026-09-25: «Just do a matrix with Columns:
    Referanse, Navn, Kote»). One row per storey, ordered by kote, extra model storeys in their natural
    place. The cell shows the found value, the tint the verdict, a symbol for black and white:
    Navn tinted when it does not match the reference name, Kote by its deviation (amber within 2×
    tolerance, red beyond); a missing floor's empty Navn and Kote in grey, an extra storey's
    Referanse red «ingen treff». The component's verdict sits in the same fixed square as the rows."""
    tittel = tittel or E("etasjedefinisjon")
    tol = em["toleranse"]
    rader = sorted(em["rader"], key=lambda r_: r_["k_kote"] if r_["k_kote"] is not None else r_["m_kote"])

    def celle(tekst: str, st: str = "", till: str = "") -> str:
        s = f'<span class="esym">{SYM[st]}</span>' if st else ""
        t = f'<span class="etill">{esc(till)}</span>' if till else ""
        return f'<td class="{st}">{s}{tekst}{t}</td>'

    linjer = []
    for r_ in rader:
        if r_["k_navn"]:
            ref = celle(f'{esc(r_["k_navn"])} <span class="ekote">{m_(r_["k_kote"], 3)}</span>')
        else:
            ref = celle("", "bad", E("ingen_treff"))
        if not r_["m_navn"]:
            navn, kote_ = celle("", "na"), celle("", "na")
        else:
            navn_st = "bad" if r_["k_navn"] and r_["m_navn"].casefold() != r_["k_navn"].casefold() else "ok"
            navn = celle(esc(r_["m_navn"]), navn_st)
            ks = etasjecelle_kote(r_, tol)
            d_ = (r_["m_kote"] - r_["k_kote"]) if r_["k_kote"] is not None else None
            kote_ = celle(m_(r_["m_kote"], 3), ks,
                          f"Δ {fmt_mm(d_)} mm" if ks in ("warn", "bad") and d_ is not None else "")
        linjer.append(f"<tr>{ref}{navn}{kote_}</tr>")
    grense = lambda x: "∞" if x is None else f"{x:g}"
    kvadrat = (f'<div class="kvadrat {verdikt}"><span class="ksym">{VERDIKT_SYM[verdikt]}</span>'
               f'<span class="kord">{esc(VERDIKT_ORD[verdikt])}</span></div>')
    return (f'<section class="blokk krav etg-komp">{kvadrat}<div class="navn">{esc(tittel)}</div>'
            f'<div class="kropp"><div class="etg-meta">{esc(E("kote_i_m"))} · {esc(E("toleranse"))} +{grense(tol["over"])} / '
            f'−{grense(tol["under"])} mm{" · " + esc(em.get("referanse", "")) if em.get("referanse") else ""}</div>'
            f'<table class="etg-matrise"><colgroup><col style="width:40%"><col style="width:30%"><col></colgroup>'
            f'<thead><tr><th>{esc(E("referanse"))}</th><th>{esc(E("navn"))}</th><th>{esc(E("kote"))}</th></tr></thead>'
            f'<tbody>{"".join(linjer)}</tbody></table></div></section>')


def html_merknader_modell(m: dict) -> str:
    """The model's comment section. Visible when empty: a titled, ruled area where edkjo writes.
    An entry flagged `mock` carries the MOCK label."""
    rader = [f'<div class="merknad"><span class="nar">{esc(dato_no(x["dato"]))}'
             f'{" · " + esc(x["kilde"]) if x.get("kilde") else ""}{" · " + esc(x["gjelder"]) if x.get("gjelder") else ""}'
             f'</span>{esc(x["tekst"].strip())}{'<span class="mock">' + esc(E("mock")) + '</span>' if x.get("mock") else ""}</div>'
             for x in m["merknader_modell"]]
    return f'<div class="modellmerknader">{"".join(rader)}<div class="linjert"></div></div>'


def html_modell(R: dict, m: dict, css: Path) -> str:
    meta = [(E("fagkode"), m["fag"]), (E("firma"), m["firma"]),
            (E("dalux_versjon"), m["versjon"]), (E("opplastingsdato"), dato_no(m["lastet_opp"])),
            (E("eksport"), m["eksport"])]
    kropp = [html_hode(R, f'{R["prosjekt"]["navn"]} · {E("rapport_navn")}', m["label"], meta)]
    sk = m["skjema"]
    vk = sk["verdikt"]
    kropp.append(f'<h2><span class="nr">1</span>{esc(E("seksjon_nokkeltall"))}</h2><div class="kpi">')
    for k in m["kpi"]:
        st = k.get("status") or ""
        s_ = f'<span class="ksym">{SYM[st]}</span>' if st else ""
        kropp.append(f'<div class="flis {st}"><div class="etikett">{esc(k["tittel"])}</div>'
                     f'<div class="verdi">{s_}{esc(k["tekst"])}</div><div class="under">{esc(k["under"])}</div></div>')
    sst = VERDIKT_STATUS[vk]
    kropp.append(f'<div class="flis {sst}"><div class="etikett">{esc(E("ifc_skjema"))}</div>'
                 f'<div class="verdi"><span class="ksym">{SYM[sst]}</span>{esc(sk["skrevet"])}</div>'
                 f'<div class="under"><span class="st {VERDIKT_STATUS[vk]}">{VERDIKT_SYM[vk]} {esc(VERDIKT_ORD[vk])}</span>'
                 f' · {esc(E("godtatt"))} {esc(sk["godtatt"])}</div></div>')
    kropp += m.get("ekstra_kpi", [])   # optional extra cards (template variants)
    kropp.append("</div>")
    kropp.append(f'<h2><span class="nr">2</span>{esc(E("seksjon_merknader"))}</h2>' + html_merknader_modell(m))
    nr, i = 2, 0
    # Requirements drawn as components elsewhere on the page (GUID card, etasjematrise) are not
    # repeated as numbered rows.
    komp = set(m.get("komponent_ids") or [])
    for sk_ in R["seksjoner"]:
        nr += 1
        legende = html_legende(R) if nr == 3 else ""
        kropp.append(m.get("for_seksjon", {}).get(sk_["id"], ""))
        kropp.append(f'<h2><span class="nr">{nr}</span>{esc(sk_["tittel"])}{legende}</h2>')
        kropp.append(m.get("seksjon_start", {}).get(sk_["id"], ""))
        for bl in m["blokker"]:
            if bl["seksjon"] == sk_["id"] and bl["id"] not in komp:
                i += 1
                kropp.append(html_blokk(i, bl, {"dekning": R["terskel"], "gyldig": R["terskel_gyldig"]}))
    if i != len([b for b in m["blokker"] if b["id"] not in komp]):
        raise SystemExit("FEIL: et krav i konfigurasjonen mangler seksjon")
    if m["hygiene"]:
        nr += 1
        kropp.append(f'<h2><span class="nr">{nr}</span>{esc(E("seksjon_hygiene"))}</h2><div class="hygiene rad4">')
    for h in m["hygiene"]:
        sub = " · ".join(h["sub"])
        kropp.append(f'<div class="flis"><div class="etikett">{esc(h["tittel"])}</div>'
                     f'<div class="verdi">{sym(h["status"])} {esc(h["tekst"] or STATUSORD[h["status"]])}</div>'
                     f'<div class="under">{esc(sub)}</div></div>')
    if m["hygiene"]:
        kropp.append("</div>")
    kropp.append(f'<section class="galleri"><h2><span class="nr">{nr + 1}</span>{esc(E("seksjon_typegalleri"))}</h2>'
                 '<div class="kort-rutenett">')
    for t in m["typer"]:
        kropp.append(html_kort(t))
    kropp.append("</div></section>")
    nr_g = nr + 2
    if m.get("materialer"):
        kropp.append(html_materialer(m, nr_g))
        nr_g += 1
    kropp.append(html_psett(m, nr_g))
    kropp.append(html_kodelister(m, nr_g + 1))
    # The full hash is for machines: small and muted in the first page's bottom margin, outside
    # the verdict page's content area.
    fot = ('<style>@page :first { @bottom-left { content: "' + E("sjekksum") + ' '
           + m["sha256"] + '"; font-family: var(--sk-skrift); font-size: var(--mk-tekst-mini); '
           'color: var(--sk-svak); } }</style>')
    vannmerke = f'<div class="vannmerke">{esc(E("mock"))}</div>' if m.get("mock") else ""
    ekstra_css = f'<style>{m["ekstra_css"]}</style>' if m.get("ekstra_css") else ""
    return html_dokument(f'{E("rapport_navn")} {m["label"]}', ekstra_css + fot + vannmerke + "\n".join(kropp), css)


# ---------------------------------------------------------------- material gallery, code lists
def er_materiale(navn: str, ikke_materiale: list[str]) -> bool:
    """A material name as found, against the standard's non-material filter (materiale block
    `ikke_materiale`: colour/finish, element words, bare numbers, placeholders)."""
    return not any(re.search(p, navn or "", re.I) for p in ikke_materiale)


def last_kodetabell(ref: dict, rot: Path | None) -> dict[str, str]:
    """A code table from its config reference {kilde, fil, felt: {kode, navn}}: a YAML or JSON list,
    found by stier.tabell_sti (`rot` is the project config's directory). Code -> name."""
    sti = stier.tabell_sti(ref["fil"], rot)
    tekst = sti.read_text(encoding="utf-8")
    rader = json.loads(tekst) if sti.suffix.lower() == ".json" else yaml.safe_load(tekst)
    fk, fn = (ref.get("felt") or {}).get("kode", "kode"), (ref.get("felt") or {}).get("navn", "navn")
    return {str(x[fk]).strip().upper(): str(x.get(fn, "")) for x in rader}


def kodelister_konfigurert(blokker: list[dict]) -> list[dict]:
    """The code lists to render: a requirement that declares `kodeliste` AND has a location in the
    merged configuration. Without a location the list is left out entirely (a catalogue, not a
    check: no «ikke konfigurert»)."""
    return [{"id": b["id"], "tittel": E(f"kodeliste_{b['id']}"), "ark": E(f"ark_{b['id']}"),
             "ref": b["kodeliste"]} for b in blokker
            if b.get("kodeliste") and b.get("sted") and not b.get("ikke_konfigurert")]


def kodeliste_rader(tellinger: list[tuple[str, int, int]], tabell: dict[str, str]) -> list[dict]:
    """(kode, objekter, typer) aggregated per code, named and validated against the table, sorted by
    code."""
    ut = []
    for kode, obj, typer in tellinger:
        k = str(kode).strip()
        navn = tabell.get(k.upper())
        ut.append({"kode": k, "navn": navn or "", "objekter": int(obj), "typer": int(typer),
                   "gyldig": navn is not None})
    return sorted(ut, key=lambda r_: r_["kode"])


def html_materialer(m: dict, nr: int) -> str:
    """Every material as found, one card each, sorted by objects."""
    ut = [f'<section class="galleri materialer"><h2><span class="nr">{nr}</span>{esc(E("seksjon_materialgalleri"))}'
          f'<span class="legende"><span>{sym("ok")} {esc(E("materiale"))}</span>'
          f'<span>{sym("bad")} {esc(E("ikke_materiale"))}</span>'
          '</span></h2><div class="kort-rutenett">']
    for x in sorted(m["materialer"], key=lambda x: -x["objekter"]):
        kl = list(x["klasser"].items())
        kltekst = " · ".join(f"{k} ×{n_(c)}" for k, c in kl[:3]) + (f" · {E('andre')} ({len(kl) - 3})" if len(kl) > 3 else "")
        lag = f'<dt>{esc(E("lag"))}</dt><dd>{esc(" · ".join(f"{v:g}".replace(".", ",") for v in x["lag_mm"]))} mm</dd>' if x.get("lag_mm") else ""
        ut.append(f'<div class="kort"><div class="tn">{sym("ok" if x["gyldig"] else "bad")} {esc(x["navn"] or "–")}</div>'
                  f'<div class="inst">{n_(x["objekter"])}<small>{esc(E("objekter"))}</small></div><dl>'
                  f'<dt>{esc(E("ifc_klasser"))}</dt><dd>{esc(kltekst)}</dd>'
                  f'<dt>{esc(E("typer"))}</dt><dd>{n_(x["typer"])}</dd>'
                  f'<dt>{esc(E("kilde"))}</dt><dd>{esc(x["kilde"])}</dd>{lag}</dl></div>')
    ut.append("</div></section>")
    return "".join(ut)


def html_kodelister(m: dict, nr: int) -> str:
    """The configured code lists, compact tables. Nothing when none is configured."""
    if not m.get("kodelister"):
        return ""
    ut = [f'<section class="kodelister"><h2><span class="nr">{nr}</span>{esc(E("seksjon_kodelister"))}</h2>']
    for kl in m["kodelister"]:
        rader = "".join(
            f'<tr><td>{esc(r_["kode"])}</td><td>{esc(r_["navn"] or "–")}</td>'
            f'<td class="tall">{n_(r_["objekter"])}</td><td class="tall">{n_(r_["typer"])}</td>'
            f'<td>{sym("ok") if r_["gyldig"] else sym("bad") + " " + esc(E("ikke_i_tabellen"))}</td></tr>'
            for r_ in kl["rader"])
        ut.append(f'<h3>{esc(kl["tittel"])}</h3><table class="kodeliste"><colgroup><col style="width:16mm">'
                  '<col><col style="width:16mm"><col style="width:12mm"><col style="width:26mm"></colgroup>'
                  f'<tr><th>{esc(E("kode"))}</th><th>{esc(E("navn"))}</th>'
                  f'<th class="tall">{esc(E("objekter_kolonne"))}</th><th class="tall">{esc(E("typer"))}</th>'
                  f'<th>{esc(E("gyldig"))}</th></tr>{rader}</table>')
    ut.append("</section>")
    return "".join(ut)


def katalog_ark(modeller: list[dict]) -> list[tuple[str, list[str], list[list]]]:
    """Workbook sheets matching the material gallery and the code lists: Materialer, then one sheet
    per configured list. Only for models that carry them."""
    ut = []
    mat = [[m["label"], x["navn"], E("ja") if x["gyldig"] else E("nei"), x["objekter"],
            " | ".join(f"{k} ×{c}" for k, c in x["klasser"].items()), x["typer"], x["kilde"],
            " | ".join(f"{v:g}" for v in x.get("lag_mm") or [])]
           for m in modeller for x in sorted(m.get("materialer") or [], key=lambda x: -x["objekter"])]
    if any("materialer" in m for m in modeller):
        ut.append((E("ark_materialer"), [E(k) for k in ("modell", "materiale_kol", "gyldig", "objekter_kolonne",
                                                        "ifc_klasser", "typer", "kilde", "lagtykkelse_mm")], mat))
    ark_: dict[str, list[list]] = {}
    for m in modeller:
        for kl in m.get("kodelister") or []:
            ark_.setdefault(kl["ark"], []).extend(
                [m["label"], r_["kode"], r_["navn"], r_["objekter"], r_["typer"], E("ja") if r_["gyldig"] else E("nei")]
                for r_ in kl["rader"])
    for navn, rader in ark_.items():
        ut.append((navn, [E(k) for k in ("modell", "kode", "navn", "objekter_kolonne", "typer", "i_kodetabellen")],
                   rader))
    return ut


# Colour per category; the words (psett_*) come from `etiketter` when the labels load.
PSETT_KATEGORI = {"ifc": ("--mk-kategori-ifc", None), "krevd": ("--mk-kategori-krevd", None),
                  "annen": ("--mk-kategori-annen", None)}
PSETT_MAKS_EGENSKAPER = 10
STANDARD_PSETT = stier.STANDARD / "standard_psett.yaml"


def visningsverdi(t: str) -> str:
    """An example value for print: a float rounded to three decimals, trailing zeros trimmed
    (0.7391999999999459 -> 0.739, 0.0 -> 0). Text is left as it is. The workbook keeps the raw."""
    try:
        x = float(t)
    except (TypeError, ValueError):
        return t
    if "." not in t and "e" not in t.lower():
        return t
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def html_psett(m: dict, nr: int) -> str:
    """Every property set in the model, one card each, coloured by category (never by verdict)."""
    ut = [f'<section class="galleri psett"><h2><span class="nr">{nr}</span>{esc(E("seksjon_egenskapssett"))}'
          '<span class="legende">'
          + "".join(f'<span><span class="kat" style="background:var({f})"></span>{esc(t)}</span>'
                    for f, t in PSETT_KATEGORI.values())
          + '</span></h2><div class="psett-rutenett">']
    for p in m["psett"]:
        farge, kat = PSETT_KATEGORI[p["kategori"]]
        kl = list(p["klasser"].items())
        kltekst = " · ".join(f"{k} ×{n_(c)}" for k, c in kl[:3]) + (f" · {E('andre')} ({len(kl) - 3})" if len(kl) > 3 else "")
        rader = []
        eg = p["egenskaper"]
        for e in eg[:PSETT_MAKS_EGENSKAPER]:
            eks = " · ".join(kutt(visningsverdi(x), 22) for x, _ in e["eksempler"][:3])
            rader.append(f'<tr><td>{esc(brytbar(e["navn"]))}</td><td class="tall">{esc(p_(e["andel"]))}</td>'
                         f'<td class="eks">{esc(eks)}</td></tr>')
        if len(eg) > PSETT_MAKS_EGENSKAPER:
            rader.append(f'<tr><td colspan="3" class="andre">{esc(E("andre"))} ({len(eg) - PSETT_MAKS_EGENSKAPER})</td></tr>')
        ut.append(f'<div class="pkort" style="border-left-color:var({farge})">'
                  f'<div class="pn">{esc(brytbar(p["navn"]))}</div>'
                  f'<div class="pm"><span class="kat" style="background:var({farge})"></span>{esc(kat)} · '
                  f'{n_(p["objekter"])} {esc(E("objekter"))}</div><div class="pk">{esc(kltekst)}</div>'
                  f'<table><colgroup><col style="width:38%"><col style="width:13%"><col></colgroup>'
                  f'{"".join(rader)}</table></div>')
    ut.append("</div></section>")
    return "".join(ut)


def verdi_dd(f: dict, farge: str = "") -> str:
    if not f["verdi"]:
        return f'<dd>{sym("bad")}</dd>'
    sw = f'<span class="sw" style="background:var({farge})"></span>' if farge else ""
    andre = f' <span class="st na">+{f["andre"]}</span>' if f["andre"] else ""
    if f.get("flagg"):
        return f'<dd class="warn">{sw}{SYM["warn"]} {esc(kutt(f["verdi"], 40))}{andre}</dd>'
    tom = f' <span class="st bad">{SYM["bad"]}{NBSP}{n_(f["tom"])}</span>' if f["tom"] and f["verdi"] else ""
    return f'<dd>{sw}{esc(kutt(f["verdi"], 40))}{andre}{tom}</dd>'


def html_kort(t: dict) -> str:
    return (f'<div class="kort"><div class="tn">{esc(t["navn"] or "–")}</div>'
            f'<div class="kl">{esc(t["klasse"])}</div>'
            f'<div class="inst">{n_(t["instanser"])}<small>{esc(E("instanser"))}</small></div><dl>'
            f'<dt>{esc(E("type_ns3451"))}</dt>{verdi_dd(t["systemkode"])}'
            f'<dt>{esc(E("type_ns3457"))}</dt>{verdi_dd(t["funksjonskode"])}'
            f'<dt>{esc(E("type_materiale"))}</dt>{verdi_dd(t["materiale"])}'
            f'<dt>{esc(E("type_produkt"))}</dt>{verdi_dd(t["produkt"])}'
            f'<dt>{esc(E("mengdetype"))}</dt>{verdi_dd(t["mengdetype"])}'
            f'<dt>{esc(E("type_mmi"))}</dt>{verdi_dd(t["mmi"], t["mmi_farge"])}'
            f'</dl></div>')


def html_celle(c: dict) -> str:
    sub = "".join(f'<span class="sub">{esc(s)}</span>' for s in c["sub"] if s)
    tekst = f" {esc(brytbar(c['tekst']))}" if c["tekst"] else ""
    return f'<td class="c {c["status"]}">{sym(c["status"])}{tekst}{sub}</td>'


def colgroup_mm(fast: list[float], n: int) -> str:
    return "<colgroup>" + "".join(f'<col style="width:{w:g}mm">' for w in bredder(fast, n)) + "</colgroup>"


def html_prosjekt(R: dict, css: Path) -> str:
    labels = R["labels"]
    kort = {m["label"]: m["kort"] for m in R["modeller"]}
    hode_kol = "".join(f'<th>{esc(brytbar(kort[l]))}</th>' for l in labels)
    meta = [(E("dato"), dato_no(R["dato"])), (E("eksport"), R["eksport"]), (E("modeller"), str(len(labels)))]
    k = [html_hode(R, E("rapport_navn"), R["prosjekt"]["navn"], meta)]
    # 1 Leveransen
    k.append(f'<h2><span class="nr">1</span>{esc(E("seksjon_leveransen"))}</h2><table>'
             + "<colgroup>" + "".join(f'<col style="width:{w}mm">' for w in (40, 18, 36, 26, 26, 20, 20)) + "</colgroup>"
             + f'<thead><tr><th>{esc(E("modell"))}</th><th>{esc(E("fagkode"))}</th><th>{esc(E("firma"))}</th>'
               f'<th>{esc(E("dalux_versjon"))}</th><th>{esc(E("opplastingsdato"))}</th>'
               f'<th class="tall">{esc(E("objekter_kolonne"))}</th><th>{esc(E("ifc_skjema"))}</th></tr></thead><tbody>')
    for m in R["modeller"]:
        k.append(f'<tr><td>{esc(brytbar(m["label"]))}</td><td>{esc(m["fag"])}</td><td>{esc(m["firma"])}</td>'
                 f'<td>{esc(m["versjon"])}</td><td>{esc(dato_no(m["lastet_opp"]))}</td>'
                 f'<td class="tall">{n_(m["n"])}</td><td>{esc(m["schema"])}</td></tr>')
    k.append("</tbody></table>")
    # 2 Krav x modell
    k.append(f'<h2><span class="nr">2</span>{esc(E("seksjon_krav_modell"))}</h2><table>' + colgroup_mm([34], len(labels))
             + f'<thead><tr><th>{esc(E("krav"))}</th>{hode_kol}</tr></thead><tbody>')
    forrige = "blokk"
    for rad in R["matrise"]:
        kl = ' class="skille"' if rad["type"] != forrige else ""
        forrige = rad["type"]
        k.append(f'<tr{kl}><td class="krav">{esc(brytbar(rad["tittel"]))}<small>{esc(rad["kilde"])}</small></td>'
                 + "".join(html_celle(rad["celler"][l]) for l in labels) + "</tr>")
    k.append(f"</tbody></table><p>{html_legende(R)}</p>")
    # 3 Bruk and 4 GUID på tvers: project config (use cases, Kopiobjekt); omitted without it
    nr = 2
    if R["bruk"]:
        nr += 1
        k.append(f'<h2><span class="nr">{nr}</span>{esc(E("seksjon_bruk"))}</h2><table>' + colgroup_mm([34], len(labels))
                 + f'<thead><tr><th>{esc(E("bruk"))}</th>{hode_kol}</tr></thead><tbody>')
        for b in R["bruk"]:
            k.append(f'<tr><td class="krav">{esc(b["tittel"])}<small>{esc(" · ".join(b["rader"]))}</small></td>'
                     + "".join(html_celle(b["celler"][l]) for l in labels) + "</tr>")
        k.append("</tbody></table>")
    if not R["guid"]:
        return html_dokument(f'{E("rapport_navn")} {E("prosjektrapport")}', "\n".join(k), css)
    nr += 1
    k.append(f'<h2><span class="nr">{nr}</span>{esc(E("seksjon_guid_paa_tvers"))}</h2><table>' + colgroup_mm([34], len(labels))
             + f'<thead><tr><th></th>{hode_kol}</tr></thead><tbody>')
    for g in R["guid"]:
        k.append(f'<tr><td class="krav">{esc(brytbar(kort[g["label"]]))}<small>{n_(g["objekter"])}</small></td>'
                 + "".join(html_celle(g["celler"][l]) for l in labels) + "</tr>")
    k.append("</tbody></table>")
    return html_dokument(f'{E("rapport_navn")} {E("prosjektrapport")}', "\n".join(k), css)


# ================================================================ PDF
def chrome() -> Path:
    exe = Path(os.environ["CHROME"]) if os.environ.get("CHROME") else None
    exe = exe or next((p for p in CHROME if p.exists()), None)
    exe = exe or next((Path(w) for w in map(shutil.which, CHROME_PATH) if w), None)
    if exe is None:
        raise SystemExit("FEIL: fant ingen Chrome/Edge")
    return exe


def skriv_pdf(html_sti: Path, pdf_sti: Path) -> Path:
    """Headless print with a virtual time budget, so the header font has arrived before print.
    One browser process at a time. Printed beside the HTML first, then moved into place; when the
    destination is held open by a reader the staged file is returned and the caller fails the
    build, so a stale PDF can never pass for a fresh one."""
    stadie = html_sti.with_suffix(".pdf")
    for i in range(1, 20):
        try:
            if stadie.exists():
                stadie.unlink()
            break
        except PermissionError:
            # The staged copy is held open by a reader too: stage beside it under a new name.
            stadie = html_sti.with_name(f"{html_sti.stem}_{i}.pdf")
    subprocess.run([str(chrome()), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--no-pdf-header-footer", "--virtual-time-budget=10000",
                    f"--print-to-pdf={stadie}", html_sti.as_uri()],
                   capture_output=True, text=True, timeout=300)
    if not stadie.exists():
        raise SystemExit(f"FEIL: PDF ikke skrevet: {stadie}")
    try:
        stadie.replace(pdf_sti)
        return pdf_sti
    except PermissionError:
        return stadie


OVERLOP_JS = """<script>
window.addEventListener('load', function () {
  var ut = [];
  document.querySelectorAll('.mk *').forEach(function (e) {
    if (e.closest('svg') || e.classList.contains('vannmerke')) return;
    var cs = getComputedStyle(e);
    if (cs.display === 'inline' || cs.display === 'none' || cs.overflow === 'hidden') return;
    if (e.scrollWidth > e.clientWidth + 1) {
      ut.push((e.className || e.tagName) + ' | ' + (e.textContent || '').trim().slice(0, 70) +
              ' | ' + e.scrollWidth + ' > ' + e.clientWidth);
    }
  });
  var p = document.createElement('pre');
  p.id = 'overlop';
  p.textContent = JSON.stringify(ut);
  document.body.appendChild(p);
});
</script>"""


MAKS_DOMSSIDER = 2   # pages the verdict part may take before the build fails (rule 7)


def overlop_sjekk(html_sti: Path) -> list[str]:
    """Every element whose content is wider than its own box, measured in the headless page. The
    grid gives each cell a track; text wraps inside it, so anything wider has overflowed."""
    kopi = html_sti.with_name(html_sti.stem + ".overlop.html")
    kopi.write_text(html_sti.read_text(encoding="utf-8").replace("</body>", OVERLOP_JS + "</body>"),
                    encoding="utf-8")
    res = subprocess.run([str(chrome()), "--headless=new", "--disable-gpu", "--virtual-time-budget=5000",
                          "--window-size=1200,1600", "--dump-dom", kopi.as_uri()],
                         capture_output=True, text=True, timeout=180, encoding="utf-8", errors="replace")
    kopi.unlink(missing_ok=True)
    m = re.search(r'<pre id="overlop">(.*?)</pre>', res.stdout, re.S)
    if not m:
        return ["overløpssjekken fikk ikke svar fra siden"]
    return json.loads(html.unescape(m.group(1)))


def pdf_sjekk(pdf_sti: Path, galleri: bool) -> dict:
    import fitz
    doc = fitz.open(str(pdf_sti))
    sider_ = doc.page_count
    fonter = sorted({f[3] for p in doc for f in p.get_fonts()})
    galleriside = None
    if galleri:
        for i, p in enumerate(doc):
            if E("seksjon_typegalleri").upper() in p.get_text().upper():
                galleriside = i
                break
    doc.close()
    return {"sider": sider_, "fonter": fonter, "galleriside": galleriside}


def png_side1(pdf_sti: Path, png_sti: Path) -> None:
    import fitz
    doc = fitz.open(str(pdf_sti))
    doc[0].get_pixmap(dpi=150).save(str(png_sti))
    doc.close()


# ================================================================ XLSX
def skriv_xlsx(R: dict, reg: Register, sti: Path) -> None:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    tok = les_tokens()
    fyll = {s: PatternFill("solid", fgColor=hex_(tok, f"--sk-{n}-flate"))
            for s, n in (("ok", "oppfylt"), ("warn", "avvik"), ("bad", "mangler"), ("na", "na"))}
    fet = Font(bold=True)
    wb = openpyxl.Workbook()
    ark_liste = []

    def ark(navn: str, hode: list[str]):
        ws = wb.create_sheet(navn)
        ws.append(hode)
        for c in ws[1]:
            c.font = fet
            c.alignment = Alignment(wrap_text=True, vertical="bottom")
        ark_liste.append(ws)
        return ws

    def status_tekst(c: dict) -> str:
        return " ".join(x for x in [SYM[c["status"]], c["tekst"], *c["sub"]] if x)

    labels = R["labels"]
    mods = {m["label"]: m for m in R["modeller"]}
    blokk_tittel = [b["tittel"] for b in reg.blokker]

    # Sammendrag
    ws = ark(E("ark_sammendrag"), [E(k) for k in ("modell", "fagkode", "firma", "dalux_versjon", "opplastingsdato",
                                                  "ifc_skjema", "objekter_kolonne", "instanser_per_type",
                                                  "typer_med_en_instans_kol")]
             + [f"{t} {E('dekning_prosent')}" for t in blokk_tittel])
    for m in R["modeller"]:
        kp = {k["id"]: k for k in m["kpi"]}
        rad = [m["label"], m["fag"], m["firma"], m["versjon"], m["lastet_opp"], m["schema"], m["n"],
               kp["instanser_per_type_alle"]["tekst"], kp["typer_med_en_instans_alle"]["tekst"]]
        rad += [None if b["dekning"].get("andel") is None else round(b["dekning"]["andel"], 1) for b in m["blokker"]]
        ws.append(rad)
        for j, b in enumerate(m["blokker"]):
            c = ws.cell(row=ws.max_row, column=10 + j)
            c.fill = fyll[b["status"]]
            c.number_format = "0.0"

    # Krav
    ws = ark(E("ark_krav"), [E("krav"), E("kilde")] + labels)
    for rad in R["matrise"]:
        ws.append([rad["tittel"], rad["kilde"]] + [status_tekst(rad["celler"][l]) for l in labels])
        for j, l in enumerate(labels):
            ws.cell(row=ws.max_row, column=3 + j).fill = fyll[rad["celler"][l]["status"]]
    for b in R["bruk"]:
        ws.append([b["tittel"], " · ".join(b["rader"])] + [status_tekst(b["celler"][l]) for l in labels])
        for j, l in enumerate(labels):
            ws.cell(row=ws.max_row, column=3 + j).fill = fyll[b["celler"][l]["status"]]

    # Funn
    ws = ark(E("ark_funn"), [E(k) for k in ("modell", "krav", "verdi", "antall", "status")])
    for m in R["modeller"]:
        for b in m["blokker"]:
            dk = b["dekning"]
            if dk.get("mangler"):
                ws.append([m["label"], b["tittel"], "–", dk["mangler"], E("flagg_mangler")])
                ws.cell(row=ws.max_row, column=5).fill = fyll["bad"]
            for e in b["fordeling_alle"]:
                if e["flagg"] in ("avvik", "mangler", "flagg"):
                    verdi = e["verdi"] + (f" · {e['tillegg']}" if e["tillegg"] else "")
                    st = {"avvik": "warn", "mangler": "bad", "flagg": "na"}[e["flagg"]]
                    ws.append([m["label"], b["tittel"], verdi, e["n"], E(f"flagg_{e['flagg']}")])
                    ws.cell(row=ws.max_row, column=5).fill = fyll[st]
        eb = next(b for b in m["blokker"] if b["id"] == "etasjer")
        for pe in (eb.get("spenn") or {}).get("per_etasje", []):
            for k in ("avvik", "mangler", "uten_geometri"):
                if pe.get(k):
                    ws.append([m["label"], eb["tittel"], f"{pe['etasje']} · {E('spenn_' + k)}", pe[k], E("flagg_avvik")])
                    ws.cell(row=ws.max_row, column=5).fill = fyll["warn"]
        for h in m["hygiene"]:
            if h["status"] in ("warn", "bad"):
                ws.append([m["label"], h["tittel"], " · ".join([h["tekst"], *h["sub"]]), None,
                           STATUSORD[h["status"]]])
                ws.cell(row=ws.max_row, column=5).fill = fyll[h["status"]]

    # Per modell
    bid = [b["id"] for b in reg.blokker if b["id"] not in ("guid", "skjema", "etasjedefinisjon", "produkt", "materiale")]
    ws = ark(E("ark_per_modell"), [E(k) for k in ("modell", "ifc_klasse", "objekter_kolonne", "mengdetype")]
             + [f"{b['tittel']} {E('kol_oppfylt')}" for b in reg.blokker
                if b["id"] not in ("guid", "skjema", "etasjedefinisjon", "produkt", "materiale")])
    for m in R["modeller"]:
        mt = {}
        for kl, t_, en_, c_, _ in m["mengdeklasser"]:
            mt.setdefault(kl, []).append(MENGDEORD[t_] + (f" · {en_}" if en_ else ""))
        for kl, c in m["per_klasse"].items():
            ws.append([m["label"], kl, c["n"], " | ".join(mt.get(kl, []))] + [c.get(x, 0) for x in bid])

    # Verdier
    ws = ark(E("ark_verdier"), [E(k) for k in ("modell", "krav", "verdi", "antall_objekter", "gyldig")])
    for m in R["modeller"]:
        for b in m["blokker"]:
            for r_ in b.get("rader") or []:
                liste = r_.get("gyldighet") is not None
                for e in r_.get("fordeling_alle") or []:
                    verdi = e.get("raa", e["verdi"]) + (f" · {e['tillegg']}" if e.get("tillegg") else "")
                    gyldig_ = (E("nei") if e["flagg"] == "avvik" else E("ja")) if liste else "–"
                    ws.append([m["label"], b["tittel"] + (f" · {r_['tittel']}" if r_.get("tittel") else ""),
                               verdi, e["n"], gyldig_])
                    if gyldig_ == E("nei"):
                        ws.cell(row=ws.max_row, column=5).fill = fyll["warn"]

    # Type 1:1: a project-layer sheet, there only when a project requirement reads type_1til1
    # (a project type property equal to the type name). Omitted in a run without it.
    type_1til1 = any(str(k.get("datanokkel", "")).startswith("type_1til1") for k in reg.krav)
    if type_1til1:
        ws = ark(E("ark_type_1til1"), [E(k) for k in ("modell", "retning", "nokkel", "objekter_kolonne", "motparter",
                                                       "kun_skrivemaate")])
    for m in (R["modeller"] if type_1til1 else []):
        k1 = m["type_1til1"]
        for retning, nok in ((E("type1til1_splitt"), "splitt"), (E("type1til1_samling"), "samling")):
            for b in k1.get(nok, []):
                ws.append([m["label"], retning, b["nokkel"], b["objekter"],
                           " | ".join(f"{v} ×{n}" for v, n in b["motparter"].items()),
                           E("ja") if b["kun_skrivemate"] else ""])

    # Etasjer: the etasjematrise, row for row
    ws = ark(E("ark_etasjer"), [E(k) for k in ("modell", "konfigurert_navn", "konfigurert_kote_mm", "modellens_navn",
                                                "modellens_kote_mm", "status")])
    for m in R["modeller"]:
        for r_ in m["etasjematrise"]["rader"]:
            ws.append([m["label"], r_["k_navn"], r_["k_kote"], r_["m_navn"], r_["m_kote"], r_["status"]])

    # Filer
    ws = ark(E("ark_filer"), [E(k) for k in ("modell", "fil", "sjekksum", "dalux_versjon", "opplastingsdato", "eksport",
                                              "ifc_skjema", "eksportor", "eksportert", "byte", "merknad")])
    for m in R["modeller"]:
        ws.append([m["label"], m["fil"], m["sha256"], m["versjon"], m["lastet_opp"], m["eksport"],
                   m["schema"], m["system"], m["eksportert"], m["bytes"], m["merknad_runde"]])

    # Typer (the type gallery, row for row)
    ws = ark(E("ark_typer"), [E(k) for k in ("modell", "type", "ifc_klasse", "objektklasser", "instanser_kol",
                                              "type_ns3451", "type_ns3457", "type_materiale", "type_produkt",
                                              "mengdetype", "type_mmi")])
    for m in R["modeller"]:
        for t in m["typer"]:
            ws.append([m["label"], t["navn"], t["klasse"], t["objektklasser"], t["instanser"],
                       t["systemkode"]["alle"], t["funksjonskode"]["alle"], t["materiale"]["alle"],
                       t["produkt"]["alle"], t["mengdetype"]["alle"], t["mmi"]["alle"]])

    # Egenskapssett: every set and every property, nothing collapsed
    ws = ark(E("ark_egenskapssett"), [E(k) for k in ("modell", "egenskapssett", "kategori", "objekter_kolonne",
                                                      "ifc_klasser", "egenskap", "utfylt", "utfylt_prosent",
                                                      "ulike_verdier", "eksempler")])
    for m in R["modeller"]:
        for p in m["psett"]:
            kl = " | ".join(f"{k} ×{c}" for k, c in p["klasser"].items())
            for e in p["egenskaper"] or [{"navn": "", "fylt": 0, "andel": 0, "ulike": 0, "ulike_tak": False, "eksempler": []}]:
                ulike = f"≥{e['ulike']}" if e.get("ulike_tak") else e["ulike"]
                ws.append([m["label"], p["navn"], p["kategori_tekst"], p["objekter"], kl, e["navn"],
                           e["fylt"], round(e["andel"], 1), ulike,
                           " | ".join(f"{x} ×{c}" for x, c in e["eksempler"])])

    # Lesmeg: the register, verbatim
    for navn, hode, rader in katalog_ark(R["modeller"]):
        ws = ark(navn, hode)
        for r_ in rader:
            ws.append(r_)

    ws = ark(E("ark_lesmeg"), [E(k) for k in ("del", "id", "tittel", "kilde", "maaler_oppslag")])
    ws.append([E("telte_objekter"), "", "", "", reg.standard["telte_objekter"].strip()])
    ws.append([E("terskel"), "", "", "", f"{E('status_ok')} ≥ {R['terskel']['ok']} % · "
                                        f"{E('status_bad')} < {R['terskel']['warn']} %"])
    for b in reg.blokker:
        steder = [(pre, b[k]) for pre, k in (("", "sted"), (E("produkt_prefiks") + ": ", "sted_telleobjekt"),
                                             (E("materiale_prefiks") + ": ", "sted_mengdeobjekt")) if b.get(k)]
        kilder = " · ".join(f"{pre}[{nivaa_etikett(s['nivaa'])}] {blokkdata.kildeetikett(s)}"
                            for pre, s in steder) or E("ikke_konfigurert")
        ws.append([E("lesmeg_krav"), b["id"], b["tittel"], b.get("kilde", ""), kilder])
    for kr in reg.krav:
        ws.append(["krav.yaml", kr["id"], kr["tittel"], kr.get("kilde", ""), " ".join(kr.get("maaler", "").split())])
    for k in reg.kpi:
        ws.append([E("lesmeg_nokkeltall"), k["id"], k["tittel"], "", " ".join(k.get("maaler", "").split())])

    wb.remove(wb["Sheet"])
    for ws in ark_liste:
        ws.freeze_panes = "B2" if ws.title != E("ark_lesmeg") else "A2"
        if ws.max_row > 1:
            ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"
        for i in range(1, ws.max_column + 1):
            ws.column_dimensions[get_column_letter(i)].width = 16
        ws.column_dimensions["A"].width = 24
    wb.save(sti)


# ================================================================ checks and main
def sjekk_mojibake(filer: list[Path]) -> list[str]:
    import zipfile
    funn = []
    for f in filer:
        if f.suffix == ".xlsx":
            with zipfile.ZipFile(f) as z:
                tekst = "".join(z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith(".xml"))
        else:
            tekst = f.read_text(encoding="utf-8")
        for m in MOJIBAKE:
            if m in tekst:
                funn.append(f"{f.name}: {m!r}")
    return funn


def bygg(prosjekt: Path, runde: Path, cache: Path, ut: Path, ifc: Path | None = None,
         css: Path = CSS_STD, ny: bool = False, kun_rendering: bool = False,
         kun_standard: bool = False) -> int:
    """Render one round into `ut`. Measures the blocks first (blokkdata, cached under `cache`)
    unless `kun_rendering`, which reads the caches as they lie."""
    stier.finnes(prosjekt, runde)
    css = Path(css).resolve()
    reg = Register(prosjekt, kun_standard)
    r = Runde(runde, cache, prosjekt.resolve().parent, ifc)
    r.bind(reg)
    print(f"Runde {r.dato}: {runde.name}")
    stier.finnes(r.data_sti, r.struktur_sti, TOKENS, css, MERKE)
    data = {d["id"]: d for d in map(normaliser, json.loads(r.data_sti.read_text(encoding="utf-8")))}
    struktur = {s["label"]: s for s in json.loads(r.struktur_sti.read_text(encoding="utf-8"))}
    rapporter = r.hoved(reg)
    for m in rapporter:
        vent = r.cfg[m]["sha16"]
        if m not in data or m not in struktur:
            raise SystemExit(f"FEIL: {m}: mangler i data.json eller struktur, kjør bep_egenskapskontroll.py og struktur.py")
        egen, strukt = data[m].get("sha"), struktur[m].get("sha16")
        if egen != vent or strukt != vent:
            raise SystemExit(f"FEIL: {m}: runde {vent} ≠ egenskapskontroll {egen} / struktur {strukt}")
        if data[m].get("sjekk_versjon") != SJEKK_VERSJON_KREVD or "guid_kopi" not in data[m]:
            raise SystemExit(f"FEIL: {m}: data.json er skrevet av en eldre egenskapskontroll, kjør bep_egenskapskontroll.py --ny")

    if kun_rendering:
        # Template round (edkjo 2026-09-24): no IFC processing. The caches are read as they lie;
        # the geometry cache is not read at all.
        katalog = r.blokk_sti / "prosjekt"
        bd = {m: json.loads((katalog / f"{m}.json").read_text(encoding="utf-8")) for m in rapporter}
        geo = {m: {} for m in rapporter}
    else:
        # One location per requirement (blokkdata 6), cached per file sha and register. No geometry
        # is processed: geomdata.py (ifcopenshell.geom) is not run, so no etasjespenn.
        bd = blokkdata.kjør(prosjekt, runde, cache, ifc, ny=ny, valgte=rapporter, kun_standard=kun_standard)
        geo = {m: {} for m in rapporter}
        gamle = [m for m in rapporter if not bd[m].get("ett_sted")]
        if gamle:
            raise SystemExit(f"FEIL: blokkdata uten ett sted per krav: {', '.join(gamle)}")
    for m in rapporter:
        if bd[m]["n"] != data[m]["n"]:
            raise SystemExit(f"FEIL: {m}: blokkdata n={bd[m]['n']} ≠ egenskapskontroll n={data[m]['n']}")
    R = beregn(reg, r, data, struktur, bd, geo)
    R["mal"] = bool(kun_rendering)
    if not kun_rendering:
        # Fail honestly (edkjo): no MOCK reading reaches a measured round.
        mock = [f"{m['label']}: {', '.join(m['mock'])}" for m in R["modeller"] if m["mock"]]
        if mock:
            raise SystemExit("FEIL: MOCK i en målt runde: " + " | ".join(mock))
    (ut / "html").mkdir(parents=True, exist_ok=True)
    (ut / "data").mkdir(parents=True, exist_ok=True)
    (ut / "data" / "beregnet.json").write_text(json.dumps(R, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    skrevet: list[Path] = []
    feil: list[str] = []
    for m in R["modeller"]:
        navn = f"{reg.prosjekt['kode']}_Mottakskontroll_{m['kort']}"
        h = ut / "html" / f"{navn}.html"
        h.write_text(html_modell(R, m, css), encoding="utf-8")
        pdf = ut / f"{navn}.pdf"
        skrevet_pdf = skriv_pdf(h, pdf)
        if skrevet_pdf != pdf:
            feil.append(f"{pdf.name} er låst (åpen i en leser); ny versjon ligger i {skrevet_pdf}")
        s = pdf_sjekk(skrevet_pdf, galleri=True)
        m["_sider"] = s["sider"]
        print(f"{pdf.name}: {s['sider']} sider, typegalleri fra side {None if s['galleriside'] is None else s['galleriside'] + 1}")
        # The verdict part (everything before the type gallery) may run to two pages
        # (edkjo: «two pages fine, one page not a hard rule»); the gallery starts on a fresh page.
        if s["galleriside"] is None or s["galleriside"] > MAKS_DOMSSIDER:
            feil.append(f"{pdf.name}: domsdelen er over {MAKS_DOMSSIDER} sider (typegalleriet starter på side "
                        f"{None if s['galleriside'] is None else s['galleriside'] + 1})")
        feil += [f"{h.name}: overløp: {x}" for x in overlop_sjekk(h)]
        skrevet += [h, pdf]
    h = ut / "html" / f"{reg.prosjekt['kode']}_Mottakskontroll_Prosjekt.html"
    h.write_text(html_prosjekt(R, css), encoding="utf-8")
    pdf = ut / f"{reg.prosjekt['kode']}_Mottakskontroll_Prosjekt.pdf"
    skrevet_pdf = skriv_pdf(h, pdf)
    if skrevet_pdf != pdf:
        feil.append(f"{pdf.name} er låst (åpen i en leser); ny versjon ligger i {skrevet_pdf}")
    s = pdf_sjekk(skrevet_pdf, galleri=False)
    print(f"{pdf.name}: {s['sider']} sider · fonter {', '.join(s['fonter'])}")
    skrevet += [h, pdf]
    xlsx = ut / f"{reg.prosjekt['kode']}_Mottakskontroll.xlsx"
    skriv_xlsx(R, reg, xlsx)
    print(xlsx.name)
    skrevet.append(xlsx)
    moj = sjekk_mojibake([p for p in skrevet if p.suffix in (".html", ".xlsx")] + [ut / "data" / "beregnet.json"])
    if moj:
        feil += [f"mojibake: {x}" for x in moj]
    if feil:
        print("\n".join(f"FEIL: {x}" for x in feil))
        return 1
    print(f"OK: {len(R['modeller'])} modellrapporter, prosjektrapport, regneark i {ut}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Render the mottakskontroll of one round from its measurements.")
    stier.argumenter(ap)
    ap.add_argument("--ifc", type=Path, metavar="DIR", help="IFC folder of the round (replaces the round's `kilde`)")
    ap.add_argument("--css", type=Path, default=CSS_STD, help="treatment (default: rapport/mottakskontroll.css)")
    ap.add_argument("--ny", action="store_true", help="measure the blocks again, ignoring the cache")
    ap.add_argument("--kun-rendering", action="store_true",
                    help="no IFC processing: read the caches as they lie, mark MOCK where numbers are missing")
    ap.add_argument("--kun-standard", action="store_true", help="the standard layer only (standard/standard.yaml)")
    a = ap.parse_args()
    return bygg(a.prosjekt, a.runde, a.cache, a.ut, a.ifc, a.css, a.ny, a.kun_rendering, a.kun_standard)


if __name__ == "__main__":
    raise SystemExit(main())
