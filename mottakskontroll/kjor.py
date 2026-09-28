"""The mottakskontroll of one round, measured and rendered end to end.

    python mottakskontroll/kjor.py --ifc DIR --prosjekt krav.yaml --runde runde.json --ut DIR
        [--cache DIR] [--ny] [--kun-rendering] [--kun-standard]

Steps, each also runnable on its own with the same arguments:

    bep_egenskapskontroll.py   counted set, GUIDs, Type 1:1          -> <cache>/bep/<dato>/
    struktur.py                storeys, site, georeferencing          -> <cache>/struktur/<dato>/
    bygg_mottakskontroll.py    the blocks (blokkdata.py), then the
                               model PDFs, project PDF and workbook   -> <ut>/
    bygg_avvik.py              one deviation workbook per group       -> <ut>/

--kun-rendering skips the two measuring steps and the block measurement, and renders from the
caches as they lie. --cache defaults to <ut>/cache.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bep_egenskapskontroll  # noqa: E402
import bygg_avvik  # noqa: E402
import bygg_mottakskontroll  # noqa: E402
import stier  # noqa: E402
import struktur  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Measure and render the mottakskontroll of one round.")
    ap.add_argument("--ifc", type=Path, metavar="DIR",
                    help="IFC folder of the round (default: the round's `kilde`, relative to the project config)")
    ap.add_argument("--prosjekt", required=True, type=Path, metavar="KRAV.yaml", help="project config")
    ap.add_argument("--runde", required=True, type=Path, metavar="RUNDE.json", help="round config")
    ap.add_argument("--ut", required=True, type=Path, metavar="DIR", help="output directory")
    ap.add_argument("--cache", type=Path, metavar="DIR", help="measurement cache (default: <ut>/cache)")
    ap.add_argument("--css", type=Path, default=bygg_mottakskontroll.CSS_STD, help="report treatment")
    ap.add_argument("--ny", action="store_true", help="measure again, ignoring the caches")
    ap.add_argument("--kun-rendering", action="store_true",
                    help="no IFC measurement: render from the caches as they lie")
    ap.add_argument("--kun-standard", action="store_true", help="the standard layer only")
    a = ap.parse_args()
    cache = a.cache or a.ut / "cache"
    stier.finnes(a.prosjekt, a.runde)
    if not a.kun_rendering:
        if bep_egenskapskontroll.kjør(a.prosjekt, a.runde, cache, a.ut, a.ifc, ny=a.ny):
            return 1
        if struktur.kjør(a.prosjekt, a.runde, cache, a.ifc):
            return 1
    rc = bygg_mottakskontroll.bygg(a.prosjekt, a.runde, cache, a.ut, a.ifc, a.css, a.ny,
                                   a.kun_rendering, a.kun_standard)
    if rc:
        return rc
    return bygg_avvik.bygg(a.prosjekt, a.runde, cache, a.ut, a.kun_standard)


if __name__ == "__main__":
    raise SystemExit(main())
