# ifc-check — notes for agents

> Helping a user set up a project config and get results (not extending the tool)? Read [docs/agent-guide.md](docs/agent-guide.md) first.

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
  fundamentals.ts  the twelve structure-and-usability checks, their severities
                   and `verdictOf`
  placement.ts   `mesh-placement`, the twelfth check: needs the streamed meshes,
                 so it runs beside `runFundamentals`, not inside it
  kpis.ts        the seven numbers on the board's KPI row
  report.ts      the report contract: one row per requirement × model
                 (see "Report contract")
  code-tree.ts   the board's two code treemaps as data: system (NS 3451, or
                 IFC class, one level) and function (NS 3457-8, PredefinedType
                 as a marked fallback); pure, selftested
  quantities.ts  the treemaps' Volum / Areal: project units from the STEP
                 bytes, BaseQuantities by precedence, closed-mesh volume and
                 face-direction area, the fold onto a tree; pure, selftested
                 (see "Treemap measures")
  standard-layer.ts  the `ifc-schema`, `phase` and `material-product` report rows, with the
                 ruleset's `projectLayer` on top (see "The standard layer")
  storey-config.ts  `storey-config`: file storeys against the ruleset's floor
                 config (`storeys`)
  pset-inventory.ts  every property and quantity set, with fill, examples
                 and category (see "Pset inventory")
  ifc-pset-names.ts  generated: the set names the IFC templates define
src/ui/          the screen, and the worker that drives the engine
  model-worker.ts  one Web Worker per file; keeps the parsed graph resident
                   so a ruleset dropped later evaluates without re-parsing
  bento-spec.ts    the house dashboard grid, mirrored from sprucelab
  ModelPanel.tsx   one model: header (name, state, size, file facts), filter
                   bar, the two tabs, the derivation band under the active tab
  Dashboard.tsx    tab 1 (Kontroll): the bento board
  BentoGrid.tsx    + useBentoCols.ts + bento-layouts.ts — the two authored
                   tab-1 layouts and the container-query track ladder
  model-labels.ts  the short column label per loaded model (ARK/RIV/RIB)
  Verification.tsx the focal tile: one row per universal check, then the
                   project rules under "Regler" when a ruleset is loaded
  FloorSetup.tsx   the Etasjer tile: config floors × loaded models, or the
                   file's own storeys with no config
  TraceBand.tsx    the derivation band: the rows behind the open number
                   (50–61.8 %, by content) beside the object panel
  ObjectPanel.tsx  everything the engine has for the selected element:
                   lead cards + Attributter / Relasjoner / Egenskaper (tabs)
                   / Beregnet
  Contents.tsx     tab 2 (Innhold): classes, Etasje × klasse
                   (StoreyClassCensus.tsx), type ledger
  forms.tsx        gauge, distribution, KPI row, readouts
  SetupPage.tsx    the project mappings page (`#page=setup`)
src/ids/         ruleset model, IDS emitter, evaluator, XSD validator
  import.ts      IDS 1.0 XML -> ruleset, per specification (see "The IDS view")
  xml-read.ts    the DOM-free XML reader the importer runs on (Node and browser)
  xlsx.ts        the ruleset as an .xlsx workbook, read and written (see
                 "The .xlsx workbook")
  config-template.ts  the ruleset the .xlsx template is written from
  ids-report.ts  an imported IDS against one model: one row per specification
src/ui/IdsResults.tsx  the IDS table tile of the Prosjekt board
src/builder/     rule builder UI (a strict subset of the JSON format)
src/bcf/         BCF 2.1 export: topic plan, camera, spaces, XML, zip, XSD
                 validation (pure) + `browser.ts` (snapshots, download)
src/design/      the design alternatives' component family (`#design=a|b|c`) and fonts
src/ui/alt/      the design alternatives' layouts on the canon's module grid
                 (see "The module grid: the layout canon"): AltBoard, module-grid,
                 Requirements (the three renderings of a requirement),
                 Charts (treemaps, MMI bars), req-view, treemap (squarify)
src/ui/requirements.ts  the report's eleven requirements, in its order, over
                 the report contract rows (see "Round two" below)
src/ui/report-rows.ts   what the workers build for the board: the contract
                 rows, per-value doors of the mapping rows, the two treemaps
src/ui/measure-state.ts the treemap measures held in either worker, fed the
                 mesh batches one at a time after the board is posted
src/ui/board-doors.ts   the elements behind a requirement, a value or a cell
src/codelists/   bundled code lists (code -> name), generated; lookups only
scripts/
  check-cli.ts   run the fundamentals headlessly
  ids-cli.ts     author, lint, emit and run rulesets headlessly
  gen-config-template.ts  write examples/ and public/eks-config-template.xlsx
  bcf-cli.ts     export BCF headlessly, XSD-validate it, check every camera
  viewport-gate.mjs  real models in headless Chrome at every target viewport
  isolate-gate.mjs   what a CLICK does, driven with real mouse events
  zoom-gate.mjs      what the WHEEL does, driven with real CDP wheel events
  module-grid-gate.mjs  the design alternatives against the layout canon
                     (rules 1, 3 to 9) in headless Chrome, per viewport class
  bento-pack-test.mjs   the module grid and the packer without a browser
  build-wasm.sh  rebuild the vendored ifcfast wasm module
  gen-ifc-classes.py   regenerate the concrete-class lists from the EXPRESS schema
vendor/ifcfast-wasm/   the wasm engine + PROVENANCE.md
mottakskontroll/       the mottakskontroll report engine (Python): measure a round, render the
                       PDFs and workbooks; see mottakskontroll/README.md
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
number hiding twelve answers is what the twelve answers exist to replace.

### `displayValue` — the value the check found

Every result carries one, as a code plus params plus an English `text`, the
same shape `Finding.reason` uses so the UI can render it in Norwegian or
English and an agent can branch on the code. Codes: `literal` · `share` ·
`count` · `unique` · `shared-elevation`.

The screen prints that value and colours it by the verdict: a red block reading
`m` or `0 av 851` says what is wrong without a click. Pattern taken from the
delivered Skiplum reports (`skiplum-reports/projects/kistefos`, the Modell ×
Krav matrix and `skiplum-automation/scripts/python/acc/requirements.py`).

## The twelve fundamentals

Project-agnostic: no property sets, no classification system, no delivery
stage. Because they are universal they are judged with no ruleset loaded.

