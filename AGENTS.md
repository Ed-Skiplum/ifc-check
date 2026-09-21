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
  placement.ts   `mesh-placement`, the twelfth check: needs the streamed meshes,
                 so it runs beside `runFundamentals`, not inside it
  kpis.ts        the seven numbers on the board's KPI row
  storey-config.ts  `storey-config`: file storeys against the ruleset's floor
                 config (`storeys`)
src/ui/          the screen, and the worker that drives the engine
  model-worker.ts  one Web Worker per file; keeps the parsed graph resident
                   so a ruleset dropped later evaluates without re-parsing
  bento-spec.ts    the house dashboard grid, mirrored from sprucelab
  BentoGrid.tsx    + useBentoCols.ts + bento-layouts.ts — the two authored
                   layouts and the container-query track ladder
  Verification.tsx the focal tile: one row per universal check
  forms.tsx        the supporting tiles (gauge, distribution, roster, readouts)
  SetupPage.tsx    the project mappings page (`#page=setup`)
src/ids/         ruleset model, IDS emitter, evaluator, XSD validator
src/builder/     rule builder UI (a strict subset of the JSON format)
src/codelists/   bundled code lists (code -> name), generated; lookups only
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

**One exception to "judged with no ruleset loaded":** when the loaded ruleset
carries an enabled `copy-object` mapping (see Project mappings below), the
worker re-runs `runFundamentals` with that mapping's reference/copy objects
excluded, exactly as it excludes them from every ruleset rule's own selection.
`checks` on the model report is replaced with that re-run, not merged; parsing
without a ruleset, or with one that carries no `copy-object` mapping, behaves
exactly as before.

## `mesh-placement` — geometry against the stated storey

DEVIATION. Runs wherever geometry exists (parse worker, restore worker from
the cached batches, `check-cli.ts`); with no complete geometry (mesh pass
failed, or a cache whose batches were capped) it is `not_applicable` with the
reason. Copy-object exclusions and openings are dropped exactly as in
`runFundamentals`. One finding per element:

- `far-from-model` — the element's mesh centre, or its own half-extent, is
  beyond 5 × the 98th percentile of centre distances from the median centre
  (Chebyshev per axis), floored at 1 m. This is `bulkOutliers`, the SAME
  function the viewer's entry camera uses to decide what not to frame, so
  "Utenfor ramme" and this check always name the same elements. On
  `KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc` it flags the five ifcfast#190
  beams and nothing else.
