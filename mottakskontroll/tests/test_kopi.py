"""Copy/reference objects leave the counted set (edkjo 2026-11-27).

    python -m pytest mottakskontroll/tests -q

One synthetic IFC4 file, six walls with a body, two copy markers on them:
    P.IsReference  (boolean mode, KNM shape)   False False False False True True
    P.Kopi         (owner mode, HI90 shape)    ARK   ''    T_ARK RIB   XYZ   kopi
The model, its walls and the values are made up for the test; no project data.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
import yaml

HER = Path(__file__).resolve().parent
sys.path.insert(0, str(HER.parent))

import bep_egenskapskontroll as B  # noqa: E402
import blokkdata  # noqa: E402
import bygg_mottakskontroll as BM  # noqa: E402
import konfig  # noqa: E402

ISREF = [False, False, False, False, True, True]
KOPI = ["ARK", "", "T_ARK", "RIB", "XYZ", "kopi"]


@pytest.fixture(scope="module")
def arbeid() -> Path:
    """The test's own folder inside the repo (gitignored), emptied first."""
    d = HER / "_tmp"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir()
    return d


@pytest.fixture(scope="module")
def ifc(arbeid: Path) -> Path:
    import ifcopenshell
    import ifcopenshell.api as api
    f = api.run("project.create_file", version="IFC4")
    prj = api.run("root.create_entity", f, ifc_class="IfcProject", name="T")
    api.run("unit.assign_unit", f)
    ctx = api.run("context.add_context", f, context_type="Model")
    body = api.run("context.add_context", f, context_type="Model", context_identifier="Body",
                   target_view="MODEL_VIEW", parent=ctx)
    site = api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    bygg = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="B")
    et = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="E1")
    et.Elevation = 0.0
    api.run("aggregate.assign_object", f, relating_object=prj, products=[site])
    api.run("aggregate.assign_object", f, relating_object=site, products=[bygg])
    api.run("aggregate.assign_object", f, relating_object=bygg, products=[et])
    for i, (ref, kopi) in enumerate(zip(ISREF, KOPI)):
        w = api.run("root.create_entity", f, ifc_class="IfcWall", name=f"W{i}")
        rep = api.run("geometry.add_wall_representation", f, context=body, length=1.0, height=1.0, thickness=0.2)
        api.run("geometry.assign_representation", f, product=w, representation=rep)
        api.run("spatial.assign_container", f, products=[w], relating_structure=et)
        ps = api.run("pset.add_pset", f, product=w, name="P")
        api.run("pset.edit_pset", f, pset=ps, properties={"IsReference": ref, "Kopi": kopi})
    sti = arbeid / "T_ARK.ifc"
    f.write(str(sti))
    return sti


def krav(arbeid: Path, navn: str, modus: str | None) -> Path:
    """A minimal project config: no marker, the boolean marker or the owner marker."""
    y = {"prosjekt": {"kode": "T", "navn": "T"}, "fagkoder": ["ARK", "RIB"],
         "modeller": {"T_ARK": {"fagkode": "ARK", "kopi_eier": ["T_ARK", "ARK"]},
                      "T_RIB": {"fagkode": "RIB", "kopi_eier": ["T_RIB", "RIB"]}},
         "krav": [], "kpi": [], "bruk": [], "forventet": {}}
    if modus == "bool":
        y["blokker"] = [{"id": "kopiobjekt", "sted": {"pset": "P", "egenskap": "IsReference"},
                         "gyldige": ["true", "false"]}]
        y["forventet"]["kopi_objekt"] = {"sanne_verdier": ["true"], "eier_verdier": ["false"]}
    elif modus == "eier":
        y["blokker"] = [{"id": "kopiobjekt", "sted": {"pset": "P", "egenskap": "Kopi"}}]
        y["forventet"]["kopi_objekt"] = {"sanne_verdier": ["kopi", "true"]}
        y["egenskapskontroll"] = {"pset": "P", "egenskaper": [{"navn": "Kopi", "kopi": True, "samle": True}]}
    sti = arbeid / f"{navn}.yaml"
    sti.write_text(yaml.safe_dump(y, allow_unicode=True), encoding="utf-8")
    return sti


def maal(krav_sti: Path, ifc: Path, label: str = "T_ARK") -> tuple[dict, dict]:
    reg = blokkdata.les_register(krav_sti)
    bd = blokkdata.mål(label, ifc, reg)
    d = B.kontroll(label, ifc, konfig.egenskapskontroll(reg["y"]), reg["y"]["fagkoder"], reg["y"]["_rot"])
    return bd, d


