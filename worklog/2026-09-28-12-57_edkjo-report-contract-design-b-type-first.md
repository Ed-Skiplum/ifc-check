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

## Next steps (next session)

**Update 13:55:** another session landed items 1 and 5 after this list was written (`8a61c4c` to
`4594f09`): the .xlsx config import/export/template with obscured EKS examples and the
`<FROM PROJECT>` lint, and a Rom tab that takes spaces out of the treemaps. Check `git log` before
starting anything below.

**From the KNM session:** KNM.ids was rebuilt (MMI accepts 100, 200, 250, 300, 350, 400, 500, 600;
IfcProxy in the element scope; 38 specs). A KNM project config in the HI90 `krav.yaml` schema now
exists at `10016-kistefos/underprosjekter/KNM_Mottakskontroll/02_arbeid/krav.yaml` (faggruppe ARK =
KNM_ARK + KNM_ARK_Exterior; IFC2X3 + IFC4 accepted; 8 storeys from BEP v7.0 §6.5 with placeholder
kotes; EPSG:5950). KNM-only requirements without a datanokkel (IsReference, IsExternal,
LoadBearing, FireRating, TFM, KomponentID, Manufacturer, System, Sone) are not measured yet. Use
it for the IDS tab test and the report work (#3).

1. **Excel config template** (not built; the design is in the empty commit `b4dbb38` on branch
   `wip/excel-config`: library choice, sheet layout, round-trip guard. Lint does not yet refuse
   `<FROM PROJECT>`, so add that check first. `examples/knm-floors.test.ruleset.json` also carries
   real names and three gates use it): .xlsx with Etasjer first and
   Lesmeg/README second (human-legible, aimed at agents), then Klassifikasjon, MMI, Kopiobjekt,
   Kilder. Import by drop or setup page, export .xlsx and JSON, "last ned mal", `ids-cli
   xlsx2json` / `json2xlsx`. Rename the examples to obscured names (EKS); keep real-named fixtures
   only where a gate runs against real models, under a private path. Finish, then edkjo looks live.
2. **Graf tab as a showpiece** (not started; only read): one large canvas (>= 70 % of the tab),
   Modell | Graf swap with the other as a small window, light HUD instead of tiles and band.
   *"strictly not needed, so it just needs to be cool and inspiring."* Pointers: layout in
   `GraphTab.tsx` ~1060 to 1200 (`graphFieldLayout`); the band is `ModelPanel.tsx` ~516
   (`trace && !docked`), drop it on Graf by adding `tab === "graph"` to `docked`; HUD facts are in
   GraphTab's `index.byId`. ifcfast-site (master d5a1e22) has no swap, it is a 2×2 grid; carry
   over its compact graph mode (canvas and hover tip only, 65cbc83), the small glass control top
   right and the inset vignette.
3. **isolate-gate** still asserts the old chip model; rewrite it for the one-origin filter or fold
   it into `xfilter-gate.mjs`.
4. **Colour by class in the 3D** (offered, not asked): charts and model can only share colours if
   the viewer gets that mode. Wait for edkjo.
5. **IfcSpace in the treemaps:** rooms are ~97 % of the Volum map. Asked, unanswered.
6. **HI90 coordination** (#1, #4): denominator, `kilder[].n`, exact vs loose name matching, the new
   `krav.yaml` shape for Materiale/Produkt. Report inside ifc-check (#3) after that.
7. **ifcfast gaps** surfaced by the IDS parity run: IfcRelAssignsToGroup and non-storey containment.
   Offered to file on EdvardGK/ifcfast; unanswered.
8. **Rewrite the 36+ unpushed commits' author** to edvard.kjorstad@skiplum.no? Asked, unanswered.
   Then push `main` (GitHub is far behind production).
9. The 23 Skiplum repos on `edvard@skiplum.no`: alias or move to `edvard.kjorstad@skiplum.no`?
