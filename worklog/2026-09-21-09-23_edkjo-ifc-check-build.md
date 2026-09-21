---
project: ifc-check
date: 2026-09-21
author: edkjo
---

# ifc-check: from an IDS question to a live client-side checker

Started as "build an IDS for Kistefos" and grew into a standalone tool: a
browser IFC health checker and IDS rule builder on a WebAssembly build of
ifcfast. Nothing is uploaded; the IFC is parsed in the browser.

- Live: https://ifc-check.skiplum.com (container on skiplum-apps-1 behind Caddy)
- Listed: https://skiplum.com/uttun/verktoy/ifc-check (Supabase `streamlit_apps` row, slug `ifc-check`)
- Repo: https://github.com/Ed-Skiplum/ifc-check (public, `main` @ 94e7b77)

## What exists

- **Engine** (`src/engine/`): eleven project-agnostic fundamentals, each with a
  severity (`deviation` / `advisory`) and a `displayValue`. The screen prints
  the found value coloured by verdict (Bestått / Advarsel / Avvik / N/A), the
  pattern from the delivered Skiplum reports. No composite score.
- **Verification page** on the house bento grid, mirrored from
  `sprucelab/frontend/DESIGN.md` §2d. Two authored layouts, 0.0% air, every
  tile inside its kind's aspect bound, fit on both axes.
- **Rule builder** (`src/ids/`, `src/builder/`): IDS 1.0 as the base, not the
  ceiling. `ids` rules export to a valid `.ids`; `extended` rules carry what IDS
  structurally cannot (typing, uniqueness, type usage count, model metadata).
  Validation is real, xmllint-wasm against the vendored buildingSMART XSD,
  cross-checked with Python xmlschema plus three negative controls.
- **Two inputs**: the IFC gives facts, a ruleset gives project verdicts.
- **three.js viewer** with bidirectional cross-filter, ported from the G55
  QTO-LCA dedup viewer: merged batch geometry, per-face element id, overlay
  highlight, filter and highlight modes, orbit pivot following selection or
  the visible set without moving the eye.
- **Type ledger**: types by instance count, geometry and declaration, with
  disagreeing values flagged and the single-instance ratio as the headline.
- **IndexedDB cache** keyed on ifcfast `cache_key`: refresh and re-drop both
  skip the parse.
- `AGENTS.md` documents the ruleset format, CLIs and the evaluator boundary.

## Findings worth keeping

- **ifcfast wasm geometry is f32-quantised at NTM coordinates** (#188). On
  KNM_RIV a Ø400 duct wobbles ±4.4 mm and 9 to 13% of faces collapse to zero
  area; model totals move only 0.7%, so it hides from QTO and is obvious in a
  viewer. Zeroing the site `IfcCartesianPoint` takes the error to 0.033 mm.
- **KNM_RIB (B+G work model)**: 5 beams mesh to ~19,000 km from an
  `IfcTrimmedCurve` trim bug (#190); three storeys all at elevation 0.0; no
  names, types or materials.
- **BEP basepoint typo** E 922000 should be E 92200 (see the KNM_Mottakskontroll worklog).
- **BATID is not `Tag`.** The 2026-05-31 KSV_modellanalyse investigation found
  Tag is a non-unique cast-unit mark and GlobalId is the per-object identity.
  Awaiting edkjo on what BATID reads from.

## ifcfast issues filed (EdvardGK/ifcfast)

#178 IfcGeographicElement parses to an empty model · #179 three mesh frames
disagree · #180 storey elevation in file units · #183 psets/classifications
have no wasm accessor (gates IDS property and classification facets) · #188
f32 quantisation at georef · #190 trimmed-curve beams.

## Open

- Site-point rebase in the worker as a workaround for #188 (designed, not started).
- Filter chips do not survive a refresh (not in the URL hash).
- First dropped file is always id `m1`, so a stale hash can bind to a different model.
- `zoomToSelection` cannot reach the outlier beams (radius clamp).
- Renderer amplifies noise on thin walls: `flatShading` + `DoubleSide` + 100,000:1 near/far.
- One WebGL context per model panel, no pooling (browsers cap ~16).
- Catalogue card has no Norwegian description; title is the slug.
- Public repo has no LICENSE; README is still the scaffold's.
- **Nothing has been exercised in a real browser beyond edkjo's own look.**
  Every gate is headless mechanism.