def beregning(krav_sti: Path, bd: dict, label: str = "T_ARK"):
    """The report's per-model reading without a round: only what utenfor_omfang reads."""
    m = object.__new__(BM.Modellberegning)
    m.reg, m.bd, m.label = BM.Register(krav_sti), bd, label
    m.fag = m.reg.modeller[label]["fagkode"]
    return m


def test_uten_markor_som_for(arbeid, ifc):
    """No marker configured: nothing is a copy, every wall counted, no `kopier` anywhere."""
    bd, d = maal(krav(arbeid, "ingen", None), ifc)
    assert konfig.KOPI == {}
    assert bd["n"] == d["n"] == 6 and bd["n_alle"] == 6
    assert "kopier" not in bd
    assert "kopiobjekt" not in d["ikke_telt_grunn"]
    assert "kopiobjekter" not in d["tellegrunnlag"]


def test_boolsk_markor(arbeid, ifc):
    """KNM shape: IsReference TRUE is a copy. Out of n, the Typeobjekt set, the tallies and the
    Kopiobjekt block; reported once, as `kopier`."""
    k = krav(arbeid, "bool", "bool")
    bd, d = maal(k, ifc)
    assert bd["n"] == d["n"] == 4
    assert bd["n_alle"] == 4                       # Typeobjekt / KPI grunnlag
    assert sum(bd["blokker"]["typeobjekt"]["botter"].values()) == 4
    assert bd["blokker"]["kopiobjekt"]["botter"] == {"oppfylt": 4}
    assert [v[0] for v in bd["blokker"]["kopiobjekt"]["verdier"]] == ["False"]
    assert bd["kopier"] == {"n": 2, "verdier": [["True", 2]]}
    assert d["ikke_telt_grunn"]["kopiobjekt"] == 2
    assert len(d["guid_kopi"]) == 4                # the GUID universe is the counted set
    assert bd["utelatt_objekter"] == []            # copies are not listed with the left-out objects
    m = beregning(k, bd)
    assert m.utenfor_omfang({"id": "kopiobjekt", "sted": {"pset": "P", "egenskap": "IsReference"}}) == \
        [(BM.E("kopier_holdt_utenfor"), 2)]
    # another requirement prints nothing about them
    assert m.utenfor_omfang({"id": "mmi", "sted": {"pset": "P", "egenskap": "MMI"}}) == []


def test_eiermarkor(arbeid, ifc):
    """HI90 shape: a value naming another model, or a copy value, is a copy; blank or this model's
    owner names is own. Read per model: the same file reads differently as T_RIB."""
    k = krav(arbeid, "eier", "eier")
    bd, d = maal(k, ifc, "T_ARK")
    # own: ARK, '', T_ARK; copies: RIB, XYZ, kopi
    assert bd["n"] == d["n"] == 3
    assert bd["kopier"]["n"] == 3
    assert sorted(v for v, _ in bd["kopier"]["verdier"]) == ["RIB", "XYZ", "kopi"]
    assert d["verdier"]["Kopi"] == {"ARK": 1, "(tom)": 1, "T_ARK": 1}   # egenskapskontroll tally
    m = beregning(k, bd)
    # XYZ is no fagkode and no copy value: a copy with an invalid marker
    assert m.utenfor_omfang({"id": "kopiobjekt", "sted": {"pset": "P", "egenskap": "Kopi"}}) == \
        [(BM.E("kopier_holdt_utenfor"), 3), (BM.E("kopier_ugyldig"), 1)]
    bd_rib, d_rib = maal(k, ifc, "T_RIB")
    # own as T_RIB: '' and RIB
    assert bd_rib["n"] == d_rib["n"] == 2 and bd_rib["kopier"]["n"] == 4


