# ifc-check — notes for agents

A browser IFC model checker. Everything runs client-side on a WebAssembly build
of [ifcfast](https://github.com/EdvardGK/ifcfast); no backend, no upload.

This file is for an agent driving the tool or extending it. It documents what
exists and has been run, not what is planned. Where something is unverified it
says so.

## Layout

```
src/engine/      parse + run checks. Pure TS, no React, usable headlessly.
  types.ts       ProductRow / IfcGraph / IfcSummary / CheckResult / Finding
  fundamentals.ts  the nine structure-and-usability checks
  worker.ts      one Web Worker per file
src/ids/         ruleset model, IDS emitter, XSD validator   (in progress)
src/builder/     rule builder UI                              (in progress)
scripts/
  check-cli.ts   run the fundamentals headlessly
  build-wasm.sh  rebuild the vendored ifcfast wasm module
vendor/ifcfast-wasm/   the wasm engine + PROVENANCE.md
```

## Running the checks without a browser

Node 24 strips TypeScript natively, so there is no build step:

```bash
node scripts/check-cli.ts model.ifc [more.ifc ...]
```

Measured: a 10.5 MB IFC2X3 model with 851 products parses in ~250 ms.

## The check result model

Four states, and the distinction between two of them is the point:

| state | meaning |
|---|---|
| `pass` | the check ran, found nothing |
| `fail` | the check ran, found findings |
| `review` | a human has to judge; **not** a failure, does not count toward failures |
| `not_applicable` | the check could not run, or matched no elements |

**`not_applicable` is never folded into `pass`.** A check that matched nothing
has established nothing, and reporting that as green is how a rule that has
silently stopped matching goes unnoticed. This is not hypothetical: ifctester
marks an IDS specification with zero applicable entities as `status=true`, so an
`.ids` whose applicability matches no object in the file reports as passing.

Any new check must preserve this. If a precondition is not met, return
`not_applicable` with a `reason` — never a clean pass.

## The nine fundamentals

Project-agnostic: no property sets, no classification system, no delivery stage.

`parse-integrity` · `storey-containment` · `storey-in-building` ·
`element-named` · `element-typed` · `type-name-placeholder` ·
`single-instance-types` (review) · `element-material` · `guid-unique`

A file the parser reports zero products for **fails** `parse-integrity`. ifcfast
drops IFC classes its whitelist does not carry — `IfcGeographicElement` among
them ([ifcfast#178](https://github.com/EdvardGK/ifcfast/issues/178)) — so an
empty product list means "empty or unsupported", never "clean".

## IDS, and where it stops

Rules are authored on the buildingSMART IDS 1.0 standard, but IDS cannot
express everything a model needs checking for. These limits are verified
against the schema, not assumed:

- The `relations` enumeration is exactly `IFCRELAGGREGATES`,
  `IFCRELASSIGNSTOGROUP`, `IFCRELCONTAINEDINSPATIALSTRUCTURE`, `IFCRELNESTS`,
  `IFCRELVOIDSELEMENT IFCRELFILLSELEMENT`. **No `IFCRELDEFINESBYTYPE`** — so
  "every element is typed" cannot be an IDS rule.
- No uniqueness or cross-instance operator — so "GlobalId is unique" and
  "this type is used by one element" cannot be IDS rules.
- No geometry access — so "the mesh bottom sits in the storey that contains
  it" cannot be an IDS rule.
- `IfcMapConversion`, `IfcProjectedCRS` and `IfcUnitAssignment` are not
  reachable by any facet — so georeferencing and unit checks cannot be IDS
  rules.

An IDS facet asks about one object at a time. Every limit above is a
cross-object or non-object question.

### Authoring traps

Each of these was hit while building this tool:

1. **`minOccurs` / `maxOccurs` go on `<applicability>`, not `<specification>`.**
   The XSD rejects them on `specification`.
2. **The entity facet matches the exact class only — no subtypes.** Selecting
   an abstract class such as `IFCBUILDINGELEMENT` matches nothing, and the
   specification then reports as passing over zero entities. Enumerate concrete
   classes; derive the list from the schema rather than typing it.
3. **`ifcVersion` is a space-separated list** and is metadata only. It does not
   gate which files a rule runs against — ifctester will happily run an
   `IFC4`-declared specification against an IFC2X3 file.
4. Facets are Entity, Attribute, Classification, Property, Material, PartOf.
   `applicabilityType` and `requirementsType` are defined separately in the
   XSD; not every facet is legal in both.

## The wasm engine

`vendor/ifcfast-wasm/` is a build of ifcfast's `crates/wasm`, not authored here.
ifcfast is read-only to this project. `scripts/build-wasm.sh` downloads a source
tarball into a scratch directory and builds there; it never modifies the ifcfast
working tree.

The crate is **in no tagged release** — v0.5.1 ships only `crates/core` — and
there is no npm package or release asset, so the module must be built from
source. `vendor/ifcfast-wasm/PROVENANCE.md` records the commit.

### What the wasm build exposes

`fromBytes` · `summaryJson` · `graphJson` · `qtoJson` · `typesJson` ·
`statsJson` · `bySourceJson` · `streamMeshes` · `streamShiftJson` · `toGlb`

`graphJson()` carries `products` (with `typed`, `materials`, `storey_guid`,
`type_name`, `type_source`, `is_external`, `fire_rating`, `load_bearing`),
`storeys` with elevations, `contained_in`, `aggregates`, `storey_building`,
`sites`, `buildings`, `voids`.

**The JSON shapes differ from the Rust structs** published on GitHub. Read
`src/engine/types.ts`, which is written against the actual payloads. In
particular `contained_in` is `{product_guid, storey_guid}` with no
`container_kind`, so in the browser it tracks storey containment specifically,
not containment in any spatial element.

### Open ifcfast issues that constrain this tool

| | |
|---|---|
| [#178](https://github.com/EdvardGK/ifcfast/issues/178) | `IfcGeographicElement` / `IfcCivilElement` silently produce an empty model |
| [#179](https://github.com/EdvardGK/ifcfast/issues/179) | `mesh()`, `meshes()` and `iter_meshes()` use three different coordinate frames |
| [#180](https://github.com/EdvardGK/ifcfast/issues/180) | `StoreyRow.elevation` is in file units while all geometry is metres |
| [#183](https://github.com/EdvardGK/ifcfast/issues/183) | psets and classifications are parsed but have no JS accessor |

**#183 gates IDS property and classification facets.** The rows exist —
`summaryJson().tables` reports them loaded with counts — but nothing can read
them out, so those facets cannot run in the browser until it lands.

**#180 matters to any geometry check you write.** Storey elevation is in file
units; mesh vertices are metres. Multiply by `summary.unit_scale` before
comparing, or every millimetre model is wrong by 1000× and silently.
