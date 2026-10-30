# mottakskontroll

The mottakskontroll report engine: measures a round of delivered IFC models against a project
config and renders one PDF per model, a project PDF, the workbook and the avvik workbooks.
Python, separate from the browser app in `src/`. Moved from the HI90 project repo
(Ed-Skiplum/ifc-check#3); the report itself is unchanged.

The engine holds no project path. What varies per project is its config: the project config,
the round config, and any code table the project brings.

## Layout

```
mottakskontroll/
  kjor.py                   the entrypoint: measure and render one round
  bep_egenskapskontroll.py  step 1: counted set, GUIDs, Type 1:1      -> <cache>/bep/<dato>/
  struktur.py               step 2: storeys, site, georeferencing     -> <cache>/struktur/<dato>/
  blokkdata.py              step 3: the blocks per object (run by the builder) -> <cache>/blokker/<dato>/
  bygg_mottakskontroll.py   step 4: beregnet.json, PDFs, workbook     -> <ut>/
  bygg_avvik.py             step 5: avvik workbooks per faggruppe     -> <ut>/
  konfig.py                 merges standard/standard.yaml with the project config
  stier.py                  arguments and path rules
  step.py                   streaming STEP reader for struktur.py
  standard/                 the standard layer: standard.yaml, standard_en.yaml (English words), standard_psett.yaml, code tables
  rapport/                  report treatment: tokens.css, mottakskontroll.css, brand mark
  mal/prosjekt.yaml         project config template
  requirements.txt
```

## Counted set

The objects every requirement is measured over, the same for all projects (standard.yaml
`standard`): an `IfcElement` with 3D geometry, of none of the `ikke_telt` classes (openings,
virtual and geographic elements, building element parts). A part of an assembly is not counted
either (`ikke_telt_del_av`): an element decomposed through `IfcRelAggregates` from another
`IfcElement` (a stair flight, stringer or railing of an `IfcStair`, a plate or member of an
`IfcCurtainWall`, anything in an `IfcElementAssembly`). Its owner is the object checked, and is
counted also when its 3D geometry sits in its parts only. A part aggregated into the spatial
structure (storey, space) is unaffected. `data.json` records the parts left out per model under
`ikke_telt_grunn.del_av_element`.

## Run it on another box

Needs Python (tested on 3.12) and Chrome, Chromium or Edge (PDF print; `$CHROME` overrides the lookup).

```bash
git clone https://github.com/Ed-Skiplum/ifc-check.git && cd ifc-check
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r mottakskontroll/requirements.txt
python mottakskontroll/kjor.py --ifc EXPORT_DIR --prosjekt krav.yaml --runde runde.json --ut OUT_DIR
```

| argument | |
|---|---|
| `--ifc DIR` | the round's IFC files. Omitted: each model's `kilde`, else the round's `kilde`, relative to the project config's directory |
| `--prosjekt` | project config (below) |
| `--runde` | round config (below) |
| `--ut DIR` | outputs; `<ut>/data/beregnet.json` is the computed round every output renders from |
| `--cache DIR` | measurements; default `<ut>/cache`. Keyed by date and file sha, so one cache can serve many rounds |
| `--ny` | measure again, ignoring the cache |
| `--kun-rendering` | no measuring: render from the cache as it lies (the experiment loop). Still reads the IFC files for sha256 and schema |
| `--kun-standard` | the standard layer only, no project context |

Each step also runs alone with the same arguments (`bygg_mottakskontroll.py --kun-rendering ...`).

## Project config

One YAML per project, the `krav.yaml` shape. Template: `mal/prosjekt.yaml`. `konfig.py` refuses
a config that still carries a `<FROM PROJECT` placeholder, the same sentinel as
`src/ids/config-template.ts`.

Must declare (the engine reads these unconditionally):

| key | |
|---|---|
| `prosjekt.kode`, `prosjekt.navn` | output file prefix, file-name rule, report header |
| `fagkoder` | discipline codes: file-name grammar, copy-object values |
| `modeller` | every model label a round can carry, with `fagkode` and `kopi_eier` |
| `krav` | the requirement register the blocks and the matrix refer to by id |
| `kpi`, `bruk` | workbook numbers and use cases; may be empty lists |
| `forventet` | `filnavn`, `koordineringsobjekt`, `plassering`, `georeferering`, `mmi.koder`, `kopi_objekt.sanne_verdier` |

May declare:

| key | effect |
|---|---|
| `blokker[]` by standard id | `sted` / `sted_telleobjekt` / `sted_mengdeobjekt` REPLACE the standard location; any other key overrides. Unknown id: error |
| `forventet.etasjer`, `forventet.typenavn` | storey table and type-name rule; absent: not checked |
| `forventet.mmi.fase` | MMI code -> phase; Fase is then read at the MMI location |
| `blokker[].utelatt` | `true` on a requirement in the project layer takes it out of the report entirely: not measured, no matrix row, block or deviation sheet. The type gallery keeps its field, shown unfed as «–» (HI90 drops Produkt; products/EPDs per type will come from another source) |
| `blokker[].unntatt` | `{fag: [fagkode], modell: [label]}`: the requirement does not apply to those models. It is measured, but the block reads «gjelder ikke» there, and its code list or material gallery is left out of that model's report (KNM: IsExternal only for the owners the BEP names) |
| `blokker[].gjelder_fra_mmi` | a whole number: the requirement applies per object from that MMI. An object whose MMI is below it is outside the requirement's denominator, as an out-of-scope class is, and gives no deviation row; with no object due, the block reads «gjelder ikke». MMI is read at the `mmi` block's `sted`, which must then be configured. An object with no MMI, or a value that is not a whole number, counts as due, since it cannot be shown to be below. On `systemkode`, `funksjonskode`, `produkt`, `materiale`, `kopiobjekt` and the opt-in blocks. Values are still read for the type gallery and the mengdetype analysis |
| `prosjektpsett` | the project property set `bep_egenskapskontroll.py` counts: `navn`, `egenskaper[]` `{navn, regel}` with `regel` one of `tre_sifre` (the form only), `ns3451` (three digits and a code in the NS 3451 table: 360 fails, 361 passes), `ns3457` (a code in the NS 3457-8 table), `fagkode` (a value from `fagkoder`), `lik_typenavn` (equals `IfcTypeObject.Name`, and the Type 1:1 pairing), `utfylt`; optional `krav` (the krav id measuring the set, named in other krav's `krever`) and `navnedel` (sets whose name contains it are listed as found instead). Absent: nothing of it is measured, and a krav reading it is «ikke konfigurert» |
| `egenskapskontroll` | the same check in the other shape (konfig.egenskapskontroll; one of the two, not both): `pset`, optional `psetnavn_inneholder` (default `pset`) and `krav` (default the krav id `pset` when there is one), `egenskaper[]` `{navn, maaler, samle, kopi}` plus at most one rule: `monster` (regex), `godtatte` (values), `kodetabell` (its codes) or `lik_typenavn: true` |
| `blokker[]` of an opt-in standard block (`valgfri` in standard.yaml) | the block is measured and reported only when listed; its title and text are the `tittel` and `maaler` of the krav it ties, else `[WRITE]` |
| `seksjoner`, `blokker[].seksjon` | the project's own report sections, `[{id, tittel}]` in report order, REPLACING the standard's (`ifc_helse`, `standardkrav`). `tittel` may be left out for a standard id, which keeps the standard's title. Every block in the report names one in `seksjon` (a standard block keeps its own unless the project sets it), else the run stops. Blocks run section by section, in the order the project lists them in `blokker`, then in the standard's order. Without `seksjoner`, sections and order are the standard's |
| `uten_rapport`, `faggrupper` | fagkoder or model labels with no report; avvik workbook groups (unlisted model = own group) |
| `skjema` | accepted/recommended schemas, replaces the standard's |
| `merknader`, `merknader_modell` | the report's only sentences |
| `spraak` | report language: `nb` (default, the standard layer as written) or `en`. With `en` every engine-owned word (labels, verdict words, the standard's section and block titles and requirement texts, KPI titles, the counted-objects note) comes from `standard/standard_en.yaml`, dates print as ISO 8601, decimals with a point, and the HTML carries `lang="en"`. Text the project writes (block `tittel` and `krav_tekst`, `krav` titles and `maaler`, its section titles, merknader) prints as written, so an English report needs those in English too. A key in `standard.yaml` `etiketter` or `verdiktord` with no English entry stops an English run |
| `etiketter`, `verdiktord`, `kpi_terskler`, `terskel_gyldig` | merged key by key over the standard (over the English table when `spraak: en`) |
| `standard`, `kpi_band`, `kpi_alle` | replace the standard's whole |

Table paths (`kodetabell`, `kodeliste.fil`, `mengdetype[].tabell`): absolute as given; a bare
name that exists in `standard/` is the standard's table; any other relative path resolves against
the project config's directory. A bare name present in both places is an error.

## Round config

One JSON per round, in the project repo.

| key | |
|---|---|
| `dato` | round date; keys the cache |
| `eksport` | export name, printed |
| `kilde` | folder of the export, relative to the project config's directory; its name is printed |
| `modeller[]` | `label`, `fil`, `sha16` (first 16 of sha256; a mismatch stops the build), `firma`, `versjon`, `lastet_opp`, `merknad`, optional `kilde` |
