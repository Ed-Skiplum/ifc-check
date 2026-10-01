---
project: ifc-check
date: 2026-10-01
author: edkjo
---

# Oppsett walk, IDS as a report, Innhold as a rollup

`9697776` → `8341aff` on main (24 commits, including merges). Every step was pushed to
Ed-Skiplum/ifc-check with the Skiplum token and deployed with
`skiplum/internal/infra/apps-server/deploy.sh ifc-check`. A push alone does not deploy: the site
sat on the 30 Sep build until deploy.sh ran. Worked as coordinator, agents in worktrees
(`ifc-check-wt-*`, all removed again). Verification was tsc, the selftest and the layout test,
plus local Playwright runs for the Oppsett picker; edkjo looked live.

## Inputs

- `.ids`/`.xml` from the landing page or a drop on the board goes to the IDS tile's loader
  (`takeRulesetFile` in `App.tsx`). The AppBar «Slipp regelsett» button is gone.
- The KNM ruleset in `10016-kistefos/.../02_arbeid/ifc-check/` migrated to formatVersion 2
  (v1 kept as `KNM.ruleset.v1.json`). Open: `KNM_Tak` is 242 there and 142.8 in the fixture;
  `KNM-config.xlsx` is probably still v1.

## Oppsett walk

- Landing tile is one «Start oppsett» button. Oppsett opens on a choice: open a ruleset or
  download the template, or «Veiled meg».
- Steps, in edkjo's Type-first order: choice · Last opp IFC · Systemkode · Funksjonskode
  NS 3457-8 · Duplikat objekt · MMI · Fase · Materiale / Produkt · Mengdetype · Etasjeoppsett.
- No gating: being on a step is the decision; a pick or a typed value turns the rule on.
- Property picker from the loaded model (`psetInventory` in the worker, merged across models):
  search, keyboard, counts; «Egenskapen er ikke med» opens manual fields. A pick collapses into
  a card (pset, property, count, «Endre»).
- Values list with the Uttrekk applied live (✓ / ✗ / ! and totals, the evaluator's own lookup).
  «Eksempel» (typed or picked, defaults to the most frequent value) generates a regex from a
  marked part; «Bruk» applies it.
- Defaults: Systemkode NS 3451, Komponentklasse NS 3457-8 (was the first bundled list for both).
  MMI starts with an empty list and `^(0|\d{3})$`: an empty MMI list is a format check (lint,
  evaluator, preview, board bars). Schema `minItems` on `codes` removed; lint still refuses an
  empty list outside MMI.
- MMI presets: Standard MMI-veileder 2.0 (Tabell 1, names verified against the .txt), Forenklet
  (100 to 600, 350 = «Klar for siste kontroll før arbeidstegning»), MMI for gjenbruk (0 to 600
  phase «Ny», 700 Bevares, 800 `[WRITE]`, 900 Gjenvinning/avfall).
- MMI and Etasjeoppsett: click builder («+», «Legg til alle»; storeys from the model) and
  per-step templates (`.mmi.xlsx`, `.etasjer.xlsx`, same sheets as the workbook).
- Fase, Materiale / Produkt, Mengdetype write `projectLayer.phase.sources` and
  `projectLayer["material-product"]`; the standard layer's sources show first
  (`engine/standard-sources.ts`).
- «Lagre oppsett» stores the ruleset in localStorage and returns to the board.
- Type leads only where the evaluator can: a type is checked through its Name, so Typer is the
  default for an attribute source, Forekomster for a property.

## Board

- One tab per model under the AppBar; inactive panels stay mounted.
- IDS tab is a report: Standardkrav rows, then one row per specification, requirement and result,
  model, Scope and Detail beside it. A specification shows its title; ▸ discloses the facets.
  KPI cards, treemaps and MMI bars left the tab.
- Innhold is the content rollup: QTO table (ears Klasse · Type · Systemkode · Komponentklasse ·
  Etasje · Materiale; Antall · Volum · Areal · Lengde; Sum row), Etasje × klasse, the treemaps
  (mapped where a mapping exists), MMI bars, Typer ledger.
- Treemaps are flat, one level, with Antall · Volum · Areal · Lengde ears. A parent-coded object
  gets its own tile.
- A Scope row isolates and frames its element; the list stays, the same row again steps back.
- Object panel: «Grunnleggende» instead of «Attributter»; Pset_*Common properties left that
  section (they show under their set).

## PDF

- «Eksporter PDF»: the mottakskontroll report HTML/CSS ported to TS (`src/mottakskontroll/`),
  one PDF per model plus the project PDF, printed by the browser. Blocks the browser does not
  measure print as not measured; undecidable verdicts print `[WRITE]`. Never printed live yet.

## Fixes along the way

- `src/ui/types/facts.ts` imported without `.ts`, so the selftest never ran under node.
- The IDS report merge deleted `MMI_SIZES` and `bestFilled`, still used by `layoutContents`;
  restored before deploy.

## Learned

- IDS `partOf IFCRELASSIGNSTOGROUP` (system membership) is `not_evaluable`: ifcfast exposes no
  group relations. Filed EdvardGK/ifcfast#215.
- Assemblies: in IDS a part is checked on its own (no inheritance). Example in
  `WIP Architecture model.ifc`: IfcStair `0dhuWxFczAEf1__ECjQtHh` aggregates a flight and two
  stringers (`0dhuWxFczAEf1__ECjQtLe`); the stair has no geometry. The no-mesh check already
  excludes such assemblies; counts and code coverage count stair and parts separately.

## Open, edkjo's call

- Assembly rule: strict (IDS), inherit from the assembly, or split (codes, MMI, phase, copy on
  the assembly; materials and QTO on the parts). Proposed split.
- POFIN's recommended list for «Grunnleggende»: not in the workspace, needs the spreadsheet.
- Names that differ between board and walk: Kopiobjekt / Duplikat objekt, MMI / Prosesstatuskode.
- Standardkrav rows on the IDS tab: title plus ▸ like IDS rows?
- «Åpne IFC» on the landing page and AppBar vs «Last opp IFC» in the walk; ✕ on model tabs;
  Kildetype «Attributt».
- Gjenbruk 800 name and phase.

## Loose ends

- `GITHUB_SECRET` (EdvardGK) in `~/.claude/.env` returns 401; `gh` is logged in as EdvardGK.
- An old `vite preview` from 10:53 holds port 4199 (PID 55536), not started by this session.