| check | severity |
|---|---|
| `parse-integrity` | deviation |
| `spatial-chain` — Project → Site → Building → Storey all present | deviation |
| `storey-containment` — reads `storey_guid`, which follows IfcRelAggregates parents and spaces aggregated to a storey; not `contained_in` alone (#4) | deviation |
| `storey-in-building` | deviation |
| `storey-elevation` — storeys must sit at distinct elevations | deviation |
| `guid-unique` | deviation |
| `element-named` | advisory |
| `element-typed` | advisory |
| `type-name-placeholder` | advisory |
| `single-instance-types` (review) | advisory |
| `type-unused` — a declared type object no element uses | advisory |
| `element-material` — the layer-set column OR a named `materialsJson()` row (a direct IfcMaterial counts, #5); not_applicable when that table was not supplied | advisory |

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

## `type-unused` — declared type objects nothing uses

ADVISORY, and the one fundamental that is not about the products at all: its
subject is the file's type roster. `typeObjectsJson()` is every declared
`IfcTypeObject` keyed by its own GlobalId; `graphJson().products[].type_guid`
points into it; the unused types are the first minus the distinct non-null
second. KNM_ARK declares 398, its elements use 339, so 59 are declared and
unused.

Before ifcfast 0.5.3 this could not be asked. The graph reached a type only
through the elements using it, which is exactly the set an unused type is not
in — so the question was not a check that failed, it was a check that could not
exist. That is why it arrives now rather than having been an omission.

Three states, and the first two are both `not_applicable` for different reasons
that the row prints:

- `graph.type_objects` is absent (a caller that read the graph alone) — "the
  declared type roster was not supplied with this graph". Never a pass.
- the file declares no type objects — "the file declares no type objects". A
  model with no types has no unused ones, which is not a clean bill of health
  about type structure. KNM_RIB in `KNM_Mottakskontroll/02_arbeid` is this
  case: 851 products, 0 declared types.
- the roster is there — `used of declared`, one finding per unused type, whose
  `guid` is the TYPE's GlobalId and whose `entity` is the type's class.

The copy-object scope filter is deliberately NOT applied: it scopes elements,
and a type object is not an element. A type used only by excluded objects is
still a used type, and the number stays independent of a project setting.

`entity` arrives in ifcfast's own spelling — `IfcWalltype`, not `IfcWallType`
([ifcfast#186](https://github.com/EdvardGK/ifcfast/issues/186)). Nothing
compares it to a class name; if you ever do, compare case-insensitively.

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
  "Utenfor ramme" and this check always name the same elements.
  **Corrected 2026-09-23:** this used to say it flags the five ifcfast#190
  beams on `KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc`. It does not, and on the
  evidence it has not for some time — `check-cli.ts` on that file reports
  **0 of 851 far from the model (cutoff 295.8 m)**, measured both before and
  after the `placementContext` refactor, so the note was stale rather than
  broken by a change. The models that DO carry a stray today are the Void-demo
  exports: `KNM_ARK` 1 of 1 335 (cutoff 290.3 m) and `KNM_RIB` 1 of 3 (cutoff
  4.1 m). `zoom-gate.mjs` uses the first.
- `storey-mismatch` — edkjo's three-state rule (ifc-check#2, 2026-09-24),
  per element against its STATED storey, span `[elev, next_elev)` where
  `next_elev` is the next distinct elevation above; the top storey is open:

  | band | condition |
  |---|---|
  | green | `elev <= mesh_bottom < next_elev` |
  | yellow | `elev - 0.10 <= mesh_bottom < elev` AND `mesh_top >= elev` |
  | red | anything else |

  Yellow and red are both findings with code `storey-mismatch`;
  `params.band` says which and `params.delta` is bottom minus the stated
  elevation (m). Red or far makes the check `fail` (Avvik); yellow alone makes
  it `review` (Advarsel, via `verdictOf`). The UI prints one sentence for both
  bands. `CheckResult.tally` carries green / yellow / red / far / no_storey /
  unmeshed / band_ran. Every edge compares EXACTLY (`PLACEMENT_SLACK_M = 0`,
  edkjo 2026-09-25, overruling a 1 mm numerical slack). Streamed vertices are
  float32, so on HI90_ARK (22.09) 723 elements read yellow, 717 of them less
  than 0.1 mm below their storey; that is accepted. `LEVEL_EPSILON_M` (1 mm)
  still decides only whether two storey elevations are one level. Elevation is scaled by
  `unit_scale` (ifcfast#180). Refuses to run, and says so in `detail`, when
  fewer than two distinct elevations exist or when the elevation span and the
  mesh-bottom span do not overlap (elevations relative to a building placed
  elsewhere). This replaces the KNM `storey_check.py` rule (greatest elevation
  <= bottom + 0.1 m). On HI90_ARK: before, 40 of 2 730 off their storey;
  after, 2 689 green, 7 yellow, 34 red.

Not measurable: distance from an element's OWN placement origin. The core has
a `drift` table (`drift_distance_m`) but the wasm build exposes only its row
count.

## `body-no-mesh` — Body declared, no mesh (Mangler mesh)

ADVISORY (`src/engine/body-mesh.ts`). An element whose Body representation
exists in the file while ifcfast's mesh stream produced nothing for it. No wasm
accessor exposes representations, so the parse worker reads them from the STEP
bytes (`bodyDeclarations`), only for the in-scope elements that streamed no
mesh, and attaches them as `graph.body_declared` (cache format 6). Chain read:
`IfcProduct.Representation` → `IfcProductDefinitionShape` → the
`IfcShapeRepresentation` whose identifier is `Body` → item classes, following
`IfcMappedItem` into its mapped representation and a boolean result into its
first operand. `not_applicable` with the reason when the mesh pass failed or
the table was not read (ifczip). Value: meshed of (meshed + Body-without-mesh);
elements with no Body at all (assemblies, spaces with no Body) are not
findings. Both CLIs read the table too.

Measured 2026-09-28: 0 findings on the KNM exports and most HI90 exports;
HI90_ARK_MMI700 (Dalux 14.09) has 19, all `IfcWallStandardCase / IfcExtrudedAreaSolid`
(SweptSolid).

**ifcopenshell in the browser.** The derivation band of this check carries
«Verifiser med ifcopenshell» (`IfcosControl.tsx`, `ifcos-verify.ts`,
`ifcos-worker.ts`): Pyodide 0.28.3 from cdn.jsdelivr.net, the
`ifcopenshell-0.8.5-cp313-cp313-pyodide_2025_0_wasm32.whl` from
ifcopenshell.github.io/wasm-wheels (CORS `*`), the dropped `File` re-read,
`ifcopenshell.geom.create_shape` on exactly the finding GUIDs in a worker that
is terminated after the run. Verdict per element on its row: geometry
(vertex/face counts) | none | error (message). A failed stage says which
stage and why; a model restored from the cache has no file and says so. On
HI90_ARK_MMI700: 19 of 19 geometry (12 vertices, 16 faces), ~22 s headless.
The wheel's `ifcopenshell.version` reads `0.0.0`; the version shown is the
installed distribution's (`importlib.metadata`).

**The ifcfast issue.** Per signature (`element class / item chain / ifcfast
version`, `IFCFAST_VERSION` in `body-mesh.ts`, set by hand when the wasm is
re-vendored) where ifcopenshell found geometry: the unauthenticated GitHub
search for an open issue with the signature verbatim in its title, else a
prefilled `issues/new` link the user opens. The body carries no client data
(no file name, names, GUIDs, property values, coordinates): only classes,
representation identifier/type (a single word, else `(other)`), versions and
counts. The selftest asserts it.

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

On the Kontroll tab the `floors` tile ("Etasjer") renders `FloorSetupMatrix`
when a config is loaded: rows = config floors (name · kote), then under a
divider one row per file storey that matches no floor; one column per loaded
model (file stem), this panel's model first; cells from the same
`matchStoreys` the check uses. Cell vocabulary: ✓ green = match; gold
`✗ <file name>` = right kote, wrong name; gold `✗ +0,350` = right name, kote
off by the signed Δ in metres (file − config); gold `! ␣` = matches only after
trimming; gold `! ×2` = several storeys on one floor; red `✗` = the storey's
own not-in-config row; `—` = floor absent, never a finding. The full
"name · kote" is each cell's title. Sub: `floors × models` and `+N` extra rows.
Column headers are the models' distinguishing short names
(`model-labels.ts`: the common prefix and suffix dropped at a separator, so
`KNM_ARK`/`KNM_RIV`/`KNM_RIB` read `ARK`/`RIV`/`RIB`; one model, or a cut
that leaves a name empty or two names equal, keeps the stems); the file name
is the header's title. Model columns and every mark are sized to their
content and never truncated; only a found storey NAME (`✗ <name>`) ellipsizes,
at 16ch, by design. With no config the tile lists the file's own storeys (name · kote, gold
shared-kote marker), no model columns. What is ON each floor is the census,
"Etasje × klasse", on the Innhold tab, never on this tile. `check-cli.ts --ruleset <file>` supplies the
config headlessly. `examples/eks.ruleset.json` carries no floor config: the
KNM BEP §6.5 marks the elevations TBD ("working placeholders").

## The KPI row

Seven numbers, one each (`kpis.ts` + `KpiRow` in `forms.tsx`), in two places
since the 2026-09-24 layout pass. The three FINDING counts (Uten etasje ·
Uten type · Plassering, in the focal's own row order) sit inside the
verification focal, stacked in the section to the right of the check rows:
the board's only large coloured numerals. The four NEUTRAL counts (Typer
brukt · Etasjer · Filstørrelse · Materialer) are label·value pairs at list
size in a quiet 13×1 `tellTales` strip on the LAST row of both boards (P2).
The numbers: **Typer brukt**
(`339 / 398` — type objects an element is defined by, over the type objects the
file declares; see "Three numbers about types" below), Uten type (`element-typed`
findings), Etasjer, Filstørrelse, Materialer (distinct names over physical
in-scope products), Uten etasje (`storey-containment` findings; the wasm graph
sees storey containment only), Plassering (`mesh-placement` findings). The
three finding counts carry their check's verdict colour and cross-filter via
the `check` focus; the rest are neutral counts. Seven tiles cannot share a
band (at most four band cuts per row), hence one strip; the grid has no
KPI-row kind. Strip-class spans are aspect-checked against
`BENTO_STRIP_ASPECT_MAX`, as the spec states, in both `BentoGrid` and
`board-gate.mjs`.

### Three numbers about types, and why they differ

A board carries three counts that all answer to the word "types", and on a real
model none of them equals another. KNM_ARK: the file DECLARES **398** type
objects, its elements are defined by **339** of them, and those resolve to
**84** distinct type NAMES.

- The KPI prints `339 / 398`, used over declared, and is labelled Typer brukt.
- The type ledger keys by NAME, so its roster is the 84 — that is what
  `single-instance-types` counts against too, which is why the ledger keys that
  way (see the type ledger's own note).
- `type-unused` counts the gap between the first two: 59 findings.

Until ifcfast 0.5.3 the KPI printed 398 and the ledger listed 84 with nothing on
screen relating them. The ledger's foot now prints
`Typeobjekter  339 brukt av 398 · 84 navn`, and `types-gate.mjs` asserts the
three reconcile against the raw roster, so the surfaces cannot drift apart
silently.

## The model panel: three tabs

Per model (`ModelPanel.tsx`). The header line carries name · state · size and
the file's own facts as a `ReadoutStrip` (schema · unit · products · parse
time · project · application; products opens its derivation). Under it the
tab strip, and the filter bar on the SAME line, right-aligned over the strip's
empty end (2026-09-24; it used to be a line of its own above the tabs). It is
outside the tab panels, so the filter belongs to the model and persists across
tabs. It never wraps: the one filter chip appearing moves nothing, so the row
just clicked is still under the pointer for the click that undoes it. The
gates find it by `[data-filter-bar]`, the chip by `[data-filter-origin]`.
"Åpne IFC" is the filled primary only on the empty landing; with a model
loaded it drops to the outlined style of the other bar controls. Then:

1. **Kontroll** (`Dashboard.tsx`, bento): verification focal (the twelve
   checks + `mesh-placement` + `storey-config`, then the ruleset's rules as
   rows under "Regler", `not_evaluable` included; this replaced the separate
   rule strip; the three finding counts beside the rows), the model tile, the
   spatial gauge (four lamps), the Etasjer tile, and the quiet strip of
   neutral counts.
2. **Innhold** (`Contents.tsx`, flow surface, not bento): band 1 is Klasser
   (38.2 %) | Etasje × klasse (61.8 %, `Ifc` prefix dropped, headers wrap to
   two lines, total column = elements per storey); band 2 is the type ledger,
   full width, sticky header, its disproportion band as the head. Both bands
   are fixed, viewport-derived heights; their tables scroll inside.

3. **Graf** (`GraphTab.tsx`): the model as a drill (building, storey, class,
   product) with the selected element's `IfcRel*` edges blooming out of it, and
   the 3D beside it (below).
4. **Typer** (`TypesTab.tsx`) and 5. **Materialer** (`MaterialsTab.tsx`): the
   type and material extraction (below).
6. **Rom** (`RoomsTab.tsx`): the spaces, apart from the treemaps (see "The
   Rom tab").
7. **Prosjekt** (`alt/ProjectBoard.tsx`): project specifics and the IDS: the
   Standardkrav KPI cards, the IDS table, the mapped treemaps, the MMI bars
   and the model (see "The project tab board", "The IDS view"). The tab's name is pending the owner and
   lives in one key, `tab.project`.

The tab is `tab=contents` / `graph` / `types` / `materials` / `rooms` / `project` in the URL hash (absent = Kontroll), one
for all panels, pushed to history so Back/Forward walk it. Both tabs stay mounted and
the inactive one is `hidden`, so the 3D scene and its camera survive a tab
switch. The derivation band opens INSIDE the panel of the model it belongs to,
under the active tab, pinned to the bottom of the scrolling page
(`sticky bottom-0`) at 38.2 % of the screen, so a number clicked at the top of
a tall board opens its derivation in view. Within it the rows take 50–61.8 %
by their content and the object panel the rest (below).

Checked 2026-09-21 in headless Chrome against a LOCAL preview build, not the
deployed site: both tabs at 1440 and 1100 with KNM_ARK, ARK+RIV+RIB + knm
ruleset, and ARK+RIV+RIB + a test floor config; the band split; the setup
double-click dialog (opens on an off card, Aktiver turns it on, an on card
ignores double-click); the app bar at 390 with a model loaded (no control
past the right edge).

The app bar wraps at narrow widths, so BCF, the ruleset, Oppsett and NB/EN
stay reachable at 390 px. The board itself has no portrait layout (canon
2026-08-01); that is out of scope, not a defect.

## Clicking: one filter, one origin (2026-09-28)

edkjo's rule, now canon in `resources/design-system/data-workspace.md`:
*"cross filter should have one origin: all other views show only the matching
results. The clicked origin highlights. So: Original: Highlight, everything
else: Isolate."* It replaced facet chips that OR-ed within a facet and AND-ed
across facets, which the owner saw as *"it seems like the cross filter is
cumulative somehow, or that selecting something in the graph and list dont
respect that the xc filter has changed."* It was: a treemap cell AND a graph
storey AND a type card intersected, the type card and the Materialer card
carried the ISOLATED card's guids (so a click intersected even where it meant
to replace), and the graph, galleries, treemaps, MMI and floor sidebar read
the unfiltered profile while only the 3D obeyed the chips.

**The state** (`src/ui/filter-state.ts`, pure, selftested): per model ONE
`{ origin, key, filter, scope, selection }`. `origin` is the view clicked,
`key` what was chosen in it, `filter` its elements (a focus resolved by
`cross-filter.ts` `resolveActive`, or guids carried by a card), `scope` what
the Scope dock lists. `reduceFilter` is the only writer; `useCrossFilter`
holds it per model and every view reads the one resolved set (`ModelPanel`
builds `xf = { origin, matched }` once). No view keeps a copy.

- **A click replaces.** Any click in any view sets the filter and makes that
  view the origin; the previous filter is gone, never intersected. The chosen
  item again clears it. The bar shows the one filter (kind, label, ✕ to
  clear) and `N / total`; nothing accumulates.
- **Shift or Ctrl** adds or removes an element WITHIN one view, where it
  existed before: the canvas, a Scope row, a graph product. From another view
  it replaces like any click.
- **A Scope row** makes Scope the origin: it keeps its list and highlights the
  row, everything else isolates to the element. The same row again steps back
  to the filter the list came from (`base`).
- **A click on something that is not an element set** (`kpi:products`, a
  `not_applicable` check, a `not_evaluable` rule, a `not_configured`
  requirement) opens Scope with its reason and clears the filter. An empty
  scene there would report "was not answered" as "no elements".
- **The type page** is its own view-local mode (origin `typepage`): Per
  forekomst sets the filter to the current instance, Alle forekomster to the
  type's instances, all selected (`set`, no toggle); leaving hands the
  gallery's filter back. A requirement line leaves with ONE filter: that
  requirement's findings among the type's instances.
- **The hash mirrors it**: `focus=` is the Scope focus, written with
  `replace`, restored once on load as a click from the focus's own view
  (`origins.ts` `originOfFocus`). Back/Forward walk tabs and the type page,
  not filters.

**Origin highlights.** The origin view keeps every item; the chosen one keeps
its own highlight and the rest are dimmed (`data-xf="origin"` on the view,
one CSS rule in `index.css`; `data-xf-in` keeps a treemap frame around, or
cells inside, the chosen cell). The graph as origin draws every node, the
chosen storey or bucket ringed and the rest sunk back.

**Every other view isolates** to the filter's elements:

| view | origin id | isolated |
|---|---|---|
| 3D (Oversikt, lent to Graf, Typer, Materialer, Prosjekt) | `viewer` | `Vis kun` draws the set, `Uthev` ghosts the rest; as origin (a canvas pick) the whole model, the pick highlighted |
| Graf | `graph` | only the storeys, buckets and products that match (`buildDrill` over the matching rows; relations still read the whole model) |
| Scope | `scope` | lists the filter's derivation (`scope`) |
| Detail | | the selection the filter implies (an element pick); empty for a set |
| Typer gallery | `types` | only types with matching instances, counts recomputed (`catalogue` over the matching rows) |
| under the Typer viewer | `type-materials` | the chosen type's materials, a click makes that material the filter |
| Materialer | `materials` | only materials and layer sets with matching elements, counts recomputed |
| treemaps (Oversikt, Prosjekt) | `tree-system`, `tree-function` | cells recomputed over the matching elements; volume and area summed per element (`elementQuantities`), else count |
| MMI bars | `mmi` | each bar its value's elements in the set; bars with none not drawn; shades keep the full scale |
| Etasjer sidebar | `floors` | only storeys (config rows) holding matching elements |
| Innhold | `census` | Klasser, Etasje × klasse and the type ledger over the matching rows |
| KPI cards, checks, IDS table, counts | `reqs`, `checks`, `ids` | **whole model, marked** «Hele modellen» (`data-xf="whole"`): a requirement's base is not known per element, so a figure over the set would be invented |

A click from an isolated view always takes the WHOLE item (the full type
card, the full storey), so it replaces and never intersects.

**`Vis kun / Uthev`** says only how the 3D expresses the isolation; it does
not decide whether a click isolates.

**Cross-model: a click narrows its own panel only.** The filter is per model,
so the other panels are untouched; only the panel's OWN column in the floor
matrix is a door.

**Every selection is framed** (edkjo, 2026-09-28): *"always frame the selected
object. pivot on it and frame it."* This replaced the 2026-09-23 rule that a
set never moved the camera and a canvas pick moved nothing. Whatever is chosen
becomes the orbit pivot AND is framed, from every path: canvas pick, Scope or
band row, graph node (viewer main or windowed), treemap cell, requirement or
KPI card, chip, Typer/Materialer gallery card, a Shift second click (frame what
remains). One framing rule, one piece of arithmetic: the same
`ModelScene.zoomToSelection` the button runs. Instant; nothing is animated.

- **Where it happens.** `ModelScene.followChoice`, called by `ViewerTile` in
  one effect keyed on `[selection, matched]` and declared AFTER the filter and
  selection effects, so the scene holds both before it decides. No path asks
  for a frame; a change of choice is the request. (`ModelView.frameSeq` and its
  per-path counter are gone.)
- **What is framed** is the box the pivot is taken from (`pivotBox`, i.e.
  `pivotBounds`): the selection if there is one, otherwise the matched set.
  A set frames its ROBUST bounds, with the same outlier rule as the pivot, so a
  stray element in a class does not frame the class from a kilometre out. A
  selection OF a stray element still reaches it (its own box).
- **What moves nothing.** Clearing: an emptied selection (the lone row again,
  Escape), or the last chip removed. A `Vis kun / Uthev` toggle. A re-render at
  the same choice: `followChoice` remembers what it last saw, the selection by
  identity (every gesture is a new array, so the same element picked twice is
  two requests) and the set by members (its memo can rebuild unchanged).
- **A set change with a selection held** (a chip added or removed) frames the
  selection, since the selection is what the orbit is about.
- **Framed from the current angle.** `fitRadius` takes the view direction, and
  `frameBox` passes the turntable's own. Solved from the entry angle, an element
  framed after a few orbits reached 0.31 to 0.48 NDC instead of 0.88.
- **A hidden tile** (Typer or Materialer open) has a 1x1 viewport; a choice made
  there is held and framed on the resize that brings the tile back.
- An element with no mesh in the scene (budget capped, or no geometry) leaves
  the camera alone. The HUD already carries how much of the filter has geometry.
- `Zoom til valg` stays: with a selection it re-frames it (after an orbit or a
  wheel), with none it frames the whole model, outliers included.

### The object panel — everything the engine has, in IFC's own order

The band is full width and its four columns never needed all of it, so it
splits at the golden section (2026-09-23): the rows keep **61.8 %**, an object
panel takes the **38.2 %** on the right. The band's height rule is unchanged —
this costs table WIDTH, never rows — and the four columns were re-cut to
`23ch 22ch minmax(12ch,1fr) minmax(20ch,2fr)` so they still fit the narrowest
box the app ships in, the 1100 px skiplum.com iframe, without the list
acquiring a sideways scroll. GUID stays 23ch and is still never truncated; the
other three ellipsize by design and carry their full text in `title`.

**Since 2026-09-24 the split follows the rows** (`columnsFor` in
`TraceBand.tsx`): the class column is the longest class name, name and reason
share the rest in proportion to their longest text, and the list takes what
that needs, clamped to 50–61.8 %; the object panel gets the remainder (38.2 to
50 %). A class drill carries no reason, so the panel gets half and its lead
cards stop ellipsizing type names. GUID is 25ch: its 22 mono characters are
wider than 23 sans `ch` and ran into the class column. A row that carries a
reason is a finding of the open check or rule, so its reason is drawn in the
focal's verdict cell (fill + glyph), the same grammar as the row above it.

`src/ui/ObjectPanel.tsx`. Four instructions from edkjo fix its shape, and they
pull in one direction: *"keep psets and BIM data separate"* · *"I hate
opinionated viewers that hide data"* · *"reveal and express what the IFC is
saying to non-technical users"* · *"I'd treat the core IFC attributes as KPIs,
so an opinionated strong display vs getting drowned"*. So: **hierarchy, never
curation**. Nothing the engine holds is left out; what identifies the object is
displayed strongly and the rest is a calm list under it.

**Lead cards.** Five, in the board's own KPI vocabulary (micro gold label, big
mono value, cells of a line-coloured grid): IFC-klasse · Type · Navn · Etasje,
two up, then GlobalId full width. Every one of them is ALSO a row in the list
below — the cards are emphasis, not a subset. Each card carries its IFC term as
a dim third line, because that pairing is what teaches the standard over a
hundred selections.

**Four groups, in the order the standard is built:**

| group | IFC | what |
|---|---|---|
| **Attributter** | `IfcRoot` · `IfcObject` | GlobalId · IFC-klasse · Navn · ObjectType · Tag · PredefinedType, then the three `Pset_*Common` values the parser flattens onto the row (IsExternal · FireRating · LoadBearing), labelled with the set family they come from |
| **Relasjoner** | `IfcRelationship` | the objectified relations: Tomt (`IfcSite`) · Bygning · Etasje (`IfcRelContainedInSpatialStructure`) · Type + Typeobjekt (`IfcRelDefinesByType`) · Del av (`IfcRelAggregates` / `IfcRelNests`) · Åpninger and Åpning (`IfcRelVoidsElement`, both ends) · Materialer (`IfcRelAssociatesMaterial`) · `IfcMaterialLayerSet` · one row per classification SYSTEM (`IfcRelAssociatesClassification`) |
| **Egenskaper** | `IfcRelDefinesByProperties` | one TAB per `IfcPropertySet` and per `IfcElementQuantity`, plus the profile tab |
| **Beregnet** | — | what THIS TOOL measured. Separated and labelled, never mixed in |

**Classification is an ASSOCIATION, not added data.** By the standard it
arrives through `IfcRelAssociatesClassification`, the same mechanism as
material, so it sits in Relasjoner and not with the property sets. Each row is
one system and carries everything the reference holds — code · name · edition ·
location · publisher — with the instance/type flag as the dim note.

**Each row is a plain label with the IFC term under it.** "Etasje" over
`IfcRelContainedInSpatialStructure`, "Type" over `IfcRelDefinesByType`. Labels
only: no sentences, no help text, no prose in a tooltip. The plain labels come
from the app's own i18n (Etasje, Materialer, Egenskaper, Klassifikasjon,
Geometri, Trekanter were already there); "Del av", "Består av" and "Åpning" are
plain Norwegian rather than coinages, and where no term of art was confirmed the
IFC term IS the label (`IfcMaterialLayerSet`).

#### The property and quantity tabs

edkjo: *"I prefer each pset as a tab rather than a sorting group."* One tab per
`IfcPropertySet` and one per `IfcElementQuantity` (`Qto_*`, ifcfast's
`quantitiesJson()`, new on the profile as `quantities`. This note used to say
`CACHE_FORMAT` went to 3 for it; the code stayed at 2, so a format-2 record
could restore without quantities. Format 3 shipped with #5, see the wasm
section). The strip **scrolls sideways and never wraps**; a tab
is sized to its own name, so no label is ever cut.

Measured 2026-09-23 (`tmp/pset-census.mjs`), because "many psets" needed to be
a number: KNM_RIV's 6 818 property rows are **2 sets per element** — every
element carries `NONS_Process` and `RIV` and nothing else — so the strip does
not scroll there at all. The case that needs it is Void-demo **KNM_RIB**: 337
property rows and 10 quantity rows over 13 owners, **up to 14 sets on one
object**, 25 distinct set names, the longest
`Pset_ReinforcementBarPitchOfColumn` at 34 characters. Fourteen tabs at that
width are several times the 38.2 % panel, which is exactly why the strip
scrolls rather than wrapping or truncating. KNM_ARK carries both of its
property rows on `IfcProject`, so its elements show `ingen`.

- **Order marks standard from project** — `Pset_*` / `Qto_*` first, then the
  project's own sets after a gold rule in the strip. An ORDERING, never a
  filter: no set is hidden for having an unexpected name.
- **Occurrence vs type** is a real distinction in the standard, so ifcfast's own
  `source` (`instance` / `type`) rides each property row as its dim note, and
  the value type (`IfcLabel`, `IfcAreaMeasure`, …) sits under the property name.
- **The selected tab is remembered by NAME across selections**, so stepping down
  a list of walls keeps `Pset_WallCommon` open. A name the next element does not
  carry falls back to the first tab.
- **The profile tab states its own absence.** The wasm build exposes **no**
  `IfcProfileDef` accessor of any kind, so there is no honest profile drawing to
  make. The tab is present and reads `ikke levert`: leaving it out would say
  "this element has no profile", which is a claim about the FILE made out of a
  gap in the plumbing. A mesh-derived section was explicitly ruled out by edkjo
  — *"if there is a defined profile"* — so nothing is sliced to fabricate one.

#### Beregnet — derived, and kept apart

edkjo: *"let's add some analytical properties too: for instance what floor the
lowest point of the mesh sits in."* Every value here comes from
`src/engine/placement.ts` and `src/bcf/spaces.ts` — the SAME functions with the
SAME thresholds that `mesh-placement` and the BCF space split run, so a number
beside an element and the check's verdict on that element cannot disagree.
`placementContext` / `placementOf` were extracted from `checkMeshPlacement` for
this and the check now runs off them, so there is one hub, one cutoff, one
storey band and one tolerance in the codebase rather than two that agree today.
The extraction is behaviour-identical, checked rather than assumed: `check-cli`
on `KNM_Mottakskontroll/KNM_RIB` and on Void-demo `KNM_ARK` prints the same
counts, cutoffs and detail lines before and after it.

| row | from |
|---|---|
| Etasje etter geometri | `placementOf().expected` — the storey the mesh BOTTOM falls in, `STOREY_TOLERANCE_M` 0.1 m |
| Laveste punkt · Over etasjekote | mesh bottom, and its signed offset from the stated storey's elevation |
| Dimensjoner · Min · Maks · Senter | `collectBoxes` + `unshiftBoxes`, absolute world metres |
| Fra hovedmassen | `bulkHub` / `bulkOutliers` distance, with the cutoff as the note |
| Trekanter | the streamed `meta.tri`, with `begrenset` when the budget capped |
| Rom | `buildSpaceLocator().discreteSpace`, the BCF rule's own thresholds |

When a value cannot be computed the row says so in the engine's own words
(`storeyReason`: unit unresolved, elevations not distinguishable, the frames do
not overlap, or `far from the model`), never a blank that reads as zero.

Two drawings, both inline SVG, both from data the engine really has: the
**elevation strip** (the file's storey bands with the element's mesh extents
marked against them — what makes "its lowest point is on another floor" a
picture rather than a comparison of two numbers) and the **spatial path**
(`IfcSite → IfcBuilding → IfcBuildingStorey → element`, with a link the engine
cannot supply drawn dashed and empty rather than omitted).

#### Three absences, and three selection states

| | |
|---|---|
| `ikke levert` | the engine carries no such table at all. A fact about the plumbing — and the reason a category ifcfast does not expose still gets a section rather than being left out: a missing section reads as "the object has none". |
| `—` | nothing is selected. This surface's own dash for absent. |
| `ingen` | the selected object declares none. A fact about the FILE. |

**one** element shows its values; **several** (Shift or Ctrl down the band) show
the SHARED values, and a field they disagree on reads `Ulike verdier` with every
variant in the `title`; **none** shows the labels with `—`.

The data rides on `ModelProfile`, keyed by GlobalId, built in `profileOf`
(`src/storage/rehydrate.ts`) so the parse worker and the cache-restore worker
produce it from one function. The key set is NOT the product rows: a property
set sits on a site, a building, a storey or the project as readily as on a wall
— KNM_ARK carries both of its property rows on `IfcProject`, KNM_RIB 231 of its
337 on spatial elements — so joining onto `rows` would silently drop them.
`withTypeFacts` now also carries `layer_set`, the aggregation parent and both
ends of `IfcRelVoidsElement`; `profileOf` carries the storey's building, the
building and site rosters, the classification reference's full column set, and
the quantity table.

#### What ifcfast does NOT expose, per category

Chase these upstream rather than living with them silently:

| category | missing |
|---|---|
| attributes | `Description` and `OwnerHistory` on any entity — `ProductRow` carries neither column |
| relationships | `IfcRelFillsElement` (only `voids` is carried, opening → host) · element containment in a site, building or space (`contained_in` is storey-only) · building → site · `IfcRelAssignsToGroup` · `IfcRelConnects*` |
| profile | the whole `IfcProfileDef` family, and representation access of any kind — no accessor exists |
| quantities | the unit: `quantitiesJson()` gives `unit_step_id`, a STEP id with nothing to resolve it |
| properties | no unit per property either |
| materials | `IfcMaterialLayerSetUsage` DirectionSense and OffsetFromReferenceLine (the thicknesses DO arrive, per layer, in `materialsJson()`; the 1:20 section draws the file's `layer_index` order and cannot say which face is which) |
| placement | `ObjectPlacement`, and the core's `drift_distance_m` (row count only) |
| types | a type object's own property rows — ifcfast folds them onto the occurrences that inherit them |

## The orbit is the selection (2026-09-26)

edkjo: *"we always have to orbit selected objects."* Whenever something is
selected, the orbit centre is the selection's centre, and it stays there until
the selection changes or is cleared. Nothing else moves it: not a wheel, not a
pan, not a set chip, not the viewer moving between Kontroll and Graf. Since
2026-09-28 every selection is also FRAMED (see "Every selection is framed"
above); the pivot rule here is unchanged.

- **The pivot.** `ModelScene.updatePivot` takes the selection first
  (`pivotBounds`), and now records whether it did (`orbitsSelection`).
  `Turntable.setPivot` stores the centre and moves nothing. `probe()` reports
  `pivot`, `orbitsSelection` and `selection` so a gate can read all three.
- **The wheel, the one path that broke.** Measured before the fix
  (`pivot-gate.mjs` B2): the pivot itself stayed on the selection, but the
  dolly anchored on the CURSOR, so four ticks with the pointer away from the
  selection carried it 0.83 NDC across the screen, toward the edge or past the
  eye. The next drag still turned about it, just about a point the camera had
  been driven away from. Now, with a selection, `onWheel` anchors the dolly on
  the pivot: the eye slides along the eye to selection line and the selection
  keeps its screen place (5e-16 NDC). With nothing selected the cursor rule is
  unchanged (B14). A zoom never touches `pivot`; the lerp moves the look-at
  `target`.
- **Every other path already held**, and the gate now says so rather than
  assuming it: canvas pick, pan, treemap cell, requirement, Scope row, Shift
  second click (drops only that element, the orbit returns to the rest), the
  lone row again (clears, and the pivot lets go), a chip's ✕, Kontroll to
  Graf with the viewer windowed and main, a graph pick in both layouts, and
  Graf back to Kontroll. The lent canvas is the same `ModelScene`, and
  `resize` never touches the pivot.

`scripts/pivot-gate.mjs` phase 2 (B1 to B16) drives each path with real CDP
events on `#design=a` against `dist/` and asserts off the live scene per path:
F the selection is FRAMED (its projected box within `FIT_FRACTION` of every
viewport edge and filling it, and the look-at target on the pivot, which only
`frameBox` leaves behind), P the pivot IS the selection's centre, and O a real
left-drag moves the eye while the selection's centre stays put on screen
(< 1e-3 NDC). Clearing (the lone row again, Escape, the last chip) is asserted
not to move the eye; B15 (treemap cell, nothing selected) and B16 (Typer card,
viewer hidden) frame the set. Phase 1 assertion 10: a dolly toward the pivot
keeps it fixed.

Measured 2026-09-28 on KNM_RIB against a local `vite preview` of the build (not
the deployed site): every framed selection reached 0.75 to 0.82 NDC except B8
(0.55, a steep polar angle), all 16 paths pass.

```bash
npm run build && node scripts/pivot-gate.mjs /c/workspace/skiplum/client-projects/10016-kistefos/underprosjekter/KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc
node scripts/pivot-gate.mjs model.ifc --no-browser     # arithmetic only
```

Run on `KNM_Mottakskontroll/02_arbeid/KNM_RIB.ifc`: the Void-demo exports fail
phase 1 assertion 6, which is pre-existing and unrelated (their stray element is
476 m out, not the hundred bulk widths the assertion expects).

## The band opens on a SELECTION (2026-09-23)

(The design alternatives do not do this since 2026-09-25: their Detail panel
shows the selection itself, so a selection never re-targets their Scope. See
"Round two".)

edkjo: *"where is the properties panel?"* The object panel lived only inside the
derivation band, and the band only opened when a NUMBER was clicked, so
selecting an element in the 3D tile showed nothing at all.

**The rule, exactly as implemented** (`App.tsx`, one effect over
`cross.views`):

> A model's selection opens the band on that model, on an `element` focus naming
> the selected GUIDs, WHEN no derivation is open for that model **or** when the
> one that is open is that model's own `element` focus. A real drill — a check,
> rule, class, type, storey, cell or KPI — is never re-targeted by a selection.
> An emptied selection closes the band only when what is open is that element
> focus.

So clicking down a list of findings keeps the list, a canvas pick with nothing
open opens the panel on what was picked, and a canvas pick while an element view
is open re-targets it.

- `Focus` gains `{ kind: "element", guids }`, serialised `element:<g>+<g>`, so
  the selection rides the URL hash like every other derivation and Back walks
  it. `buildTrace` lists those rows.
- **Superseded 2026-09-28 (one origin):** a canvas pick now makes the 3D the
  filter's origin. The 3D keeps the whole model and highlights the pick (so
  the tile still shows what the pointer was over); every other view isolates
  to it. See "Clicking: one filter, one origin".
- **Opening the band frames nothing by itself.** The camera follows the
  selection (`followChoice`), not the band.
- The effect is driven off the SELECTION rather than off each call site, so
  every path reaches it — canvas pick, band row, Escape, a shift-click that
  grows the set. A ref holds the last selection it acted on, so the hash change
  it makes does not re-enter; on the FIRST pass it only records, and a hash
  restored with an `element` focus puts its selection back instead of being
  closed by an effect that has seen nothing yet.

## Zoom: the window, not the step (2026-09-23)

edkjo on the deployed site: *"we get zoom saturated hard"*.

**Diagnosis, measured** on KNM_ARK (`KNM_Void-demo/export_2026-09-14`, 1 696
products) at 2112×1267 through `scripts/zoom-gate.mjs`, with real CDP
`mouseWheel` events and the pose read off `ModelScene.probe`:

- **the wheel STEP was never the problem.** `deltaY` 100 →
  `exp(-100 × 0.0016)` = **0.8521 per tick in**, 1.1735 out, and the gate
  measures exactly that on every tick of a six-tick run.
- **zoom-to-cursor is exact**, and always was. `zoom()` lerps the target toward
  the focus by `1 − after/before`, which works out to
  `eye' = k·eye + (1−k)·focus`: the eye slides along the eye→focus line and the
  view direction never changes, so every point on that line keeps its screen
  position. (A first version of the assertion tracked the NDC bounding box's
  centre and "failed" at 0.14 NDC — that was the measurement, not the camera:
  which corner of a box is extreme changes with perspective. `ModelScene.project`
  exists so the gate can follow a real world point instead.)
- **the RADIUS WINDOW was the fault.** `Turntable.setExtent` derives it from the
  MODEL: `[extent × 0.002, extent × 50]`. On KNM_ARK that is **0.3584 m to
  8 961 m** around a 259.91 m entry radius. A camera framed on ONE element can
  land outside it at either end, and the old `zoom()` clamped to `[min, max]`
  unconditionally:
  - **below the floor** — framing a small element puts the radius under
    0.3584 m, so the next tick IN clamped UP: a zoom-in answered with a jump
    outward, and every tick after it refused (`after === before` → early
    return). The wheel went dead with the picture in the wrong place.
  - **above the ceiling** — `zoomToSelection` on a stray element (the
    Mottakskontroll KNM_RIB beams, ±31 847 402 m) computes a fit radius far past
    8 961 m, `apply()` clamped it back, and the camera was left somewhere that
    showed nothing and could not zoom out either. This is the
    "zoomToSelection cannot reach the outlier beams (radius clamp)" note, and it
    was real.

**Two changes, both in `src/viewer/camera.ts`:**

1. **`Turntable.allow(radius)`** — every explicit frame widens the window around
   what it framed: down to `radius × 0.02`, out to `radius × 4`. Limits only
   ever widen; a frame grants reach, it never takes it away. `frameBox`
   (`scene.ts`) calls it BEFORE writing the radius, or `apply` would clamp the
   frame straight back. Measured: framing an `IfcWall` at 12.42 m lowers the
   floor from 0.3584 m to **0.2485 m**, so the wheel has somewhere to go.
2. **The stops ABSORB, they never reflect.** `zoom()` clamps to
   `[min(minRadius, before), max(maxRadius, before)]`, so a camera already
   outside the window can always move away from the stop, and a tick into it is
   a no-op rather than a jump.

`setExtent` is unchanged and the model-wide view behaves exactly as before: the
entry fit already sits inside the window, so `allow` at the entry radius widens
nothing. Near and far are also untouched (`radius / 2000` and `radius × 50`, the
~100 000 : 1 the viewer has always run): they are a depth-precision question,
not the saturation, and the gate prints both on every run so a claim about them
can be made from numbers.

### `scripts/zoom-gate.mjs`

Real CDP `mouseWheel` against a production build in headless Chrome. Asserts, on
KNM_ARK: the entry radius sits inside the window · a band row frames an element
closer than the model AND inside the window · six ticks in are strictly
decreasing at the predicted step, and a fixed world point under the cursor stays
under the cursor (< 0.02 NDC) · 60 ticks in never once raise the radius (the
absorbing-stop rule — the old clamp failed this on the first tick from a small
framed element) · the way out is monotone and REACHES the whole-model view in a
number of ticks a hand can turn. Then, on the Mottakskontroll KNM_RIB, that
framing a `far-from-model` element reaches it (its box projects inside the
viewport), that the frame is under the ceiling, and that the wheel still moves
the radius out there.

Measured 2026-09-23 on `npm run build` + `vite preview`: model radius 259.91 m,
window 0.3584 – 8 961 m, near 0.130 m far 13 000 m; framed wall 12.4247 m with
the window floor dropped to 0.2485 m; zoom in 12.4247 → 4.7573 m over six ticks
at 0.8521 each; the floor reached at about tick 25 and held for the remaining 35
ticks without ever rising; 44 ticks from the floor back to 283.63 m, past the
259.91 m model view.

```bash
npm run build && node scripts/zoom-gate.mjs        # or --url <deployed>
```

### `scripts/xfilter-gate.mjs` (2026-09-28)

The one-origin cross-filter, three real clicks on HI90_ARK: a treemap cell
(Oversikt), a storey node (Graf), a type card (Typer). After each: one filter
with that origin; the origin keeps all its items (14 cells, 12 storeys, 200
cards) with the chosen one marked and the rest dimmed; the 3D draws exactly
the filter's elements with geometry (`drawnElements()` = the HUD's shown);
and the filter is the new click's WHOLE set (storey 402, not its 128 in the
cell; type 334, not its 128 on the storey). Local preview build, mechanism
only.

