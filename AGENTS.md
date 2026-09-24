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
  fundamentals.ts  the twelve structure-and-usability checks, their severities
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
  TraceBand.tsx    the derivation band: the rows behind the open number (61.8 %)
                   beside the object panel (38.2 %)
  ObjectPanel.tsx  everything the engine has for the selected element:
                   lead cards + Attributter / Relasjoner / Egenskaper (tabs)
                   / Beregnet
  Contents.tsx     tab 2 (Innhold): classes, Etasje × klasse
                   (StoreyClassCensus.tsx), type ledger
  forms.tsx        gauge, distribution, KPI row, readouts
  SetupPage.tsx    the project mappings page (`#page=setup`)
src/ids/         ruleset model, IDS emitter, evaluator, XSD validator
src/builder/     rule builder UI (a strict subset of the JSON format)
src/bcf/         BCF 2.1 export: topic plan, camera, spaces, XML, zip, XSD
                 validation (pure) + `browser.ts` (snapshots, download)
src/design/      the three visual directions (`#design=a|b|c`) and their fonts
src/codelists/   bundled code lists (code -> name), generated; lookups only
scripts/
  check-cli.ts   run the fundamentals headlessly
  ids-cli.ts     author, lint, emit and run rulesets headlessly
  bcf-cli.ts     export BCF headlessly, XSD-validate it, check every camera
  viewport-gate.mjs  real models in headless Chrome at every target viewport
                     (`--design a|b|c` measures a visual direction)
  isolate-gate.mjs   what a CLICK does, driven with real mouse events
  zoom-gate.mjs      what the WHEEL does, driven with real CDP wheel events
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
| `storey-containment` | deviation |
| `storey-in-building` | deviation |
| `storey-elevation` — storeys must sit at distinct elevations | deviation |
| `guid-unique` | deviation |
| `element-named` | advisory |
| `element-typed` | advisory |
| `type-name-placeholder` | advisory |
| `single-instance-types` (review) | advisory |
| `type-unused` — a declared type object no element uses | advisory |
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
config headlessly. `examples/knm.ruleset.json` carries no floor config: the
KNM BEP §6.5 marks the elevations TBD ("working placeholders").

## The KPI row

Seven cards, one number each, in a 13×1 / 21×1 `tellTales` strip on top of
both layouts (`kpis.ts` + `KpiRow` in `forms.tsx`): **Typer brukt**
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
filter bar, ABOVE the tab strip: chips belong to the model, so they persist
across tabs. Then:

1. **Kontroll** (`Dashboard.tsx`, bento): KPI strip, verification focal (the
   twelve checks + `mesh-placement` + `storey-config`, then the ruleset's
   rules as rows under "Regler", `not_evaluable` included; this replaced the
   separate rule strip), the model tile, the spatial gauge (four lamps) and
   the Etasjer tile.
2. **Innhold** (`Contents.tsx`, flow surface, not bento): band 1 is Klasser
   (38.2 %) | Etasje × klasse (61.8 %, `Ifc` prefix dropped, headers wrap to
   two lines, total column = elements per storey); band 2 is the type ledger,
   full width, sticky header, its disproportion band as the head. Both bands
   are fixed, viewport-derived heights; their tables scroll inside.

3. **Graf** (`GraphTab.tsx`): the selected element's relationship graph, every
   `IfcRel*` edge the engine carries, drawn around it (below).

The tab is `tab=contents` / `tab=graph` in the URL hash (absent = Kontroll), one
for all panels, pushed to history so Back/Forward walk it. Both tabs stay mounted and
the inactive one is `hidden`, so the 3D scene and its camera survive a tab
switch. The derivation band opens INSIDE the panel of the model it belongs to,
under the active tab, pinned to the bottom of the scrolling page
(`sticky bottom-0`) at 38.2 % of the screen, so a number clicked at the top of
a tall board opens its derivation in view. Within it the rows take 61.8 % and
the object panel 38.2 % (below).

Checked 2026-09-21 in headless Chrome against a LOCAL preview build, not the
deployed site: both tabs at 1440 and 1100 with KNM_ARK, ARK+RIV+RIB + knm
ruleset, and ARK+RIV+RIB + a test floor config; the band split; the setup
double-click dialog (opens on an off card, Aktiver turns it on, an on card
ignores double-click); the app bar at 390 with a model loaded (no control
past the right edge).

The app bar wraps at narrow widths, so BCF, the ruleset, Oppsett and NB/EN
stay reachable at 390 px. The board itself has no portrait layout (canon
2026-08-01); that is out of scope, not a defect.

## Clicking: the UI isolates, the viewer highlights

