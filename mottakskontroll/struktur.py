"""Mechanical structure/placement extraction for the models of one mottakskontroll round.

Reuses the streaming STEP reader in step.py (pass1/pass2/parse_args/ref/typed and the
base-point Name regex). No ifcopenshell, files read sequentially.

The round -- source folder, models, expected sha256[:16] -- is read from the round config.
The hash gate is hard: a file that does not match its config value raises.
Output: <cache>/struktur/<dato>/struktur_<dato>.json

    python struktur.py --prosjekt krav.yaml --runde runde.json --cache CACHE [--ifc DIR]
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
sys.path.insert(0, str(Path(__file__).parent))

import stier  # noqa: E402
from step import BASEPOINT, ENT, GUID_FIRST, NOT_ELEMENT_PREFIX, decode_str, parse_args, pass1, pass2, ref, typed  # noqa: E402


PREFIX_MM = {"MILLI": 1.0, "CENTI": 10.0, "DECI": 100.0, "KILO": 1e6, None: 1000.0}
# cheap byte prefilter for the base-point pass: same alternatives as step.BASEPOINT
BP_BYTES = re.compile(rb"base ?point|nullpunkt|rotasjonspunkt|origo|koordin", re.I)

# ---- own-geometry extent for basepoint/site candidates, without a full geometry kernel.
# BFS over each candidate's small representation tree (IfcProductDefinitionShape ->
# IfcShapeRepresentation -> Items -> ...), one extra streaming pass per BFS level. Only
# curve/point-bearing and straight-edged polygon (explicit Brep face/shell/loop) item
# types below are expanded -- all of them resolve to plain cartesian points with no
# curvature or extra transform. Swept solids (extruded/revolved/swept-disk), mapped
# items and boolean results are intentionally NOT in this list -- their branch is left
# unexpanded, not guessed at, and a candidate with none of its geometry resolvable
# reports null, never a zero-size box at the origin.
EXTENT_MAX_DEPTH = 16


def resolve_extents(path: Path, targets: dict) -> dict:
    """targets: key -> {"rep": IfcProductDefinitionShape id or None, "origin": (x, y, z, theta_rad)}
    in file units (same chain absolute() already composes). Returns key -> (lo, hi), each a
    [x, y, z] list in file units (caller applies the mm factor), or (None, None)."""
    owners = defaultdict(set)
    for key, t in targets.items():
        if t["rep"] is not None:
            owners[t["rep"]].add(key)
    local_points = defaultdict(list)  # key -> [(x, y, z), ...] in the object's own local frame
    frontier = set(owners)
    seen = set()

    for _ in range(EXTENT_MAX_DEPTH):
        batch = frontier - seen
        if not batch:
            break
        fetched = {}
        with open(path, "rb") as f:
            for raw in f:
                if not raw.startswith(b"#"):
                    continue
                m = ENT.match(raw)
                if not m:
                    continue
                eid = int(m.group(1))
                if eid in batch:
                    fetched[eid] = (m.group(2).decode(), m.group(3))
        seen |= batch
        next_frontier = set()

        def add_child(who, r):
            if r is not None:
                owners[r] |= who
                if r not in seen:
                    next_frontier.add(r)

        for eid, (typ, argbytes) in fetched.items():
            who = owners.get(eid)
            if not who:
                continue
            try:
                a = parse_args(argbytes.decode("utf-8", "replace"))
            except Exception:
                continue

            if typ == "IFCCARTESIANPOINT":
                v = a[0] if a else None
                if isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v):
                    p = (list(v) + [0.0, 0.0, 0.0])[:3]
                    for k in who:
                        local_points[k].append(tuple(float(x) for x in p))
            elif typ in ("IFCCARTESIANPOINTLIST3D", "IFCCARTESIANPOINTLIST2D"):
                v = a[0] if a else None
                if isinstance(v, list):
                    for row in v:
                        if isinstance(row, list) and row:
                            p = (list(row) + [0.0, 0.0, 0.0])[:3]
                            for k in who:
                                local_points[k].append(tuple(float(x) for x in p))
            elif typ in ("IFCPOLYLINE", "IFCPOLYLOOP"):
                lst = a[0] if a else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ == "IFCINDEXEDPOLYCURVE":
                add_child(who, ref(a[0]) if a else None)
            elif typ in ("IFCGEOMETRICSET", "IFCGEOMETRICCURVESET", "IFCCOMPOSITECURVE"):
                lst = a[0] if a else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ == "IFCCOMPOSITECURVESEGMENT":
                add_child(who, ref(a[2]) if len(a) > 2 else None)
            elif typ == "IFCPRODUCTDEFINITIONSHAPE":
                lst = a[2] if len(a) > 2 else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ in ("IFCSHAPEREPRESENTATION", "IFCTOPOLOGYREPRESENTATION"):
                lst = a[3] if len(a) > 3 else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ == "IFCFACETEDBREP":
                add_child(who, ref(a[0]) if a else None)
            elif typ in ("IFCCLOSEDSHELL", "IFCOPENSHELL"):
                lst = a[0] if a else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ in ("IFCFACEBASEDSURFACEMODEL", "IFCSHELLBASEDSURFACEMODEL"):
                lst = a[0] if a else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ == "IFCFACE":
                lst = a[0] if a else None
                if isinstance(lst, list):
                    for v in lst:
                        add_child(who, ref(v))
            elif typ in ("IFCFACEOUTERBOUND", "IFCFACEBOUND"):
                add_child(who, ref(a[0]) if a else None)
            # else: swept solid (extruded/revolved/swept-disk) / mapped item / boolean
            # result / curve primitive (trimmed curve, circle, line, b-spline) / anything
            # else not listed above -- left unexpanded on purpose.
        frontier = next_frontier

    out = {}
    for key, t in targets.items():
        pts = local_points.get(key)
        if not pts:
            out[key] = (None, None)
            continue
        ox, oy, oz, theta = t["origin"]
        c, s = math.cos(theta), math.sin(theta)
        abs_pts = [(ox + px * c - py * s, oy + px * s + py * c, oz + pz) for (px, py, pz) in pts]
        lo = [min(p[i] for p in abs_pts) for i in range(3)]
        hi = [max(p[i] for p in abs_pts) for i in range(3)]
        out[key] = (lo, hi)
    return out


def sha16(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def scan_basepoints(path: Path):
    """One extra streaming pass: rooted entities whose Name matches BASEPOINT."""
    out = []
    with open(path, "rb") as f:
        for raw in f:
            if not raw.startswith(b"#") or not BP_BYTES.search(raw):
                continue
            m = ENT.match(raw)
            if not m:
                continue
            typ = m.group(2).decode()
            if typ.startswith(NOT_ELEMENT_PREFIX) or not GUID_FIRST.match(m.group(3)):
                continue
            try:
                a = parse_args(m.group(3).decode("utf-8", "replace"))
            except Exception:
                continue
            nm = a[2] if len(a) > 2 else None
            if not isinstance(nm, str) or not BASEPOINT.search(nm):
                continue
            # IfcTypeObject subtypes have no ObjectPlacement (index 5 is ApplicableOccurrence)
            # or Representation in the IfcProduct sense either; leave both unset rather than
            # reporting a fabricated 0,0,0 or misreading an unrelated attribute.
            is_type = typ.endswith("TYPE")
            lp = None if is_type else (ref(a[5]) if len(a) > 5 else None)
            rp = None if is_type else (ref(a[6]) if len(a) > 6 else None)
            out.append(dict(id=int(m.group(1)), cls=typ, name=nm, placement=lp, rep=rp))
    return out


def analyse(path: Path, label: str, expect: str) -> dict:
    fname = path.name
    got = sha16(path)
    if got != expect:
        raise RuntimeError(f"sha256[:16] mismatch for {fname}: expected {expect}, got {got}")

    with open(path, "rb") as f:
        schema = "IFC4" if "IFC4" in f.read(4096).decode("utf-8", "replace") else "IFC2X3"

    counts, keep, elem_class, _props, _pn, n_lines, n_unparsed = pass1(path)
    P = {eid: parse_args(a) for eid, (t, a) in keep.items()}
    T = {eid: t for eid, (t, a) in keep.items()}

    def of(typ):
        return [eid for eid, t in T.items() if t == typ]

    # ---- length unit -> mm factor
    # A file typically declares several IFCSIUNIT LENGTHUNIT rows (the extra ones feed
    # IfcDerivedUnit). Only the one inside the project's IfcUnitAssignment is the file unit.
    assigned = set()
    for pid in of("IFCPROJECT"):
        ua = ref(P[pid][8]) if len(P[pid]) > 8 else None
        if ua in P:
            assigned |= {ref(v) for v in (P[ua][0] or []) if ref(v) is not None}
    if not assigned:  # no project/assignment found: fall back to every unit row
        for ua in of("IFCUNITASSIGNMENT"):
            assigned |= {ref(v) for v in (P[ua][0] or []) if ref(v) is not None}
    length_unit, mm, n_len_rows = "?", 1.0, 0
    for uid in of("IFCSIUNIT"):
        a = P[uid]
        if typed(a[1]) != "LENGTHUNIT":
            continue
        n_len_rows += 1
        if assigned and uid not in assigned:
            continue
        pre, nm2 = typed(a[2]), typed(a[3])
        length_unit = f"{pre + ' ' if pre else ''}{nm2}"
        mm = PREFIX_MM.get(pre, 1000.0) if nm2 == "METRE" else 1.0
    conv_units = []
    for uid in of("IFCCONVERSIONBASEDUNIT"):
        a = P[uid]
        if typed(a[1]) == "LENGTHUNIT" and (not assigned or uid in assigned):
            conv_units.append(str(a[2]))
    if conv_units:
        length_unit += f" (conversion-based: {', '.join(conv_units)})"
    if length_unit == "?":
        raise RuntimeError("no assigned LENGTHUNIT found")

    # ---- base-point objects (extra pass), then resolve placement chains
    bps = scan_basepoints(path)

    wanted = set()

    def collect(lp):
        while lp is not None and lp in P:
            axis = ref(P[lp][1])
            if axis in P:
                for v in P[axis]:
                    if ref(v) is not None:
                        wanted.add(ref(v))
            lp = ref(P[lp][0])

    spatial = of("IFCSITE") + of("IFCBUILDING") + of("IFCBUILDINGSTOREY")
    for sid in spatial:
        collect(ref(P[sid][5]))
    for bp in bps:
        collect(bp["placement"])

    G, _ = pass2(path, wanted, set())
    GP = {eid: parse_args(a)[0] for eid, (t, a) in G.items()}

    def coord(pid):
        v = GP.get(pid)
        return [float(x) for x in v] if isinstance(v, list) else None

    def absolute(lp):
        """Compose the placement chain root-first; returns (x, y, z, theta_deg) in file units."""
        levels = []
        while lp is not None and lp in P:
            axis = ref(P[lp][1])
            loc, ang = [0.0, 0.0, 0.0], 0.0
            if axis in P:
                c = coord(ref(P[axis][0]))
                if c:
                    loc = (c + [0.0, 0.0, 0.0])[:3]
                rd = coord(ref(P[axis][2])) if ref(P[axis][2]) is not None else None
                if rd:
                    ang = math.atan2(rd[1], rd[0])
            levels.append((loc, ang))
            lp = ref(P[lp][0])
        x = y = z = th = 0.0
        for (lx, ly, lz), ang in reversed(levels):
            x += lx * math.cos(th) - ly * math.sin(th)
            y += lx * math.sin(th) + ly * math.cos(th)
            z += lz
            th += ang
        return x, y, z, math.degrees(th)

    # ---- storeys
    contained = Counter()
    for rid in of("IFCRELCONTAINEDINSPATIALSTRUCTURE"):
        a = P[rid]
        st = ref(a[5])
        contained[st] += len(a[4] or [])

    storeys = []
    for sid in of("IFCBUILDINGSTOREY"):
        a = P[sid]
        elev = typed(a[9]) if len(a) > 9 else None
        _x, _y, z, _th = absolute(ref(a[5]))
        storeys.append(dict(
            name=a[2],
            elevation_mm=round(float(elev) * mm, 3) if isinstance(elev, (int, float)) else None,
            abs_z_mm=round(z * mm, 3),
            n_contained=contained.get(sid, 0),
        ))
    storeys.sort(key=lambda r: (r["elevation_mm"] if r["elevation_mm"] is not None else -1e18))

    # ---- site
    def compound_deg(v):
        if not isinstance(v, list) or not v:
            return None
        p = [float(x) for x in v] + [0.0, 0.0, 0.0, 0.0]
        s = -1.0 if p[0] < 0 else 1.0
        return s * (abs(p[0]) + abs(p[1]) / 60 + abs(p[2]) / 3600 + abs(p[3]) / 3.6e9)

    site = None
    site_id = site_origin = site_rep = None
    for sid in of("IFCSITE"):
        a = P[sid]
        x, y, z, th = absolute(ref(a[5]))
        site = dict(
            name=a[2],
            abs_xyz_mm=[round(x * mm, 3), round(y * mm, 3), round(z * mm, 3)],
            rotation_deg=round(th, 6),
            ref_lat=compound_deg(a[9] if len(a) > 9 else None),
            ref_lon=compound_deg(a[10] if len(a) > 10 else None),
            ref_lat_raw=a[9] if len(a) > 9 else None,
            ref_lon_raw=a[10] if len(a) > 10 else None,
            ref_elevation=typed(a[11]) if len(a) > 11 else None,
        )
        site_id = sid
        site_origin = (x, y, z, math.radians(th))
        site_rep = ref(a[6]) if len(a) > 6 else None
        break

    # ---- georeferencing
    mapconv = None
    for m2 in of("IFCMAPCONVERSION"):
        a = P[m2]
        mapconv = dict(eastings=typed(a[2]), northings=typed(a[3]), orthogonal_height=typed(a[4]),
                       x_axis_abscissa=typed(a[5]), x_axis_ordinate=typed(a[6]), scale=typed(a[7]))
        break
    crs = None
    for c in of("IFCPROJECTEDCRS"):
        a = P[c]
        crs = dict(name=a[0], description=a[1], geodetic_datum=a[2], vertical_datum=a[3],
                   map_projection=a[4], map_zone=a[5], map_unit=str(typed(a[6])) if len(a) > 6 and a[6] is not None else None)
        break

    # ---- own-geometry extent for basepoint candidates + the site. BEP Sec3.3 route where the
    # coordination marker is carried as the site's own body rather than a separately named
    # object (ARK): the renderer only accepts an IfcSite candidate when it has lo_mm/hi_mm.
    bp_origin = {}
    extent_targets = {}
    for i, bp in enumerate(bps):
        if bp["placement"] is None:
            continue
        x, y, z, th = absolute(bp["placement"])
        bp_origin[i] = (x, y, z, math.radians(th))
        extent_targets[("bp", i)] = {"rep": bp["rep"], "origin": bp_origin[i]}
    site_already_bp = site_id is not None and any(bp["id"] == site_id for bp in bps)
    if site_id is not None and not site_already_bp:
        extent_targets[("site",)] = {"rep": site_rep, "origin": site_origin}
    extents = resolve_extents(path, extent_targets) if extent_targets else {}

    def mm3(v):
        return [round(x * mm, 3) for x in v] if v else None

    bp_out = []
    for i, bp in enumerate(bps):
        if bp["placement"] is None:
            bp_out.append({"class": bp["cls"], "name": bp["name"], "xyz_mm": None, "lo_mm": None, "hi_mm": None})
            continue
        x, y, z, _th = bp_origin[i]
        lo, hi = extents.get(("bp", i), (None, None))
        bp_out.append({"class": bp["cls"], "name": bp["name"],
                       "xyz_mm": [round(x * mm, 3), round(y * mm, 3), round(z * mm, 3)],
                       "lo_mm": mm3(lo), "hi_mm": mm3(hi)})
    if site_id is not None and not site_already_bp:
        lo, hi = extents.get(("site",), (None, None))
        bp_out.append({"class": "IFCSITE", "name": site["name"] if isinstance(site["name"], str) else "",
                       "xyz_mm": site["abs_xyz_mm"], "lo_mm": mm3(lo), "hi_mm": mm3(hi)})
    bp_out.sort(key=lambda r: (r["class"], r["name"]))

    return dict(
        label=label, file=fname, sha16=got, schema=schema, length_unit=length_unit,
        storeys=storeys, site=site, mapconversion=mapconv, crs=crs, basepoint_objects=bp_out,
        _n_lines=n_lines, _n_unparsed=n_unparsed, _n_entities=sum(counts.values()),
        _n_sites=len(of("IFCSITE")), _n_buildings=len(of("IFCBUILDING")),
        _n_lengthunit_rows=n_len_rows, _mm_per_unit=mm,
    )


def kjør(prosjekt: Path, runde_sti: Path, cache: Path, ifc: Path | None = None) -> int:
    stier.finnes(runde_sti)
    runde = json.loads(runde_sti.read_text(encoding="utf-8"))
    rot = prosjekt.resolve().parent
    dato = runde["dato"]
    out = cache / "struktur" / dato
    out.mkdir(parents=True, exist_ok=True)
    print(f"runde {dato} ({runde_sti})\nkilde {ifc or (rot / runde['kilde']).resolve()}", flush=True)
    results, failures = [], []
    for m in runde["modeller"]:
        label, fname, expect = m["label"], m["fil"], m["sha16"]
        print(f"--- {label}  {fname}", flush=True)
        try:
            r = analyse(stier.ifc_sti(m, runde["kilde"], rot, ifc), label, expect)
        except Exception as e:
            print(f"FAILED {label}: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            failures.append(dict(label=label, file=fname, error=f"{type(e).__name__}: {e}"))
            continue
        results.append(r)
        print(f"    {r['schema']} unit={r['length_unit']} storeys={len(r['storeys'])} "
              f"sites={r['_n_sites']} buildings={r['_n_buildings']} basepoints={len(r['basepoint_objects'])} "
              f"mapconv={bool(r['mapconversion'])} crs={bool(r['crs'])} unparsed={r['_n_unparsed']}/{r['_n_lines']}")
    dest = out / f"struktur_{dato}.json"
    dest.write_text(json.dumps(results, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\nwrote {dest}  ({len(results)} ok, {len(failures)} failed)")
    for f in failures:
        print("  FAILURE:", f)
    return 1 if failures else 0


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    stier.argumenter(ap, ut=False)
    ap.add_argument("--ifc", type=Path, metavar="DIR", help="IFC folder of the round (replaces the round's `kilde`)")
    a = ap.parse_args()
    return kjør(a.prosjekt, a.runde, a.cache, a.ifc)


if __name__ == "__main__":
    raise SystemExit(main())
