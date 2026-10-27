# -*- coding: utf-8 -*-
"""
gen_kodetabell_ns3451.py — writes kodetabell_ns3451.yaml (beside this script) from the NS 3451:2022 PDF.

Reads tables 2-7 (bygningsdeler, levels 1-4) straight from the standard's table grid. Table 8
(systemkoder) is a separate table and is not part of this file.

Why not the PDF's text layer: the PDF (Word export, Cambria) draws å/ô/é as a base glyph plus a
combining glyph, and its ToUnicode CMap for the Identity-H font is wrong (glyph `a` is mapped to
«å», the combining glyphs to nothing). Every text extractor that trusts ToUnicode produces
«overflåte», «(cid:465)», «vanntåk ke». So this script decodes each drawn GLYPH ID through the
system's own Cambria cmap (same font build: 7614 glyphs), maps combining glyphs by their name
(uni030A, uni0302, ...), and NFC-normalises. Before use it checks that every glyph outline the
table uses is identical in the embedded subset and the system font, so the GID mapping is proven,
not assumed.

Row and level come from the drawn grid: the four narrow code columns are levels 1-4, then Navn,
then Veiledning. Rows marked «(Reservert)» are left out (5.1: «skal ikke benyttes»). Anything the
script cannot decode, or a row it cannot place, stops the run.

Run:  PYTHONUTF8=1 python gen_kodetabell_ns3451.py
"""
import hashlib
import io
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import fitz  # PyMuPDF
from fontTools.ttLib import TTCollection, TTFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PDF = Path(r"C:\workspace\resources\standards\ns3451\ns-3451_2022_no_001.pdf")
OUT = Path(__file__).with_name("kodetabell_ns3451.yaml")
SYSFONT = {  # style -> system Cambria file (Windows)
    "regular": ("C:/Windows/Fonts/cambria.ttc", 0),
    "bold": ("C:/Windows/Fonts/cambriab.ttf", None),
    "italic": ("C:/Windows/Fonts/cambriai.ttf", None),
    "bolditalic": ("C:/Windows/Fonts/cambriaz.ttf", None),
}
FIRST_TABLE, LAST_TABLE = 2, 7


def die(msg):
    sys.exit(f"STOP: {msg}")


# ------------------------------------------------------------------ glyph decoding
def load_sys(style):
    path, idx = SYSFONT[style]
    return TTCollection(path).fonts[idx] if idx is not None else TTFont(path)


def gid_table(tt):
    """gid -> unicode string, from the font's cmap (lowest code point wins) or its uniXXXX name."""
    order = tt.getGlyphOrder()
    name2gid = {n: i for i, n in enumerate(order)}
    out = {}
    for cp, name in sorted(tt.getBestCmap().items()):
        out.setdefault(name2gid[name], chr(cp))
    for i, n in enumerate(order):
        m = re.fullmatch(r"uni([0-9A-F]{4})", n)
        if i not in out and m:
            out[i] = chr(int(m.group(1), 16))
    # Contextual forms without a code point (e.g. an `f` variant drawn before `l`): the font's own
    # single substitutions say which character they stand for. Used only when unambiguous.
    src = {}
    if "GSUB" in tt:
        for lk in tt["GSUB"].table.LookupList.Lookup:
            for st in lk.SubTable:
                st = st.ExtSubTable if lk.LookupType == 7 else st
                if getattr(st, "LookupType", lk.LookupType) != 1:
                    continue  # single substitutions only
                for a, b in (getattr(st, "mapping", None) or {}).items():
                    if name2gid[a] in out:
                        src.setdefault(name2gid[b], set()).add(out[name2gid[a]])
    for gid, chars in src.items():
        if gid not in out and len(chars) == 1:
            out[gid] = next(iter(chars))
    return out


def style_of(fontname, flags):
    n = fontname.lower()
    b = "bold" in n or bool(flags & 16)
    i = "italic" in n or bool(flags & 2)
    return "bolditalic" if b and i else "bold" if b else "italic" if i else "regular"


