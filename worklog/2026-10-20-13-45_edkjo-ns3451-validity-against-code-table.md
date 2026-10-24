# 2026-10-20 — NS 3451 validity against the code table, not just the form

## Problem
HI90 mottakskontroll accepted `^\d{3}$` as a valid NS 3451 code. Group codes padded with a zero
(320, 360, 370, 310, 230) passed, but they are not codes: 36 is the group Luftbehandling, 361 is its
first three-digit code. Same flaw in the BEP property check (`regel: tre_sifre`).

## Done
- `standard/standard.yaml` systemkode: `kodetabell: kodetabell_ns3451.yaml` beside `gyldig`.
- `blokkdata.py`: systemkode valid = form AND code in the table (`sk_gyldig`). The cache key
  (`registerhash`) already hashes `kodetabell`, so old measurements are invalidated.
- `bygg_mottakskontroll.py`: one code table per requirement (`kodetabeller`), used by both
  systemkode and funksjonskode distributions (`ford_kodetabell`).
- `bep_egenskapskontroll.py` + `konfig.py`: new rules `ns3451` (three digits + in table) and
  `ns3457` (in the NS 3457-8 table). `SJEKK_VERSJON` 4, table bytes in `konfig_nokkel`.
- README and `mal/prosjekt.yaml` document the rules.
- HI90 `krav.yaml` (hi90 repo, uncommitted like the rest of `prosjektpsett`): `HI90_NS3451: ns3451`,
  `HI90_NS3457-8: ns3457` (was `utfylt`).

## Verified (today's round, scratch output)
- Systemkode avvik: RIV 91 -> 29 654 (320/360/370/310), RIB 9 -> 16 (230). ARK/RIE unchanged.
- BEP HI90_NS3451: RIV 100 % -> 0 %, RIB_MMI700 100 % -> 99 %. HI90_NS3457-8 RIV 64 % -> 46 %.

## Notes
- Not committed: branch `feat/hi90-v1-port` carries other uncommitted work in the same files.
- The krav.yaml change alone triggers the live watcher's next hourly rebuild + Dalux upload.
- Running kjor.py straight against the HI90 krav folder fails ("tabell finnes både i ...") because the
  folder holds copies of standard tables; stage as `_stage_project_config` does.

## Later the same day: Produkt out of the HI90 report
- edkjo: the team puts products in `HI90_Material` for single-product types. Type cards keep the
  Produkt field, but it is not fed from the model. Products and EPDs per type will come from another
  source later (Cobuilder or similar).
- Engine: project-layer `utelatt: true` on a requirement. It is not measured (`blokkdata.les_register`),
  dropped from `Register.blokker` (no matrix row, block or Avvik sheet), and listed in `Register.utelatt`.
  Type cards and the Typer sheet show an unfed field as a neutral «–» (`IKKE_MATET`), never ✗.
- HI90 `krav.yaml`: `produkt: utelatt: true`.

## Went live 13:36
Katja's RIE v18 triggered the watcher. It rebuilt with the working tree (both changes) and uploaded
11 reports. Checked against the delivered PDFs: Produkt only on type cards («–»); Systemkode avvik
RIV 29 654, RIB 16, RIE 190 (new export).