edkjo's rule, settled on the ifcfast-site work and restated here 2026-09-23:
*"When clicking an item from the table I want that to isolate in the model"*,
and the drill is two steps — *"so you click to see rejected instances, then
select an instance and see that."*

**A click on a row or a cell makes a CHIP** (`src/ui/cross-filter.ts`), which
is what narrows the 3D. Nothing navigates and no tile learns a second gesture:
the same click that opens the derivation band adds the chip. Chips OR within a
facet and AND across facets. The bar above the tabs is the only way back —
each chip's ✕, or `Tøm filter`; clicking the same row again removes its chip,
so the gesture is its own undo.

The surfaces whose rows are a set of elements, and all of them are doors:

| surface | chip | the set |
|---|---|---|
| Verifikasjon check row | Kontroll | the check's findings |
| Regler rule row | Regel | the rule's findings (a type finding's `members`) |
| KPI card (Uten type · Uten etasje · Plassering) | Kontroll | the same |
| Klasser bar | Klasse | every element of that IFC class |
| Etasjer row (no config) | Etasje | everything the graph places on that floor |
| Etasjer matrix cell, OWN column | Etasje | that file storey, both storeys on a `×2` cell |
| Etasje × klasse storey row / total | Etasje | that floor, every class |
| Etasje × klasse cell | Celle | that floor × that class |
| Typer ledger row | Type | that type's instances (the untyped row too) |
| a row of the derivation band | Element | that one element (below) |

**The second step is an `element` chip.** A row of the open derivation selects
its element — as it always did — and now also narrows the filter to it, so
under `Vis kun` the scene IS that element. It ANDs with the set chip above it,
the same row again steps back out to the set, and choosing a different NUMBER
drops it (`clearElements`): carried onto another set it would AND to nothing
and draw an empty scene. It is the one path where a single element narrows the
scene — a pick in the 3D tile still only highlights, because a click that hid
what the pointer was over would make the tile useless for what it is for.

**`Vis kun / Uthev` is unchanged, and it is not what makes a click isolate.**
It says how the cross-filter is EXPRESSED in the scene: `Vis kun` (the
default) draws the matched set alone, `Uthev` keeps the model and dims the
rest. Both modes narrow the same set; only the drawing differs.

**Rows that stand for no element set are not doors**, and each says so the way
that surface already did rather than by a chip reading `0 / 851`:

- a `not_applicable` check or a `not_evaluable` / `not_applicable` rule makes
  NO chip (`chipOf` returns null). The row still opens its derivation, which
  prints the reason. An empty scene there would report "was not answered" as
  "no elements", the same conflation `not_applicable` exists to prevent.
- a census cell of 0 is an empty `td`, a storey with no elements is an inert
  row, a `—` matrix cell is not a storey — all as before.
- a `kpi:products` / `kpi:storeys` click still makes no chip: one is every
  product, the other is not a product set.

**Cross-model: a click narrows its own panel only.** The filter is per model
(`useCrossFilter` keys every view by model id), so the other panels and their
viewers are untouched. That is why only the panel's OWN column in the floor
matrix — the first, `ownFirst` — is clickable: a cell under another file's
column names a storey this panel's viewer does not contain. Every such storey
is one click away in its own model's panel.

**A SET never moves the camera; the one ELEMENT does** (2026-09-23). Isolating
a set does not fit, frame or zoom — the pivot re-targets without moving the eye
(`pivot-gate.mjs` assertion 8). The second step is the exception edkjo asked
for: *"It should also frame the object and show the properties and
attributes."* So a row of the derivation band frames what it picked, through
the SAME `ModelScene.zoomToSelection` the button runs — one framing rule, one
piece of arithmetic, so a row and `Zoom til valg` cannot land the camera in two
places. Instant, like the button; nothing is animated.

- The request travels as `ModelView.frameSeq`, a counter bumped only by
  `pickElement` (`cross-filter.ts`) and read by `ViewerTile` in an effect
  declared AFTER the selection effect, so the scene already holds the new
  selection. A counter rather than a flag: the same element picked twice is two
  requests. `ViewerTile` remembers the last value it acted on, so a re-render
  never re-frames a camera the user has since orbited.
- **A canvas pick still moves nothing.** `pick` does not touch `frameSeq`, so
  the rule holds by the request never being made rather than by a check.
- Shift/Ctrl down the band frames the accumulated selection. Stepping back OUT
  (the same row again, an empty selection) leaves the camera where it is.
- An element with no mesh in the scene — budget capped, or no geometry — leaves
  the camera alone: `zoomToSelection` finds no bounds and returns. The HUD
  already carries how much of the filter has geometry.