def verify_embedded(doc, sysfonts, used):
    """Every (style, gid) used must have the same outline in an embedded Cambria of that style as in
    the system font. Returns the number of glyphs checked."""
    emb = {}
    for x in range(1, doc.xref_length()):
        try:
            obj = doc.xref_object(x)
        except Exception:
            continue
        m = re.search(r"/FontName /(?:\w+\+)?(Cambria[\w-]*)", obj)
        f2 = re.search(r"/FontFile2 (\d+) 0 R", obj)
        if m and f2:
            st = {"Cambria": "regular", "Cambria-Bold": "bold", "Cambria-Italic": "italic",
                  "Cambria-BoldItalic": "bolditalic"}.get(m.group(1))
            if st:
                emb.setdefault(st, []).append(TTFont(io.BytesIO(doc.xref_stream(int(f2.group(1))))))
    checked = 0
    for st, gid in sorted(used):
        ref = sysfonts[st]
        rg = ref["glyf"][ref.getGlyphOrder()[gid]]
        ok = False
        for e in emb.get(st, []):
            if e["maxp"].numGlyphs != ref["maxp"].numGlyphs:
                continue
            eg = e["glyf"][e.getGlyphOrder()[gid]]
            if eg.numberOfContours == 0 and rg.numberOfContours != 0:
                continue  # not in this subset
            ce, ee, fe = eg.getCoordinates(e["glyf"])
            cr, er, fr = rg.getCoordinates(ref["glyf"])
            if list(ce) == list(cr) and list(ee) == list(er) and bytes(fe) == bytes(fr):
                ok = True
                break
        if not ok:
            die(f"glyph {gid} ({st}) differs between the PDF subset and the system Cambria")
        checked += 1
    return checked