```bash
npm run build && node scripts/xfilter-gate.mjs [--model PATH]
```

Verified 2026-09-28: all assertions hold (first run caught the type card
carrying the isolated card's guids, which intersected; fixed).

### `scripts/isolate-gate.mjs`

**Stale since 2026-09-28:** it asserts the chip model (a canvas click makes
no chip, an element chip beside the class chip, `Tøm filter`). Not updated
with the one-origin change; `xfilter-gate.mjs` asserts the new rule.

Real CDP mouse events against a real model in headless Chrome — a synthetic
`click()` on a React handler would prove the handler, not the gesture.
Assertions: the whole model · a class row isolates (the bar reads the class's
own count, the HUD narrows) and the object panel opens in its empty state,
its pset and classification sections carrying the no-selection dash · the
class set is framed about its own centre · the same row restores, and the
camera does not move (clearing moves nothing) · a band row is one element ·
**that row FRAMED it** — the eye moved,
the element's box projects inside the viewport, and it fills the frame, so
"contains it from a mile away" fails · the object panel names that element and
carries every attribute row · the same band row steps back to the set · a
canvas click selects, makes no chip and **frames the pick** ·
`Tøm filter` · the object panel's four groups and its three absences told apart
on a selected element (a Uniformat value, the pset group reading `ingen` rather
than `ikke levert`, and the profile tab reading `ikke levert` because the ENGINE
does not carry it) · a SELECTION opening the band, and a tab switch keeping the
selection · a storey row on the Etasjer tile · and, with three models and
`tests/fixtures/private/knm-floors.test.ruleset.json`, that only the own column of the matrix
is a door and the other two panels do not move.

The camera assertions read the pose off the live scene: `ViewerTile` registers
its instances on `window.__ifcCheckScenes` in mount order, and the gate calls
`ModelScene.probe(guids)` — read-only, returning eye, target, radius and the
NDC box of those elements under the current camera. The projection is therefore
the shipped arithmetic; no copy of it lives in the gate, the same rule
`pivot-gate.mjs` follows. There is no honest way to recover a camera pose from
rendered pixels.

```bash
npm run build && node scripts/isolate-gate.mjs        # or --url <deployed>
node scripts/isolate-gate.mjs --url http://localhost:5174/   # vite dev
```

Verified 2026-09-23 on KNM_Void-demo `export_2026-09-14` (ARK alone, then
ARK+RIV+RIB with the test floor config), **all assertions passing against
`npm run build` + `vite preview`** — the production bundle, not a dev server.
The framing numbers that run measured, on the first `IfcWall` of the class
drill: the eye moved 0.967 of its radius and the element's box came out
1.40 of 2 NDC across.

## BCF export

The app bar's `BCF` control writes one BCF 2.1 archive for every loaded model
(`src/bcf/`). Fields: max GUIDs per issue (default 500, Dalux's limit) and
author (remembered per viewer in localStorage). Nothing is downloaded unless
every document validates against buildingSMART's BCF 2.1 XSDs, vendored
byte-identical in `vendor/bcf-schema/`.

- **Topics:** only state `fail`, fundamentals and ruleset rules alike. One per
  model × check × STATED storey (`storey_guid`; a finding on a storey is that
  storey's; no storey is its own group, last). A group over the max is split by
  IfcSpace when a loaded model carries spaces (itself first, else the one
  sharing most storey names): one bucket per room for the DISCRETE elements in
  it, and one storey bucket (first) for everything else, massing and anything
  in no room alike. Any bucket still over the max is cut into `(i/n)` parts.
  Title `check · storey [· space] [(i/n)]`; storey and space are also
  `Labels`. There is no "Uten rom" bucket: an element that is not a room's
  discrete object is the storey's. Ordered by storey elevation. Copy-object
  exclusions never appear. Topic GUID = uuid v5 over cache_key, check, storey
  GlobalId, space GlobalId (or `-`) and part, so a re-export is stable; the
  storey bucket seeds like an unsplit group.
- **Discrete vs massing is geometric** (`spaces.ts`, no IFC class list). The
  wasm graph has no space containment or space boundaries, so everything is
  tested against each space's triangle mesh (upward-ray parity, box
  prefilter, smallest space wins) in absolute metres, which is why the space
  model can be another file. An element is discrete in space S when (1) its
  mesh-box centre is in S, (2) at least 0.5 of a 5×5×5 lattice over its mesh
  box is in S, (3) no lattice point is in another space, and (4) its box
  height is at most 0.9 × S's. Measured on HI90 ARK+RIE (140 spaces,
  2026-09-21), elements with centre in a space: height ratio ≤ 0.77 for every
  terminal, appliance, alarm and furnishing, ≥ 1.10 for every wall, lining
  (IfcCovering) and opening; inside fraction ≥ 0.60 for every terminal (0.60
  = a wall-mounted box half in the wall), ≤ 0.40 for openings. (3) moves the
  HI90 glass partitions, exported as IfcFurnishingElement, to the storey:
  they span rooms. Residue: thin slabs (2-5 cm) and small
  IfcBuildingElementParts lying wholly in a room pass as discrete (9 of 250
  massing-class elements with centre in a space). An IfcSpace fails (4)
  against itself, so spaces are the storey's. Space label = Name, else its
  GlobalId (LongName has no accessor). KNM Mottakskontroll and Void-demo carry
  no IfcSpace, so there the split is parts only.
- **Camera:** framed like zoom-to-selection (`robustBounds` + `fitRadius` at the
  entry pose, 1024×768, fov 45), then IFC = (vx, −vz, vy) + stream shift. No
  camera or snapshot on a capped model or a chunk with no geometry.
- **Snapshot:** a hidden `ModelScene` renders the chunk under a highlight filter
  with the selection overlay (`ModelScene.snapshot`).

Verified 2026-09-21 on KNM (Mottakskontroll RIB; Void-demo ARK+RIV+RIB) and
HI90 (ARK+RIE, Dalux export 18 Sep, the space path): every document XSD-valid under xmllint-wasm
and Python `xmlschema`; bcf-client 0.8.5 parses every archive; every selected
element with an ifcopenshell world-coordinate mesh projects inside its topic's
exported camera, except elements the framing leaves out as far outliers. The
browser export was driven in headless Chrome against a LOCAL preview build and
its viewpoints are byte-identical to `bcf-cli.ts`. Dalux and Solibri import
are NOT verified. Discrete split (same day, `bcf-cli.ts` only, not re-driven
in the browser): HI90 topics 285 → 89 at N=500 and 461 → 259 at N=100; KNM
unchanged, same GUIDs.

## Graf: the model as a space you drill into (2026-09-25)

History: *"showing the full edge graph is totally ok to do"*, *"it should be
its own tabbed view"*, *"the graph for instance needs to be cool and smooth"*
(2026-09-23). Then, 2026-09-25: *"we built a demo here a few months ago using
ifcfast. It had a way better graph UI than this"* (`sidehustles/ifc-fast-demo`,
`components/drill-graph.tsx`), and on the flat SVG drawing: *"very boring
looking. square nodes and flat UI. make it feel more like a space with
information. Neural network."* And: *"lets add the viewer here as well like in
IFCfast site … toggle between model and graph as main and the other windowed"*.

Files: `GraphTab.tsx` (React, gestures, frame loop), `graph-model.ts` (what is
drawn, pure), `graph-sim.ts` (physics), `graph-paint.ts` (palette, sprites),
`viewer/dock.ts` (lending the viewer).

**The drill (the demo's).** Opens at the crown (building, storeys with their
element counts, the no-storey bucket, the site roster). Click a storey: it opens
into class buckets AND becomes THE filter (Etasje, replacing whatever was on).
Click a bucket: it opens into its products (cap 400, then `+N`) and storey ×
class becomes the filter (Celle). Click a product: it becomes the filter and
the selection; Shift or Ctrl adds within the graph. As the origin the graph
keeps every node, the chosen one ringed; a filter from any other view draws
only the matching storeys, buckets and products (2026-09-28). Click the empty field:
the selection clears. `Tøm alle` folds every drill. A selection made elsewhere
(the 3D, a table) drills to where it lives. Drag a node and it stays put; drag
the field to pan; the wheel zooms about the pointer.

**Kept from the earlier ifc-check graph:** the selected element's relationships
bloom out of its node (type and siblings, parent and parts, openings and host,
materials, classifications, property and quantity sets, each behind its
switch), every edge an `IfcRel*` the engine carries, the lit edges named with
it; `ikke levert` as ONE node for an absent table; building → site, element
containment outside a storey and `IfcProject` are not drawn because the engine
does not carry them; no randomness (FNV seeded starts, fixed step); positions
carry across rebuilds, so a new node is born at the node it grows from.

**The look.** Canvas 2D on a dark field: round glowing nodes sized by weight
(a storey by its count, a bucket by its members), class colours on one cool
ramp sorted by name (the demo's `stableEntityPalette`), verdict colour on a
product with findings (Avvik red, Advarsel amber, with an opacity floor) and a
verdict ring on a storey or bucket that holds them, luminous threads that fade
with length and depth, a z per node (far is smaller, dimmer, softer), parallax
against the pointer, ambient drift, and a selection that lights its
neighbourhood with pulses running outward while the rest sinks back. Labels:
the crown always, buckets once there is room, the focus, and a tip on hover.
Reduced motion: no drift, no pulses, the loop stops once settled.

**Physics** are the demo's d3-force settings written out (charge −120 with a
reach of 240 through a uniform grid, link strength 0.5, collide r + 4, alpha
decay 0.045, velocity decay 0.4) plus a weak centre pull for what no edge
holds. Measured locally (node): 5 ms per tick at 2000 nodes. Headless Chrome:
~80 fps with 580 nodes drawn.

**The 3D beside it.** `Modell | Graf` picks the main surface; the other sits
in a window at the top right (top, because the derivation band covers the
bottom). The board's own scene is LENT, not duplicated: `ViewerTile` registers
its canvas under the model's mesh batches (`dock.ts`), the tab moves the canvas
into its slot and sizes the scene there, and hands it back when the tab hides.
One GPU copy, one selection. No viewer on the board (no mesh), no toggle.

**Probe for scripts:** `window.__ifcCheckGraphs[i]()` returns every node's id,
kind, label, count and last drawn canvas position. Read only.

## Typer and Materialer tabs (2026-09-25)

edkjo: *"I also want a tab for type extraction and a materials extraction tab.
ifcfast."* Ports of the demo's Types and Materials views
(`components/views/types-view.tsx`, `materials-view.tsx`), one model per panel.

- **Typer** (`TypesTab.tsx`): IFC class × type name, instances, IsExternal and
  LoadBearing as true · false · unset. A row is a Type chip. Openings are left
  out, as everywhere else on the board.
- **Materialer** (`MaterialsTab.tsx`): material names (the engine's
  `ProductRowLite.materials`) with their classes and element count, a row makes
  a `material` chip; and Layer sets from `materialsJson()` layer rows
  (`profile.materialRows`), layers and thickness.

