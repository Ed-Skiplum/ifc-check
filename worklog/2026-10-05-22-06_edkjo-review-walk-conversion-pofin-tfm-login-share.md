---
project: ifc-check
date: 2026-10-05
author: edkjo
---

# UI review, walk conversion, POFIN, TFM, Typenavn, login, share store

`6c1ee42` → `cddc8ff` on main (56 commits, including merges), one day. Nothing pushed yet;
edkjo deployed twice with `skiplum/internal/infra/apps-server/deploy.sh ifc-check` (the deploy
is blocked for the session by the permission classifier). Worked as coordinator on Fable; every
build agent ran Opus in its own worktree under `.claude/worktrees/`, assessments ran Fable.
Verification was tsc and the selftest (495/495 at the end), then from mid-day rendered
screenshots in headless Chrome (`scripts/walk-shots.mjs`, `tmp/walk-pass/round0..11`), and
edkjo looked live. The relay is not in the compose stack, so nothing under `/relay/*` is live.

## Review (live, start of day)

- Board: no first-screen verdict; project rules only on the IDS tab (by design since e88a2fc,
  AGENTS.md was stale); the IDS table contradicted its detail; the Etasjedefinisjon card said
  100 % on a red Deviation; names differ between board and Setup; Graph tab blank once.
- Walk: ~18 clicks plus typing, every step a config form on a card, nothing proposed, no end
  screen, free-jump rail, download buttons on every step. Old RuleBuilder unreachable.
- Fixed: Kopiobjekt counts (blank = own object, `ruleCounts` in trace.ts) and the storey card
  headline (storeys matching, not storeys present).

## Direction edkjo set (saved in memory `app-network-direction`)

- ifc-check is one focused, standalone app: upload IFC, set config, get answers (model vs
  config, IFC fundamentals, a splash of health insights). Not the front door to anything.
- Network of apps that hand data on, but every app takes an IFC directly; a hand-off is a
  shortcut. "IFC is the delivery mechanism, our data model is the verified and QAQC layer."
- Deep diffing (type identity surviving a rename, new/edited/missing types) and the type and
  materials bank are sprucelab-level; sprucelab has accounts, versions, a type bank and a
  name-keyed diff already, but no fact fingerprint and only partial material layers.
- ifc-check gets accounts via the lightweight Skiplum login (konto.skiplum.com), not sprucelab,
  so a project is set up once and the tool is reused weekly. Shallow diff at most.
- Mengdetype is assessed, not checked: only a recommended master unit on the type aggregation.
- Share: hosted (relay store), HTML as the web-native full report, PDF as the face of the
  Excel. The HTML content question (report page vs board snapshot) is still unanswered.

## Walk as it stands

- First screen «POFIN» / «Egendefinert»; POFIN prompts «Gjennomgå» / «Aksepter oppsett», every
  row opens its step pre-filled and returns. `pofinRuleset()` assigns Typenavn, Systemkode
  (RefPriSysOcc), Funksjonskode (RefCompOcc), Duplikat (DuplicateOwnedBy), MMI (ProcessStatus,
  format only), IFC4+. Pset properties left out: POFIN states no class applicability.
- Last opp IFC is the whole stage (dashed target, drop anywhere, auto-advance on ready); no
  bar, counter or skip there. Segments: green only when checked against the loaded model,
  hatched for a saved answer not yet checked.
- Mapping steps (Systemkode, Funksjonskode, MMI, Duplikat): Krav line (list pill + three example
  codes), then three cards «Standard» / «Funnet i modellen» / «Velg selv», action row directly
  under, «Avansert» for regex, Forekomster/Typer, switch, templates. Standard is always listed
  with its real count; a saved source with 0 hits never wins the pre-pick; dates and quantity
  sets never count as codes; a candidate named after the list ranks first.
- Typenavn: coverage from the existing Typeobjekt check, naming scheme as a part sequence
  (NS 3457-8, NS 3451, Siffer, Bokstaver, Deltegn, Tekst, Godtatte, Mønster) in the shared
  ChipRow; From box names the type classes and shows samples. No alternative source exists
  (the check reads the type's Name only).
- TFM: `src/engine/tfm.ts` ported from tfm-check (Statsbygg PA 0802 default), shape plus
  per-part agreement with Systemkode, Funksjonskode, Etasje and a Lokasjon property; Rom and
  the numbers are shape only; no translation between code lists.
- Mengdetype step removed; «Ledeenhet» column on the type ledger. Python report and the Excel
  template still mention mengdetype.
- Numbers: the step, the landed strip and the summary read the same report row; the walk counts
  what the rule selects («Fysiske elementer»).

## Accounts and share

- `src/account/`: `/api/me`, sign-in via `/api/continue?to=`, sign-out, ruleset as state doc
  (tool `ifc-check`, kind `ruleset`, key = file name, `ifAbsent` adoption, `baseVersion`).
  Invisible until the platform allows the origin: filed as Ed-Skiplum/platform#1.
- `relay/share.mjs`: POST/GET/DELETE `/share`, sandboxed CSP, 8 files / 5 MB / 12 MB, 180 days.
  Not deployed (no relay container in the stack); no client side yet.
- Excel download no longer refused for a format-only MMI (reader dropped `codes: []`).

## Process lessons

- Three agent-built walk variants went to edkjo before any screen had been rendered; he
  rejected every one. From then on each UI change was rendered at his window size and read by
  me and by an independent Fable critique before he saw it. Rule saved in data-workspace.md.
- Composition cannot be delegated as "zones": the three-card step only landed once the layout
  was specified element by element. Earlier briefs described the pieces and got boxes.
- "Saved source first" as the pre-pick made another project's property look like the app's
  assumption. Standard first, saved as "saved".
- Agents report "nothing seen in a browser" honestly; the coordinator has to act on it.

## Open

1. Deploy the relay (compose + volume; `relay/DEPLOY.md`) and the platform origins (platform#1).
2. HTML report content for Share: mottakskontroll page or board snapshot.
3. First-screen rebuild: model vs config · fundamentals · health insights; what happens to the
   other tabs.
4. Project chooser once several configs exist per account.
5. Walk leftovers: progress bar wider than the column at 2092/2560; MMI pre-pick of
   `Construction.Default Thickness` (value 400); failing values no longer shown on the mapping
   step; Materiale / Produkt is two decisions on one screen; red-before-deciding on Typenavn
   unanswered; Python report and Excel template still carry mengdetype.
6. New labels awaiting edkjo: Avansert, Hopp over, Ingen treff, Oppsummering, Kun format, Tekst,
   Siffer, Bokstaver, Deltegn, Ledeenhet, Fysiske elementer, Funnet i modellen, Velg selv,
   Egendefinert, Gjennomgå, Aksepter oppsett, Logg inn, Logg ut.