# ------------------------------------------------------------------ grid + cells
def grid(page):
    """Column rules (x) and row rules (y) of the table on this page. Row rules are clipped to the
    vertical extent of the column rules, so ruling below the table is not read as rows."""
    xs, ys, vy = set(), set(), []
    for dr in page.get_drawings():
        for it in dr["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.x - b.x) < 0.5:
                    xs.add(round(a.x, 1))
                    vy += [a.y, b.y]
                elif abs(a.y - b.y) < 0.5:
                    ys.add(round(a.y, 1))
            elif it[0] == "re":
                r = it[1]
                if r.width < 2:
                    xs.add(round(r.x0, 1))
                    vy += [r.y0, r.y1]
                elif r.height < 2:
                    ys.add(round(r.y0, 1))
    if vy:
        ys = {y for y in ys if min(vy) - 1 <= y <= max(vy) + 1}
        ys |= {round(min(vy), 1), round(max(vy), 1)}  # a row running on to the next page has no rule

    def merge(v):
        out = []
        for x in sorted(v):
            if not out or x - out[-1] > 1.0:
                out.append(x)
        return out
    return merge(xs), merge(ys)


def page_glyphs(page, gidmaps):
    """[(x0, x1, y_baseline, x_origin, char, is_mark, (style, gid))], decoded by glyph id."""
    out = []
    for s in page.get_texttrace():
        st = style_of(s["font"], s["flags"])
        gm = gidmaps[st]
        for c in s["chars"]:
            uni, gid, origin, bbox = c[0], c[1], c[2], c[3]
            ch = gm.get(gid)
            if ch is None:
                ch = f"\uFFFD[gid {gid}]"
            out.append((bbox[0], bbox[2], origin[1], origin[0], ch, unicodedata.combining(ch[0]) > 0,
                        (st, gid)))
    return out


def cell_text(glyphs):
    """Lines by baseline, joined by one space. Within a line, a space glyph or a gap wider than
    1 pt is a word break."""
    if not glyphs:
        return "", []
    lines = []
    for g in sorted(glyphs, key=lambda g: (round(g[2], 0), g[3])):
        if lines and abs(lines[-1][0] - g[2]) < 2:
            lines[-1][1].append(g)
        else:
            lines.append([g[2], [g]])
    texts = []
    for _, gs in lines:
        t, last_x1 = "", None
        for x0, x1, _, _, ch, mark, _ in gs:
            if mark:
                t += ch
                continue
            if last_x1 is not None and x0 - last_x1 > 1.0 and not t.endswith(" ") and ch != " ":
                t += " "
            t += ch
            last_x1 = x1
        texts.append(unicodedata.normalize("NFC", re.sub(r"\s+", " ", t).strip()))
    texts = [t for t in texts if t]
    return " ".join(texts), texts


# ------------------------------------------------------------------ main
def main():
    doc = fitz.open(PDF)
    sysfonts = {k: load_sys(k) for k in SYSFONT}
    gidmaps = {k: gid_table(v) for k, v in sysfonts.items()}
    used = set()

    rows, reserved, hyphen_breaks = [], [], []
    table = None
    for pno in range(doc.page_count):
        page = doc[pno]
        head = page.get_text("text")
        m = re.search(r"^Tabell (\d+) — ", head, re.M)
        if m:
            table = int(m.group(1))
        if table is None or table < FIRST_TABLE:
            continue
        if table > LAST_TABLE:
            break
        xs, ys = grid(page)
        if not xs:
            continue  # figure page inside the table section
        if len(xs) != 7:
            die(f"page {pno + 1}: expected 7 vertical rules, found {len(xs)}: {xs}")
        glyphs = page_glyphs(page, gidmaps)
        for y0, y1 in zip(ys, ys[1:]):
            cells = [[] for _ in range(6)]
            for g in glyphs:
                xc = (g[0] + g[1]) / 2 if not g[5] else g[0]
                if not (y0 < g[2] < y1):
                    continue
                for i in range(6):
                    if xs[i] < xc < xs[i + 1]:
                        cells[i].append(g)
                        break
            code_cols = [cell_text(c)[0] for c in cells[:4]]
            navn, navn_lines = cell_text(cells[4])
            veil = cell_text(cells[5])[0]
            filled = [(i, c) for i, c in enumerate(code_cols) if c]
            if navn == "Navn" or (code_cols == ["", "", "", ""] and navn == ""):
                continue  # header row, or the guidance of the previous page's last row running on
            if code_cols == ["", "", "", ""]:
                die(f"page {pno + 1}: name without a code (row split across pages?): {navn!r}")
            if len(filled) != 1:
                die(f"page {pno + 1}: row without exactly one code: {code_cols} {navn!r}")
            level, kode = filled[0][0] + 1, filled[0][1]
            if not re.fullmatch(r"\d{%d}" % level, kode):
                die(f"page {pno + 1}: code {kode!r} in level-{level} column")
            if "\uFFFD" in navn:
                die(f"page {pno + 1}: undecodable glyph in name of {kode}: {navn!r}")
            for a, b in zip(navn_lines, navn_lines[1:]):
                # «røyk-» / «og brannventilasjon»: a suspended compound hyphen, joined with a space
                # (the default). Any other line ending in a hyphen could be a word break: stop.
                if a.endswith("-") and not re.match(r"(og|eller) ", b):
                    hyphen_breaks.append((kode, a, b))
            if navn == "(Reservert)":
                reserved.append(kode)
                continue
            used.update(g[6] for c in cells[:5] for g in c)
            rows.append({"kode": kode, "navn": navn, "nivå": level, "tabell": table, "side": pno + 1})

    # hierarchy + uniqueness
    seen = {}
    for r in rows:
        if r["kode"] in seen:
            die(f"duplicate code {r['kode']}")
        seen[r["kode"]] = r
        if r["nivå"] > 1 and r["kode"][:-1] not in seen:
            die(f"{r['kode']} has no parent {r['kode'][:-1]} before it")
        if r["kode"][0] != str(r["tabell"]):
            die(f"{r['kode']} found in table {r['tabell']}")
    if hyphen_breaks:
        die("name line ending in a hyphen, join is ambiguous: " + repr(hyphen_breaks))

    n_glyphs = verify_embedded(doc, sysfonts, used)
    sha = hashlib.sha256(PDF.read_bytes()).hexdigest()
    per_level = {lv: sum(1 for r in rows if r["nivå"] == lv) for lv in (1, 2, 3, 4)}

    head = [
        "# kodetabell_ns3451.yaml",
        "#",
        "# NS 3451:2022 building element table (tables 2-7), code and name, levels 1-4. Ships with the",
        "# tool (standard layer); the Systemkoder list looks names and validity up here.",
        "#",
        f"# Generated {date.today().isoformat()} by 02_Arbeid/gen_kodetabell_ns3451.py from",
        f"#   {PDF.as_posix()}",
        f"#   sha256 {sha}",
        "# read from the table grid by glyph id (the PDF's own text layer is damaged, see the script).",
        f"# {len(rows)} codes: level 1 {per_level[1]}, level 2 {per_level[2]}, level 3 {per_level[3]},"
        f" level 4 {per_level[4]}. Names verbatim as printed.",
        f"# Left out, marked (Reservert) in the standard: {', '.join(reserved)}.",
        "# Not in this file: table 8 (systemkoder, 4-digit), and letter suffixes (5.1: «bokstav som",
        "# siste tegn», e.g. 661A), which are valid use of a listed code, not codes of their own.",
        "# Do not edit by hand; regenerate from the source.",
    ]
    body = []
    for r in rows:
        body.append(f'- kode: "{r["kode"]}"')
        body.append(f'  navn: "{r["navn"]}"')
    OUT.write_text("\n".join(head + body) + "\n", encoding="utf-8")
    print(f"{len(rows)} codes -> {OUT}  (levels {per_level}, reserved {len(reserved)}, "
          f"{n_glyphs} glyph outlines verified)")


if __name__ == "__main__":
    main()
