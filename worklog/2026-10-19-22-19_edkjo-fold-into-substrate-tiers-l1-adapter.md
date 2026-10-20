---
project: ifc-check
date: 2026-10-19
author: edkjo
---

# ifc-check folds into the substrate: tiers, plan, L1 adapter (step 1)

Coordinator on Opus. Three read-only mapping/planning agents, one build agent in its own worktree.
Plan posted on [#13](https://github.com/Ed-Skiplum/ifc-check/issues/13#issuecomment-6272262060).
Step 1 merged to main (`fc8c6fb`) and pushed. main had 21 earlier commits sitting unpushed, and
they went up with it. Not deployed (no UI change).

## Direction (edkjo)

- Apps build on the shared IFC substrate. Inntun is the information suite, with no individual apps.
  ifc-check is the one-off check and should not stay a separate app. "You lead for all apps."
- Tiers:

| Tier | Who | Gets |
|---|---|---|
| Free | anyone, no account | IFC check reports |
| Uttun | paid account | statefulness + project management |
| Inntun | Skiplum clients | full suite (befaring/sitewalk, delivery) |

- Uttun is for showcasing and Inntun is pure delivery and value creation. But the goal is for Uttun
  to be the default go-to for most BIM coordinators, so it gets the same check quality, not a teaser.
- My mapping: free stays in the browser (instant, nothing stored); Uttun and Inntun go through the
  substrate. One TS engine serves both.
- Supersedes the 2026-10-05 "network of standalone apps, ifc-check stays stateless" direction
  (memory updated).

## Findings

- Inntun already has most of ifc-check's views (Oversikt, Typer, Materialer, Krav, Mottakskontroll,
  Modell). No Inntun view reads L1 at runtime; it reads JSON exported into the repo. The
  mottakskontroll is run by hand.
- The substrate runs only the parse and model-diff on upload. Where verdicts should be stored was
  `[OPEN]` in platform docs.

## Plan (summary; full text on #13)

- **Runner:** an `ifc-check-runner` container on skiplum-apps-1, wired like model-diff, enqueued
  from `app_substrate_complete`. It reuses the TS engine through an L1 adapter.
- **Config:** one doc, the konto `uttun/requirements` krav tree. The Ruleset is compiled from it.
- **Output:** a `kind: report`, `tool: ifc-check` file, plus a `model_check_job` index row and a
  `GET /api/projects/:id/checks` read route.
- **Decided by me:** the krav tree is canonical, and checks run on every parsed version.

## Step 1: L1 adapter + parity

- `src/engine/l1-graph.ts`: `l1ToGraph(tables, manifest)`. Pure TS. Anything L1 lacks goes into
  `unobserved`, never a default.
- `scripts/l1-fetch.ts`: read only, through the signed-in platform CLI, with a sha256 check per
  table.
- `scripts/l1-parity.ts`: exits 1 on any check difference. Dev dependencies `hyparquet` and `fzstd`
  are used by the scripts only.
- **Parity on KNM** (konto project 81ecb52d), ARK v3, RIB v3, RIE v3 and RIV v2: all 12 fundamentals
  match wasm in verdict and counts, and every product field matches. RIV v3 was skipped at 3.4 GB
  free.
- **Adapter bug fixed:** properties owned by types are excluded (wasm psets don't carry them).
- The storey difference for parts that the planner expected didn't show up: both parsers resolve a
  part's storey through its whole.
- **Substrate gaps** (to file on platform): whole-file duplicate STEP id count, a `unit_resolved`
  flag, representation item chain, type PredefinedType/Description, IfcMapConversion/CRS and site
  placement.
- **Untested:** IfcSpace (KNM has none) and a model with an unresolved unit.
- **Verification:** tsc and the parity script, run locally against production L1 (read only).

## Next

- Step 2 (platform `model_check_job`, enqueue, service and read routes, staging) is briefed, with
  worktree `platform-wt-model-check` on branch `feat/model-check-job`. The memory gate blocked the
  spawn (commit headroom 1.4 GB, AoE2 running). Start when memory frees.
- File the substrate gaps as `substrate-gap` issues on Ed-Skiplum/platform.
- Open with edkjo:
  - Inntun requirements source: konto `uttun/requirements` or sprucelab EIR?
  - Does «Ignorer» exclude objects from checks?