- `Zoom til valg` stays, and still takes the accent the moment a selection
  exists: a canvas pick and a restored selection both need it.

### The object panel — everything the engine has, in IFC's own order

The band is full width and its four columns never needed all of it, so it
splits at the golden section (2026-09-23): the rows keep **61.8 %**, an object
panel takes the **38.2 %** on the right. The band's height rule is unchanged —
this costs table WIDTH, never rows — and the four columns were re-cut to
`23ch 22ch minmax(12ch,1fr) minmax(20ch,2fr)` so they still fit the narrowest
box the app ships in, the 1100 px skiplum.com iframe, without the list
acquiring a sideways scroll. GUID stays 23ch and is still never truncated; the
other three ellipsize by design and carry their full text in `title`.

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
`quantitiesJson()`, new on the profile as `quantities` and the reason
`CACHE_FORMAT` went to 3). The strip **scrolls sideways and never wraps**; a tab
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
| materials | layer THICKNESSES — only the layer set's NAME reaches the graph, so a to-scale layer drawing cannot be honest |
| placement | `ObjectPlacement`, and the core's `drift_distance_m` (row count only) |
| types | a type object's own property rows — ifcfast folds them onto the occurrences that inherit them |

## The band opens on a SELECTION (2026-09-23)

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
- **It makes no chip.** `chipOf` returns null for it, so a canvas pick still
  only highlights: a click that hid what the pointer was over would make the
  tile useless for what it is for.
- **It does not move the camera.** `frameSeq` is still bumped only by
  `pickElement`, so nothing about opening the band frames anything.
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

### `scripts/isolate-gate.mjs`

Real CDP mouse events against a real model in headless Chrome — a synthetic
`click()` on a React handler would prove the handler, not the gesture.
Assertions: the whole model · a class row isolates (the bar reads the class's
own count, the HUD narrows) and the object panel opens in its empty state,
its pset and classification sections carrying the no-selection dash · the
same row restores, and the canvas is
**pixel-identical** to before, which is the set-does-not-move-the-camera
assertion · a band row is one element · **that row FRAMED it** — the eye moved,
the element's box projects inside the viewport, and it fills the frame, so
"contains it from a mile away" fails · the object panel names that element and
carries every attribute row · the same band row steps back to the set · a
canvas click selects, makes no chip and **does not move the camera** ·
`Tøm filter` · the object panel's four groups and its three absences told apart
on a selected element (a Uniformat value, the pset group reading `ingen` rather
than `ikke levert`, and the profile tab reading `ikke levert` because the ENGINE
does not carry it) · a SELECTION opening the band, and a tab switch keeping the
selection · a storey row on the Etasjer tile · and, with three models and
`examples/knm-floors.test.ruleset.json`, that only the own column of the matrix
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

## Graf — the element's relationship graph (2026-09-23)

edkjo: *"showing the full edge graph is totally ok to do"*, then *"it should be
its own tabbed view"*. So it is a third model-panel tab, not a card in the
object panel: it needs the width, and it matches the MODEL | GRAPH tabs on his
ifcfast-site.

`src/ui/GraphTab.tsx`, inline SVG, **no dependency**. The build is unchanged;
the layout is LIVE (2026-09-23). edkjo: *"the graph for instance needs to be
cool and smooth."*

`src/ui/graph-sim.ts` runs the same physics over real frames instead of inside
a `useMemo`: velocity Verlet with a per-tick decay, `alpha` cooling to rest and
reheating on every gesture, a collision radius, and pinned nodes. So the
arrangement expands into place, a new selection MOVES the nodes it shares with
the old one instead of cutting to a new picture, a node can be dragged and
stays where it is put, the wheel magnifies about the pointer and a drag on the
field pans. Hovering dims everything the hovered node is not attached to, in
CSS, off one attribute write. Positions are written straight to the DOM by the
frame loop: React owns what exists, the loop owns where it is.

Determinism survives — start positions are still an FNV-1a hash of the node id
and there is no randomness anywhere, so the same element settles into the same
arrangement every time it is opened. The centre pull is split per axis from the
tile's aspect, which is what stopped the drawing under-filling a wide tile.

**Why not d3-force**: ~26 kB for Barnes-Hut approximation that pays at
thousands of nodes. This graph is capped at 180 by the build, deliberately, and
180 nodes is 16 110 pairs per tick — a tenth of a frame. The exact sum is both
cheaper than the import and more accurate than the approximation.

