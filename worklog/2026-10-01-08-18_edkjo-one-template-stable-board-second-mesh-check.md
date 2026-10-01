---
project: ifc-check
date: 2026-10-01
author: edkjo
---

# One template, a stable board, a second mesh check

Four days, `b5b1164` → `20bcf4f` (125 commits). Every step was deployed to https://ifc-check.skiplum.com
with `skiplum/internal/infra/apps-server/deploy.sh ifc-check` and pushed to Ed-Skiplum/ifc-check
with the Skiplum token. Worked as coordinator, with agents in separate worktrees.

## Repo and identity

- 62 unpushed commits rewritten from `ed.subscript@gmail.com` to `edvard.kjorstad@skiplum.no`
  (edkjo ran `filter-branch`), then pushed. The repo stays on Ed-Skiplum; issues are signed
  `edkjo, ifc-check/work`. Pushing needs the URL-embedded `GITHUB_SECRET_SKIPLUM`, because Git
  Credential Manager holds EdvardGK (memory: repo-identity).
- `tests/fixtures/private/` is untracked and gitignored. The real-named examples were already
  on GitHub before that, so they stay in history.
- PR #6 merged: the mottakskontroll Python engine now lives in `mottakskontroll/`.
- #4 closed. #7 answered point by point and left open on three decisions.

## Config

- Excel template, then one workbook for IDS and non-IDS rules on ruleset model v2:
  - IDS sheets and an `.ids` export, checked against the XSD;
  - rule sheets that cover HI90's krav.yaml gaps: storey plane and tolerances, MMI → phase,
    recommended vs accepted schema, coded lists with names, Kopiobjekt as ownership, per-model
    facts;
  - Lesmeg written for an agent.
- HI90's config migrated as a private fixture. Material counts match HI90 exactly.
- Open, edkjo's call: name matching (exact, as in IDS, vs HI90's case- and space-insensitive),
  phase order, an upgrade path for v1 files.

## Engine and checks

- `body-no-mesh` check. ifcopenshell (Pyodide plus the 0.8.5 wheel) now runs in the background
  after every load on every element ifcfast left unmeshed. Labels read «ikke verifisert» until it
  finishes. Misses become «ifcfast-feil». On HI90_ARK_MMI700, 19 walls are ifcfast misses.
- `relay/`: sanitized ifcfast-miss reports, stored in SQLite (one row per signature) and filed
  to EdvardGK/ifcfast once `IFCFAST_ISSUES_TOKEN` exists. Log-only without it.
  `file-pending.mjs` files later. NOT LIVE: nettside-studio (owner of apps-server) staged an
  owner-run script for edkjo.
- Spaces are out of the treemaps. LongName is read from the STEP bytes.
- The model cache is per tab session (sessionStorage id, 2 h purge).

## UI

- **Tabs:** Oversikt, IDS (was Prosjekt), Modell, Innhold, Typer, Materialer, Rom, Graf.
- **Oversikt:** IFC health only.
  - Left column: Verifikasjon over Scope.
  - Right edge: properties full height.
  - Body: KPI row, model, Etasjer over Klassifikasjon (unweighted code chips).
  - Treemaps moved to Innhold. 12 px frame, every row and column used.
- **New tabs:**
  - Rom: room schedule by name or storey, 3D/Plan.
  - Modell: pure viewer.
  - Graf: one stage plus a small live window; double-click swaps; two-way selection.
- **Typer and Materialer:** facet pills (class, codes, IsExternal/LoadBearing/FireRating,
  Ubrukt, Én forekomst).
- **Selection is its own state.** A click selects, never filters. Esc clears the selection,
  then the filter.
- **One teal highlight** (`--sel`) for every chosen or selected thing. The origin marks without
  dimming.
- **Object panel:** tabbed themes (Attributter, Relasjoner, Egenskaper, Beregnet), set ears
  inside Egenskaper. Shows «Velg en forekomst for å se detaljer» with nothing selected.
- **Fixes:**
  - the app fits the window;
  - no nested scrollers;
  - stable layout (nothing moves on a click);
  - keyboard access, ARIA tabs;
  - AA contrast on Innhold;
  - whole header readouts;
  - one name per thing;
  - «Uten geometri» shows the model ghosted;
  - «Ingen objekter».
- **UI/UX review** (Fable, live) found 10 issues, all fixed. Headless checks pass at 1440,
  1920, 2133 and 2112.

## edkjo's rulings (canon written)

`resources/design-system/data-workspace.md`:
- stable layout;
- selection visible everywhere, highlight only;
- one highlight colour;
- origin marks, doesn't dim;
- Esc escalates;
- 12 px frame margin;
- object panel is tabbed.

`spatial-workspace.md`: the no-geometry filter.

## Platform

The Skiplum account platform was planned, skeleton-built, security-reviewed and fixed in
`skiplum/internal/platform`, then handed to nettside-studio, which owns it now. Rulings:
- free is stateless;
- paid means hosted state;
- the CLI runs client-side with a server quota;
- lightweight CRUD, separate from Inntun/sprucelab;
- blobs in R2.

## Process lessons

- RAM was the bottleneck all session: edkjo's Chrome and Solibri held 5 to 14 GB. Agents
  serialized and gated headless runs.
- Agent reports explained away real failures ("moved on select: YES" called structural). Read
  the tables, not the summaries.
- The permission check blocked an agent from adding edkjo's own UI string. Surfaced; done after
  his explicit permission.
- Coordination with other sessions is pre-authorized (memory: coordinate-without-asking).

## Next steps

1. **Relay live:** edkjo runs nettside-studio's staged script, then checks
   `curl https://ifc-check.skiplum.com/relay/ifcfast-miss`. Later: the fine-grained EdvardGK
   token, then `file-pending.mjs`.
2. **Innhold overhaul:** asked and unanswered (what it should cover and answer).
3. **#7 decisions:** name matching, phase order, v1 upgrade.
4. **Smaller questions waiting on edkjo:**
   - Back button with a filter;
   - «HELE MODELLEN» per card or per row;
   - Klassifikasjon always visible;
   - hover in teal;
   - the empty Typer material row;
   - Scope gone from Typer/Materialer.
5. **Gate scripts out of date with the new layout:** `module-grid-gate.mjs` Overview block,
   `isolate-gate.mjs` 6c.
6. **Still English in the NB UI:** IDS and project-rule detail lines.
7. **Pyodide cost:** about 2.5 GB of browser RAM per load for the second check. Watch it live.