Not exposed by the wasm engine, shown as absent: m³ and m² per type (the demo
summed ifcfast's meshed take-off; `qtoJson()` is not read here), and
`IfcMaterialLayerSet.Name` (`layer_set` is null on every HI90_ARK product), so a
layer set row is its layer stack and the header says `ikke levert`.

**Galleries, not rows (2026-09-26).** Owner: *"the types and materials tabs
need to be galleries, not rows."* Both tabs are card galleries on the module
grid (`Gallery.tsx`: rule-6 columns on the gallery's own width, uniform cards
since a gallery is one collection, columns trimmed to whole cards and
centred, overflow scrolls inside the tab; floating cards, `.gallery-card`).
Every card is S 2×2 (types, materials, layer sets); the tab fills the window to its 24 px foot. Sorted by count as
before; a click does what the row did (Type chip, material chip).

- **Type card**: a render of a representative element (the MEDIAN by
  triangles among the type's instances with geometry), class, type name,
  instances, IsExternal and LoadBearing. Renders come from
  `viewer/thumbnails.ts`: one shared offscreen WebGL context for all
  thumbnails, one element's triangles per render read from the streamed
  batches (positions a view, only that element's indices copied), rendered
  once at 320×200, kept as a webp data URL per (batches, type), geometry
  disposed at once. Lazy (a card asks when it nears view), three renders a
  frame. Never a second copy of the model. A type with no streamed geometry
  shows the dashed cube (sprucelab's placeholder), never a stand-in.
- **Material card**: a NEUTRAL swatch, since the engine gives no
  IfcMaterial surface colour (the mesh colour is per product and falls back
  to a class palette), name, classes, element count.
- **Layer set card**: the layers as one strip in proportion to their
  thickness (a layer without one is hatched at an equal share), count, layer
  count and total, then each layer's thickness and material.

### The layer section, 1:20 (2026-09-28)

Owner: *"a view that shows the material layer and thickness. A sandwich
component essentially. 1:20"*, scoped to *"make [the strip] a bit more
apparent"*. Geometry in `src/ui/layer-section.ts` (pure, selftested):
`PX_PER_MM` = 96/25.4/20 = **0.1890 px per mm**, fixed, so two sections
compare by eye; too thick for its tile, the section scrolls, never rescales.

- **Type page**: its own tile (`layers` in `pageLayout`, top of the widest
  column, only when the type has a layer stack), the most used stack cut as a
  600 mm piece: walls stand (layers left to right), slabs and roofs lie. Break
  lines at the open ends, a dimension chain with a tick per face and the
  total, a leader per layer with its mm and material, a 0 to 500 mm scale bar
  and `1:20`. The identity tile no longer repeats the list.
- **Cards** (Materialer layer sets, the sets under the Typer viewer): the
  strip is taller, still proportional, mm on a layer wide enough, a swatch
  per layer row. No card click was added; the click still selects.
- **Colour and hatch** by the material NAME only where it maps clearly
  (`materialCategory`: isolasjon, betong, gips, tre, mur, metall, folie,
  luft); anything else is `other`, a stable categorical colour per name and
  no hatch. A layer with no thickness is 8 px of the `ikke levert` hatch and
  the total is unknown, never 0.
- **Direction**: `layer_index` order as the file gives it. DirectionSense is
  not exposed by the wasm engine (see the table under the object panel).

### Type instances and what goes with what (2026-09-28)

edkjo: *"for the types and materials to show what goes with what. For types:
Single instance selector like in lca_qto, with a toggle for all instances of
type. So either see them one by one with a navigation "next/former" or see
all."*

**Reference mirrored:** the G55 QTO-LCA type viewer,
`skiplum/client-projects/10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/verify_app.html`
(worklog `2026-06-17-22-40_edkjo-type-viewer-show-all-instances-toggle.md`):
`Per forekomst | Alle forekomster`, ‹ › titled `Forrige (↑)` / `Neste (↓)`,
↑ ↓ step the instances, ← → the types, Esc closes. Labels verbatim (`inst.*`).

- **Instance mode**: first built as a card that grew in place to XL with the
  3D inside. Owner, same day: *"this doesnt work. Open a full page type view on
  doubleclick rather than this inline card viewer."* Replaced, see below.
- **Order:** by storey, lowest elevation first, storeys without elevation
  after, elements in no storey last; then GlobalId, plain string order.
- **Links** (`type-links.ts`, pure, `catalogue(profile)`, once per profile in
  `ModelPanel`): a product belongs to one type card (`entity::typeName`, the
  Typer grouping; the card carries its `type_guid`s), names its materials
  (`ProductRowLite.materials`, from `graph.materials`) and has its layer rows
  (`materialsJson()`). Type ↔ material and layer set → type are the union over
  the products, each link counted in elements. A class's untyped elements are
  the card `entity::` and link under the class name.
- **Drawn as chips** (`LinkChip`): the type view lists its materials, a
  material card its types, a layer set card its types. A chip switches tab and
  opens the type view / marks (`data-revealed`) the material card.
  `GalleryCard` is a `div role=button`, since a card holds doors of its own.

**The viewer beside the gallery, the type view (2026-09-28).** Owner: *"you
didnt add a viewer to my types and materials dash"*, then the double-click
ask above.

- **Both tabs** (`BoardViewer.tsx`, `WithViewer`): the board's ONE scene sits
  permanently right of the gallery, lent through `dock.ts` as Graf lends it
  (no second copy). The tab's grid is rule 6 on the tab body with the
  gallery's 16 px padding as margin, so the gallery (its own rule-6 pass on
  the narrower width) lands on the same module. The viewer is XL, 8 × 5 when
  that leaves a card column, else 6 × 4 (smaller canon sizes only on a tab too
  short for XL). The gallery scrolls in its own area; the tab fills to the
  window foot, no page scroll.
- **Click** a type card: its instances are selected. A material card or a
  layer set card: the elements using it (`LayerSetCard.guids`, new). The
  viewer frames and pivots on it as on every selection. The card stays marked
  until the selection clears. The Type chip and material chip the cards used
  to make are gone from these tabs (the click is a selection now).
- **Double-click** a type card: the TYPE VIEW covers the tab (absolute over
  the tab section, not a modal), on the tab's grid: the lent 3D as the XL hero
  (one M column kept beside it from 9 columns, else the tiles go under), then
  three M tiles: the navigator (Per forekomst / Alle forekomster, ‹ › Forrige
  (↑) / Neste (↓), `n / N`) with Navn · GlobalId · Etasje of the current
  instance; the type's facts (class, name, count, type GlobalId, IsExternal,
  LoadBearing); its materials as chips. ↑ ↓ step instances, ← → step types.
  ‹ (titled `Lukk (Esc)`) or Esc returns; the gallery stays mounted under the
  view, so its scroll is kept. Opening selects the first instance.
- **dock.ts `lend(dock, slot)`** now hands the canvas home only while it is
  still in that slot, so two surfaces trading it (Graf to Typer, gallery to
  type view) cannot pull it out of the one that just took it. GraphTab uses it.

Verified: tsc, selftest, `vite build`. The isolate-gate T phase opens the
view by a double-click now (`dblClickAt`); NOT re-run. Not seen live.

**Click filters, double-click is a page (2026-09-28, third round).** Owner:
*"the behaviour when doubleclicking a type is open a type page"*,
*"One type - doubleclick - shows that one type with a viewer"*, *"the viewer
of course needs to filter on the type. Currently it does not"*. The two rounds above
only SELECTED, which highlights and hides nothing.

- **Click** a type card: the type's instances become THE filter (origin
  `types`; since 2026-09-28 it replaces every other filter, nothing ANDs).
  The gallery keeps every card, the chosen one marked and the rest dimmed;
  the viewer beside it draws only that type's instances, framed. The same
  card again or the ✕ clears it. The second click of a double-click is
  ignored.
- **Double-click**: `#…&tab=types&type=<key>` (`useHashView` key `type`,
  pushed; ← → between types replace it). The route drives the page, so a
  pasted link opens it once the catalogue has the key, and Back/Forward walk
  it. The page covers the tab; the gallery stays mounted `invisible` under it
  (scroll kept). Entering saves the gallery's chips, selection and mode (as
  they were BEFORE the double-click's first click) and sets the chips to that
  one type; the current instance (or all) is the selection. ‹, Esc (history
  back when the gallery opened it) or Back restores the saved state. A tab
  switch clears `type`. A material's type link opens the page.
- `ModelScene.drawnElements()` (read-only) counts the distinct elements the
  scene draws, for gates. (`cross.setChips` is gone with the chips; the page
  sets the one filter with a `set` action.)

Verified: tsc, selftest, `vite build`, `isolate-gate --only types` on
HI90_ARK (IfcWallStandardCase "Betong 96", 58 instances): a click draws 58 of
2875 and stays on the gallery; the same card again draws 2875; a double-click
puts the key in the hash, hides the gallery, the page draws 58; T1 to T5 as
before; Esc returns to the gallery with no `type` and 2875 drawn. Local
headless preview only, not on a deployed site.

Verified: selftest (order across storeys and no storey, type → materials,
material → types with an untyped class, layer set → types, type_guid per
card). `isolate-gate --only types` (phase T, also run at the end of a full
run), first run on HI90_ARK (IfcPlate "System Panel:Glassfelt 25mm", 56
instances): open, one selected, the 3D lent into the card, Neste changes the
GlobalId and the selection, ↑ ↓ step, Alle forekomster selects 56, Per
forekomst returns, the material link lands on Glass which links back
(7 types), the type link reopens the type. Two assertions failed on that run
(a regex escape in the gate's counter check; Esc after a cross-tab link, focus
left on the hidden tab); both fixed, not re-run. Local headless run only; not
seen on a deployed site. No screenshots taken.

### The type page, type first (2026-09-28, fourth round)

Owner: *"remember to isolate the per instance view, and also build a proper
type page, not this stripped down naked thing … almost all properties are
type properties. We want to know type properties, and also what distribution
the instances of the type has for instance properties: MMI, QTO, IsReference
etc"*, *"and what instances there are. GUID etc"*, *"see my QTO_LCA type view
for inspiration"*.

- **Isolation.** Per forekomst sets the one filter to the current instance
  (origin `typepage`), so the viewer draws ONE element, framed; ‹ › ↑ ↓ and
  a list row re-isolate. Alle forekomster: the type's instances. A
  requirement / IDS line leaves for its Scope (`onScope`: `focus` plus the
  tab, `std` and IDS to Prosjekt, the rest to Kontroll) with ONE filter,
  that line's findings among the type's instances; the saved gallery state
  is dropped.
- **Data** (`src/ui/type-page.ts`, pure, selftest): identity (class, the type
  object's class via `typeObjectClass`, type GlobalIds, PredefinedType and
  ObjectType over the instances, classification refs with the bundled list
  name, the system/function lines, layer stacks, Diskret/Sammensatt);
  properties folded from the type (`source: "type"`) and the instances' own,
  per (set, name): filled / blank / not carried, values with counts, the
  typical value, `disagree` when a property the type should settle has two or
  more values. Not flagged (`perInstance`): the progress-code and copy-object
  sources, `Pset_*Common.Status` and the phase layer's sources, and a
  property whose every value is the instance's own storey name (ARK's `BIM
  Data.Etasje`). Required marks: every (`propertySet`, `baseName`/`name`)
  pair in the enabled rules and the project layer, matched by
  `pset-inventory`'s `nameMatches`. The MMI and Kopiobjekt readings are
  `board.values` (the rule's own reading) over the type. Storeys, model. QTO
  per Volum / Areal / Lengde: Σ, min, median, max and the Qto / computed /
  missing / pending split. Requirements: `requirements(board.rows)` plus any
  other row with a finding on the type, failed = the type's instances among
  `funn`; IDS: failing instances (a finding on the type object counts every
  instance). The instance rows: GlobalId, name, storey, model, MMI, copy,
  status (Pset_*Common.Status, then the phase sources), quantities.
- **Absent, with the reason, never empty**: `untyped`, `table-absent`,
  `type-rows-on-occurrences` (the engine limit under "Pset inventory":
  HI90_ARK has 0 type-folded rows, so every type there shows it),
  `quantities-not-received`.
- **Quantities** come from the measure worker: `MeasureState.elements()`
  (`[v, src, a, src, l, src]` per product, the treemaps' resolution) rides on
  the first `measured` answer and on completion, into
  `ModelEntry.elementQuantities`. Length is new: `qtoLengths`, the
  BaseQuantity `Length` only, scaled by the quantity's own LENGTHUNIT
  (`quantityUnits` now reads LENGTHUNIT too; every HI90_ARK quantity names
  its own unit, #17 = mm) or the project's, else `summary.unit_scale`.
- **Layout** (`TypePage.tsx`, `pageLayout`): the head line is the G55
  `galhead` plus `innernav` (types `n / N`, ← →, Per forekomst / Alle
  forekomster, ‹ n / N ›, the instance's Navn · GlobalId · Etasje). On the tab
  grid: viewer 8 × 5 (6 × 4 under 16 columns), `Instanser (N)` under it, then
  columns beside it (right ≥ 14: 4 | rest | 4; ≥ 8: 4 | rest), each tile the
  rows its content wants, the leftover to the heaviest, shrinking heaviest
  first to 1 : 2 and scrolling inside. At 2112 × 1267: 18 × 9, tiles 8x4 4x3
  4x2 6x6 4x2 4x2 6x3, no page scroll. The current instance is a `Forekomst`
  column in the property and QTO tables, red where it differs from the
  type's typical value (2026-06-12 canon: comparison lined up).
- **G55 carried over**: labels verbatim (`Type / navn`, `Diskret /
  sammensatt`, `Materialsammensetning · N materiallag`, `Volum · Areal ·
  Lengde · Antall`, `Mengde i QTO`, `Instanser (N)`, `Verdi`), the MMI chips
  with counts, the instance table per GUID with row ↔ 3D ↔ ↑ ↓. Not carried:
  the editing (corrections, weights, comments, dedup, logs).
- **Gallery**: each card carries `System` and `Funksjon` (`typeCodes`,
  type-links.ts, off the board's code trees: the code and list name, or the
  fallback in italics: type object class / PredefinedType; the majority value
  and `+n` other values). Under the viewer, the filtered type's material and
  layer set cards (`MaterialCardView`, `SetCardView`, exported from
  MaterialsTab; `WithViewer`'s `under`), a click selects as on Materialer.
  The header's `m³ · m² ikke levert` is gone: the page has the quantities.

Verified: tsc; selftest (160, type page, type codes, lengths); `vite build`;
`isolate-gate --only types --model HI90_ARK --ruleset
tests/fixtures/private/hi90-project-layer.test.ruleset.json` (IfcWallStandardCase "Betong
96", 58): the page draws 1, Neste draws 1, Alle forekomster draws 58, the
list has 58 rows, all T assertions hold. Screenshot `tmp/type-page/`. Local
headless preview only, not on a deployed site.

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
- **Exactly one focal**; P0/P1 never below the fold; air is the gutter and
  empty structural tracks only. The upstream "exactly one 5×3 gauge" rule is
  REMOVED here (local deviation, `validateBentoLayout`): edkjo 2026-09-25,
  spatial structure is one compact tile, not a gauge block (below).
- `validateBentoLayout` runs at render — dev throws with every fault at once,
  prod renders an error tile in the offending slot. Never a silent reflow.

Two deviations from upstream, both in the kind→span registry and both named at
the entry in `bento-spec.ts`: `tellTales` takes the focal spans (the
verification block is this board's focal) and `viewer` takes 5×5 (no upstream
viewer span meets the kind's own aspect bound). The former `matrix` full-band
deviation is reverted: the census left the board for the Innhold tab
(2026-09-21), and `matrix` is back to upstream's 8×5 / 13×8.

Tab-1 layouts (2026-09-25): 13 tracks × 9 rows (`verify` 8×5 | `viewer` 5×5;
`floors` 8×3 | `spatial` 5×3; the quiet `kpis` 13×1 last, P2) and 21 tracks ×
6 rows (`floors` 8×3 over `classes` 5×2 | `spatial` 3×2, then `viewer` 5×5
and `verify` 8×5 from row 1, `kpis` 21×1 across row 6).

**Romlig struktur is not a block** (edkjo 2026-09-25): *"this does not deserve
this much space"*; with everything present the four lamps tell one fact. And
the shape rule that came with it: wide/short and narrow/tall tiles are avoided
unless the component itself is supposed to be that (a timeline, an elevation
strip), so the lamps do not become a one-row band either. On 21 tracks they
are a compact 3×2 gauge (~1.3 : 1 rendered). The freed cells went to
`classes` (3×3 → 5×2) and the row-unit ceiling: with the class tile off 3×3
the ceiling is the viewer's 1.11, so every tile, the focal and Etasjer
included, grows 11 % taller into the band (514 → 454 px at 2112 × 1267). An
exhaustive search with `spatial` at 3×2 finds exactly four closed 21-track
boards, all six rows, all `classes` 5×2 and `kpis` 21×1. On 13 tracks it
finds NONE: a 3-wide tile only fits in the left eight tracks, whose rows are
the focal and the floor tile, so the floor tile would leave the fold; and the
5×3 slot beside the floor tile has no other tile whose registry spans fill it.
The 13-track board keeps `spatial` at 5×3 until a tile is registered for that
slot or the lamps move into a header. Open, edkjo's call. On 21 tracks the
focal CANNOT be top-left: an exhaustive search (every span, every seam-legal
placement, 5–11 rows, focal at 8×5 or 13×8) finds no closed board with a 5×5
viewer and the one 5×3 gauge that puts the focal in column 1, because the
5-wide tiles only start on track 1 or 9. `node scripts/board-gate.mjs`
validates both. Open upstream questions for sprucelab, not forked here:
whether a KPI-row kind should exist, and whether the row unit's height flex
(below) belongs upstream.

**The KPI strip was 13×1 on BOTH boards** (2026-09-22; 21×1 on the 21-track
board since 2026-09-25, on the last row, where it no longer squeezes the floor
tile). On 21 tracks it used to
take the whole 21-track row, which left the Etasjer tile 8×2 — five floors of
ten. Searched exhaustively (every span each kind admits, every seam-legal
placement, 4–11 rows, one focal and one gauge): 21 tracks closes at six rows in
exactly two ways, and the 13-wide strip is the one that leaves row 1's other
eight tracks to `floors`, making it 8×3. The only other closed boards are nine
rows with `viewer` at 3×3 — they would fill a tall screen, at the cost of the
3D becoming the smallest tile. Not taken; edkjo's call.

### Size and the page (2026-09-22)

edkjo on the tabbed board: *"not sure what I'm looking at in the dash now. It
seems stunted"*, then *"a grid of tiles … that way we can resize to monitor
size easily as everything is proportional"*, *"bento box, not a matrix"*.

- **Diagnosis.** The local grid bounded the track by BOTH axes,
  `min(100cqw / divisor, 100cqh / rows)`, so the board always fit one screen.
  On every 16:9 / 16:10 screen the height term won and every tile shrank
  below its content: Etasjer headers read `KNM…`, deltas `−0,…`, the rules
  hid behind an inner scrollbar.
- **Now: one module, derived from the width** — `track = 100cqw / divisor`,
  which is the upstream rule (this re-aligns the mirror; it is not a new
  deviation). Every tile is an integer number of tracks, so the composition
  scales uniformly with the grid's width. The canvas uses `container-type:
  inline-size`, takes its height from its rows, and the page (`<main>`)
  scrolls vertically. Model panels are content height; the panel caps at
  `BENTO_MAX_WIDTH` with the canvas (convergence is a page property).
- **Layout selection rule:** the grid's own inline width, one breakpoint.
  Below 1900 px of grid: the 13-track layout; at or above: the 21-track one.
  Between breakpoints nothing reflows, it scales. Above 2530 px the canvas
  stops growing and the margins grow.
- **Contents scale with the module.** `--bento-line` (a list row) =
  `clamp(20px, 0.26 × track, 36px)`; `--bento-fs` = half a line,
  `--bento-fs-sm` = 0.4 of a line (both clamped). The focal, floor, gauge and
  class rows ride these, so a tile shows the same rows at every size: the
  focal seats all thirteen checks plus the rule section, the 8×3 floor tile
  ten floors. The fraction was 0.27 until 2026-09-22, where the floor tile came
  out exactly one row short of a ten-floor config at every size.
- **Deviations from upstream** (registry only, named at the entry): `tellTales`
  focal spans and `viewer` 5×5. The `roster` ceiling 2.9 → 4.1, raised the same
  day to admit an 8×2 floor tile, is REVERTED — no layout asks for 8×2 now.
  The 21-track board carries the Klasser distribution (3×3) because the other
  tiles cannot close it without air.

### The height: take a surplus, never squeeze (2026-09-22)

edkjo on a 2112 × 1267 window: *"why the large band at the bottom and squished
floor chart in the middle?"*

- **The ROW unit travels, the track does not.** `bentoRowFactorRange` gives the
  row a floor (the authored `BENTO_ROW_FACTOR`, so nothing is ever squeezed —
  that was the "stunted" bug) and a ceiling DERIVED from the tiles actually
  placed: a tile renders at `w / (h · f)` and must stay inside its kind's own
  aspect, so the binding tile is whichever has the highest `aspect.min` per
  cell, capped by `BENTO_CELL_ASPECT.min`. `BentoGrid` grows the row toward the
  page height it is given (`space`) until the board covers it or `f` reaches
  that ceiling. Bound-safe by construction: no tile can be grown out of its
  usable range, and a shortfall is ignored rather than absorbed.
- **What it is worth today.** 13 tracks: ceiling 1.11 (the 5×5 viewer), inert
  in practice because nine rows already overflow a laptop. 21 tracks: it was
  exactly 1.00 while `classes` sat at 3×3 (a `distribution`, usable aspect from
  1.0); since 2026-09-25 (`classes` 5×2) it is also the viewer's 1.11.
- **That band is structural, not a sizing bug.** Six rows of a 21-track board
  render ~3.4 : 1; a 2112 × 1267 window gives the board ~2080 × 1095, i.e.
  ~1.9 : 1. The track is the width over a constant and the row is capped, so no
  module closes the ~480 px left below. Only more ROWS OF CONTENT do: the
  nine-row boards above (3×3 viewer), or tiles promoted from the Innhold tab.
  The viewport gate prints the band at every viewport so it stays a number
  someone can act on.
- **Measurement.** The width ladder is still pure CSS and first-paint correct.
  Only the surplus height is measured — `useBentoCols` reads `boardSpace` off
  the scroller's content box less the panel chrome above the board, scroll-
  independent, re-run by a `ResizeObserver` on the board, the scroller and the
  panel. A missing measurement costs surplus height, never content: the board
  renders at its authored row unit, exactly as before this existed.
- Upstream questions: should the height-bound track be dropped upstream too (it
  never existed there), should the row's height flex live upstream, and should
  the layout breakpoint know the container's HEIGHT — a 21-track board is the
  right call for a 2112-wide window and the wrong one for a 1267-tall one.

### The viewport gate

`scripts/viewport-gate.mjs` (build first; `--url` for a deployed site):
one headless Chrome, launched only with >= 4 GB free, fresh profile per run
(the app restores the last session from IndexedDB). It drops real KNM models
(KNM_Void-demo `export_2026-09-14`: ARK alone; ARK+RIV+RIB with
`tests/fixtures/private/knm-floors.test.ruleset.json`, a TEST floor config, not the KNM
BEP's) and at every target viewport, both tabs, asserts: no horizontal
overflow of page or main; no `[data-essential]` element ellipsized or cut by
a clipping ancestor; per-tile minimum fully visible rows (focal 13, floors 10
— every row of a ten-floor config — gauge 4, the quiet KPI strip 4); no `overflow: hidden` box
hiding content and no sideways scroll inside a tile; and **fill** — a board
shorter than the page height it was given must have its row unit already at
the ceiling its own tiles allow, so a surplus is structural and never a module
that declined to grow. The board's height, its space and the band between them
print on every line, passing or not. Also the landing at 390×844 and 1280×720.
Screenshots to `tmp/viewports/` (`-full.png` = whole page at the same width).
Exit 0 / 1 / 2.

Targets (CSS px): 1280×720, 1280×800, 1366×768, 1440×900, 1536×864,
1680×1050, 1920×1080, 1920×1200, 2112×1267 (edkjo's own window, and the
smallest 21-track target), 2560×1440, 2048×1152 at dpr 1.25, 3440×1440, and
the skiplum.com iframe boxes 1100×800 and 1200×900 (emulated as the viewport:
the app lays out against its own box). The board has no portrait layout (canon
2026-08-01).

Mark any new essential label or value `data-essential`; by-design ellipsis
(type names, material lists, rule names, a found storey name, the program
name) stays unmarked and carries its full text in `title`.

`--design a|b|c` no longer applies here: since 2026-09-25 a design alternative
is not a skin over the bento board but its own layout on the module grid, and
`scripts/module-grid-gate.mjs` measures those (below). This gate measures the
default board.

## Design alternatives 2026-09-25

History. 2026-09-23, edkjo on the shipped board: *"our problem now is that the
UIUX is really ugly and old looking. We need this to be modern, snappy and
impressive."* 2026-09-24: *"they dont really have different takes on component
design"* … *"just color"* … *"for sure I like cards that come off the
background vs flat."* 2026-09-25, on the three skins live: *"there is barely any
difference in the design, and basically no difference in the layout. What is
this for alternatives?"*, *"it seems you havent applied real research and
options around modern data dense dashboards"*, *"I dont like any of them. I'd
say the smash is closest, but the sizing and tiling/layout is just bad."* Then
three rules for the grid: *"we want to build this around a fixed grid size that
is dynamically adjusted to monitors/viewports according to best practice"*,
*"tiles need to have aspect ratios that lend themselves to this. wide/short and
narrow/tall is to be avoided"*, qualified *"unless the chart or component
explicitly is supposed to be that."*

So `#design=a|b|c` are now three LAYOUTS of the Kontroll tab, one component
family, one grid. The research they apply is
`tmp/research-data-dense-ui-2026-09-24.md` (components, layout, perception,
the audit); the references are its outperformers. Absent `#design` nothing
changes: no `data-design` attribute, the bento board, every gate above as it
was. Innhold and Graf are the same components in all three; they only take the
shared styling.

Code: `src/ui/alt/module-grid.ts` (the grid, the tile vocabulary, the three
layout functions, pure TS), `src/ui/alt/AltBoard.tsx` (the tiles; every body is
an existing component or the same numbers, via `src/ui/board-data.ts`, which
the bento board reads too), `src/design/directions.css` (the component family).
`Dashboard` hands off to `AltBoard` when a design is set; `ModelPanel` docks
the band in the board for `a` on Kontroll and keeps it at the foot otherwise.

### Grid practice, researched

| Source | What it fixes | Seen how |
|---|---|---|
| Grafana dashboard JSON (`gridPos`) | 24 columns; height in units of 30 px; panels placed at whole x, y, w, h | [docs page](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/), fetched |
| Datadog dashboards | a 12 column grid; "high density" on a wide screen puts the dashboard's halves side by side as 2 × 12, widgets stay max 12 wide | [effective-dashboards](https://github.com/DataDog/effective-dashboards/blob/main/guidelines.md), [integration dashboards](https://datadoghq.dev/integrations-core/guidelines/dashboards/); numbers from search snippets |
| Carbon 2x grid | 8 px mini unit, everything a multiple; 32 px gutter (16 px each side) at every breakpoint; 16 columns by default, 4 and 8 on small screens; breakpoints sm 320, md 672, lg 1056, xlg 1312, max 1584 | [2x grid](https://carbondesignsystem.com/elements/2x-grid/overview/); the page did not render through fetch, values from search snippets |
| Material 3 | window size classes by width: compact < 600, medium 600–839, expanded 840+, large and extra-large from 1200 / 1600; layout changes at a class, not continuously | [Android window size classes](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes), snippet |
| Fluent 2 | 4 px spacing ramp; six width classes 320 / 480 / 640 / 1024 / 1366 / 1920; a 12 column grid "common for its flexibility"; gutters and margins change per breakpoint | [layout](https://fluent2.microsoft.design/layout), fetched |
| Atlassian | 12 columns; gutter, margin and column count change per breakpoint; breakpoints read off the viewport; space tokens on an 8 px base (space.100) | [grid](https://atlassian.design/foundations/grid), snippet |

Common denominators: a small base unit (4 or 8 px) that every dimension is a
multiple of; a FIXED row unit (Grafana 30 px) and fluid columns with fixed
gutters (Carbon, Atlassian, Fluent); a column count that is a multiple of 12
(Datadog 12, Grafana 24, Carbon 16 is the outlier); a small set of width
classes where the layout may change, and scaling between them. How products
scale up: Carbon and Atlassian add columns per class, Datadog duplicates the
12-column grid side by side, Grafana stays at 24 and lets columns grow, Stripe
and Carbon cap the content width.

### The module grid: the layout canon (2026-09-26)

The canon is edkjo's LAYOUT SYSTEM in
`C:\workspace\resources\design-system\data-workspace.md` (rules 1 to 10).
It replaced the 8 px base / 32 px row / 12·24·36 column grid of 2026-09-25.
Code: `src/ui/alt/module-grid.ts` (pure TS; the gates import it).

- **Rule 6, the formulas.** Square module about 100 px, gap 16, margin 24.
  `C = round((W − 48 + 16) / 116)`, `u = (W − 48 − (C−1)·16) / C`, row height
  = u, `R = floor((H − chrome − 48 + 16) / (u + 16))`. W is `main`'s client
  width (the window less a scrollbar); chrome is the grid's top edge less the
  24 px top margin, measured per model panel, so a second model gets the same
  board. The canon writes `floor` for C, but its own reference table (2112 →
  18, 2560 → 22) is `round` (floor gives 17 and 21); the table wins, stated
  here. Measured, local: 1440×900 → 12×6, 1920×1080 → 16×8, 2112×1267 →
  18×10, 2560×1440 → 22×11, 3440×1440 → 29×11, 1280×800 → 11×5, 1100×800 →
  9×5; chrome 72 px (the file line shares the tab row in the alternatives,
  `ModelPanel`), u 97.5 to 102.7 px.
- **Rule 1.** `main` pads 24 px at the sides and foot; the grid is the window
  less 48 px, capped nowhere (the `BENTO_MAX_WIDTH` cap is off under
  `#design`).
- **Rule 7, sizes.** S 2×2 · M 3×2 / 2×3 · L 4×3 / 3×4 · XL 6×4 stepping to
  8×5 · strip k×1 only for a named content: `MG_STRIPS` has one, the MMI bars
  (a bar chart with few items). At most two XL.
- **Rule 8, the packer (`mgPack`).** Each tile: sizes (its class, most wanted
  first) and a priority (its order). A guillotine cover: the board is cut edge
  to edge in two, recursively, until each part is one tile at a canon size;
  the two parts take RUNS of the priority order (the first part the first
  tiles; the reverse costs), so tiles read by priority, row-major, and line
  up in clean stacks. The cheapest cover wins (a tile below its first size
  costs, the hero most, so XL steps to 8×5 where it fits); ties go to the
  first cut tried. Breaks: when nothing covers the board, tiles that are not
  `required` move into a tab of a host (a bit mask over them, lowest priority
  first); nothing shrinks below its sizes. When the content at its largest
  cannot fill the board (a wide window), the board shrinks, whole modules at a
  time, to the largest rectangle that keeps the grid's shape, centred on the
  grid: no tile is ever stretched. Moved tiles render as tabs in the host's
  head; into the requirements list they go inline after the rows (as the old
  list did); the counts go back into the checks list. A dock that is a tab
  comes forward when it fills. Deterministic: `scripts/bento-pack-test.mjs`.
- **Rule 9's measurable part.** Every cell of the board rectangle is in
  exactly one tile; the board is centred. Asserted by both tests. The look is
  judged on screenshots.

What the canon could not satisfy, stated rather than hidden:

- **Wide windows do not fill.** The content at its canon sizes is at most
  about 164 cells (two XL at 8×5, six L, four S, the MMI strip). 2112×1267 is
  180 cells, 2560×1440 is 242, 3440×1440 is 319. So from about 2100 px the
  board is smaller than the grid and centres with wider margins (a 16×10 of
  18×10 at 2112 in a; 20×8 of 22×11 at 2560; 14×8 in b at 2112). Rule 1 holds
  (columns grow, the module does not); "the board fills the viewport" does
  not. Growing tiles past their class would break rules 5 and 7.
- **Scope and Detail are empty glass until used** (the 2026-09-25 ruling: no
  label, no placeholder), which rule 5 would call empty space.
- **The narrow class (under 11 columns, and 11×5)** seats the model at 6×4,
  the requirements and Scope at M, the MMI bars a strip; Detail is a tab of
  Scope, the charts inline in the requirements list.

### The tile vocabulary and its aspect bounds

Aspect = rendered width / height in px. `MG_ASPECT` is the list; the gate
allows these kinds and no others. Every canon size renders inside 1:2 to 2:1
at any module from 88 to 112 px, and an XL's canvas (the tile less its 32 px
head) inside 9:16 to 16:9 (`bento-pack-test` asserts both).

| Kind | Bound | What |
|---|---|---|
| `panel`, `list`, `chart` | 1 : 2 to 2 : 1 | every requirement panel, count, list, treemap |
| `viewer`, `graph` | 9 : 16 to 16 : 9 | a canvas (rule 4), the tile and the canvas in it |
| strip (MMI only) | k×1 | rule 3's named exception: a few-item bar chart, read across |

### The canvas aspect rule (2026-09-26)

edkjo, verbatim: *"tall/narrow and short/wide isnt good. Thats a relative
term, and I would classify full width/half height as in the bad category. A
viewer/canvas always needs to have an aspect ratio that is in the range of
square to monitor or phone aspect ratios."*

So every 3D viewer `<canvas>` and every graph `<canvas>`, on every surface,
renders at width / height inside **[9/16, 16/9]**: phone portrait, through
square, to a 16:9 monitor. `CANVAS_ASPECT` in `src/ui/canvas-aspect.ts` is the
number; the module grid's `viewer` and `graph` kinds take it, and both gates
import it. The TILE gets the shape: nothing letterboxes or scales inside a
canvas. Where sizing cannot reach the bound, the composition changes (beside
rather than above, a column rather than a row).

What it changed:

- **Graf tab.** The field (the tab's full width at 62vh, less the toolbar) is
  wider than 16:9 on every desktop screen: the merge smoke measured the main
  at 1886×635, 2.97. Now the main takes the widest 16:9 box and the other
  surface sits beside it in the column left over, the column's width and as
  tall as the field, no narrower than 3:4 and no wider than 16:9; on an
  ultra-wide field the pair is centred. A field already inside the bound keeps
  the old 4:3 corner window. Same geometry in both swap states
  (`graphFieldLayout`).
- **a.** The inspector's viewer was sized to 2.4:1 (2.23 to 2.36 measured).
  It now takes the rows that keep its canvas at 16:9, Scope and Detail under
  it; when that leaves them wider than the list bound (1920×1080), the viewer
  takes the full height and Scope over Detail a rail beside it.
- **b.** The viewer's width is capped at 16:9 of its canvas; the report column
  takes any surplus. The compact class uses the inspector above.
- **c.** The right region's viewer was capped at a third of the height (1.93
  to 2.27 measured); it now takes the rows its canvas needs, the rail the rest.
- **Bento board.** The `viewer` kind's ceiling goes 2.2 → 16:9, a local
  tightening; the 5×5 it is placed at renders about 1:1 and is unaffected.
  The one full-width tile under half the viewport height is the KPI strip
  (`kpis`, 13×1 / 21×1): the four neutral counts read in one line, a strip by
  content and upstream's own span class, so it stays and `viewport-gate`
  reports it (never fails it). It is not a canvas.

Gates: `module-grid-gate` measures every canvas at every class and state,
Kontroll and the Graf tab in both swap states, and fails a full-width strip;
`viewport-gate` measures every canvas on Kontroll, Innhold and Graf (both
swap states) at every viewport, and reports bento strips.

### Round two (2026-09-25): the report's content, one screen, two docked panels

edkjo on round one, all three live: *"the content dash still sucks. I dont
understand the obsession with floor vs ifcclass"* · *"why not report on what
matters first? Remember you're building with the pdf report, and they might
have some more insight into what is important to report on."* · *"Fit to
viewport for the dash"* · *"When clicking an object it makes no sense to open
a table that hides half the page. Why not have a dedicated information panel
with identities in scope and another with properties/info on a selected
identity?"* He kept the direction: *"the bold step away from the previous"*.
Then three additions the same day: a system treemap and a function treemap
(*"treemap that defaults to ifctype/class, but when configured shows the
project classification code for system. Another for component codes for
function that can show predefined type as fallback"*), and *"MMI
distribution"*, a chart, never a KPI, reading exactly «Statuskode ikke
konfigurert» with no mapping.

**The content order is the report's** (HI90
`docs/rapport-rammeverk.md`, "Model report", sections 3 and 4, and the
numbered list under it; names from `docs/begreper.md`). `src/ui/requirements.ts`:

| # | Requirement | Report row it reads | Report reference |
|---|---|---|---|
| | **IFC-struktur** | | rapport-rammeverk §3 |
| 0 | IFC-skjema | `ifc-schema` | a Nøkkeltall tile in the report (§1), begreper §0; it leads the group here because the board has no Nøkkeltall band |
| 1 | Typeobjekt | `element-typed` | begreper §1 |
| 2 | GUID | `guid-unique`, told as «Duplikater i fila» | begreper §9 |
| 3 | Etasjedefinisjon | `storey-config` (ikke konfigurert with no floors) | begreper §10 |
| 4 | Objekter i etasje | `storey-containment`, with `mesh-placement` as its span reading | begreper §10 |
| | **Standardkrav** | | rapport-rammeverk §4 |
| 5 | Systemkode NS 3451 | the `system-classification` mapping | begreper §2 |
| 6 | Funksjonskode NS 3457-8 | the `component-classification` mapping | begreper §3 |
| 7-8 | Materiale / Produkt | `material-product`, one row in the contract, so one requirement here; the open rulings print as «åpen» | begreper §4-6 |
| 9 | Kopiobjekt | the `copy-object` mapping | begreper §8 |
| 10 | MMI | the `progress-code` mapping, its fordeling sorted by code, never a big figure | begreper §7 |
| 11 | Fase | `phase` | begreper §11 |

Each requirement shows what the report block shows: the status (the row's
`state`, glyph and word and colour; `not_configured` is «∅ ikke konfigurert»
in grey, never green), the Dekning (presence: `grunnlag − mangler` over
`grunnlag`, «n % · x av N» with `grunnlag_klasse`), the «fra» line (every
`kilder` source with its layer tag, IFC or prosjekt, and its n, 0 included),
and the fordeling (every value with its count, avvik amber, mangler red,
«n unike verdier»). The engine's thresholds are not the report's
(`standard.terskel`): the status is the engine's pass / warn / fail, and the
report's OK / Kan brukes / Ikke oppfylt words are not borrowed for it. No
number is computed on the board but a share of two of the row's own counts.
A mapping with no rule is `not_configured`: the contract emits no row for an
unconfigured classification mapping, and the board says what that is.

Everything the engine runs that the report does not carry (Innlesing, Romlig
struktur, Etasje i bygning, Etasjekoter, Navn på objekt, Typenavn, Type brukt
én gang, Ubrukt type, Materiale, and the project rules that are not a
mapping) follows the requirements as the existing verification list, less the
rows a requirement already shows, then the four neutral counts.

**The storey and class views left the main dash.** c's per-storey and
per-class small multiples, the Etasjer tile (storey list, floor matrix), the
Romlig struktur panel and the seven-number row are gone from the
alternatives. Nothing was deleted: Innhold still carries Klasser and Etasje ×
klasse, the bento board (no `#design`) is untouched, and the alternatives'
`Multiple` / `Lamps` components and the `multiples` / `rowMultiples` packers
stay exported for a drill-down that wants them back. A storey is still one
click away: a storey value in Objekter i etasje's fordeling is a door to that
storey.

**Clicks.** A requirement, a figure's head, a fordeling value, a treemap cell
or an MMI bar fills Scope and makes a chip, the same click grammar as the
bento board (a second click on the same thing undoes it). A requirement that
is a check or a rule keeps its `check:` / `rule:` focus; `ifc-schema`,
`phase` and `material-product` open a `req:` focus over the row's `funn`; a
value opens `req:<id>|=<value>` (`req:<id>|-` for no value): for a mapping row
every object the rule read that value on (`BoardData.values`, read by the
rule's own path `codeLookupSubjects`), for other rows the `funn` carrying it
(so only a flagged value is a door there), and for Typeobjekt and Objekter i
etasje the type or the storey it names. A treemap cell opens `tree:<axis>|<key>`
and a `Klassifikasjon` chip. A `not_configured`, `not_evaluable` or
`not_applicable` requirement makes no chip, as a check that could not run does
not.

**Scope and Detail.** Two tiles of the grid, always present, empty until used
(no label, no placeholder). Scope is the derivation list (`TraceBand` with
`alone`: no object panel beside it, the GUID kept whole, the other columns
ellipsized with their text in `title`); Detail is `ObjectPanel` over the
current selection. A Scope row selects, isolates, frames and fills Detail
(`pickElement`, unchanged); a pick in the 3D fills Detail and is framed, like
every selection, and opens nothing else: in the alternatives the "selection opens the band" effect of `App` is
off, because Detail already shows the selection. Nothing overlays the board,
and a click never moves a tile. Innhold and Graf keep the band at the foot.

**One screen.** Every layout fills exactly the rows the viewport leaves under
the tab strip (`useModuleBox`), and a tile's surplus scrolls inside it. At
the compact class (12 columns) 12 × 13 cells cannot seat the eleven
requirement panels, three charts and the inspector at their aspect bounds, so
all three alternatives become the list (requirements, then the charts inline,
then the other checks) beside the inspector; `MgLayout.chartsInList` says so.

**Verified 2026-09-25, LOCAL `vite preview` builds in headless Chrome, not
the deployed site.** `module-grid-gate`: all 108 states pass (KNM one model at
all six classes, three models at 1440 and 2112, each at rest, with a
requirement open, and with an element selected) and all 36 HI90_ARK states
(without and with the fixture). `isolate-gate`: every assertion holds,
phases 1-2 (bento) unchanged, plus D1-D7 on a, b and c. One gap stated rather
than hidden: on KNM_ARK the requirement D2 opens (Typeobjekt, one untyped
IfcRoof) has no mesh, so the framing half of D3 is skipped by design in the
alternatives; framing itself is the unchanged `pickElement` path that phase 1
asserts. The fixture `tests/fixtures/private/hi90-project-layer.test.ruleset.json` now also
carries the NS 3451, NS 3457-8 and MMI mappings on HI90_Prosjektinfo (manual
§4.2 and §4.5); HI90_Kopi objekt stays out, since its values name the owning
model per file (krav.yaml `kopi_eier`), which a copy-object code list cannot
say. On HI90_ARK: NS 3451 fail (2 294 ok, 431 avvik, 413 mangler of 3 138),
NS 3457-8 all mangler, MMI 134 on the list, 2 591 «Status ikke satt», 413
mangler.

### Treemap measures: Antall / Volum / Areal (2026-09-28)

Owner: *"the treemap is doing a split by ifcentity that I dont want. Go by
count, volume and area. Base quantities if possible, calculated if not. But
make sure we dont hold the entire dataset while waiting for the geometry
analysis - output the dash and then let the geometric analysis happen in the
background."*

**The entity split.** It was the unconfigured system tree: IFC class, then
type name under each class (`systemTree` with no mapping). It is one level
now, the class only; the code trees (NS 3451 2 → 24 → 243, NS 3457-8 Q → QL
→ QLD) are unchanged and never had an entity level. With no
`system-classification` mapping the class IS the only grouping, by his
earlier spec (*"defaults to ifctype/class"*).

**The switch.** Antall · Volum · Areal (`col.count`, `measure.volume`,
`measure.area`) in the treemap tile's head; in a tabbed tile, whose head is
the tab strip, in a thin row under it. Under a Volum or Areal map one mono
line gives the source split, the non-zero parts of «Qto n · beregnet n ·
mangler n». A cell's size is its summed value; a node whose every element is
missing has no area on screen and is counted in «mangler», never drawn as 0.

**Precedence (`src/engine/quantities.ts`).** Only `BaseQuantities` and
`Qto_*BaseQuantities` sets; instance rows before type rows at each name; a
value that does not parse, is not > 0, or whose unit does not resolve is
skipped and the next name tried.

| | names, first found wins |
|---|---|
| volume, every class | NetVolume, GrossVolume, Volume |
| area, IfcWall(StandardCase/ElementedCase), IfcCurtainWall | NetSideArea, GrossSideArea, NetArea, GrossArea, Area |
| area, IfcSpace | NetFloorArea, GrossFloorArea, NetArea, GrossArea, Area |
| area, IfcBeam, IfcColumn, IfcMember (+StandardCase), IfcPile | NetSurfaceArea, GrossSurfaceArea, OuterSurfaceArea, NetArea, GrossArea, Area |
| area, every other class | NetArea, GrossArea, Area, NetSideArea, GrossSideArea |

**Units.** No wasm accessor gives the area or volume unit (`unit_step_id` is
a bare STEP id), so the parse worker reads them from the STEP bytes in 8 MB
latin1 chunks (`quantityUnits`, 48 ms on HI90_ARK's 21 MB): the IfcProject's
IfcUnitAssignment, SI prefix applied to the base (MILLI SQUARE_METRE = 1e-6
m²), and every area / volume IfcSIUnit by id for a quantity naming its own. A
conversion-based unit (square foot) is not resolved and its quantities are
skipped, never read as metres; an ifczip's bytes are compressed, so its units
stay unread. The result rides on the graph as `quantity_units`, so a restore
has it: `CACHE_FORMAT` 4.

**Computed, when no BaseQuantity.** From the streamed mesh (world metres),
only for a CLOSED mesh: vertices welded at identical float coordinates, every
directed edge matched by its reverse. Volume by signed tetrahedra. Area is the
largest face direction: triangles binned by unit normal (components in steps
of 1/20, about 3°), the largest bin's area; a wall's side, a slab's top, a
space's floor. An estimate, always counted as «beregnet»: a curved face reads
low, and the wasm mesh has no openings cut, so walls read gross. Chosen over
half the surface on HI90_ARK, median computed / Qto on elements carrying
both: slab 1.00 vs 1.04, wall 1.02 vs 1.24, space 1.17 vs 3.19, door 1.34 vs
1.90; volume 1.00 on slabs, walls, doors, spaces, windows. No BaseQuantity and
no closed mesh (open, or no geometry) is «mangler».

**Progressive, never blocking (`src/ui/measure-state.ts`).**

1. The worker posts the board with no geometric work: BaseQuantities are in
   its `measures` at once, every other element `pending`.
2. The main thread then hands the mesh batches it already holds for the
   viewer back one per message (a copy, not a transfer), the next only when
   the worker answers; the worker measures each and keeps the numbers only.
   Batches the triangle ceiling withheld are measured in the stream callback,
   where they are dropped anyway. The restore path feeds the cached batches
   the same way.
3. A closing `null` completes the pass: an element with no measure then has
   no mesh and is missing.
4. The worker re-folds and posts the measures at most every 250 ms and on
   completion (`measured`), over the parsed board and the ruleset's board.

Rule: Volum or Areal is enabled when its tree has no `pending` element, so a
model whose every element carries the BaseQuantity has it with the board.
Until then the button is disabled and a 2 px bar along the head's foot shows
batches measured of batches handed back, no text.

Measured on HI90_ARK with the fixture (headless, `tmp/treemap-measures/
measure-hi90.ts`): at the board, volume Qto 1 170 and 1 968 pending, area Qto
1 193 and 1 945 pending (NS 3451 tree, 3 138 objects); complete, volume Qto
1 170 · beregnet 1 552 · mangler 416, area Qto 1 193 · beregnet 1 523 ·
mangler 422. The whole geometric pass costs 94 ms over 12 batches and 228 523
triangles. In a LOCAL `vite preview` build in headless Chrome
(`tmp/treemap-measures/timing.mjs`, HEAD plus this change only, 5 runs):
board data at 2.37 s median, painted 2.52 s, Volum and Areal enabled 2.85 s.
HEAD alone: 3.2 s / 3.5 s on its one uncontended run; the other four ran
while the box was loaded (mesh pass 15 to 49 s), so the before side is not a
clean median. IfcSpace WAS in the treemaps' object set, so on Volum the rooms
(17 100 m³ of about 17 600) filled the map. Since 2026-09-28 both trees leave
IfcSpace out (`TREE_EXCLUDED` in `code-tree.ts`, mapped or not; owner:
*"spaces should be kept separate from the treemap"*); the spaces are the Rom
tab's. A mapped tree's cell count can therefore be lower than its
requirement's count by the spaces the mapping reads.

### The Rom tab (2026-09-28)

Owner: *"I think it could be cool to add a tab for spaces in fact. Spacial with
an aggregated room/space schedule"*; grouped by room name and by storey; the
spatial view both a 3D and a plan per storey, toggled.

- **Layout** (`roomTiles` in `module-grid.ts`): the spatial tile XL (8 × 5
  where that leaves the schedule 4 columns, else 6 × 4, else 4 × 3), the
  schedule beside it at the same height, capped at the list bound 2 : 1.
  Measured locally in headless Chrome with HI90_ARK: 1440×900 8×5 + 4×5,
  canvas 1.71; 1100×800 6×4 + 3×4, canvas 1.63; 1920×1080 8×5 + 8×5;
  2112×1267 8×5 + 9×5, canvas 1.72. No page scroll. The foot band is not
  drawn on this tab: the two tiles fit the window.
- **Room name** is LongName, else Name. The wasm graph has no LongName, so the
  parse worker reads it from the STEP bytes (`spaceLongNames` in
  `engine/rooms.ts`, chunked, ISO 10303-21 string escapes decoded) onto the
  graph as `space_long_names` (`CACHE_FORMAT` 5) and the profile rows as
  `longName`. On HI90_ARK every IfcSpace.Name is '' and LongName carries the
  function, so without it the schedule would be one unnamed group. An ifczip
  has no readable bytes: the schedule then says `LongName · ikke levert`.
- **Schedule** (`roomSchedule`): count, area, volume per group from the
  treemaps' resolved quantities (`elementQuantities`: BaseQuantities first,
  the closed-mesh estimate second). A sum counts only rooms with the value;
  pending shows `…`, all missing `—`, the split is in the cell title and under
  the table (`SourceLine`). By name, largest group first; by storey, top floor
  first. A group opens to its rooms.
- **3D** is the board's scene, lent, under a `SceneLens`: only the spaces are
  drawn, in their group's colour (vertex colours repainted, restored on
  release), and spaces are pickable while it is held. The filter applies
  inside the lens; the camera frames and orbits the lens ∩ filter.
- **Plan** (`room-plan.ts`) is SVG, not the scene: each space's floor (the
  horizontal faces in the lower half of its height) projected down, outlined
  by its boundary edges, labelled where the room is wide enough. It is the
  footprint, not a mesh cut at a height. Storey picker; a choice on another
  storey brings that storey up; the view frames the selection, else the
  filter, else the storey.
- **Clicks**: a group row is origin `rooms` (filter kind `room`, the whole
  group's guids), a room row an element pick from `rooms`, a room in the plan
  one from `room-plan`, a room in the 3D the canvas's own (`viewer`). The
  origin keeps its items and dims the rest; the schedule and the plan isolate
  (the plan by `Vis kun / Uthev`).

### The Overview (2026-09-28): b is the one board

Owner: *"Kontroll should be 'Overview' and IDS should be specific to that"*,
*"KPI cards go on top, then sidebar and larger tiled components"*, *"make b
the new main version … we iterate on b"*. The tab is «Oversikt» / "Overview"
(i18n `tab.checks`, key unchanged). General model health only
(`layoutOverview` in `module-grid.ts`, `AltBoard.tsx`):

- **KPI row:** one S card per IFC-struktur requirement (IFC-skjema,
  Typeobjekt, GUID, Etasjedefinisjon, Objekter i etasje, `ReqCard`), then the
  counts and, when general, the treemaps as M 3×2, until the row closes. No
  ellipsis, no scroll (the text wraps).
- **Sidebar:** the floor config (`FloorSetupMatrix`, or `StoreyList` with no
  config), the full height under the KPI row on the right; 3×4 L, else the
  named tall exception `MG_TALL.floors` (a floor chart, 3 or 4 wide).
- **Middle:** the model (XL), Scope, Detail, the checks no requirement shows
  (own verdicts, no project claims, no project rules; `compact` under
  400 px), the general treemaps, the counts left; the lowest move into tabs
  of Scope. A dock tab brought forward by a fill gives way when it empties.
- **Not here (the project tab's):** Standardkrav (Systemkode, Funksjonskode,
  Materiale/Produkt, Kopiobjekt, MMI, Fase), the MMI bars, a treemap read
  through a project mapping, the project rules. They are the project tab's
  board (below).
- The search keeps the board that covers most of the window. With the HI90
  fixture (mapped treemaps off) 2112×1267 is 12×10 of 18×10: the content does
  not fill 18 columns. 1440×900 is 12×6, full.
- a and c compositions are removed from `module-grid.ts` and `AltBoard.tsx`;
  `#design=a|c` now render this board. `ReqRow`, `ReqPanel`, `ReqSection`
  in `Requirements.tsx` are unmounted (kept for the project tab).
- Measured locally (`module-grid-gate --design b --scenario hi90-fixture`),
  not on a deployed site.

### The project tab board (Prosjekt, 2026-09-28)

`src/ui/alt/ProjectBoard.tsx`, `layoutProject` in `module-grid.ts`, the
Overview's tile frame (`Tile`, `useModuleGrid` exported from `AltBoard.tsx`).
- **KPI row:** one S `ReqCard` per Standardkrav requirement, report order,
  closed with M tiles (MMI bars, a mapped treemap) where the board is wider.
- **Body, by priority:** the model (XL, the board's scene through
  `LentViewer`), the IDS table (XL, never under 6 wide: its columns need
  ~680 px), Scope, Detail, the mapped treemaps (`projectTrees`, with the
  measure switch), the MMI bars (M or the named strip); the lowest move into
  tabs of the IDS table. Narrow fallback: `StandardkravList` as one M tile.
- Scope and Detail dock here as on the Overview (`docked` in `ModelPanel`),
  so the tab has no foot band and no page scroll. An `.ids` dropped anywhere
  on the tab is the tab's.
- Without a ruleset: every card `not_configured`, the MMI tile «Statuskode
  ikke konfigurert», no mapped treemap tile. Without an `.ids`: the table is
  the open button.
- Pure layout checked in node at 1440×900 (12×6 full), 1920×1080 (15×6 of
  16×7), 2112×1267 (18×6), 2560×1440 (12×10 of 22×11: the content does not
  fill 22). Not measured in a browser, not deployed.

### The three alternatives (2026-09-26, superseded 2026-09-28)

Same content, same measurement; they differ in priority order, hero choice
and where Scope, Detail and the model sit (`layoutA/B/C`). Tile maps as
measured locally with HI90_ARK and the fixture (tile, size, priority):

**a · Linear work surface, KPI band (2026-09-26).** Owner: *"I like A best,
but add a row of KPI cards at the top rather than the dense left sidebar that
needs scrolling."* The requirements list is gone; the requirements are a band
on the board's top row (`layoutA` / `aBand` in `module-grid.ts`), and under
it by priority the model (hero), Scope, Detail, the treemaps, the MMI bars,
the other checks, the counts. The band, first that seats a full board:

1. **cards**: one S card per requirement in report order, one row (needs
   2 × 11 = 22 columns: 2560 and wider). Name, status (glyph, word, colour),
   the dekning figure; MMI reads «Statuskode ikke konfigurert» or a mini
   distribution, never one number (`ReqCard`).
2. **sections-m**: one M 3×2 card per report section, its requirements as
   compact rows sharing the height, no scroll, each row its own door
   (`ReqSection`).
3. **sections-l**: the same at L 4×3.

Each mode's first full cover is computed and the one covering the most of the
window wins (rule 9: a board, not a strip in the middle of the screen), ties
to the order above. Wrapping the S cards onto a second row was not taken: at
16 to 18 columns it leaves two or three cards alone on a row, and at 12 it
spends four of six rows. The rest of the band's row is filled from the tiles
below (counts first, then the MMI bars and treemaps), so the band is one
clean row; the board may narrow by whole columns, centred. Under 11 columns
the shared narrow fallback (with its requirements list) still applies.
Measured locally with HI90_ARK (module-grid-gate): 1440 sections-m + 3
counts, body viewer 6×4 · scope · system · detail · function (MMI, checks, a
count in tabs), board 12×6; 1920 and 2112 sections-l + both treemaps L on
top, viewer 8×5 · scope · detail L · four counts, board 16×8; 2560 cards
(11 S), viewer 6×4 · scope · detail · treemaps L 3×4 · MMI strip · checks,
board 22×6; 3440 cards + a count, board 24×6. The search costs 5 to 75 ms
under 22 columns and 100 to 300 ms at 22 and wider, once per window size.

**b · Stripe summary.** One hero. The summary leads top-left (the treemaps,
the MMI bars), the model beside it, then the report as blocks (L), Scope,
Detail, the checks, the counts. 1440: system M p0 · function M p1 · MMI M p2 ·
viewer XL 6×4 p3 · reqs L 3×4 p4 (checks inline) · scope L 3×4 p5 · detail M
p6. 2112: system L 3×4 · function M · MMI M · viewer XL 6×4 · reqs, scope,
detail, checks L 4×3 · counts S; board 14×8 of 18×10.

**c · Grafana / Datadog.** One S panel per requirement, the report's two
sections as blocks (IFC-struktur 5 in a band, Standardkrav 6 as 2 across),
the model, Scope and Detail, the charts, the checks, the counts. Where eleven
panels do not fit beside the model (1440) the requirements are one L list.
1440: reqs L 3×4 p0 · viewer XL 6×4 p1 · scope L 3×4 p2 · detail M p3 ·
system M · function M · MMI M (checks tab). 2112: 11 panels S · viewer XL 6×4
· scope M · detail M · system L 3×4 · function L 3×4 · MMI strip 4×1 · checks
L 4×3 · counts S; board 17×8 of 18×10.

**Graf tab** (all three): the graph and the model are two XL tiles side by
side on the same grid (8×5 each where two fit, else 6×4; under 12 columns the
second is an L 3×4), on the tab's own dark field, which is exactly the two
tiles' rectangle. `Modell | Graf` swaps which is first. `graphTiles`.

### The shared surface: glass (rule 10)

edkjo: *"im more into floating tiles and glassmorphism than the flat
parchment style you've been going for."* One surface for a, b and c
(`src/design/directions.css`):

- **Field:** `--d-field`, a cool gradient `#e8edf3 → #dde3ea → #d6dde6` under
  three soft ambient lights (blue top-left, warm right, teal foot), fixed.
- **Tiles:** `rgba(246,249,252,.64)`, `backdrop-filter: blur(22px)
  saturate(150%)`, solid `#edf1f5` without backdrop-filter or with reduced
  transparency. Radius 14 px. A 1 px inner edge `rgba(250,252,255,.72)`, a
  faint outer ring, then layered shadows (`0 1px 2px .06`, `0 8px 20px -6px
  .14`, `0 26px 52px -20px .24`, shade `rgb(22,34,54)`). Doors rise 2 px.
- **Text on the glass (WCAG, composited over the lightest, darkest and the
  blue-lit field):** ink `#141a22` 14.2 to 16.0; muted `#536070` 5.2 to 5.9;
  label `#475264` 6.4 to 7.2; warn ink `#7e560a` 5.3 to 6.0; accent `#a24808`
  4.9 to 5.5. Status fills: cream on green 4.77, cream on red 5.13, ink on gold
  5.10. Green and red as bare TEXT are 4.1 to 4.9 and are used only for large
  verdict figures (3:1 applies).
- Unchanged: Smash's raised keys and the sunken tab tray, 32 px rows, status
  colour only for status, never #fff or #000, the 3D field not skinned.

### `scripts/module-grid-gate.mjs` and `scripts/bento-pack-test.mjs`

`node scripts/bento-pack-test.mjs` (no browser, a few seconds per hundred
layouts): rule 6 against the canon's reference table, rule 1 (columns never
drop as the window widens, the module stays 88 to 112 px), rule 7's
vocabulary and every size's rendered aspect at modules 88 to 112 px, then for
a, b and c over a sweep of windows: a layout exists, is deterministic (rule
8), every tile a canon size or the named strip, at most two XL, no full-width
tile, no overlap, no hole, the board centred (rule 9), the model, Scope, Detail
and the requirements present, every moved tile hosted; the Graf tiles XL (L
for the second under 12 columns) inside the canvas bound.

`npm run build && node scripts/module-grid-gate.mjs [--out dir] [--only
1440x900,…] [--design a,b,c] [--scenario one,three,hi90,hi90-fixture]`. One
headless Chrome (only with >= 4 GB free) on a LOCAL preview build, at
1100×800, 1280×800, 1440×900, 1920×1080, 2112×1267, 2560×1440 and 3440×1440.
On the RENDERED board, per the canon: rule 6 (C, R and u by the formula from
the window and the measured chrome, within 1 px, and the grid's own box C·u +
(C−1)·16 by R·u + (R−1)·16); rule 1 (24 px margin, every tile edge on the
grid within 1 px, nothing past it, no page scroll either way); rule 7 (every
tile a canon size or the named strip, its `data-mg-size` true, at most two
XL); rules 3 and 4 (aspect per kind, no full-width tile under half the
viewport height, every canvas 9:16 to 16:9 on Kontroll and on the Graf tab in
both swap states); rule 5 (no essential value cut); rule 8 (a resize round
trip gives the same layout); rule 9 (no overlap, no hole, the board is the
tiles' rectangle, centred). The Graf tab: both surfaces on the grid at canon
sizes. Then the docks: empty at rest, a requirement fills Scope, a Scope row
fills Detail (as a tab where Detail is one), the tiles do not move.
Scenarios: KNM_ARK at every class; KNM ARK + RIV + RIB at 1440 and 2112;
HI90_ARK at 1440 and 2112; HI90_ARK with the fixture at 1440, 1920, 2112,
2560 and 3440.

### Research not applied, and why

- Cmd+K palette, single-key shortcuts, a density switcher, collapsible groups
  in c: new features, not asked for.
- Skeleton loading: the progress sweep already says "working"; no new state.
- Sparklines under Stripe's numbers: there is no time series in one file.
- Small multiples per MODEL: each loaded model keeps its own panel; a
  cross-model board is a new surface. With a floor config, `c`'s Etasjer
  group is led by the floor matrix, which is per model.
- Datadog's high-density duplication: columns are added instead, which keeps
  one composition.
- The derivation band's rows stay 26 px: the row height is the windowing
  constant of `TraceBand`, and the band behaves as before.
- Bloomberg's zero radius and dark ground: the owner chose Smash's family.

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

## The IDS view (Prosjekt tab, 2026-09-28)

edkjo: *"We also need to add an IDS tab that only shows the IDS result"*;
it lives in the Prosjekt tab (the project specifics, apart from the model
health on Kontroll). An `.ids` is opened or dropped in the tab, runs against
every loaded model as written, and shows one row per specification in file
order: name · Aktuelle · Bestått · Avvik · status. It is separate from the
ruleset: dropping the file on the tab does not load it as the ruleset (the
tab marks the drop handled; `App` skips a drop a panel took).

**States.** `pass`, `fail` (an element fails, or min/maxOccurs is broken),
**`not_applicable` shown as "Ikke anvendt" / "Not applied"** (the
applicability matched nothing, never a pass; ifctester reports this
`status=true`), and `not_evaluable` with the reason (the row's title and the
band). Counts are `–` where the state has none.

**A click** opens the derivation band with the failing elements and adds an
`ids` chip, which isolates them in the viewer tile of the project board: the
board's one scene, lent (`LentViewer`). The derivation fills the Scope tile. A not-applied or not-evaluable row makes no chip, as a
rule that did not run. The focus is `ids:<index>` in the hash.

**Importer coverage** (`src/ids/import.ts`, DOM-free on `xml-read.ts`, so the
CLI and the browser share it; `ruleset-file.ts` uses its strict form):

- facets, both positions: entity (name, predefinedType), partOf (all five
  relations, cardinality, instructions), classification (value, system, uri),
  attribute (name, value), property (propertySet, baseName, value, dataType,
  uri), material (value, uri); cardinality and instructions in requirements.
- values: `simpleValue`, or `xs:restriction` with base string, boolean,
  integer, double, decimal, date, dateTime, duration and the facets
  enumeration, one pattern, min/max Inclusive/Exclusive, length, minLength,
  maxLength.
- `applicability` minOccurs/maxOccurs, `ifcVersion` (metadata, IFC2X3, IFC4,
  IFC4X3_ADD2 kept, others dropped), `info`, default namespace or a prefix.
- **Refused per specification, never guessed:** any other restriction facet
  (`whiteSpace`, `fractionDigits`, `totalDigits`), a second `xs:pattern`,
  another base, an unknown facet or element, a second entity facet,
  `optional` on partOf. That specification becomes `not_evaluable` with the
  path and the construct; the rest of the file runs. The strict form
  (ruleset loader) refuses the whole file instead.

**Against ifctester**, KNM.ids (38 specs; `10016-kistefos/.../KNM_Mottakskontroll/
02_arbeid/ids/`, reports from `run_matrix.py`) on the 2026-09-28 exports, per
spec applicable / pass / fail, `node scripts/ids-cli.ts ids`:

| model | agree | differences |
|---|---|---|
| KNM_RIB | 38 of 38 | none |
| KNM_ARK | 37 of 38 | "distribution element is in a system": `IFCRELASSIGNSTOGROUP` not exposed, `not_evaluable` here, ifctester 10 / 0 / 10 |
| KNM_RIV | 36 of 38 | the same spec (ifctester 334 / 322 / 12); "Element is placed in a spatial structure" 653 / 652 / 1 here, 653 / 653 / 0 in ifctester: the `IfcGeographicElement` contained in `IfcSite` (the containment limit above) |

Before the evaluator changes listed under "The evaluator's boundary", RIB
agreed on 32 of 38 and ARK/RIV differed on the containment spec by 265 / 1:
type-class specs read NOT APPLIED, IfcBoolean `False` failed an `xs:boolean`
enumeration, materials read layer sets only, and aggregated parts (stair
flights, curtain wall plates and members) had no container.

Verified: `selftest` (importer round trip of the emitted sample, default
namespace, an unreadable spec kept in place, the strict refusal, and each
state and parity rule above on a synthetic model); a local headless Chrome
run of the built app (`vite preview`, not the deployed site) at 1440×900 with
KNM_RIB and KNM.ids under `design=b`: 38 rows in file order, 16 read Ikke
anvendt, the viewer lent beside the table (6×4), a click on "MMI present"
put `ids:6` in the hash, one chip and 3 band rows; a not-applied row made no
chip; the `.ids` did not load as the ruleset.

## The wasm engine

`vendor/ifcfast-wasm/` is a build of ifcfast's `crates/wasm`, not authored here.
ifcfast is read-only to this project. `scripts/build-wasm.sh` downloads a source
tarball into a scratch directory and builds there; it never modifies the ifcfast
working tree.

The crate is **in no tagged release** — a release tarball ships `crates/core`
only — and there is no npm package or release asset, so the module must be
built from source. `vendor/ifcfast-wasm/PROVENANCE.md` records the commit, what
that commit brings and what the new calls cost.

**The vendored build is a BRANCH head, not ifcfast `main`.** `typeObjectsJson()`
and the per-product `type_guid` live on `feat/wasm-type-objects-183` and have
not been merged. Rebuilding from `main` would silently drop both and with them
the `type-unused` fundamental and the Types KPI's used/declared split. Pin the
commit:

```bash
IFCFAST_REV=6a16c16fe287f9e25a91190625e6e7b2922c6d1c bash scripts/build-wasm.sh
```

The script fetches the tarball through `gh` when that works and falls back to an
unauthenticated `curl` against the same API when it does not — ifcfast is
public, and a dead PAT returns 401 rather than falling through. `IFCFAST_REPO`
overrides the repository.

### What the wasm build exposes

`fromBytes` · `summaryJson` · `graphJson` · `qtoJson` · `psetsJson` ·
`quantitiesJson` · `materialsJson` · `classificationsJson` · `typeObjectsJson` ·
`typesJson` · `statsJson` · `bySourceJson` · `streamMeshes` ·
`streamShiftJson` · `shiftJson` · `toGlb`

`graphJson()` carries `products` (with `typed`, `type_guid`, `materials`,
`storey_guid`, `type_name`, `type_source`, `is_external`, `fire_rating`,
`load_bearing`), `storeys` with elevations, `contained_in`, `aggregates`,
`storey_building`, `sites`, `buildings`, `voids`.

**Five tables do not come out of `graphJson()`, and every caller attaches
them to the graph itself** — `graph.psets`, `graph.classifications`,
`graph.type_objects`, `graph.quantities`, `graph.materials`:

| | |
|---|---|
| `psetsJson()` | `[{guid, pset_name, prop_name, value, value_type, source}]`. `guid` is the OWNER — product, spatial element or project. `value` is the STEP literal as a string, never coerced. `source` is `instance` or `type`; a type's own properties arrive keyed by the OCCURRENCE that inherits them, which is why a type object has no property rows of its own. |
| `classificationsJson()` | `[{guid, system_name, edition, identification, name, location, source, assignment_source}]`. `identification` is schema-normalised. Mind the two provenance columns: `source` is the publishing body, `assignment_source` is the instance/type flag. |
| `typeObjectsJson()` | `[{guid, entity, name, step_id}]`, the DECLARED roster keyed by the type's own GlobalId — what `type_guid` points at. |
| `materialsJson()` | `[{guid, role, layer_index, material_name, layer_thickness_mm, category, fraction, source}]`, one row per `IfcRelAssociatesMaterial` assignment: `direct` IfcMaterial, `list` entry, `layer` of a set, `unknown` (a constituent or profile set ifcfast does not resolve, name null). `ProductRow.materials` carries the layer sets only. HI90_ARK 22.09: 2 529 rows, 431 KiB. |
| `quantitiesJson()` | `[{guid, qto_name, quantity_name, value, quantity_type, unit_step_id, source}]` — `IfcElementQuantity` as the EXPORTER wrote it (`Qto_*`), not `qtoJson()`'s computed take-off. Same owner/verbatim-value/source rules as `psetsJson`. `unit_step_id` is a STEP id with no accessor to resolve it, so the object panel carries it and does not render it. |

They are mesh-free (the extractors ran in `fromBytes`), so reading them costs a
serialise: under 15 ms for all three on either KNM model. The payload is what to
watch — `psetsJson` is 960 KiB on KNM_RIV and is the largest string this API
hands out. `src/ui/model-worker.ts`, `src/storage/model-cache.ts`'s budget,
`check-cli.ts`, `ids-cli.ts`, `bcf-cli.ts`, `types-gate.mjs` and `cache-gate.mjs`
all attach them, so no surface runs a different model shape from the board.

**`CACHE_FORMAT` is 3 (2026-09-24, #5)** because the stored graph now carries
`materials`. A format-2 record is a miss and the file is parsed again, and
`validate` also refuses a record whose graph has no `materials` array, so a
restore never answers `element-material` from a graph without the table.
`cache-gate.mjs` asserts both.

`undefined` and `[]` on those five are DIFFERENT answers everywhere they are
read: absent means nobody supplied the table and the surface says so, empty
means the file declares none. A facet over an absent table is `not_evaluable`
naming the table, never a pass.

**The JSON shapes differ from the Rust structs** published on GitHub. Read
`src/engine/types.ts`, which is written against the actual payloads. In
particular `contained_in` is `{product_guid, storey_guid}` with no
`container_kind`, so in the browser it tracks storey containment specifically,
not containment in any spatial element.

### Open ifcfast issues that constrain this tool

| | |
|---|---|
| [#179](https://github.com/EdvardGK/ifcfast/issues/179) | `mesh()`, `meshes()` and `iter_meshes()` use three different coordinate frames |
| [#180](https://github.com/EdvardGK/ifcfast/issues/180) | `StoreyRow.elevation` is in file units while all geometry is metres |
| [#186](https://github.com/EdvardGK/ifcfast/issues/186) | a type object's `entity` is title-cased (`IfcWalltype`), not the IFC spelling |

**#180 matters to any geometry check you write.** Storey elevation is in file
units; mesh vertices are metres. Multiply by `summary.unit_scale` before
comparing, or every millimetre model is wrong by 1000× and silently. (0.5.3 also
offers `storeys[].elevation_m`; this code still reads `elevation` and scales.)

**#186 matters wherever a type's class is compared.** `typeObjectsJson()`
returns `IfcWalltype`. Nothing in this codebase matches it against a class name,
and nothing should without folding case first.

**Closed by the 0.5.3 build, and worth knowing because the numbers moved:**

- **#183** — psets and classifications now have accessors. The IDS property and
  classification facets, the code-lookup property and classification sources,
  the copy-object scope filter over either, and the object panel's own sections
  are all real as a result. Nothing anywhere still says `utilgjengelig ·
  ifcfast#183`; if you find such a string, it is stale.
- **#178** — `IfcGeographicElement` is parsed. KNM_RIV went from 652 products
  to 653 between 0.5.1 and this build, and the extra product is an orphan with
  no material that fails `mesh-placement`, so three of its counts moved by one
  for reasons that have nothing to do with the file. Expect that on any model
  that carries site objects. `IfcCivilElement` was not retested.


## Rulesets

The ruleset JSON is the interface. The builder UI is a view onto it and holds
no capability the format lacks, so an agent never needs the UI.

JSON Schema: `src/ids/ruleset.schema.json` (draft 2020-12). Validate your
authored ruleset against it before running. The selftest asserts the shipped
copy has not drifted from `src/ids/schema.ts`.

Besides `rules` and `storeys`, a ruleset may carry `projectLayer`: the
project's additions to the standard-layer requirements (`ifc-schema`,
`phase`, `material-product`), read by the report only. See "The standard
layer" under "Report contract". The builder UI neither shows nor edits it; the setup page keeps
it when it rewrites the ruleset.

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
- `list` names a bundled list in `src/codelists/`. Two ship:
  `ns3457-8` (NS 3457-8:2021, 910 codes, all three levels) and `ns3451`
  (NS 3451:2022 tables 2–7, the bygningsdelstabell: 813 codes of 1 to 4
  digits, 125 of them reserved). Table 8 (Systemkoder, the 4-digit
  `2120`-style system codes) is a different list and is not bundled. Each
  generated module carries its provenance in `meta`: source file, SHA-256,
  date, count, and `corrections` with the page each name was verified on
  (for `ns3451` against the earlier table, for `ns3457-8` the names fixed in
  the transcription after a re-read of the page renders). Lookups only: nothing enumerates a list
  into an IDS.
- **Reserved codes** (`(Reservert)`, "Koden skal ikke benyttes") are in the
  list and named in `CodeList.reserved`, so a lookup tells a reserved code
  from an unknown one: finding code `reserved` (`code "227" ... is reserved in
  NS 3451`), counted apart in the detail line (`, 1 reserved`, printed only
  when there is one) and in a note. Whether a project accepts a reserved code
  is an owner ruling nobody has made; until a ruleset can express it, a
  reserved-code finding fails the rule like any other finding and sits in
  `coverage.deviating`.
- `extract` is a JavaScript regex (not XSD, not implicitly anchored) with
  exactly one capture group, the code. Lint rejects zero or several groups.
- `source` is one of `{attribute}`, `{property: {propertySet, name}}`,
  `{classification: {system?}}`. **All three are evaluable.** A property is
  read by SET plus NAME; a classification by `identification` — the
  schema-normalised code — narrowed to `system` when one is given. An object
  carrying several values for the source (realistically only a classification
  can) contributes the FIRST in file order, and the result carries a note
  counting the objects that had more, so nothing is picked silently.
  `target: "type"` takes an ATTRIBUTE source only: a type object's own
  properties are not keyed by the type in the parsed tables — ifcfast folds
  them onto the occurrences that inherit them (`source: "type"`), and not one
  property row of 7 157 in the KNM export is keyed by a type's GlobalId.
- `target` `occurrence` (default) reads the elements `select` picks.
  `type` reads the TYPES of those elements, one subject per type Name, with
  the member elements in `finding.members` (the cross-filter uses them).
  `select` is optional for this check; omitted selects everything.
- Findings per subject: `<attr> is empty` · `does not match <extract>` ·
  `code "X" ... is not in <list>` · `code "X" ... is reserved in <list>`.
  The detail line counts all four.

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

**Empty types are a FUNDAMENTAL, not a rule** — see `type-unused` above. They
were unanswerable while the wasm build exposed neither `typeObjectsJson()` nor
`type_guid`; 0.5.3 exposes both, and the question is project-agnostic, so it
belongs with the fundamentals rather than in anyone's ruleset.

Verified headlessly (`ids-cli run`) on the KNM models: every finding kind,
the pass path, the four `not_evaluable` reasons, and the lint errors for a bad
regex, zero and two capture groups. The builder fields are type-checked and
built, not exercised in a browser.

Example project config: `examples/eks.ruleset.json`.

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

A property source is the shape POFIN actually specifies —
`NONS_Process.DuplicateOwnedBy` — and it runs for real since 0.5.3. If a source
cannot be reached at all (no property or classification table attached to the
graph), the filter cannot run: the mapping's own rule reports `not_evaluable`
with the reason, carrying a note that reference objects could not be excluded
from the rest of the ruleset. Every other rule then runs unfiltered, exactly as
if the mapping were absent — **never** silently treated as "no reference
objects".

The setup page (`#page=setup`, "Oppsett") has one card per role, laid out as
the Etasjeoppsett card as a full first band (fixed viewport-derived height,
rows scroll inside) and the four mapping cards 2×2 under it, header and cards
in one bounded container. Each card's on/off is a switch (`role="switch"`,
`Switch.tsx`; the landing's setup tile draws the same switch). Double-clicking
a card that is off opens a small confirm dialog (the card's name, Aktiver /
Avbryt); a card that is on ignores double-click, and a double-click on a live
field is left to the field. The ruleset name field is marked invalid only
after it has been touched or a download was attempted. A card
creates its rule on first enable (id = the role, `select` physicalElement,
the rule builder's blank source and extract), and turning it off sets
`enabled: false`, keeping what was entered. Edits apply to the loaded models
at once. Lint issues for a card's rule print on the card; a ruleset with lint
errors cannot be downloaded. All three source kinds now evaluate, so the card
no longer carries a state for the source it was given. The `copy-object`
card additionally carries a boolean/codes toggle (`isBooleanValues` decides
which is shown as active) and, in codes mode, the same allowed-values input
`progress-code` uses. Built and type-checked; **not exercised in a browser.**

Verified headlessly: `selftest` asserts each mapping lint refusal, the schema
refusal of a code-lookup with neither list nor values, a values lookup on a
synthetic model (in list passes, outside and empty fail), a property-sourced
mapping as `not_evaluable` carrying the "could not be excluded" note (and that
`progress-code` still evaluates the full, unfiltered set when it does), and
the copy-object scope filter excluding a reference object from another rule's
findings in both boolean and codes mode. `examples/eks.ruleset.json` expresses
its NS 3457-8 type-name rule as `component-classification`; `run` on
KNM_ARK / RIV / RIB (KNM_Void-demo `01_inn/export_2026-09-14/`) is
byte-identical to before the mapping was added (84/84, 4/4, 2/2 no match) —
that ruleset carries no `copy-object` mapping, so this exercises the
no-filter path, not the exclusion itself.

### The .xlsx workbook (2026-09-28)

`src/ids/xlsx.ts` writes and reads the ruleset as a workbook. The JSON stays
the interface; the workbook is the same document in another spelling.

| Sheet | Holds |
|---|---|
| Etasjer | `storeys`, one row per floor |
| Lesmeg | reference table: sheet, column, field path, type, allowed values, example. Never read |
| Klassifikasjon | the `system-classification` and `component-classification` mappings |
| MMI | the `progress-code` mapping |
| Kopiobjekt | the `copy-object` mapping |
| Kilder | `projectLayer` sources, one row per source (`phase.sources`, `material-product.*`) |
| Prosjekt | one row: formatVersion, name, description, ifcVersions, `ifc-schema.accepted`, info (JSON), any other top-level key as JSON |
| Andre regler | every other rule, one JSON per row |

- Row 1 is the Norwegian header, row 2 the field path. The reader keys
  columns by row 2 only; a column with a blank row 2 is a notes column.
  An unknown sheet or field path is refused.
- A mapping rule that its sheet cannot spell exactly (a value with a comma,
  an extra key) is written to Andre regler; `storeys` or `projectLayer` that
  do not fit go to Prosjekt as JSON. Values lists are comma-separated.
- Rule order out of a workbook: Klassifikasjon, MMI, Kopiobjekt, Andre
  regler (`canonicalRuleset`).
- Every write reads itself back and deep-compares with the input in that
  order; a difference throws, in the app and in `json2xlsx`.
- Reader problems and lint issues are located as `Sheet!Cell` (`locate`, the
  longest path prefix with a cell). The app prints them on a refused drop;
  `xlsx2json` prints them on stderr and exits 1 on a lint error.
- The zip carries a fixed timestamp, so the bytes are deterministic.

The template, `examples/eks-config-template.xlsx` and its copy in `public/`
(Oppsett: **Last ned mal**), is written from `CONFIG_TEMPLATE` by
`node scripts/gen-config-template.ts`. Every project value is `<FROM PROJECT>`,
and lint code `from-project` refuses any string that still carries it.

Verified: `selftest` asserts both template files are current, round-trips
(json, xlsx, json, deep equal) the template, `SAMPLE_RULESET`, every
`examples/*.json` and every `tests/fixtures/private/*.json`, the misfit
fallbacks, and the reader's refusals at their cells. openpyxl reads the
template and a workbook openpyxl saved (shared strings, a notes column, a
boolean cell) reads back located. One headless run of the setup page (vite
dev, Chrome): template served, the template refused at `Etasjer!B3`, a filled
workbook loaded, the .xlsx and JSON downloads equal to it. Not opened in
Excel itself.

Real-named fixtures a gate needs live in `tests/fixtures/private/`
(`knm-floors`, `hi90-project-layer`); `examples/` carries obscured ones (EKS).

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
node scripts/ids-cli.ts ids    my.ids a.ifc [...] [--max-findings N]   # see "The IDS view"
node scripts/ids-cli.ts report [--ruleset my.ruleset.json] a.ifc [...]   # see "Report contract"
node scripts/ids-cli.ts psets  [--ruleset my.ruleset.json] [--examples N] a.ifc [...]   # see "Pset inventory"
node scripts/ids-cli.ts xlsx2json config.xlsx > my.ruleset.json   # see "The .xlsx workbook"
node scripts/ids-cli.ts json2xlsx my.ruleset.json [--out config.xlsx]
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
occurrence bounds · **every property, by property set plus name** · **every
classification reference, by system and code** · **every quantity, read as a
property** · **the declared type objects, for IDS rules**.

**Not evaluable, and reported as such:** attributes outside those five ·
`IFCRELNESTS` · `IFCRELASSIGNSTOGROUP` · a facet whose name is itself a
restriction · a property or classification facet on a graph that carries no
such table, which names the missing table rather than passing · on a type
object: anything but GlobalId, class, Name and materials.

Added 2026-09-28 for IDS parity (measured against ifctester, "The IDS view"):

- **Quantities are properties.** `quantitiesJson()` rows join the property
  index as (Qto set, quantity name, value), because IDS reads an
  `IfcElementQuantity` as a property set. The value type is the measure the
  kind implies (`Length` -> `IfcLengthMeasure`), so a `dataType` on a
  quantity can match.
- **Property values compare by their IFC type.** ifcfast writes an
  IfcBoolean as `True` / `False`; IDS writes `true` / `false`. A boolean or
  logical is compared in the XSD lexical space, a number as a number (`3.`
  equals `3`, relative tolerance 1e-6). Everything else, and every attribute,
  is a literal string compare as before.
- **Materials read `materialsJson()` when it is attached** (the parse worker,
  the cache and every CLI attach it): every association, the element's own
  and the one inherited from its type, `role` `unknown` included, and a value
  matches a material's Name or Category. Without the table the facet reads
  `ModelProduct.materials`, layer sets only, as before.
- **The declared type objects are selectable by IDS rules.** An entity facet
  naming `IFCWALLTYPE` selects the type objects (`type_objects`, ifcfast's
  `IfcWalltype` spelling compared uppercased); before this it matched nothing
  and read NOT APPLIED on a file full of types. Extended rules keep the
  element universe. A type row answers GlobalId, class, Name and materials;
  a property, classification or PredefinedType on it is `not_evaluable`,
  because ifcfast folds a type's own sets onto the occurrences.
- **partOf is recursive, as IDS 1.0 defines it.** Containment reads the
  element's own storey containment or, for a part of an assembly (a stair
  flight, a curtain wall plate), the containment of the nearest aggregate
  ancestor; the facet's entity may be the container or any spatial element
  above it. Aggregation walks up the same way. Voids stay one step.
- **Containment limit, stated on the finding.** The graph carries STOREY
  containment only (`IfcGraph.contained_in`). An element contained directly
  in a site, building or space has no container here and fails a containment
  requirement, with the reason saying the parser cannot see such a container.
  KNM_RIV has one: `IfcGeographicElement` "Site objekt", in `IfcSite` by
  `IFCRELCONTAINEDINSPATIALSTRUCTURE` #288474 (read in the STEP text).

**Property identity is (property set, property name).** The old caveat — "a
property rule matches on base name only" — is gone, and so is the note that
carried it: the evaluator reads `psetsJson()` rows and matches both halves,
either of which may be a restriction (`Pset_.*Common` plus a literal name is a
legal facet). `dataType` is honoured too, compared case-insensitively against
the row's `value_type`, because ifcfast writes `IfcText` where IDS writes
`IFCTEXT`. Three property states are kept apart in a finding: a value, `present
but empty` (the row exists and carries `""`, which is the common state on a
real export), and `absent`.

**Classification facets read `identification`**, which the parser normalises —
IFC4 `IfcClassificationReference.Identification` and IFC2x3 `.ItemReference`
both land in that column — so nothing in the evaluator branches on the file's
schema and a rule written once runs against both.

One caveat the output still states for itself: spatial structure elements are
synthesized into the selection universe carrying GlobalId and Name only. Their
property sets and classifications ARE readable, though — those tables key by
GlobalId, not by product row, which is how KNM_RIB's 231 storey- and
building-level property rows stay reachable.

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
node scripts/gen-config-template.ts                            # the .xlsx template, examples/ and public/; selftest asserts both are current
PYTHONUTF8=1 python scripts/gen-codelists.py                   # src/codelists/*.ts from the workspace standards tables
PYTHONUTF8=1 python scripts/gen-ifc-psets.py                   # src/engine/ifc-pset-names.ts, needs ifcopenshell
PYTHONUTF8=1 python scripts/gen-codelists.py mengdetype        # only the named ids (ns3457-8, mengdetype); needs PyYAML
```

`gen-codelists.py` fails rather than writing a partial list, and cross-checks
NS 3457-8's source (`ns3457_pdf_extract.json`, the QA'd transcription its
HANDOVER marks authoritative) against the reviewed `ns3457_table.csv` code by
code.

NS 3451 is extracted from the standard's PDF itself
(`resources/standards/ns3451/ns-3451_2022_no_001.pdf`, copied there from
`_graveyard/toolkit--ifc-workbench/ns3451-ifc-mapper/docs/`), so the
generator needs PyMuPDF (`pip install pymupdf`). `find_tables` gives the
cells; the name is the characters inside the Navn cell. The PDF text layer is
broken in 17 names: runs of zero-width glyphs plus a spacer, which every
extractor reads as `overfla te`, `vanntåk ke`, `fjernva rme`. That is where
the earlier table's `overflåte`/`fjernvårme` came from. Those 17 names are
typed in `NS3451_READ_FROM_IMAGE`, each read off the rendered page at 170 dpi
and checked to be a subsequence of the damaged text layer. The build stops if
a zero-width name appears that is not listed, if the set of disagreements
with the earlier `mappings/ebkph/ns3451_table.csv` changes (13 corrected
names, 3 codes that table lacked: 374, 632, 762), or if any name carries
mojibake, `(cid:`, or a code has no parent. The spruceledger lexicon has no
entry for any of these terms.

Headless on HI90 (`ids-cli run`, `system-classification` → `ns3451` on
`HI90_Prosjektinfo.HI90_NS3451`): ARK (Dalux export 2026-09-14) 1306 of 2071
pass, 455 empty, 310 no match (`24-`, `23-`, `35-`, `26-`, `Ny `); RIB
(2026-09-04) 2033 of 2299 pass, 255 empty, 11 not in the list (`230`, which
NS 3451:2022 does not have). Neither model uses a reserved code, so the
reserved path is asserted only on the synthetic model in `selftest`.

## Report contract

`node scripts/ids-cli.ts report [--ruleset my.ruleset.json] a.ifc [b.ifc ...]`
prints one JSON document, UTF-8 bytes on stdout whatever the console code
page: `{command, ruleset, rows, errors, lint}`. `rows` is one object per
requirement × model, built by `src/engine/report.ts` from results the engine
already computed (fundamentals, `storey-config`, `mesh-placement`, the
ruleset's enabled rules). It is the shape the HI90 mottakskontroll report
builder reads (Ed-Skiplum/ifc-check#1; vocabulary from that project's
`docs/begreper.md`). The model is parsed once, geometry included, and the
copy-object exclusions reach the fundamentals as in the browser worker.

```json
{ "model": {"file": "HI90_ARK.ifc", "schema": "IFC2X3", "sha256": "<64 hex>"},
  "id": "mesh-placement",
  "state": "pass|warn|fail|not_applicable|not_evaluable|not_configured",
  "grunn": "why, only on not_applicable / not_evaluable / not_configured",
  "dekning": {"grunnlag": 2730, "grunnlag_klasse": "IfcProduct",
              "oppfylt": 2689, "avvik": 41, "mangler": 0, "gjelder_ikke": 250,
              "kilder": [{"navn": "IfcRelContainedInSpatialStructure",
                          "lag": "standard", "n": 2730, "foretrukket": true}]},
  "fordeling": [{"verdi": "yellow", "n": 7, "flagg": "avvik"}],
  "funn": [{"guid": "...", "klasse": "IfcSlab",
            "grunn": "storey-mismatch-red", "verdi": "-0.3"}] }
```

- `mapping`: present on a project-mapping row only, the role
  (`progress-code`, `copy-object`, ...), since a rule's `id` is cosmetic.
- `state`: a fundamental maps through `verdictOf` (`na` → `not_applicable`).
  A rule keeps its own state. `not_configured` = no home in the IFC standard
  and no project config: `storey-config` with no floor list, and a row per
  unconfigured `progress-code` / `copy-object` mapping (id = the role). A
  disabled mapping counts as unconfigured. `mesh-placement` is
  `not_evaluable` with no geometry, and when its storey half refused to run
  (then `fail` if anything is far).
- `dekning`: `oppfylt + avvik + mangler = grunnlag` whenever all three are
  set. mangler = not there, avvik = there but not acceptable. `gjelder_ikke`
  = objects taken out of scope before judging: copy-object exclusions,
  elements without geometry (`mesh-placement`), elements with no named type
  (`type-name-placeholder`). `kilder` is every source the requirement reads,
  0 hits included; `lag` is `standard` for an IFC attribute, relationship,
  `IfcClassificationReference` or a `Pset_*` / `Qto_*` property, else
  `prosjekt`. The first source is `foretrukket`, the rest are not. Only
  `phase` and `material-product` have a cascade longer than one source today
  (see "The standard layer" below); every other row's `kilder` has one entry.
  `gren` (`mengdetype` / `telleobjekt` / `mengdeobjekt`) is set on
  `material-product` only, and `foretrukket` is then per branch.
- `godtatte`: the accepted values the row judged against, on `ifc-schema` and
  `phase` (the standard's, or the project layer's replacement) and, since
  2026-09-25, on a code-lookup rule with its own `values` (the MMI mapping),
  which the board's MMI bars need for the levels at 0.
- `fordeling`: every distinct value, uncollapsed, most frequent first.
  `verdi: null` = no value; `flagg` is `""`, `avvik` or `mangler` (or `åpen`,
  on `material-product` only, below). Per check:
  storeys (incl. 0-count) for `storey-containment`; building for
  `storey-in-building`; elevation in m (3 decimals) for `storey-elevation`;
  GlobalId multiplicity in objects for `guid-unique` (`"1"`, `"2"`...);
  names, type names (`""` = typed, unnamed type), materials (an object with
  several counts under each); instances per declared type Name for
  `type-unused` (0 flagged); `green` / `yellow` / `red` / `far-from-model` for
  `mesh-placement`; the value read for code-lookup, the copy-object mapping
  and model-metadata.
- `funn`: every finding, uncapped. `grunn` is a code, never prose: the
  engine's ReasonCode (yellow and red split into `storey-mismatch-yellow` /
  `-red`), or the rule finding's code (`empty`, `no-match`, `not-in-list`,
  `no-type`, `duplicate`, `type-usage`, `value`, `requirement`,
  `occurrence-bounds`), or `material-product`'s (`product-missing`,
  `material-missing`, `material-unusable`, `mengdetype-undecided`).
- `aapne`: on `material-product` only, the open mengdetype rulings (below).

**Null, because the engine does not compute it:** `parse-integrity` has no
coverage (every `dekning` count null, `kilder` and `fordeling` empty/null);
`spatial-chain` has no `grunnlag_klasse` and no `kilder`; an ids rule has no
avvik/mangler split, no `kilder` and no `fordeling` (a finding can carry
several facet failures at once); `unique-attribute` and `type-usage-count`
have no `mangler` (empty values and untyped elements are skipped, not
failed), no `kilder.n` and no `fordeling`; `grunnlag_klasse` is null when a
rule selects several classes, `physicalElement`/`builtElement`, or no entity;
a rule's `gjelder_ikke` is null when the copy-object filter excluded
anything, since which of those the rule would have selected is not recorded.

### The standard layer: `ifc-schema`, `phase` and `material-product`

`src/engine/standard-layer.ts`. Requirements whose home the IFC standard
names, shipped with the tool, with the ruleset's `projectLayer` on top. The
merge is HI90's (`standard.yaml` + `krav.yaml` through `konfig.py`): a
project's sources are APPENDED after the standard's, so a standard source is
always preferred; a project's accepted list REPLACES the standard's. Report
rows only, after the fundamentals and before the rules; nothing reaches the
screen.

```json
"projectLayer": {
  "ifc-schema": { "accepted": ["IFC4"] },
  "phase": { "sources": [ { "property": { "propertySet": "HI90_TFM", "name": "Fase" } } ] },
  "material-product": {
    "mengdetype": [ { "property": { "propertySet": "NOSKI_Mengde", "name": "Mengdetype" } } ],
    "product": [ { "property": { "propertySet": "Identity Data", "name": "MC Product Code" } } ],
    "material": [ { "property": { "propertySet": "HI90_Prosjektinfo", "name": "HI90_Material" } } ]
  }
}
```

`sources` entries are the `CodeSource` shape code-lookup uses (attribute,
property by set plus name, classification by system). Lint refuses an id the
standard layer does not define (`project-layer-unknown`, as konfig.py
does), a schema that is not a family (`schema-accepted-form`), an empty
list, and a malformed source; a schema outside [IFC2X3, IFC4] is a warning
(`schema-accepted-widens`). HI90's per-exporter exception (`unntak`: IFC2X3
for Tekla) has no field here.

- **`ifc-schema`**: FILE_SCHEMA as written (`summary.schema`, which is the
  header string: `IFC4X3_ADD2` comes through unchanged), folded to its family
  with HI90's `skjema_grunn` rule, the leading `IFC<n>` plus an optional
  `X<n>`. So `IFC4 ADD2 TC1` and `IFC4ADD2` are IFC4, and **IFC4X3 is its own
  family, not IFC4**, as HI90's standard.yaml has it. Default accepted
  [IFC2X3, IFC4]. `pass` when the family is accepted, `warn` (avvik 1) when
  it is not, `fail` (mangler 1) when there is no schema. grunnlag 1,
  `grunnlag_klasse` null (the file has no IFC class), `kilder` FILE_SCHEMA,
  `fordeling` the value as written, no `funn`.
- **`phase`**: `Pset_*Common.Status` (set matched by `Pset_\w*Common`, name
  `Status`), then the project's sources in order, over the physical products
  (openings and copy-object exclusions out, as the fundamentals). Accepted
  NEW / EXISTING / DEMOLISH / TEMPORARY, case-insensitive; OTHER, NOTKNOWN,
  UNSET and anything else carried are avvik. Per object, as HI90's
  blokkdata: the first source carrying an accepted value decides oppfylt;
  failing that, the first source carrying any value decides avvik; none is
  mangler. `kilder[i].n` = objects that source decided (oppfylt or avvik),
  so the n's sum to oppfylt + avvik, the same meaning as a single-source
  row's "answered with a value". `fordeling` is the deciding value as
  written, null for mangler. `funn` codes `not-in-list` and `empty`. State
  `pass` with no finding, else `warn` (advisory, like `element-material`;
  the HI90 builder applies its own thresholds to the counts);
  `not_evaluable` when the graph carries no property table.

Verified: selftest (fold, all five schema states, narrowing, the cascade's
order, layers, 0-hit source and decisions on a synthetic graph, and the lint
codes); `report` on HI90_ARK (22.09 export, sha matches the reference) with
and without `tests/fixtures/private/hi90-project-layer.test.ruleset.json`, and on KNM_ARK.
No real model at hand carries Pset_*Common.Status or HI90_TFM.Fase, so the
real `phase` rows are all mangler and the value paths are proven on the
synthetic graph only.

Against the HI90 22.09 reference on HI90_ARK: `ifc-schema` matches with the
project layer (warn, 0/1/0, IFC2X3 avvik; with the standard alone it is a
pass). `phase` matches in kind (0 oppfylt, all mangler, both sources at n 0)
but grunnlag is 2980 against 2731: this tool judges every physical product,
as the fundamentals rows do, while HI90 counts IfcProduct with 3D geometry
(2730 meshed elements here, plus IfcSite, which carries ARK's coordination
marker). HI90 says `bad` where this says `warn`.

- **`material-product`** (Materiale / Produkt, #1 gap 3; HI90 begreper.md
  §6 and blokkdata «6»). Same population as `phase`. Per object, the
  mengdetype first: the IFC class table, then the NS 3457 code
  (`IfcClassificationReference` whose system name contains `3457`, looked up
  whole, then its first three, then two characters), then the project's
  `mengdetype` sources (value `telleobjekt` / `mengdeobjekt`, any case). The
  first DECISIVE answer wins (`telleobjekt`, `mengdeobjekt`,
  `ikke_relevant`), so the class wins where both tables answer; with none,
  the class row's own value stands (`avhenger`, or `ukjent` for a class the
  table lacks). Then: `ikke_relevant` is gjelder_ikke. A telleobjekt needs a
  product: `Pset_ManufacturerTypeInformation.ModelReference`, then
  `ArticleNumber`, then the project's `product` sources; none is mangler
  (`product-missing`). A mengdeobjekt needs a material: `IfcMaterial`, then
  `IfcMaterialLayerSet` (a layer thicker than 0; a set of zero-thickness
  layers counts as IfcMaterial, as HI90 reads it), then the project's
  `material` sources. A usable name is oppfylt; only names matching
  `NOT_A_MATERIAL` (HI90 standard.yaml `ikke_materiale`: RAL, NCS, element
  words like «Innervegg», bare numbers, placeholders) is avvik
  (`material-unusable`, verdi the names joined by ` + `); none is mangler
  (`material-missing`). `avhenger` / `ukjent` has neither reading: mangler
  (`mengdetype-undecided`, verdi the mengdetype). `kilder[i].n` = objects
  that source decided, as for `phase`; the mengdetype sources count
  `ikke_relevant` decisions too. `fordeling`: products and material names
  (an object with several usable materials counts under each), null for
  mangler, then one entry per open ruling that touches objects, `flagg`
  `åpen`, verdi its title, n its objects (these count objects, not values).
  `not_evaluable` when psets, classifications or `materialsJson()` were not
  supplied; `not_applicable` when every in-scope object is ikke_relevant;
  `pass` only with no finding AND no object under an open ruling, else
  `warn`.

  **The open rulings** are HI90 krav.yaml `materialprodukt.aapne` (worklog
  2026-09-23 «Åpent»): Dør og vindu (IfcDoor, IfcWindow and their
  StandardCase: stk in the type register, m² in the Solibri route map), Dekke
  og tak (IfcSlab, its two cases, IfcRoof: m² in the engine, m³ in the
  method), Trappeløp og rampeløp (IfcStairFlight, IfcRampFlight: quantity in
  one rule table, count in another), Prefab-moduler (no class: counted, but
  no product EPD, so the definition breaks). The tables still answer for
  those classes; the row never lets that pass silently. `aapne` lists all
  four always, `n` = in-scope objects whose mengdetype the class table
  decided for one of its classes, null for Prefab-moduler, which cannot be
  told apart per object.

  **The tables** are `src/codelists/mengdetype-ifcklasse.ts` (155 classes,
  plus `MENGDETYPE_AAPNE`) and `mengdetype-ns3457.ts` (789 codes), generated
  from HI90's `02_Arbeid/mengdetype_ifcklasse.yaml`, `mengdetype_ns3457.yaml`
  and `krav.yaml` with provenance meta (source, SHA-256, date, count). Not
  in `CODE_LISTS`: no code-lookup rule can name them. The generator fails on
  a changed row count, an unknown mengdetype or ledeenhet, or a ruling naming
  a class the table lacks.

  **`materialsJson()`** is attached as `graph.materials` everywhere the other
  tables are (#5). `ProductRow.materials` carries layer-set materials only;
  `element-material` and its report row now read both through
  `elementMaterialNames` (fundamentals.ts), so a direct IfcMaterial counts.
  HI90_ARK 22.09: 802 of 2980 before, 2355 after (+1 553: 1 148
  IfcFurnishingElement, 332 IfcBuildingElementPart, 44
  IfcBuildingElementProxy, 29 IfcCovering, all direct instance rows). The
  issue's 1 177 counted the covering and furnishing only. This row's
  counts did not move (697 / 134 / 1586).

  **Not expressible in the project layer:** HI90's pattern sources (a pset
  matching `^MagiCAD Pset_`, property `^product ?code$`), and HI90's
  funksjonskode cascade feeding the NS 3457 code (this row reads the
  classification only).

  Against the HI90 22.09 reference on HI90_ARK (same sha), with and without
  `tests/fixtures/private/hi90-project-layer.test.ruleset.json` (every project source 0
  there, as in the reference): oppfylt 697 and avvik 134 match, as do the
  material values (Betong 197, Isolasjon - Myk 176, Finer 105, Innervegg 71
  avvik, Gipsplate - Ombruk 67, Dekke 63 avvik), the IfcMaterial source (29)
  and the open rulings (Dør og vindu 77, Dekke og tak 278, Prefab-moduler
  shown without a count). Differences, all from the population and the n
  definition, none forced: grunnlag 2417 against 2258 and mangler 1586
  against 1427, because this row judges every physical product (2980, as
  `phase`) while HI90 counts IfcProduct with 3D geometry (2731); the extra
  159 are 153 IfcFurnishingElement, 2 IfcStair and 4 IfcRailing without
  geometry, all mangler. gjelder_ikke 563 against 473: 91 IfcVirtualElement
  are in this population, and IfcSite (HI90's one extra) is not a product row
  here. `IfcMaterialLayerSet` n 802 against 668: n here is objects the source
  decided (oppfylt + avvik), HI90's is oppfylt only. Trappeløp og rampeløp is
  listed here with n 0; HI90 omits a classed ruling that touches nothing.
  HI90 says `bad` where this says `warn`.

Not in the contract yet: a
standard-layer cascade for the classification mappings (with no mapping
configured, NS 3451 and NS 3457 produce no row). A code-lookup rule still
reads one source.

Exit codes as the rest of `ids-cli`: 1 when a row is `fail` or a model could
not be read, 3 when a row is `not_evaluable`, else 0. `warn` and
`not_configured` are answers, not failures.

## Pset inventory

`node scripts/ids-cli.ts psets [--ruleset my.ruleset.json] [--examples N] a.ifc [...]`
prints every property set (`psetsJson()`) and quantity set
(`quantitiesJson()`) in each model, as UTF-8 JSON on stdout. Data only: no
state, no threshold, no finding. HI90's Egenskapssett gallery renders it
(#1 gap 5). Built by `src/engine/pset-inventory.ts`; the model is parsed
without geometry. Exit 0, or 1 when a model could not be read or the ruleset
has lint errors.

```json
{ "command": "psets", "ruleset": "KNM" | null,
  "krevd_kilder": [{"by": "projectLayer:phase", "ref": "HI90_TFM"}],
  "models": [{
    "model": {"file": "HI90_ARK.ifc", "schema": "IFC2X3", "sha256": "<64 hex>"},
    "skjema_familie": "IFC2X3", "ifc_maler": ["IFC2X3", "IFC4"],
    "tabeller": {"psets": 59022, "quantities": 10006},
    "typer_deklarert": 205, "typer_ubrukt": 0,
    "grenser": [{"kode": "type-rows-on-occurrences", "n": 0},
                {"kode": "unused-type-sets-unreadable", "n": 0}],
    "psett": [{
      "navn": "Pset_WallCommon", "art": "pset", "kategori": "ifc",
      "ifc_mal": ["IFC2X3", "IFC4", "IFC4X3"], "krevd_av": [],
      "objekter": 524, "objekter_forekomst": 524, "objekter_type": 0, "typer": null,
      "klasser": [{"klasse": "IfcWallStandardCase", "n": 524}],
      "egenskaper": [{
        "navn": "LoadBearing", "med_verdi": 354, "tom": 0, "mangler": 170,
        "kilde": {"forekomst": 354, "type": 0},
        "verdi_type": [{"type": "IfcBoolean", "n": 354}],
        "eksempler": [{"verdi": "False", "n": 178}, {"verdi": "True", "n": 176}],
        "ulike": 2 }] }] }],
  "errors": [], "lint": [] }
```

- One entry per set NAME per table: `art` `pset` or `qto`. Owners are every
  GUID the tables key by: products, spatial elements and the project, so an
  `IfcProject` or `IfcBuildingStorey` shows in `klasser`. `klasse: null` =
  an owner in no table the graph carries.
- `objekter` = distinct owners with at least one row of the set;
  `objekter_forekomst` / `objekter_type` = owners with at least one own row /
  one row folded from their type (the two can overlap).
- Per property, over the set's `objekter`: `med_verdi` (a non-blank value),
  `tom` (the row exists, value `""`, blank or null), `mangler` (the owner
  carries the set but not this property). They sum to `objekter`. `kilde`
  counts rows by origin. `verdi_type` is every `value_type` /
  `quantity_type` as the engine spells it (title-cased,
  `IfcLengthmeasure`, see #186). `eksempler` = the N most frequent distinct
  values (default 5, `--examples`), verbatim engine strings; `ulike` = the
  exact number of distinct values, not capped.
- `kategori`, in HI90's order: `ifc` when the name is an
  `IfcPropertySetTemplate` in buildingSMART's templates for the file's schema
  family or for IFC4 (`ifc_maler`; IFC4 is always included because the IFC2X3
  template carries no `Qto_*`, which is what HI90 does too). By definition,
  not by prefix: `Pset_Fake` is not `ifc`. Else `krevd` when `krevd_av` is
  non-empty, else `annen`. `ifc_mal` lists every template defining the name,
  whatever the file's schema.
- `krevd_av`: every `propertySet` value found anywhere in an ENABLED rule
  (IDS property facets in either position, code-lookup sources, selectors)
  and anywhere under `projectLayer`, as `rule:<id>` / `projectLayer:<key>`.
  The walk is generic, so a new rule shape or layer key that names a set is
  picked up. A literal matches exactly (case and spaces count, unlike HI90's
  konfig), a restriction by its pattern / enumeration / length. Filled for
  `ifc` sets too. The top-level `krevd_kilder` lists every reference found.
- Sort: category, then `objekter` descending, then name.

**Limits, stated in `grenser` as codes with the count they affect:**

| `kode` | means |
|---|---|
| `type-rows-on-occurrences` | ifcfast folds a type object's own rows onto each occurrence using it (`source: "type"`); no row is keyed by a type's GlobalId. `n` = owners carrying at least one such row. So "on types" is "reached through an occurrence", and `typer` counts the distinct `type_guid`s behind the type rows: USED types only, null when the set has no type row. |
| `unused-type-sets-unreadable` | declared type objects no product uses (`typer_ubrukt`): their sets are in no table, so they are missing from the inventory entirely. |
| `table-absent:<table>` | the caller supplied no `psets` / `quantities` / `type_objects` table; `tabeller` then reads null. The CLI always supplies all three. |

One more the output cannot state per row: the engine writes a REAL without
its trailing point (`IFCLENGTHMEASURE(400.)` becomes `"400"`), so it and an
`IfcLabel` `'400'` count as one distinct value. HI90's ifcopenshell reading
keeps them apart (`AC_Pset_Dimension.Width` on HI90_ARK: 23 distinct there,
22 here).

Verified: selftest (category by template with the IFC4 Qto fallback on an
IFC2X3 file, a `Pset_` name that is not IFC, restriction and projectLayer
references, a disabled rule ignored, the origin split, `typer`, fill with a
null value, a spatial owner's class, the stated limits, absent tables).
`psets` on HI90_ARK 22.09 (sha matches the reference) against HI90's own
2026-09-22 blokkdata `psett`: the same 15 sets, and for all 15 the same
object count and class counts, and for all 117 properties the same filled
count; distinct values differ only as above. On KNM_ARK / RIV / RIB with
`examples/eks.ruleset.json` (which names no set, so nothing is `krevd`):
KNM_RIB is the one model at hand with type-folded rows (3 owners, 8 sets).
No real model at hand carries a set the loaded ruleset requires, so `krevd`
is proven on the synthetic graph only.