- `storey-mismatch` — the storey the mesh BOTTOM falls in (greatest elevation
  <= bottom + 0.1 m) is not the stated storey. Method and tolerance from
  `KNM_Mottakskontroll/02_arbeid/ids/storey_check.py`. Elevation is scaled by
  `unit_scale` (ifcfast#180). Refuses to run, and says so in `detail`, when
  fewer than two distinct elevations exist or when the elevation span and the
  mesh-bottom span do not overlap (elevations relative to a building placed
  elsewhere).

Not measurable: distance from an element's OWN placement origin. The core has
a `drift` table (`drift_distance_m`) but the wasm build exposes only its row
count.

## `storey-config` — the floor config (Etasjeoppsett)

The ruleset may carry `storeys: [{name, elevation}]` (elevation in METRES,
author's order). Schema and lint cover it (`storey-name-empty`,
`storey-name-duplicate`, `storey-elevation-invalid` are errors;
`storey-name-whitespace`, `storey-elevation-duplicate` warnings). The setup
page edits it as one more section; an empty list is removed, i.e. no config.

DEVIATION, per model: every file storey must match one config floor exactly on
name (case-sensitive, untrimmed) AND elevation (mm, after `unit_scale`,
ifcfast#180). Findings: `storey-not-in-config`, `storey-name-mismatch` (right
elevation, wrong name), `storey-elevation-mismatch` (right name, wrong
elevation), `storey-name-whitespace` (matches only after trimming),
`storey-duplicate-match`, and `storey-count-exceeds` (more storeys than the
config; fewer is fine). A config floor a file lacks is absent, never a
finding. No config loaded: `not_applicable`, never a pass. The parse runs it
with no config; a ruleset re-runs it with the config; clearing the ruleset
puts the parse-time checks back (`ModelEntry.baseChecks`).

On the board the `storeys` tile renders `FloorSetupMatrix` when a config is
loaded (rows = config floors, then unmatched file storeys; one column per
loaded model; cells from the same `matchStoreys` the check uses), and the
file's own roster otherwise. `check-cli.ts --ruleset <file>` supplies the
config headlessly. `examples/knm.ruleset.json` carries no floor config: the
KNM BEP §6.5 marks the elevations TBD ("working placeholders").

## The KPI row

Seven cards, one number each, in a 13×1 / 21×1 `tellTales` strip on top of
both layouts (`kpis.ts` + `KpiRow` in `forms.tsx`): Typer (declared type
objects, `summary.tables.type_objects.rows`), Uten type (`element-typed`
findings), Etasjer, Filstørrelse, Materialer (distinct names over physical
in-scope products), Uten etasje (`storey-containment` findings; the wasm graph
sees storey containment only), Plassering (`mesh-placement` findings). The
three finding counts carry their check's verdict colour and cross-filter via
the `check` focus; the rest are neutral counts. Seven tiles cannot share a
band (at most four band cuts per row), hence one strip; the grid has no
KPI-row kind. Strip-class spans are aspect-checked against
`BENTO_STRIP_ASPECT_MAX`, as the spec states, in both `BentoGrid` and
`board-gate.mjs`.

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
| `code-lookup` | a restriction tests the whole value; extracting part of it and looking it up in a code list has no facet |

Only checks that can actually be evaluated are offered. **Geometry and
georeferencing rule kinds do not exist**, because the data source does not — an
authorable but inert rule is exactly the green-looking non-result this tool is
built to avoid.

### `code-lookup` and the bundled code lists

```json
{ "type": "code-lookup", "list": "ns3457-8", "target": "type",
  "source": { "attribute": "Name" }, "extract": "^([A-Z]{2,3})-\\d{2}$" }
```

- Exactly one of `list` and `values`. `values` is the project's own list of
  allowed codes (lint rejects an empty list; the finding reads `is not in the
  allowed values (...)`). Same evaluator path as a bundled list.
- `list` names a bundled list in `src/codelists/`. Only `ns3457-8` ships
  (NS 3457-8:2021, 909 codes, all three levels). Each generated module carries
  its provenance in `meta`: source file, SHA-256, date, count. Lookups only:
  nothing enumerates a list into an IDS.
- `extract` is a JavaScript regex (not XSD, not implicitly anchored) with
  exactly one capture group, the code. Lint rejects zero or several groups.
- `source` is one of `{attribute}`, `{property: {propertySet, name}}`,
  `{classification: {system?}}`. Property and classification sources are in
  the format and return `not_evaluable` citing ifcfast#183.
- `target` `occurrence` (default) reads the elements `select` picks.
  `type` reads the TYPES of those elements, one subject per type Name, with
  the member elements in `finding.members` (the cross-filter uses them).
  `select` is optional for this check; omitted selects everything.
- Findings per subject: `<attr> is empty` · `does not match <extract>` ·
  `code "X" ... is not in <list>`. The detail line counts all three.

What a type subject cannot be, and why: the parser exposes a type object only
through the product rows that use it (`typed` + `type_name`). There is no type
GlobalId, no type class and no row for an unused type. So a type finding
carries `-` for its GlobalId; a type-class entity filter (`IFCWALLTYPE`,
groups `elementType` / `typeProduct`) and any attribute other than Name are
`not_evaluable`; the result notes how many type objects the file declares
(`summary.tables.type_objects.rows`) against how many were reached.
`typesJson()` is no way round this: its `guid` is a representative
OCCURRENCE's GlobalId (KNM_ARK: roster `3DfJg_…` is an IFCWALL, the
IFCWALLTYPE is `2AOaxJLUjBAuPEsPyzVzoE`), and it too lists used types only.

**Empty types (declared, used by no element) are therefore not a check.** The
core parses a `type_objects` table (`guid, entity, name, step_id`; KNM_ARK
declares 398, elements use 84 names) and a `type_guid` column on products, but
the wasm build exposes neither. Needs an ifcfast accessor first.

Verified headlessly (`ids-cli run`) on the KNM models: every finding kind,
the pass path, the four `not_evaluable` reasons, and the lint errors for a bad
regex, zero and two capture groups. The builder fields are type-checked and
built, not exercised in a browser.

Example project config: `examples/knm.ruleset.json`.

### Project mappings

Where a project stores the concepts every project has. A mapping is a role
on a `code-lookup` extended rule, `"mapping": "<role>"`, not a construct of
its own: it lives in the ruleset, round-trips through the JSON as-is, and is
evaluated by the same `codeLookup` path — except `copy-object`, which is a
scope filter (below). At most one rule per role (lint `mapping-duplicate`).
A mapping is matched by its `mapping` field, never by `id`, so the id on the
rule is cosmetic: it is set to the role name on creation (`progress-code`,
`copy-object`, never a suffixed variant like `progress-code-code`) but an
older file with a different id for the same role still loads and evaluates
correctly.

