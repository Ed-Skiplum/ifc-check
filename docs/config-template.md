# The project config: model and workbook

One config per project. The model (`src/ids/types.ts`, JSON Schema
`src/ids/ruleset.schema.json`) is the contract; the engine and the report
read it. The workbook (`src/ids/xlsx.ts`) and the `.ids` file are views of
it. Nothing in the model knows about Excel, XML or React.

Source: Ed-Skiplum/ifc-check#7.

## 1. Model, formatVersion 2

formatVersion 1 files are refused (lint `format-version`). Breaking changes
from 1: `storeys` is an object, `check.values` is gone, `copy-object` has its
own check, `enabled` is `false` or absent.

```ts
interface Ruleset {
  formatVersion: 2;
  name: string;
  description?: string;
  ifcVersions: IfcVersion[];
  info?: RulesetInfo;
  storeys?: StoreySetup;
  disciplines?: Discipline[];
  models?: ModelFact[];
  projectLayer?: ProjectLayer;
  rules: Rule[];                      // kind "ids" | kind "extended"
}

interface RuleBase {
  id: string;
  name: string;
  description?: string;               // what the rule checks
  reference?: string;                 // where it comes from: "BEP §6.12"
  instructions?: string;
  enabled?: false;                    // present only to switch a rule off
}

type CodeSource =
  | { attribute: string }
  | { property: { propertySet: string; name: string } }
  | { classification: { system?: string } }
  | { material: {} };                 // IfcRelAssociatesMaterial, material names

interface CodeEntry { code: string; name: string; phase?: string }

interface CodeLookupCheck {
  type: "code-lookup";
  list?: CodeListId;                  // a bundled list, or
  codes?: CodeEntry[];                // the project's own list, with names
  target?: "occurrence" | "type";
  source: CodeSource;
  extract: string;
}

interface CopyObjectCheck {
  type: "copy-object";
  source: CodeSource;                 // not material
  copy: string[];                     // values that mark a copy outright
  own: string[];                      // values that mark this file's own object
}

type StoreyPlane = "OKFG" | "OKBD";
interface StoreyTolerance { aboveMm: number | null; belowMm: number | null }  // null = no limit

interface StoreySetup {
  reference?: string;
  plane: StoreyPlane;                 // what every elevation is measured to
  tolerance: StoreyTolerance;         // file minus level, 0/0 = exact
  nameWindowMm: number | null;        // same name: read as the level within this, null = any distance
  nearMm: number;                     // other name: read as the level within this
  levels: { name: string; elevation: number }[];   // metres to `plane`
  disciplines?: {                     // a discipline measuring to another plane
    discipline: string;
    plane: StoreyPlane;
    tolerance: StoreyTolerance;
    requireAllNames: boolean;         // the tolerance holds only when every level matches by name
  }[];
}

interface Discipline { code: string; report?: false }

interface ModelFact {
  label: string;                      // the IFC file name without extension
  discipline: string;                 // a Discipline code
  group?: string;                     // models reported together; absent = its own
  ownerNames?: string[];              // copy-object values naming this model as owner
  exempt?: string[];                  // requirement ids that do not apply to this model
}

type PhaseSource = CodeSource | { progressCode: {} };

interface ProjectLayer {
  "ifc-schema"?: { reference?: string; accepted?: string[]; recommended?: string[] };
  phase?: { reference?: string; sources?: PhaseSource[] };
  "material-product"?: {
    reference?: string;
    mengdetype?: CodeSource[];
    product?: CodeSource[];
    material?: CodeSource[];
  };
}
```

IDS rules (`IdsRule`, the six facets, `IdsValue`) are unchanged.

### Rationale per new concept

| Concept | Why this shape |
|---|---|
| `reference` | #7 point 10: the citation is not the description. One field, on every rule, on `storeys` and on each `projectLayer` part. |
| `enabled?: false` | #7 point 9: one spelling. Absent = on. `true` is refused by the schema. |
| `{ material: {} }` | #7 point 2: material names from IfcRelAssociatesMaterial, own before type's. Valid as a code-lookup source. In `material-product.material` it is refused: the standard layer already reads it first. |
| `codes` | #7 point 6: a project code list carries names. Replaces `values`, so a list of codes has one shape. |
| `CodeEntry.phase` | #7 point 4: the phase is a column of the MMI table. Only on the `progress-code` rule's codes. |
| `{ progressCode: {} }` | #7 point 4: phase read through the MMI code. A phase source only. Needs an enabled `progress-code` rule with phases. |
| `recommended` | #7 point 5: a subset of `accepted`. Recommended passes; accepted only is `warn` («Kan brukes»). |
| `CopyObjectCheck` | #7 point 7: ownership. Blank, an `own` value or one of this model's `ownerNames` = the file's own object. A `copy` value, or any other value, = a copy, excluded. Compared ignoring case and whitespace. The check type is the role: at most one per ruleset, no `mapping` field (`mapping` names the three code-lookup roles). |
| `StoreySetup` | #7 points 3 and 11: the plane is part of the level table. Tolerances, windows and discipline overrides are how levels are matched, so they sit with them. |
| `Discipline` | #7 point 8: fagkoder, and models without a report (`report: false`). |
| `ModelFact` | #7 point 8: per model label, its discipline, group, owner names and exemptions. Label = file name without extension, exact. |
| `exempt` | ids are report row ids: a fundamental, `storey-config`, `mesh-placement`, `body-no-mesh`, `ifc-schema`, `phase`, `material-product`, a mapping role, or a non-mapping rule's id. The row is `not_applicable` for that model. |