def test_ende_til_ende(arbeid, ifc):
    """The round through every step without a PDF: side workbook, struktur, blocks, the report's
    numbers and HTML, the deviation and type workbooks. The copies are out of every one of them
    and printed once, beside Kopiobjekt's distribution."""
    import hashlib
    import json

    import bygg_avvik
    import bygg_typer
    import openpyxl
    import struktur
    y = yaml.safe_load(krav(arbeid, "e2e", "bool").read_text(encoding="utf-8"))
    y.update({"uten_rapport": [], "faggrupper": {}, "merknader": {}, "merknader_modell": {},
              "typerapport": {"filnavn": "T_Typer.xlsx"}})
    y["forventet"]["filnavn"] = {"endelse": ".ifc", "skille": "_"}
    k = arbeid / "e2e.yaml"
    k.write_text(yaml.safe_dump(y, allow_unicode=True), encoding="utf-8")
    r = arbeid / "runde.json"
    r.write_text(json.dumps({"dato": "2026-11-27", "kilde": ".", "modeller": [
        {"label": "T_ARK", "fil": ifc.name, "firma": "T", "versjon": "1", "lastet_opp": "2026-11-27",
         "sha16": hashlib.sha256(ifc.read_bytes()).hexdigest()[:16]}]}), encoding="utf-8")
    ut = arbeid / "ut"
    cache = ut / "cache"
    assert B.kjør(k, r, cache, ut, ny=True) == 0
    assert struktur.kjør(k, r, cache) == 0
    reg = BM.Register(k)
    rr = BM.Runde(r, cache, arbeid)
    rr.bind(reg)
    data = {x["id"]: x for x in map(BM.normaliser, json.loads(rr.data_sti.read_text(encoding="utf-8")))}
    st = {s["label"]: s for s in json.loads(rr.struktur_sti.read_text(encoding="utf-8"))}
    bd = blokkdata.kjør(k, r, cache, ny=True, valgte=["T_ARK"])
    assert bd["T_ARK"]["n"] == data["T_ARK"]["n"] == 4
    R = BM.beregn(reg, rr, data, st, bd, {"T_ARK": {}})
    m = R["modeller"][0]
    blokker = {b["id"]: b for b in m["blokker"]}
    kb = blokker["kopiobjekt"]
    assert kb["kopier"] == {"n": 2, "ugyldige": 0}
    assert kb["dekning"]["grunnlag"] == 4 and kb["verdikt"] == "oppfylt"
    # every other block's denominator is the 4 own walls
    for bid, b in blokker.items():
        if b.get("dekning", {}).get("grunnlag"):
            assert b["dekning"]["grunnlag"] == 4, bid
    h = BM.html_modell(R, m, BM.CSS_STD)
    assert h.count(BM.E("kopier_holdt_utenfor")) == 1
    (ut / "data").mkdir(parents=True, exist_ok=True)
    (ut / "data" / "beregnet.json").write_text(json.dumps(R, ensure_ascii=False, default=str), encoding="utf-8")
    assert bygg_avvik.bygg(k, r, cache, ut) == 0
    assert bygg_typer.bygg(k, r, cache, ut) == 0
    # no copy's GlobalId in any workbook
    import ifcopenshell
    f = ifcopenshell.open(str(ifc))
    kopi_guid = {w.GlobalId for w in f.by_type("IfcWall") if w.Name in ("W4", "W5")}
    for x in ut.glob("*.xlsx"):
        wb = openpyxl.load_workbook(x, read_only=True)
        celler = {str(c) for ws in wb.worksheets for row in ws.iter_rows(values_only=True) for c in row if c}
        wb.close()
        assert not (kopi_guid & celler), x.name


def test_en_regel(arbeid, ifc):
    """The report's er_kopi and the counted set's are one rule."""
    k = krav(arbeid, "eier2", "eier")
    reg = BM.Register(k)
    for v in KOPI + ["  rib ", "T ARK", "TRUE"]:
        assert BM.er_kopi(reg, v, "ARK", "T_ARK") == konfig.er_kopi(v, "T_ARK"), v


def test_ukjent_modell_stopper(arbeid, ifc):
    konfig.sett_omfang(yaml.safe_load(krav(arbeid, "eier3", "eier").read_text(encoding="utf-8")))
    with pytest.raises(SystemExit):
        konfig.er_kopi("RIB", "T_UKJENT")
    assert konfig.er_kopi("kopi", "T_UKJENT") is True      # a copy value needs no owner names
    assert konfig.er_kopi("", "T_UKJENT") is False


def test_to_markorer_stopper(arbeid):
    """The block's marker and the property set check's copy property must be the same property."""
    y = yaml.safe_load(krav(arbeid, "eier4", "eier").read_text(encoding="utf-8"))
    y["egenskapskontroll"]["egenskaper"][0]["navn"] = "Annen"
    with pytest.raises(SystemExit):
        konfig.sett_omfang(y)


def test_sted_uten_verdier_stopper(arbeid):
    y = yaml.safe_load(krav(arbeid, "bool2", "bool").read_text(encoding="utf-8"))
    del y["forventet"]["kopi_objekt"]
    with pytest.raises(SystemExit):
        konfig.sett_omfang(y)


def test_utelatt_kopiobjekt_er_ingen_markor(arbeid):
    """A Kopiobjekt taken out of the report (`utelatt`) has no place to report copies: no filter."""
    y = yaml.safe_load(krav(arbeid, "bool3", "bool").read_text(encoding="utf-8"))
    y["blokker"][0]["utelatt"] = True
    konfig.sett_omfang(y)
    assert konfig.KOPI == {}
