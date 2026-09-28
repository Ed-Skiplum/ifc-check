"""Streaming STEP reader for struktur.py, without ifcopenshell.

Moved as-is from the HI90 project's ifc_struktur.py (pass1/pass2/parse_args/ref/typed and the
line patterns) and plassering.py (the base-point Name pattern). Those two were stand-alone
scripts with the project's file list and ACC folder at module level; only the reader moved.
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

KEEP = {
    "IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE",
    "IFCLOCALPLACEMENT", "IFCAXIS2PLACEMENT3D",
    "IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCUNITASSIGNMENT",
    "IFCGEOMETRICREPRESENTATIONCONTEXT", "IFCMAPCONVERSION", "IFCPROJECTEDCRS",
    "IFCGRID", "IFCGRIDAXIS",
    "IFCPROPERTYSET", "IFCELEMENTQUANTITY",
    "IFCCLASSIFICATION", "IFCCLASSIFICATIONREFERENCE", "IFCRELASSOCIATESCLASSIFICATION",
    "IFCRELDEFINESBYTYPE", "IFCRELCONTAINEDINSPATIALSTRUCTURE", "IFCRELAGGREGATES",
    "IFCRELASSOCIATESMATERIAL", "IFCMATERIAL", "IFCMATERIALLAYERSET", "IFCMATERIALLAYER",
}
PROP_TYPES = {"IFCPROPERTYSINGLEVALUE", "IFCPROPERTYENUMERATEDVALUE", "IFCPROPERTYLISTVALUE"}
INTERESTING = re.compile(
    r"MMI|3451|3457|TFM|Status|Renovation|Kopi|Fase|Phase|LCA|Etasje|Reference|Material|"
    r"Type|Prosjekt|Rom|Room|System|Classification|Klass|Bygningsdel|Komponent|Load|Bearing|External",
    re.I,
)
SPATIAL = {"IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE"}
NOT_ELEMENT_PREFIX = ("IFCREL", "IFCPROPERTY", "IFCELEMENTQUANTITY", "IFCPRESENTATION", "IFCSTYLED")

ENT = re.compile(rb"^#(\d+)\s*=\s*(IFC[A-Z0-9]+)\s*\((.*)\)\s*;\s*$", re.S)
GUID_FIRST = re.compile(rb"^\s*'[0-9A-Za-z_$]{22}'")
LASTREF = re.compile(rb",\s*#(\d+)\s*$")

# ---------------------------------------------------------------- STEP arg parser
def decode_str(s: str) -> str:
    s = s.replace("''", "'")
    s = re.sub(r"\\X2\\([0-9A-F]+)\\X0\\", lambda m: "".join(chr(int(m.group(1)[i:i + 4], 16)) for i in range(0, len(m.group(1)), 4)), s)
    s = re.sub(r"\\X\\([0-9A-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    return s

def parse_args(s: str):
    """Parse a STEP attribute list into Python values.
    '#12' -> ('#', 12); '.ENUM.' -> ('.', 'ENUM'); typed IFCLABEL('x') -> ('T', 'IFCLABEL', [..]);
    strings -> str; numbers -> float/int; $ -> None; * -> '*'; lists -> list."""
    pos = 0
    n = len(s)

    def ws():
        nonlocal pos
        while pos < n and s[pos] in " \t\r\n":
            pos += 1

    def value():
        nonlocal pos
        ws()
        if pos >= n:
            return None
        c = s[pos]
        if c == "(":
            pos += 1
            out = []
            while True:
                ws()
                if pos < n and s[pos] == ")":
                    pos += 1
                    return out
                out.append(value())
                ws()
                if pos < n and s[pos] == ",":
                    pos += 1
        if c == "'":
            pos += 1
            start = pos
            while True:
                if s[pos] == "'":
                    if pos + 1 < n and s[pos + 1] == "'":
                        pos += 2
                        continue
                    break
                pos += 1
            val = s[start:pos]
            pos += 1
            return decode_str(val)
        if c == "#":
            m = re.match(r"#(\d+)", s[pos:])
            pos += m.end()
            return ("#", int(m.group(1)))
        if c == ".":
            m = re.match(r"\.([A-Z0-9_]+)\.", s[pos:])
            pos += m.end()
            return (".", m.group(1))
        if c == "$":
            pos += 1
            return None
        if c == "*":
            pos += 1
            return "*"
        m = re.match(r"[A-Z][A-Z0-9_]*", s[pos:])
        if m:
            pos += m.end()
            ws()
            inner = value()  # the (...) list
            return ("T", m.group(0), inner)
        m = re.match(r"[-+]?(\d+\.\d*|\.\d+|\d+)([Ee][-+]?\d+)?", s[pos:])
        if m:
            pos += m.end()
            t = m.group(0)
            return float(t) if ("." in t or "E" in t or "e" in t) else int(t)
        raise ValueError(f"bad token at {pos}: {s[pos:pos+30]!r}")

    out = []
    while True:
        ws()
        if pos >= n:
            return out
        out.append(value())
        ws()
        if pos < n and s[pos] == ",":
            pos += 1

def ref(v):
    return v[1] if isinstance(v, tuple) and v[0] == "#" else None

def typed(v):
    """IFCLABEL('x') -> 'x'; plain -> plain."""
    if isinstance(v, tuple) and v[0] == "T":
        inner = v[2]
        return inner[0] if inner else None
    if isinstance(v, tuple) and v[0] == ".":
        return v[1]
    return v

def fmt(v):
    v = typed(v)
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)

# ---------------------------------------------------------------- pass 1
def pass1(path: Path):
    counts = Counter()
    keep = {}                # id -> (type, argstr)
    elem_class = {}          # id -> type (rooted elements)
    props = {}               # id -> (type, argstr)   (interesting property lines only)
    prop_names = Counter()   # all property names (cheap regex)
    n_lines = 0
    n_unparsed = 0
    with open(path, "rb") as f:
        for raw in f:
            n_lines += 1
            if not raw.startswith(b"#"):
                continue
            m = ENT.match(raw)
            if not m:
                n_unparsed += 1
                continue
            eid, typ, args = int(m.group(1)), m.group(2).decode(), m.group(3)
            counts[typ] += 1
            if typ in KEEP:
                keep[eid] = (typ, args.decode("utf-8", "replace"))
            elif typ in PROP_TYPES:
                mm = re.match(rb"\s*'((?:[^']|'')*)'", args)
                if mm:
                    name = decode_str(mm.group(1).decode("utf-8", "replace"))
                    prop_names[name] += 1
                    if INTERESTING.search(name):
                        props[eid] = (typ, args.decode("utf-8", "replace"))
            elif (typ.endswith("TYPE") or typ.endswith("STYLE") or typ.startswith("IFCTYPE")) and GUID_FIRST.match(args):
                keep[eid] = (typ, args.decode("utf-8", "replace"))
            elif typ not in SPATIAL and not typ.startswith(NOT_ELEMENT_PREFIX) and GUID_FIRST.match(args):
                elem_class[eid] = typ
    return counts, keep, elem_class, props, prop_names, n_lines, n_unparsed

# ---------------------------------------------------------------- pass 2
def pass2(path: Path, wanted_ids: set, pset_ids: set):
    got = {}
    rels = []  # (related ids, pset id)
    with open(path, "rb") as f:
        for raw in f:
            if not raw.startswith(b"#"):
                continue
            m = ENT.match(raw)
            if not m:
                continue
            eid = int(m.group(1))
            if eid in wanted_ids:
                got[eid] = (m.group(2).decode(), m.group(3).decode("utf-8", "replace"))
            elif m.group(2) == b"IFCRELDEFINESBYPROPERTIES":
                lr = LASTREF.search(m.group(3))
                if lr and int(lr.group(1)) in pset_ids:
                    a = parse_args(m.group(3).decode("utf-8", "replace"))
                    rels.append(([ref(x) for x in a[4]], ref(a[5])))
    return got, rels

# ---------------------------------------------------------------- base-point objects
BASEPOINT = re.compile(r"base ?point|nullpunkt|rotasjonspunkt|origo|koordin", re.I)