| `mapping` | header (POFIN) | lookup | lint |
|---|---|---|---|
| `system-classification` | Systemkode | `list` | `mapping-list` |
| `component-classification` | Komponentklasse | `list` | `mapping-list` |
| `progress-code` | Prosesstatuskode (MMI) | `values` (the project's codes) | `mapping-values` |
| `copy-object` | Duplikat objekt | `values`, two modes (below) | `mapping-values` |

Headers are from POFIN 2.1 EIR bygg, "Veiledning til krav til alfanumerisk
informasjon" (`resources/standards/pofin/02-1-eir-bygg.md`). POFIN has no
header for component classification; it names NS 3457-8 "komponentklasser"
under Objekttypenavn and Forekomst, so the header is Komponentklasse.

**`copy-object` is a SCOPE FILTER, not a data-quality check.** An object whose
mapped value matches is a reference/copy object and is **excluded from the
selection of every other rule, fundamentals included** — no finding is ever
reported on it. A missing or empty value is an ordinary, in-scope object, and
so is a value `extract` does not match: this mapping never fails an element,
it only decides what the rest of the ruleset gets to see. The mapping's own
result is a count, never a finding — `"N of M objects excluded as reference
objects"` — so the filter is never silent about what it did.

Two value modes, both stored as plain `values` (no new rule field, so this
round-trips through the ruleset JSON as-is; the setup page derives which mode
is active from the values themselves, `isBooleanValues`):

- **boolean** — the G55-style `Referanseobjekt` Ja/Nei flag, `values` the pair
  `true`, `false` (`true`/`false` is how this tool renders an IFC BOOLEAN, the
  flattened IsExternal/LoadBearing do the same, and the xs:boolean lexical
  form IDS uses). Only `true` marks a reference; `false` is an ordinary
  object saying so explicitly, never a second reference value.
- **codes** — POFIN's actual `Duplikat objekt` value, the fagkode of the
  discipline that owns the object (`NONS_Process.DuplicateOwnedBy: RIV`), as a
  user-entered comma-separated list. Any of the listed codes marks a
  reference; there is no "opposite" value in this mode.

`code-values-empty` still rejects an empty list in either mode; nothing else
constrains the shape, so `mapping-values` is the only lint code the mapping
needs (the old `mapping-boolean` code that required exactly `true`, `false`
is gone).

If the source is not evaluable (property or classification, ifcfast#183), the
filter cannot run: the mapping's own rule reports `not_evaluable` with the
reason, carrying a note that reference objects could not be excluded from the
rest of the ruleset. Every other rule then runs unfiltered, exactly as if the
mapping were absent — **never** silently treated as "no reference objects".

The setup page (`#page=setup`, "Oppsett") has one card per role. A card
creates its rule on first enable (id = the role, `select` physicalElement,
the rule builder's blank source and extract), and turning it off sets
`enabled: false`, keeping what was entered. Edits apply to the loaded models
at once. Lint issues for a card's rule print on the card; a ruleset with lint
errors cannot be downloaded. A property or classification source shows the
board's own `Kan ikke vurderes` state with `ifcfast#183`. The `copy-object`
card additionally carries a boolean/codes toggle (`isBooleanValues` decides
which is shown as active) and, in codes mode, the same allowed-values input
`progress-code` uses. Built and type-checked; **not exercised in a browser.**

Verified headlessly: `selftest` asserts each mapping lint refusal, the schema
refusal of a code-lookup with neither list nor values, a values lookup on a
synthetic model (in list passes, outside and empty fail), a property-sourced
mapping as `not_evaluable` carrying the "could not be excluded" note (and that
`progress-code` still evaluates the full, unfiltered set when it does), and
the copy-object scope filter excluding a reference object from another rule's
findings in both boolean and codes mode. `examples/knm.ruleset.json` expresses
its NS 3457-8 type-name rule as `component-classification`; `run` on
KNM_ARK / RIV / RIB (KNM_Void-demo `01_inn/export_2026-09-14/`) is
byte-identical to before the mapping was added (84/84, 4/4, 2/2 no match) —
that ruleset carries no `copy-object` mapping, so this exercises the
no-filter path, not the exclusion itself.

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
PYTHONUTF8=1 python scripts/gen-codelists.py                   # src/codelists/*.ts from the workspace standards tables
```

`gen-codelists.py` fails rather than writing a partial list, and cross-checks
NS 3457-8's source (`ns3457_pdf_extract.json`, the QA'd transcription its
HANDOVER marks authoritative) against the reviewed `ns3457_table.csv` code by
code.
