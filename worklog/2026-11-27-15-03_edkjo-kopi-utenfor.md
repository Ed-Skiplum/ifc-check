---
project: ifc-check
agent: subagent, «copy/reference objects out of every check, reported only as their own count» (mottakskontroll engine)
date: 2026-11-27
branch: feat/kopi-utenfor
---

# 2026-11-27 — Copy objects out of every count

## Ask
edkjo 2026-11-27: «we need to have the "filter away reference/copy objects" in the dash and data
checks overall. Anything that is a ref object is not subject to that model and therefore not valid
data to check or use downstream for anything other than visualization in a vaccuum. So we need to
strip those from the data extraction and only show them as their own layer for documentation».
Supersedes 2026-09-29 «A copy stays in every other requirement».

## Done
- `mottakskontroll/konfig.py`: `KOPI` (the one place), set by `sett_omfang` from the `kopiobjekt`
  block's `sted`, `forventet.kopi_objekt` and `modeller.<label>.kopi_eier`. `er_kopi_verdi` is the
  single value rule (moved from the builder), `kopi_verdi(e)`, `er_kopi(v, label)`,
  `kopiobjekt(e, label)`; `i_omfang(e, label)` drops copies. Stops on: sted without
  `forventet.kopi_objekt`, a model not in `modeller` with an owner value, an
  egenskapskontroll/prosjektpsett copy property other than the block's sted. `utelatt` Kopiobjekt =
  no marker.
- `bep_egenskapskontroll.telte(sti, f, label)`: copies out of the counted set after `ikke_telt_verdi`,
  `info["kopier"]`; `ikke_telt_grunn.kopiobjekt`, tellegrunnlag text, cache key (`konfig_nokkel`)
  only when a marker is configured.
- `blokkdata.mål`: label into telte and i_omfang (Typeobjekt set, pset gallery, KPI band), `kopier:
  {n, verdier}` in the block cache, `registerhash` with KOPI.
- `bygg_mottakskontroll.py`: `er_kopi` delegates to `konfig.er_kopi_verdi`; `kopi_gyldig` shared by
  the distribution and the copy tally; `utenfor_omfang` prints «kopiobjekter holdt utenfor ×N» and
  «kopiobjekter med ugyldig verdi ×N» on Kopiobjekt only; `beregnet.json` block `kopier: {n, ugyldige}`.
- `standard.yaml` / `standard_en.yaml`: labels `kopier_holdt_utenfor`, `kopier_ugyldig`; the rule and
  quote on the kopiobjekt block.
- Docs: `docs/config-template.md`, `docs/agent-guide.md`, `mottakskontroll/README.md` («Copy objects»
  section, `ikke_telt_verdi` row no longer cites KNM IsReference).
- Tests: `mottakskontroll/tests/test_kopi.py` (pytest, synthetic IFC4, 6 walls, both marker shapes,
  end to end through side workbook, struktur, blocks, HTML, avvik and type workbooks). Scratch in
  `mottakskontroll/tests/_tmp/` (gitignored).

No cache version bump: the new keys enter `konfig_nokkel` / `registerhash` only when a marker is
configured, so projects without one keep their caches and behave as before.

## Numbers
Fixture (6 walls): no marker n 6; boolean marker n 6 → 4, kopier 2; owner marker as T_ARK n 6 → 3,
kopier 3 (1 invalid value), as T_RIB n 6 → 2, kopier 4. Every other block's grunnlag = own objects;
no copy GlobalId in any workbook.

Projected from existing caches (read only, `guid_kopi` values with the new rule; no round re-run):
- KNM 2026-11-23: KNM_ARK 982 → 871 (111 IsReference TRUE), the other five models unchanged.
- HI90 2026-10-21 cache: HI90_RIV_MMI700 20 820 → 2, HI90_RIV_MMI800 6 369 → 81,
  HI90_RIE_Utsparinger 70 → 0, HI90_RIE 1 338 → 1 257, HI90_RIB_MMI900 80 → 63, HI90_ARK 3 473 → 3 454.
  The RIV MMI subsets carry «RIV», which their `kopi_eier` does not name, so they read as copies of
  the main model. Decision for edkjo before the next HI90 round (HI90 is off-limits for broad
  changes): intended, or add «RIV»/«RIE» to those subsets' `kopi_eier`.
- G55: not derivable from the cache (G55_EIES has no tally there).

## Gates
- `python -m pytest mottakskontroll/tests -q`: 9 passed.
- `node scripts/ids-cli.ts selftest`: 572/573; the one failure («every string the browser report
  prints is in standard.yaml»: seksjon_hygiene «Hygiene», a Typeobjekt krav_tekst) fails identically
  on unmodified main. Pre-existing, not touched.

## Not changed
- Browser engine (`src/`): already a scope filter (evaluate.ts `excludedGuids`, AGENTS.md
  «copy-object is a SCOPE FILTER»).
- File-level geometry (georef bbox from all meshes, struktur base points): placement of the file,
  not object data.
- GUID på tvers now reads own objects only: a GUID own in two models still fails; a GUID that is a
  copy everywhere (owner model not in the round) no longer shows.
- Client `krav.yaml` files: not edited (contradicting comments listed in the PR).

## Open
- edkjo: the HI90 MMI-subset consequence above.
- Client comments to update by their sessions: KNM krav.yaml «A copy stays in every other
  requirement (edkjo 2026-09-29)»; G55 krav.yaml «engine gap» note on G55_EIES.
