---
project: ifc-check
date: 2026-10-07
author: edkjo
---

# Oppsett v2, NS 3451 level, Ignorer, Fase via MMI, ifcopenshell verdict cache, Materialer tabs

`175ac72` → `6e3aa79` on main (18 commits, 7 merged branches), 2026-10-06 to 10-07. Not pushed.
edkjo deployed with `skiplum/internal/infra/apps-server/deploy.sh ifc-check` several times; the
last deploy (bundle `index-BOOI6xG-.js`) carries everything below. Coordinator on Opus; builds by
Opus agents in their own worktrees. Verification per change: tsc + `node scripts/ids-cli.ts
selftest` (573 assertions, 0 failed at the end), plus local headless renders for the Oppsett
layout (`scripts/oppsett-shots.mjs`, `tmp/oppsett-v2*/`). Nothing below was looked at in a
browser by me on the deployed site except the bundle check.

## Oppsett v2 (replaces the walk)

- edkjo on the walk: "extremely painful … clunky and unintuitive and verbose", "what is in the
  model is obscure". Shape he chose: a sidebar listing every requirement, a wizard per item; a
  mapping step where defaults can be accepted but model data and custom rules are as easy.
- `src/ui/oppsett/`: `OppsettPage.tsx`, `Krav.tsx`, `Columns.tsx`, `items.ts`, `judge.ts`,
  `merge.ts`, `Phase.tsx`, `phase-mmi.ts`. Mounted at `#page=setup`; old `SetupPage.tsx` and
  `setup/*` stay in the tree, unmounted (pieces reused).
- Sidebar: requirement rows (status, name, hit %, source, POFIN/IDS tag), «Legg til krav»
  (fixed kinds + «Egenskap» custom property as an IDS rule on physical elements), «Lagre».
- Wizard: header (Forrige / Neste, Ignorer, delete), Krav editor always open (edkjo: no toggle),
  then I modellen (every pset/property with counts and samples, Standard and Forslag pinned,
  «Ikke i modellen» for a property not in the model yet) with Kilde and its value table in a
  300 px panel beside it (edkjo: the values pushed the mapping down).
- Layout: one centered scrolling column, max 1280 px, sticky sidebar (edkjo: "a centered column
  rather than a full width UI … like basecamp or fizzy" / HEY).
- IDS drop merges, never replaces: one requirement per role and per `Pset.Property`; a differing
  value rule becomes a conflict row (Behold IDS / Behold nåværende) that blocks Lagre; unreadable
  specs listed with the importer's reason. Origin tag stored in the rule's `reference`.

## Requirements

- NS 3451 level: `CodeLookupCheck.minLevel` (2 or 3), a code shorter than the level fails as
  finding `level`; Krav pills «Nivå 2» / «Nivå 3+»; examples, value table and candidate ranking
  follow it; xlsx column «Nivå». POFIN unset.
- Ignorer per project: `Ruleset.ignore?: string[]`, same id space as `ModelFact.exempt`, one
  `notApplicable()` lookup; ignored rows are not_applicable («Gjelder ikke») on every model;
  xlsx column «Ignorert» on Prosjekt; IDS export excludes ignored rules.
- Fase via MMI: Status / MMI switch; phase table (rename, add, delete phases; click code chips,
  then a phase row, to assign). Picking MMI fills a format-only MMI rule from «MMI for gjenbruk»
  (Ny / Bevares / Gjenvinning/avfall; 800 still the [WRITE] placeholder). Engine was already
  there (`CodeEntry.phase`, `{ progressCode: {} }`); sprucelab has no MMI→phase model (fixed
  stages only), so nothing was ported from it.

## Ruleset persistence

- The browser copy (`ifc-check.ruleset`) is gone; an old one is dropped on load (edkjo: an old
  session's source kept coming back as «Egendefinert»). Signed in, the account copy stays.
- A reset of an edited ruleset (Fjern, loading another ruleset file) asks «Vil du lagre
  regelsettet som en fil til neste gang?» Ja (downloads .ruleset.json) / Nei / Avbryt; leaving
  the page with unsaved edits gets the browser's generic prompt.

## ifcopenshell second check

- Root cause of the many «Uten geometri, ikke verifisert»: models restored from the IndexedDB
  cache have no File, so the check never ran. A fresh drop verified fine live (61 MB HI90 ARK in
  ~27 s, Pyodide 0.28.3, ifcopenshell 0.8.5).
- Fix: verdicts stored per cache key in a new IDB store `verdicts` (DB v1 → v2), reused on
  restore when verifier versions match; «ikke verifisert» now says why everywhere. Models cached
  before this need one re-drop; an old open tab blocks the DB upgrade.

## Materialer

- Materialer / Layer sets moved from a switch inside the facet row to tabs above it (edkjo: "The
  split was not intuitive with other filters", "one is an ingredient, the other a recipe").
- "Layer sets have materials not in materials" did not reproduce: HI90_ARK 22.09 has 21 material
  cards covering all 16 layer materials, counts agree (same on 7.09 to 26.09). Likely causes:
  sort by count puts furniture materials first; the facet selection is shared between tabs.
  Selftest now guards the agreement.
- Material card swatch uses the layer category fill/hatch (`layer-section.ts`); metal now ranks
  before wood, so «Stenderverk stål» reads as steel.

## Open

1. Under «Nivå 3+», is a valid but too shallow code (`23`) an error or a warning? edkjo: "the
   only error is none or code that isn't verifiable against the standard". Asked, unanswered.
2. «Nivå 2» label vs «Nivå 2+» (asked).
3. Use-case readiness (edkjo's idea, e.g. Reduzer needs NS 3451 3+): noted, shape not set.
4. Projects setup: next priority per edkjo ("we need to move to the projects setup fast"); what a
   project holds in v1 not yet stated.
5. Norwegian label for the «Layer sets» tab.
6. Shared facet selection across Materialer / Layer sets tabs: keep or split.
7. Relay not deployed: `/relay/*` answers 405 live, so ifcfast-miss chips read «Innsending
   feilet». Needs a relay service + route in apps-server (asked, unanswered).
8. Constituent and profile material sets are not resolved by ifcfast (role `unknown`);
   IfcMaterialList is not shown as a recipe.
9. New labels awaiting edkjo: Legg til krav, Kilde, I modellen, Fra modellen, Forslag, Brukt av,
   Ikke i modellen, Ingen kilde, Behold IDS, Behold nåværende, Nåværende, Utfylt, Slipp IFC og
   IDS, Ikke lest, Nivå 2, Nivå 3+, Ignorer, Ignorert, Legg til fase, Ja, Nei.
10. Old walk (`SetupPage.tsx`, `setup/*`) still in the tree, unmounted; remove once edkjo is
    happy with v2.
