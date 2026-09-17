"""Generate src/ids/ifc-classes.ts from the IFC schemas.

The IDS entity facet matches an EXACT class name with no subtype expansion, so a
rule that names an abstract class matches nothing and the specification then
reports as passing over zero entities. Every list here is therefore derived from
the schema itself (ifcopenshell's EXPRESS declarations) rather than typed by
hand: `entities` holds only instantiable classes, and each conceptual group is
the explicit enumeration of the concrete classes below a supertype.

    python scripts/gen-ifc-classes.py
"""

import sys
from datetime import date

import ifcopenshell
from ifcopenshell import ifcopenshell_wrapper as w

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCHEMAS = ["IFC2X3", "IFC4", "IFC4X3_ADD2"]

# group key -> (first supertype that exists in the schema, supertypes to subtract)
GROUPS = {
    "product": (["IfcProduct"], []),
    "element": (["IfcElement"], []),
    "physicalElement": (["IfcElement"], ["IfcFeatureElement", "IfcVirtualElement"]),
    "builtElement": (["IfcBuiltElement", "IfcBuildingElement"], []),
    "distributionElement": (["IfcDistributionElement"], []),
    "spatialElement": (["IfcSpatialElement", "IfcSpatialStructureElement"], []),
    "featureElement": (["IfcFeatureElement"], []),
    "elementType": (["IfcElementType"], []),
    "typeProduct": (["IfcTypeProduct"], []),
    "group": (["IfcGroup"], []),
}

# Attribute picker universe: the abstract roots whose attributes every selectable
# class carries. Kept separate from attributesByClass so the UI has a sane
# default before a class is picked.
COMMON_ROOTS = [
    "IfcRoot",
    "IfcObjectDefinition",
    "IfcObject",
    "IfcProduct",
    "IfcElement",
    "IfcSpatialElement",
    "IfcSpatialStructureElement",
    "IfcTypeObject",
    "IfcTypeProduct",
]


def decl(schema, name):
    try:
        return schema.declaration_by_name(name)
    except Exception:
        return None


def concrete_under(schema, root_names, exclude_names):
    root = None
    for n in root_names:
        root = decl(schema, n)
        if root is not None:
            break
    if root is None:
        return []
    excluded = set()
    for n in exclude_names:
        d = decl(schema, n)
        if d is not None:
            excluded |= {x.name() for x in subtree(d)}
    return sorted(
        x.name().upper()
        for x in subtree(root)
        if not x.is_abstract() and x.name() not in excluded
    )


def subtree(d):
    out = [d]
    for sub in d.subtypes():
        out.extend(subtree(sub))
    return out


def attributes(d):
    return [a.name() for a in d.all_attributes()]


def ts_list(items, indent="    "):
    return "\n".join(f'{indent}"{i}",' for i in items)


def main():
    classes_parts = []
    for schema_name in SCHEMAS:
        s = w.schema_by_name(schema_name)
        root = decl(s, "IfcObjectDefinition")
        entities = sorted(
            x.name().upper() for x in subtree(root) if not x.is_abstract()
        )

        groups = {}
        for key, (roots, excl) in GROUPS.items():
            got = concrete_under(s, roots, excl)
            if got:
                groups[key] = got

        common = []
        for r in COMMON_ROOTS:
            d = decl(s, r)
            if d is None:
                continue
            for a in attributes(d):
                if a not in common:
                    common.append(a)

        defined_types = sorted(
            x.name().upper()
            for x in s.declarations()
            if type(x).__name__ == "type_declaration"
        )

        g = "\n".join(
            f"    {k}: [\n{ts_list(v, '      ')}\n    ]," for k, v in groups.items()
        )
        classes_parts.append(
            f'  {schema_name}: {{\n'
            f'    entities: [\n{ts_list(entities, "      ")}\n    ],\n'
            f'    dataTypes: [\n{ts_list(defined_types, "      ")}\n    ],\n'
            f'    commonAttributes: [\n{ts_list(common, "      ")}\n    ],\n'
            f'    groups: {{\n{g}\n    }},\n'
            f'  }},'
        )
    header = (
        "/* GENERATED FILE — do not edit by hand.\n"
        " * Source: scripts/gen-ifc-classes.py, ifcopenshell "
        f"{ifcopenshell.version}, {date.today().isoformat()}.\n"
    )

    with open("src/ids/ifc-classes.ts", "w", encoding="utf-8") as f:
        f.write(
            header
            + " *\n"
            " * `entities` lists instantiable classes only. `groups` expand a conceptual\n"
            " * selection into the explicit enumeration of concrete classes the IDS entity\n"
            " * facet needs, because that facet does not follow subtypes.\n"
            " */\n\n"
            "export interface SchemaClasses {\n"
            "  readonly entities: readonly string[];\n"
            "  readonly dataTypes: readonly string[];\n"
            "  readonly commonAttributes: readonly string[];\n"
            "  readonly groups: Readonly<Record<string, readonly string[]>>;\n"
            "}\n\n"
            "export const IFC_CLASSES = {\n"
            + "\n".join(classes_parts)
            + "\n} as const satisfies Record<string, SchemaClasses>;\n\n"
            "export type IfcSchemaName = keyof typeof IFC_CLASSES;\n"
            "export type ClassGroupKey = keyof (typeof IFC_CLASSES)[\"IFC4\"][\"groups\"];\n"
        )

    print("wrote src/ids/ifc-classes.ts")


main()
