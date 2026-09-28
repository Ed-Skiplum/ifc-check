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
  standard/                 the standard layer: standard.yaml, standard_psett.yaml, code tables
  rapport/                  report treatment: tokens.css, mottakskontroll.css, brand mark
  mal/prosjekt.yaml         project config template
  requirements.txt
```

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
| `uten_rapport`, `faggrupper` | fagkoder with no report; avvik workbook groups (unlisted model = own group) |
| `skjema` | accepted/recommended schemas, replaces the standard's |
| `merknader`, `merknader_modell` | the report's only sentences |
| `etiketter`, `verdiktord`, `kpi_terskler`, `terskel_gyldig` | merged key by key over the standard |
| `standard`, `kpi_band`, `kpi_alle` | replace the standard's whole |

Relative table paths (`kodetabell`, `kodeliste.fil`, `mengdetype[].tabell`) resolve in
`standard/`; a project table is given as an absolute path.

## Round config

One JSON per round, in the project repo.

| key | |
|---|---|
| `dato` | round date; keys the cache |
| `eksport` | export name, printed |
| `kilde` | folder of the export, relative to the project config's directory; its name is printed |
| `modeller[]` | `label`, `fil`, `sha16` (first 16 of sha256; a mismatch stops the build), `firma`, `versjon`, `lastet_opp`, `merknad`, optional `kilde` |

## Not yet config

Project names still in the measuring code, moved as-is: the `HI90_Prosjektinfo` set and its
`HI90_*` properties in `bep_egenskapskontroll.py`, `HI90_Type` in `blokkdata.py`,
`HI90_Kopi objekt` in `bygg_avvik.py`, and the `pset` requirement id in `bygg_mottakskontroll.py`.