Labels are placed by a collision pass that reserves boxes in rank order: the
centre and the spatial parents keep their names, a property set gives way, and
edge labels go last and only on an edge long enough to hold one, which is what
makes the wheel a legibility control. `src/ui/graph-paint.ts` holds the
per-direction material — the drawing is identical in all four skins, what
changes is glyph weight, whether an edge bows, whether a label rides a chip.

Caps: 12 members per relationship group then a `+N` node, 180 nodes total.

Edges, each labelled with the relationship it IS, and drawn only where the
engine really carries it: `IfcRelContainedInSpatialStructure` (element →
storey), `IfcRelAggregates` (storey → building), `IfcRelDefinesByType` (→ the
type object, and a count node for the siblings sharing it),
`IfcRelAggregates`/`IfcRelNests` (parent and children), `IfcRelVoidsElement`
(both ends), `IfcRelAssociatesMaterial`, `IfcRelAssociatesClassification`, and
`IfcRelDefinesByProperties` (a node per property set and per quantity set, each
behind its own toggle). With nothing selected it draws the model's spatial
structure with element counts.

**Not drawn, because the engine does not carry it:** building → site (the graph
has flat site/building rosters and `storey_building` is the only spatial
aggregation edge), element containment in a site, building or space
(`contained_in` is storey-only), and `IfcProject` (a count, no guids). A
category whose table is absent gets ONE node reading `ikke levert`, so "nobody
supplied this" never wears the clothes of "this element has none".

**Clicking an element node selects it**, through the panel's own `onPick` — the
same semantics as every other UI click. A press that MOVES is a drag, not a
click, so pushing a node around never changes the selection. Non-element nodes
(a material, a pset, a storey) carry no handler at all: they are not elements,
and a faked selection would be worse than none.

Photographed in a real browser at 1440 and 1920 in all three directions
(`tmp/design-shot.mjs`), which is what caught the drawing under-filling its
tile, the edge labels crowding each other near the hub, and, in c, the graph
reading straight through the translucent derivation band on top of it.

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
verification block is this board's focal) and `viewer` takes 5×5 (no upstream
viewer span meets the kind's own aspect bound). The former `matrix` full-band
deviation is reverted: the census left the board for the Innhold tab
(2026-09-21), and `matrix` is back to upstream's 8×5 / 13×8.

Tab-1 layouts: 13 tracks × 9 rows (`kpis` 13×1; `verify` 8×5 | `viewer` 5×5;
`floors` 8×3 | `spatial` 5×3) and 21 tracks × 6 rows (`spatial` 5×3 | `classes`
3×3 | `kpis` 13×1 over `viewer` 5×5 | `verify` 8×5, with `floors` 8×3 under
the gauge). `node scripts/board-gate.mjs` validates both. Open upstream
questions for sprucelab, not forked here: the 13-track board is 9 rows against
an 8-row fold because of the KPI strip, which forces `floors` and `spatial` to
P2 there; whether a KPI-row kind should exist; and whether the row unit's
height flex (below) belongs upstream.

**The KPI strip is 13×1 on BOTH boards** (2026-09-22). On 21 tracks it used to
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
  in practice because nine rows already overflow a laptop. 21 tracks: ceiling
  exactly 1.00, because the 3×3 `classes` tile is a `distribution` whose usable
  aspect starts at 1.0. So on a 21-track board the surplus cannot be taken.
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
`examples/knm-floors.test.ruleset.json`, a TEST floor config, not the KNM
BEP's) and at every target viewport, both tabs, asserts: no horizontal
overflow of page or main; no `[data-essential]` element ellipsized or cut by
a clipping ancestor; per-tile minimum fully visible rows (focal 13, floors 10
— every row of a ten-floor config — gauge 4, KPI 7); no `overflow: hidden` box
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

`--design a|b|c` runs the same assertions against a visual direction and puts
its screenshots in `tmp/viewports/<design>/`. A direction is a skin, so every
assertion applies to it unchanged, and a wider face or a larger type scale
that clips a value is exactly what this catches: it found the KPI value
`339 / 398` ellipsized in its own card at every viewport in two of the three
on their first run. Run it per direction after touching `src/design/`.

## The three visual directions

edkjo, 2026-09-23, on the shipped board: *"our problem now is that the UIUX is
really ugly and old looking. We need this to be modern, snappy and
impressive."* The structure was accepted; the cream/hairline/gold-caps
vocabulary mirrored from sprucelab was not. Three ground-up directions live as
unlisted skins over the SAME board, for him to pick from:

