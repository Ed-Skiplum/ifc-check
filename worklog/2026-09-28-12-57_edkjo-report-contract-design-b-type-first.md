---
project: ifc-check
date: 2026-09-28
author: edkjo
---

# Report contract, design b, type first

Five days, `2ad65a3` → `dc8f314` (about 50 commits), deployed to https://ifc-check.skiplum.com by
edkjo with `deploy.sh`, and embedded at skiplum.com/uttun/verktoy/ifc-check. Coordinated with the
HI90 and KNM mottakskontroll sessions through Ed-Skiplum/ifc-check #1 to #5.

## Engine

- **Report contract (#1):** `ids-cli report` emits one row per requirement × model with state,
  dekning (grunnlag, kilder with lag and n), fordeling and funn. `not_configured` is its own state.
- **Standard layer and project layer:** IFC-skjema, Fase, Materiale/Produkt (telle/mengde lookup,
  four «åpen» rulings), NS 3451 (813 codes, 125 reserved, names verified against the PDF), pset
  inventory (`ids-cli psets`).
- **IDS:** DOM-free importer (`src/ids/import.ts`), `ids-cli ids`, and the IDS view in the Prosjekt
  tab. Against ifctester on the 2026-09-28 KNM exports: RIB 38/38, ARK 37/38, RIV 36/38. The gaps
  are engine limits (no IfcRelAssignsToGroup, storey containment only).
- **Fixes:** storey containment through aggregate parents (#4: 1222 → 2889 of 2980 on HI90_ARK),
  direct IfcMaterial counted (#5: 802 → 2355), NS 3457-8 re-read off the scans (910 codes, 12 names
  and OPZ), quantities from BaseQuantities with mesh fallback (`quantities.ts`), unit parsing.

## edkjo's rulings

- Storey band: green inside the floor, yellow within 100 mm below with top in the floor, else red;
  **0 mm** slack.
- Reserved NS 3451 code fails. `24-` reads as code 24.
- Anything not in NS 3457-8:2021 was removed from Notion (79 rows, record in resources).

## UI

- **Design b is the only version** (*"make b the new main version. Lets stop this multiple versions
  thing. we iterate on b"*). a and c removed; the hash key is ignored.
- **Oversikt** is general model health: IFC-struktur KPI cards on top, the floor config as a tall
  right sidebar, viewer, Scope and Detail. **Prosjekt** holds Standardkrav, the mapped treemaps,
  MMI and the IDS results (*"that way we dont confuse anyone"*).
- **Cross filter has one origin** (*"Original: Highlight, everything else: Isolate"*): one filter,
  a click replaces it, every view reads it. KPI cards stay whole-model («Hele modellen»).
- **Typer:** gallery cards with System / Funksjon lines (NS codes or IFC fallback); a click filters
  the viewer; a double-click opens the type on its own route. The type page follows the G55 QTO-LCA
  type viewer: identity, type properties, instance distributions with disagreements flagged, QTO,
  requirements, the instance list, Per forekomst isolating one element. Layer strip at 1:20.
- Treemaps by count, volume and area; chart colours by class and code, status as outline and hatch.
- Every selection pivots and frames. Canvases stay within 9:16 to 16:9.

## Canon written this week

`resources/design-system/data-workspace.md`: the LAYOUT SYSTEM (ten rules: module grid formulas,
tile sizes, predictable breaks, well-proportioned bento, floating glass), and the one-origin cross
filter. `spatial-workspace.md`: canvas aspect, orbit and frame the selection. Global CLAUDE.md: the
layout summary, "keep agent runs short", Skiplum git identity.

## Process lessons

- Three agents in one checkout for an hour broke each other's builds; the session exit killed three
  more. Now: one ask per agent, typecheck plus selftest, edkjo looks live.
- Worktree removal with `--force` deleted main's `node_modules` through a junction, twice.
- `deploy.sh` shipped `tmp/` (3.6 GB); it now excludes `tmp` and `.claude`.
- Things shipped unseen twice (type view); a single short headless check before handover caught
  the next one.

## Open

- Excel config template with Lesmeg as sheet two, import and export, and obscured example names:
  in progress.
- HI90: denominator (#4), `kilder[].n`, name matching, the new `krav.yaml` shape.
- isolate-gate still asserts the old chip model.
- `main` is not pushed to GitHub.
