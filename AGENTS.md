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
                 + CheckSeverity / Verdict / DisplayValue
  fundamentals.ts  the eleven structure-and-usability checks, their severities
                   and `verdictOf`
src/ui/          the screen, and the worker that drives the engine
  model-worker.ts  one Web Worker per file; keeps the parsed graph resident
                   so a ruleset dropped later evaluates without re-parsing
  bento-spec.ts    the house dashboard grid, mirrored from sprucelab
  BentoGrid.tsx    + useBentoCols.ts + bento-layouts.ts — the two authored
                   layouts and the container-query track ladder
  Verification.tsx the focal tile: one row per universal check
  forms.tsx        the supporting tiles (gauge, distribution, roster, readouts)
src/ids/         ruleset model, IDS emitter, evaluator, XSD validator
src/builder/     rule builder UI (a strict subset of the JSON format)
scripts/
  check-cli.ts   run the fundamentals headlessly
  ids-cli.ts     author, lint, emit and run rulesets headlessly
  build-wasm.sh  rebuild the vendored ifcfast wasm module
  gen-ifc-classes.py   regenerate the concrete-class lists from the EXPRESS schema
vendor/ifcfast-wasm/   the wasm engine + PROVENANCE.md
```

## Running the checks without a browser

Node 24 strips TypeScript natively, so there is no build step:

```bash
node scripts/check-cli.ts model.ifc [more.ifc ...]
```

It prints, per check, the verdict · the check id · the value found ·
`state/severity` · the finding count and the engine's own detail line.

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

### Severity, and the verdict the screen prints

`state` says whether the check FOUND anything. `severity` says what a finding
MEANS, on any project, and is constant per check:

| severity | meaning |
|---|---|
| `deviation` | wrong in the file itself — breaks a consumer of the IFC |
| `advisory` | true of the file, and a legitimate state for a model at some stage |

The screen prints `verdictOf(check)`, which is derived from the two and never
stored: `not_applicable` → **N/A**, `pass` → **Bestått**, `review` → **Advarsel**,
`fail` + advisory → **Advarsel**, `fail` + deviation → **Avvik**.

A structural work model with no materials is an Advarsel; a duplicate GlobalId
is an Avvik. There is deliberately **no composite score and no grade** — one
number hiding eleven answers is what the eleven answers exist to replace.

### `displayValue` — the value the check found

Every result carries one, as a code plus params plus an English `text`, the
same shape `Finding.reason` uses so the UI can render it in Norwegian or
English and an agent can branch on the code. Codes: `literal` · `share` ·
`count` · `unique` · `shared-elevation`.

The screen prints that value and colours it by the verdict: a red block reading
`m` or `0 av 851` says what is wrong without a click. Pattern taken from the
delivered Skiplum reports (`skiplum-reports/projects/kistefos`, the Modell ×
Krav matrix and `skiplum-automation/scripts/python/acc/requirements.py`).

## The eleven fundamentals

Project-agnostic: no property sets, no classification system, no delivery
stage. Because they are universal they are judged with no ruleset loaded.

| check | severity |
|---|---|
| `parse-integrity` | deviation |
| `spatial-chain` — Project → Site → Building → Storey all present | deviation |
| `storey-containment` | deviation |
| `storey-in-building` | deviation |
| `storey-elevation` — storeys must sit at distinct elevations | deviation |
| `guid-unique` | deviation |
| `element-named` | advisory |
| `element-typed` | advisory |
| `type-name-placeholder` | advisory |
| `single-instance-types` (review) | advisory |
| `element-material` | advisory |

A file the parser reports zero products for **fails** `parse-integrity`. ifcfast
drops IFC classes its whitelist does not carry — `IfcGeographicElement` among
them ([ifcfast#178](https://github.com/EdvardGK/ifcfast/issues/178)) — so an
empty product list means "empty or unsupported", never "clean".

## The dashboard grid — binding, not advisory

The board is an INSTANCE of the house bento grid, not a layout of its own.
edkjo, 2026-08-24: *"every DASHBOARD is an instance of ONE grid"*, *"copy one,
never a new grid"*. The canon is `sprucelab/frontend/DESIGN.md` §2d and
`sprucelab/docs/plans/2026-08-24-20-29_bento-dashboard-system.md` §1;
`src/ui/bento-spec.ts` + `BentoGrid.tsx` + `useBentoCols.ts` are a MIRROR of
the sprucelab implementation, copied because the two projects share no package
boundary. Do not evolve the grid here — change it upstream and re-mirror.

What that binds:

- **Two AUTHORED layouts, never one reflowed** — 13 tracks (8+5) and 21 tracks
  (13+8), in `src/ui/bento-layouts.ts`.
- **The switch reads the GRID's own inline size**, not the viewport
  (`BENTO_21_MIN_WIDTH` = 1900). Load-bearing here: ifc-check ships as an
  iframe on skiplum.com, where a `vw` unit measures the host page's box.
- **The track is CSS-derived** — `track = 100cqw / (cols + (cols−1)/10)`,
  `colGap = track/10`, `rowGap = φ · colGap` — so the board is correct on the
  FIRST paint, with no measurement pass. The convergence cap
  (`BENTO_MAX_WIDTH`) goes on the container-query root or `100cqw` keeps
  measuring an uncapped box.
- **Fibonacci spans only**, and bands must close: 13 → 8+5 · 5+3+5 · 3+5+5;
  21 → 8+5+8 · 13+8 · 5+8+8.
- **Exactly one focal and one gauge**; P0/P1 never below the fold; air is the
  gutter and empty structural tracks only.
- `validateBentoLayout` runs at render — dev throws with every fault at once,
  prod renders an error tile in the offending slot. Never a silent reflow.

Two deviations from upstream, both in the kind→span registry and both named at
the entry in `bento-spec.ts`: `tellTales` takes the focal spans (the
verification block is this board's focal) and `matrix` takes the full-band
spans (the storey × class census is below-fold context here, not the focal).

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


## Rulesets

The ruleset JSON is the interface. The builder UI is a view onto it and holds
no capability the format lacks, so an agent never needs the UI.

JSON Schema: `src/ids/ruleset.schema.json` (draft 2020-12). Validate your
authored ruleset against it before running. The selftest asserts the shipped
copy has not drifted from `src/ids/schema.ts`.

### Two kinds of rule

**`kind: "ids"`** becomes one IDS `<specification>`. All six facets are
covered in both positions: Entity, Attribute, Classification, Property,
Material, PartOf.

**`kind: "extended"`** carries a check IDS has no facet for. Each exists
because of a specific verified limit, not a preference:

| `check.type` | blocked in IDS by |
|---|---|
| `element-typed` | no `IFCRELDEFINESBYTYPE` in the relations enumeration |
| `unique-attribute` | no uniqueness or cross-instance operator |
| `type-usage-count` | no cross-instance counting — applicability `minOccurs` counts the whole selection, not per type |
| `model-metadata` | header, `IfcUnitAssignment` and parse stats are unreachable by any facet |

Only checks that can actually be evaluated are offered. **Geometry and
georeferencing rule kinds do not exist**, because the data source does not — an
authorable but inert rule is exactly the green-looking non-result this tool is
built to avoid.

### Things the format prevents

- `minOccurs` / `maxOccurs` live on `applicability`, never on the rule.
- `cardinality` is accepted only in `requirements`; the JSON Schema uses
  separate facet definitions per position, so putting it in applicability is a
  schema violation rather than a lint warning.
- Naming an abstract IFC class is a lint **error**. Use `"group"` and the
  emitter expands it to the concrete class enumeration — the abstract-class
  trap cannot be authored. Groups: `product`, `element`, `physicalElement`,
  `builtElement`, `distributionElement`, `spatialElement`, `featureElement`,
  `elementType`, `typeProduct`, `group`.
- `partOf` requirements take `required` or `prohibited` only, per the XSD's
  `simpleCardinality`.

### Export is honest about what it dropped

`emit` produces the `.ids` and the ruleset JSON, and lists every excluded rule
with a code (`disabled` or `not-expressible:<checkType>`). The `.ids` is
**null** rather than empty when nothing was expressible, because an IDS with
zero specifications is invalid. No custom namespace is ever injected to smuggle
an extended rule into the standard file.

### CLI

```bash
node scripts/ids-cli.ts schema                        # the ruleset JSON Schema
node scripts/ids-cli.ts sample                        # a worked ruleset to start from
node scripts/ids-cli.ts lint   my.ruleset.json
node scripts/ids-cli.ts emit   my.ruleset.json [--out DIR]
node scripts/ids-cli.ts run    my.ruleset.json a.ifc [b.ifc ...]
node scripts/ids-cli.ts selftest
```

One JSON document to stdout per invocation; progress and errors to stderr.

Exit codes: **0** clean · **1** the thing checked failed · **2** usage or
internal error · **3** nothing failed but at least one rule was
`not_evaluable`. Treat 3 as "the answer is unknown", not as a pass.

### The evaluator's boundary

`state` is never `pass` by default. Zero matches gives `not_applicable`;
anything the parser cannot answer gives `not_evaluable` with the reason
attached.

**Evaluable:** entity and predefinedType · attributes GlobalId, Name,
ObjectType, Tag, PredefinedType · materials · the relations
`IFCRELCONTAINEDINSPATIALSTRUCTURE`, `IFCRELAGGREGATES`,
`IFCRELVOIDSELEMENT IFCRELFILLSELEMENT` · type linkage · applicability
occurrence bounds · the three flattened common properties IsExternal,
FireRating, LoadBearing.

**Not evaluable, and reported as such:** classifications and any other property
(both wait on [ifcfast#183](https://github.com/EdvardGK/ifcfast/issues/183)) ·
attributes outside those five · `IFCRELNESTS` · `IFCRELASSIGNSTOGROUP` · a
facet whose name is itself a restriction.

Two caveats the output states for itself: a property rule matches on base name
only, because the parser flattens those three and does not carry the property
set name; and spatial structure elements are synthesized into the selection
universe carrying GlobalId and Name only.

XSD regex is a different dialect from JavaScript's. Patterns are anchored as
XSD anchors them, but an exotic pattern can behave differently here than in a
conforming IDS auditor.

### Validation is real

`xmllint-wasm` against buildingSMART's own XSD, vendored in
`vendor/ids-schema/` with the W3C imports alongside it. The absolute
`schemaLocation` URLs are rewritten to local filenames in code so the vendored
files stay byte-identical to what was published, and a guard throws if any
absolute import survives — validation cannot silently degrade into a
network-dependent no-op.

Cross-checked against an independent implementation: the emitted sample
validates clean under Python `xmlschema`, and `minOccurs` on a specification, a
bogus `ifcVersion` and `cardinality` on an applicability facet are each
rejected.

### Regenerating generated files

```bash
python scripts/gen-ifc-classes.py                              # needs ifcopenshell
node scripts/ids-cli.ts schema > src/ids/ruleset.schema.json   # selftest asserts this is current
```