```
#design=a   INSTRUMENT   graphite sheet, ruled, everything mono, zero radius,
                         tracked caps, a scanline on the field
#design=b   PAPIR        bright warm paper, ink rules at two weights, one
                         amber, big confident sans at negative tracking
#design=c   SMASH        a saturated rust field, frosted panels floating on
                         it, rounded, shadowed, the one that moves on hover
```

Absent, there is no `data-design` attribute at all, so the default look and
everything measured against it is untouched. The mechanism is one more key in
the existing hash (`src/ui/useHashView.ts`), which is what a static host and
an iframe both allow and a path route does not.

**What a direction may and may not do.** It may change colour, material,
shape, type, spacing and motion. It may NOT change a string, a label, a row, a
number, or what any surface shows — the panel still shows everything, and
there is no curation in `src/design/`. Three rules bind all three directions:
status is a classic traffic light and never a brand hue (2026-09-23), the
micro-label's gold is retired, and no state is ever cued by an edge stripe,
an inset white top highlight or a gold rim on glass.

**Where the hooks are.** Almost everything is reached through the palette
tokens and the existing Tailwind classes. Four markup hooks exist because a
class could not separate two meanings: `data-chrome="primary"` (the one filled
control per surface, because `bg-green` is also the `pass` cell),
`data-chrome="lede"` (the entrance's headline), `.tracking-[0.12em]` (the
house micro-label, used as a selector, NOT `[data-essential]` — that marks
values too) and `--color-ground` (the page field, split out of `cream`, which
also means "the light ink on a filled surface" and is the opposite colour on
a dark board).

**The 3D field is not skinned.** `scene.ts` holds a neutral low-chroma warm
grey, which is what the canon asks for in both themes; a field that changed
per direction would make the scene chrome rather than scene.

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

**Four tables do not come out of `graphJson()`, and every caller attaches
them to the graph itself** — `graph.psets`, `graph.classifications`,
`graph.type_objects`, `graph.quantities`:

| | |
|---|---|
| `psetsJson()` | `[{guid, pset_name, prop_name, value, value_type, source}]`. `guid` is the OWNER — product, spatial element or project. `value` is the STEP literal as a string, never coerced. `source` is `instance` or `type`; a type's own properties arrive keyed by the OCCURRENCE that inherits them, which is why a type object has no property rows of its own. |
| `classificationsJson()` | `[{guid, system_name, edition, identification, name, location, source, assignment_source}]`. `identification` is schema-normalised. Mind the two provenance columns: `source` is the publishing body, `assignment_source` is the instance/type flag. |
| `typeObjectsJson()` | `[{guid, entity, name, step_id}]`, the DECLARED roster keyed by the type's own GlobalId — what `type_guid` points at. |
| `quantitiesJson()` | `[{guid, qto_name, quantity_name, value, quantity_type, unit_step_id, source}]` — `IfcElementQuantity` as the EXPORTER wrote it (`Qto_*`), not `qtoJson()`'s computed take-off. Same owner/verbatim-value/source rules as `psetsJson`. `unit_step_id` is a STEP id with no accessor to resolve it, so the object panel carries it and does not render it. |

They are mesh-free (the extractors ran in `fromBytes`), so reading them costs a
serialise: under 15 ms for all three on either KNM model. The payload is what to
watch — `psetsJson` is 960 KiB on KNM_RIV and is the largest string this API
hands out. `src/ui/model-worker.ts`, `src/storage/model-cache.ts`'s budget,
`check-cli.ts`, `ids-cli.ts`, `bcf-cli.ts`, `types-gate.mjs` and `cache-gate.mjs`
all attach them, so no surface runs a different model shape from the board.

`undefined` and `[]` on those four are DIFFERENT answers everywhere they are
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

**Empty types are a FUNDAMENTAL, not a rule** — see `type-unused` above. They
were unanswerable while the wasm build exposed neither `typeObjectsJson()` nor
`type_guid`; 0.5.3 exposes both, and the question is project-agnostic, so it
belongs with the fundamentals rather than in anyone's ruleset.

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
occurrence bounds · **every property, by property set plus name** · **every
classification reference, by system and code**.

**Not evaluable, and reported as such:** attributes outside those five ·
`IFCRELNESTS` · `IFCRELASSIGNSTOGROUP` · a facet whose name is itself a
restriction · a property or classification facet on a graph that carries no
such table, which names the missing table rather than passing.

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
PYTHONUTF8=1 python scripts/gen-codelists.py                   # src/codelists/*.ts from the workspace standards tables
```

`gen-codelists.py` fails rather than writing a partial list, and cross-checks
NS 3457-8's source (`ns3457_pdf_extract.json`, the QA'd transcription its
HANDOVER marks authoritative) against the reviewed `ns3457_table.csv` code by
code.
