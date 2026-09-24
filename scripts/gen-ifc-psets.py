"""Generate src/engine/ifc-pset-names.ts: the property and quantity set names
the IFC standard itself defines, per schema.

The source is buildingSMART's own property set templates as ifcopenshell
bundles them (`ifcopenshell/util/schema/Pset_IFC2X3.ifc`, `Pset_IFC4_ADD2.ifc`,
`Pset_IFC4X3.ifc`): every `IfcPropertySetTemplate` Name, which covers both
`Pset_*` and `Qto_*`. The pset inventory (src/engine/pset-inventory.ts) reads
these to tell an IFC-defined set from a custom one by DEFINITION, not by the
`Pset_` prefix, since an exporter can name anything `Pset_`.

    PYTHONUTF8=1 python scripts/gen-ifc-psets.py

Fails loudly rather than writing a partial list.
"""

import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.pset as ups

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "engine" / "ifc-pset-names.ts"
TEMPLATES = {"IFC2X3": "Pset_IFC2X3.ifc", "IFC4": "Pset_IFC4_ADD2.ifc", "IFC4X3": "Pset_IFC4X3.ifc"}


def main() -> None:
    schema_dir = Path(ups.__file__).resolve().parent / "schema"
    sets: dict[str, list[str]] = {}
    sources: dict[str, dict] = {}
    for family, filename in TEMPLATES.items():
        path = schema_dir / filename
        if not path.is_file():
            sys.exit(f"missing template {path}")
        f = ifcopenshell.open(str(path))
        names = sorted({t.Name for t in f.by_type("IfcPropertySetTemplate") if t.Name})
        if not names:
            sys.exit(f"no IfcPropertySetTemplate in {path}")
        sets[family] = names
        sources[family] = {
            "file": filename,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "count": len(names),
        }
    meta = {
        "source": "ifcopenshell " + ifcopenshell.version + " util/schema property set templates",
        "generated": date.today().isoformat(),
        "templates": sources,
    }
    lines = [
        "/* GENERATED FILE — do not edit by hand.",
        f" * Source: scripts/gen-ifc-psets.py, {meta['generated']}.",
        f" * {meta['source']}.",
        " */",
        "",
        "export type PsetTemplateFamily = " + " | ".join(f'"{k}"' for k in TEMPLATES) + ";",
        "",
        "export const IFC_PSET_META = " + json.dumps(meta, ensure_ascii=False) + " as const;",
        "",
        "/** Every IfcPropertySetTemplate Name (Pset_* and Qto_*) per schema template. */",
        "export const IFC_PSET_NAMES: Record<PsetTemplateFamily, readonly string[]> = {",
    ]
    for family, names in sets.items():
        lines.append(f"  {family}: " + json.dumps(names, ensure_ascii=False) + ",")
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({', '.join(f'{k} {len(v)}' for k, v in sets.items())})")


if __name__ == "__main__":
    main()