### Engine and report

- `storey-config`: per file storey, in order: same name within tolerance = match;
  same name after trim = whitespace; same name within `nameWindowMm` =
  elevation mismatch; another name within `nearMm` = name mismatch; else not
  in config. A discipline override applies to models of that discipline;
  with `requireAllNames` only when every level is matched by name and no file
  storey is outside the table. The row carries `referanseplan` and
  `toleranse_mm`.
- `copy-object`: a model not in `models` (when `models` is declared) makes
  the filter `not_evaluable`, nothing excluded. Values outside `copy`, `own`
  and every model's `ownerNames` are tallied `deviating`, never a finding.
  One owner name may sit on several models: it is read one file at a time.
- `ifc-schema`: with `recommended`, a recommended family passes; accepted only
  is `warn` with the value unflagged; the row carries `anbefalte`.
- `phase`: a `progressCode` source gives the code's phase (accepted) or, for a
  code without one, the raw value (avvik). `godtatte` adds the table's phases.
- `progress-code` row carries `koder` (code, name, phase).
- `progress-code` with `codes: []` checks the format alone: a value the
  `extract` matches passes, one it does not match fails, blank is missing.
  The schema allows the empty list on every code-lookup; lint refuses it
  (`code-values-empty`) on any other rule. A new MMI rule starts so, with
  extract `^(0|\d{3})$` (`defaultExtract`). Presets for the list:
  `src/codelists/mmi-presets.ts`.
- `ReportModel` carries `label`, `discipline`, `group`, `report`.
- An exempt requirement is `not_applicable` in `run`, the checks
  (`src/engine/exempt.ts`) and `report`.

## 2. Workbook

Row 1 Norwegian label, row 2 field path, data from row 3. Columns keyed by
row 2. Lesmeg is first, in English, for the agent filling it, and never read.

| Sheet | Rows | Model |
|---|---|---|
| Lesmeg | decision rule, sheet map, conventions, column reference | none |
| Prosjekt | one | `formatVersion`, `name`, `description`, `ifcVersions`, `info.*` |
| IDS | one per specification | `rules[]` kind `ids`: id, name, description, reference, instructions, identifier, ifcVersions, min/maxOccurs, requirements.description, enabled |
| IDS-fasetter | one per facet | facets of a specification, by `spec`, `part` (applicability, requirements), `facet` |
| Klassifikasjon | one per role | `system-classification`, `component-classification` |
| MMI | one | `progress-code` |
| MMI-koder | one per code | `progress-code` `check.codes[]` |
| Kopiobjekt | one | `copy-object` |
| Etasjeoppsett | default row (Fag blank), one per discipline override | `storeys` minus `levels` |
| Etasjer | one per level | `storeys.levels[]`; the Kote header names the plane |
| Fag | one per discipline | `disciplines[]` |
| Modeller | one per model | `models[]` |
| Standardkrav | one per part | `projectLayer.<part>` reference, `ifc-schema` accepted and recommended |
| Kilder | one per source | `projectLayer` source lists |
| Andre regler | one per rule, JSON | extended rules without a role, and a role rule its sheet cannot spell |

IDS-fasetter columns: Spesifikasjon, Del, Fasett, IFC-klasse, Klassegruppe,
PredefinedType, Attributt, Egenskapssett, Egenskapsnavn, Datatype, System,
Relasjon, Verdi, Verdiliste, Mønster, Grunntype, Min, Maks, Over, Under,
Lengde, Min lengde, Maks lengde, URI, Kardinalitet, Instruksjon. A value is
a literal (Verdi) or a restriction (every IDS 1.0 restriction facet). Names
are literals. A rule needing more (a restriction on a name, an entity
`name`) is refused by the writer, naming the rule and the construct.

Reader rules:
- A row whose value cells are all blank is not declared: dropped. Key cells
  (Kilder/Standardkrav Krav, Klassifikasjon Rolle, Aktiv, Rapport) do not
  count.
- A row with a value filled and a required cell blank is refused at that cell.
- Aktiv and Rapport take TRUE or FALSE. Blank is refused.
- Lists are comma-separated. A blank tolerance or window cell = no limit.
- Rule order out of a workbook: IDS, Klassifikasjon, MMI, Kopiobjekt, Andre regler.

Step templates (Oppsett, MMI and Etasjeoppsett): `writeCodesXlsx` /
`writeLevelsXlsx` write a workbook holding only the MMI-koder or Etasjer
sheet, same layout and codec; `readCodesXlsx` / `readLevelsXlsx` read that
sheet from such a file or from a full config workbook, and replace that
table only. Files: `<name>.mmi.xlsx`, `<name>.etasjer.xlsx`.

## 3. .ids

`emit --ids` (CLI) and **Last ned** `<name>.ids` (Oppsett) write the enabled
`ids` rules as one IDS 1.0 file; `emit` validates it against the bundled XSD
(`vendor/ids-schema`, offline). `ids2xlsx` puts an `.ids` into the IDS
sheets of a config, replacing its `ids` rules. `reference` is not carried
into the .ids: IDS has no field for it.
