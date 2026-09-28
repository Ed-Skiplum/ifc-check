# ifc-check: guide for an agent helping a user

For an agent that sets up a user's project config and gets them useful results.
Extending the tool is `AGENTS.md`; this file only links into it.
Onboarding a Skiplum project's mottakskontroll follows the skill
`~/.claude/skills/mottakskontroll-config/SKILL.md` (ask, look, suggest; the user
confirms). This guide is the ifc-check side of that loop and does not override it.

## 1. What the tool answers

- Live: https://ifc-check.skiplum.com · embedded at skiplum.com/uttun/verktoy/ifc-check
- Everything runs in the browser (WebAssembly). Files never leave the user's machine.
- Tabs, per model:

| Tab | Answers |
|---|---|
| **Oversikt** | general model health: the twelve fundamentals, `mesh-placement`, `storey-config`, then the ruleset's rules under "Regler" |
| **Innhold** | what is in the model: Klasser, Etasje × klasse, the type ledger |
| **Graf** | the model as a drill (building, storey, class, product) with the element's `IfcRel*` edges |
| **Typer** / **Materialer** | type and material extraction |
| **Prosjekt** | project requirements (Standardkrav cards, mapped treemaps, MMI bars) plus the IDS table |

- **Oppsett** (`#page=setup`) edits the floor config and the four mappings, then downloads the ruleset.
- Without a ruleset the tool still answers everything in Oversikt/Innhold/Graf/Typer/Materialer.
  The ruleset adds the project's own requirements.

## 2. The config file (the ruleset JSON)

One JSON file per project. Schema: `src/ids/ruleset.schema.json`
(`node scripts/ids-cli.ts schema`). Required keys: `formatVersion`, `name`, `ifcVersions`, `rules`.

| Part | What it does | Report row |
|---|---|---|
| `storeys` | floor config (Etasjeoppsett): name + elevation in **metres**. Every file storey must match one entry on name (case-sensitive) and elevation | `storey-config` |
| rule `mapping: "system-classification"` | where the NS 3451 code lives, looked up in bundled `ns3451` | Systemkode |
| rule `mapping: "component-classification"` | where the NS 3457-8 code lives, looked up in bundled `ns3457-8` | Komponentklasse |
| rule `mapping: "progress-code"` | where MMI lives, and the project's accepted codes (`values`) | Prosesstatuskode (MMI) |
| rule `mapping: "copy-object"` | a **scope filter**: matching objects are excluded from every other rule. Never a finding | Duplikat objekt |
| `projectLayer` | the project's additions to `ifc-schema`, `phase`, `material-product`: extra sources appended after the IFC standard's, and an accepted list that replaces the standard's | report only |
| other `rules` | `kind: "ids"` (exports to .ids) or `kind: "extended"` (checks IDS cannot express) | one row each |

Details: AGENTS.md "Rulesets", "Project mappings", "The standard layer".

### Template

JSONC for reading. It is **not valid until every comment is removed and every
`<FROM PROJECT>` is replaced**; lint refuses it otherwise, on purpose. Delete any
part the project has no evidence for: an absent part reports `not_configured`,
which is the honest answer.

```jsonc
{
  "formatVersion": 1,
  "name": "<FROM PROJECT: project short name>",
  "description": "<FROM PROJECT: BEP version and section the config was taken from>",
  "ifcVersions": ["IFC2X3", "IFC4"],          // metadata for emitted .ids; gates nothing

  "storeys": [                                // BEP storey table; omit if the BEP marks levels TBD
    { "name": "<FROM PROJECT: storey name, exact>", "elevation": "<FROM PROJECT: metres, number>" }
  ],

  "projectLayer": {
    "ifc-schema": { "accepted": ["<FROM PROJECT: IFC2X3 | IFC4 | IFC4X3>"] },  // replaces [IFC2X3, IFC4]
    "phase": { "sources": [ { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } } ] },
    "material-product": {
      "mengdetype": [ { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } } ],
      "product":    [ { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } } ],
      "material":   [ { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } } ]
    }
  },

  "rules": [
    { "id": "system-classification", "kind": "extended", "mapping": "system-classification",
      "name": "<FROM PROJECT>", "description": "<FROM PROJECT: BEP §>",
      "check": { "type": "code-lookup", "list": "ns3451",
        "source": { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } },
        // or { "classification": { "system": "<FROM PROJECT>" } } or { "attribute": "Name" }
        "extract": "<FROM PROJECT: JS regex, exactly one capture group = the code>" } },

    { "id": "component-classification", "kind": "extended", "mapping": "component-classification",
      "name": "<FROM PROJECT>", "description": "<FROM PROJECT: BEP §>",
      "check": { "type": "code-lookup", "list": "ns3457-8",
        "target": "occurrence",               // "type" reads type Names; attribute source only
        "source": { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } },
        "extract": "<FROM PROJECT>" } },

    { "id": "progress-code", "kind": "extended", "mapping": "progress-code",
      "name": "<FROM PROJECT>", "description": "<FROM PROJECT: BEP § with the MMI table>",
      "check": { "type": "code-lookup",
        "values": ["<FROM PROJECT: every accepted MMI code, as text>"],
        "source": { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } },
        "extract": "<FROM PROJECT>" } },

    { "id": "copy-object", "kind": "extended", "mapping": "copy-object",
      "name": "<FROM PROJECT>", "description": "<FROM PROJECT: BEP §>",
      "check": { "type": "code-lookup",
        "values": ["true", "false"],          // boolean flag; or codes mode: ["<FROM PROJECT: fagkoder>"]
        "source": { "property": { "propertySet": "<FROM PROJECT>", "name": "<FROM PROJECT>" } },
        "extract": "<FROM PROJECT>" } }
  ]
}
```

Rules of the format a user will trip on:
- At most one rule per mapping role (`mapping-duplicate`). The role is `mapping`, not `id`.
- `extract` is a JavaScript regex, not anchored implicitly, exactly one capture group.
- Never name an abstract IFC class in an entity facet; use `"group"` (`physicalElement`, `builtElement`, ...).
- A real minimal example: `examples/knm.ruleset.json`. A full one (test fixture, not a project):
  `examples/hi90-project-layer.test.ruleset.json`.

## 3. Fill it from evidence, never guessing

Order of evidence: **the BEP/EIR sets the value; the model shows where it actually is.**
Model content is evidence for a suggestion, never the source of an accepted value
(the skill's hard rule).

1. **See what the models carry:**
   ```bash
   node scripts/ids-cli.ts psets --examples 10 A_ARK.ifc A_RIV.ifc A_RIB.ifc > psets.json
   ```
   Per set: `objekter`, `klasser`; per property: `med_verdi` / `tom` / `mangler`, `eksempler`, `ulike`.
   `kategori` `ifc` = a buildingSMART template set; `krevd` = named by the loaded ruleset; `annen` = the rest.
2. **Read the BEP/EIR** for: pset and property names, code list per classification, the MMI table,
   the copy/reference convention, the storey table, accepted IFC schema.
3. **Diff the two.** Where they agree, propose the value with both sources cited.
4. **Ask the user when they disagree.** Do not pick one.
5. **Check what is configured and what is not:**
   ```bash
   node scripts/ids-cli.ts report --ruleset project.ruleset.json A_ARK.ifc > report.json
   ```
   Every `not_configured` row is an open item, not an error.

### Worked example: Eksempelprosjekt (EKS)

A real case with the project name and identifiers obscured.

- **Pset name.** An older BEP says `EKS_Prosjektinfo`; the current BEP says `EKS_Project`, with
  properties `MMI`, `RefClass_NS3451`, `RefClass_NS3457-8` (hyphen), `IsReference`. Confirm in
  `psets` output which one the models actually carry before writing it.
- **NS 3451, three conventions.** The BEP says property `RefClass_NS3451`; the EIR says
  `IfcClassificationReference`; one discipline model writes `721_NS3451` as a string in
  Name/ObjectType. That is a question for the user, not a choice for the agent. Each answer is a
  different `source`.
- **MMI.** The BEP's tables list 100/200/300/350/400/500/600, a later section uses 250, a model
  writes `MMI 200/250`. Ask whether 250 is accepted before writing `values`.
- **Storeys.** The BEP marks elevations TBD, so the config carries no `storeys` until the user
  supplies them. Never copy elevations from a model into the config as if they were the requirement.
- **Component class.** The BEP says type names follow `[ComponentCode]-[nn]`, hence
  `target: "type"`, source `Name`, extract `^([A-Z]{2,3})-\d{2}$`.

## 4. Hand it over

1. **Lint first**, always:
   ```bash
   node scripts/ids-cli.ts lint project.ruleset.json
   ```
   Errors block download in Oppsett and are refused by the CLI. Warnings are worth reading.
2. The user opens the app and drops their IFCs, then the ruleset JSON (or **Åpne regelsett**).
   An `.ids` goes on the Prosjekt tab (**Åpne IDS**); it runs as written and does not become the ruleset.
3. Explain the non-results. They are answers, not bugs:

| State | UI | Means | Tell the user |
|---|---|---|---|
| `not_configured` | ikke konfigurert | no home in the IFC standard and no project config | "The project has not said where this lives. Give me the BEP section and I'll add it." |
| `not_evaluable` | Kan ikke vurderes | the parser cannot answer; the row carries the reason | quote the reason; it is a tool limit (section 7), not a model fault |
| `not_applicable` (IDS) | Ikke anvendt | the applicability matched nothing | the spec never ran. Usually a wrong class or pset name in the .ids. Never a pass |
| `not_applicable` (checks) | N/A · Ikke relevant | nothing matched, or no floor config for `storey-config` | nothing was established |

## 5. Get results out (headless)

Node 24 runs the TypeScript directly; no build. Run from the repo root.

```bash
node scripts/ids-cli.ts report --ruleset project.ruleset.json *.ifc > report.json   # every requirement × model
node scripts/ids-cli.ts psets  --ruleset project.ruleset.json *.ifc > psets.json    # every pset and property, with fill
node scripts/ids-cli.ts ids    project.ids *.ifc --max-findings 0 > ids.json        # an .ids as written; 0 = every finding
node scripts/ids-cli.ts run    project.ruleset.json *.ifc                           # the ruleset's rules only
node scripts/check-cli.ts --ruleset project.ruleset.json *.ifc                     # fundamentals, human-readable
```

One JSON document on stdout, UTF-8. Progress and errors on stderr.

| Exit | Means |
|---|---|
| 0 | clean (`warn` and `not_configured` count as answers) |
| 1 | something failed, or a model could not be read |
| 2 | usage or internal error |
| 3 | nothing failed but something was `not_evaluable`: **the answer is unknown, not a pass** |

**What to show the user first:**
1. The failing requirements: `report.rows` with `state: "fail"`, then `warn`. Per row: `id`
   (or `mapping`), model file, `dekning.avvik` and `dekning.mangler` over `dekning.grunnlag`.
2. For each, the elements: `funn[].guid` (full GlobalId, never truncated), `klasse`, `grunn`, `verdi`.
   For IDS: `models[].specs[]` with `state: "fail"`, `failed` of `applicable`, `findings[].guid`.
3. Then `not_evaluable` rows with their `grunn`, then `not_configured` as the open config list.
4. `fordeling` shows what values the model actually carries; useful when a user asks "what did they write instead?"

Report vocabulary (keep these words): grunnlag, oppfylt, avvik, mangler, gjelder_ikke, kilder,
fordeling, funn, godtatte. Full contract: AGENTS.md "Report contract".

## 6. Rules for the helping agent

- **No mock data.** Every number shown comes from a run on the user's files. Say which files and which command.
- **Do not invent requirements.** A value not in the BEP/EIR or confirmed by the user stays unconfigured.
- **State facts with sources:** BEP §, file name, `psets` count. "Probably" is not a source.
- **Ask before assuming a convention** (which pset, which code list, whether a code like MMI 250 is accepted).
  One question per real fork; don't ask what the documents already settle.
- **Norwegian terms as the report and UI use them** (avvik, mangler, Ikke anvendt, Etasjeoppsett).
  Don't coin translations.
- A model that passes because nothing applied has not passed. Say so.
- Don't write the user's comments or deliverable prose for them.

## 7. Known engine limits a user will hit

- **Type properties are folded onto occurrences.** A type object's own psets are read through the elements using it; no row is keyed by the type.
- **Unused types' psets are invisible.** A declared type nothing uses has no rows at all.
- **Type targets read the attribute `Name` only.** `target: "type"` cannot take a property or classification source.
- **No `IfcRelAssignsToGroup`, no `IfcRelNests`.** "Element is in a system" is `not_evaluable`.
- **Storey containment only.** An element contained directly in IfcSite, IfcBuilding or IfcSpace has no container here and fails a containment requirement (e.g. an IfcGeographicElement placed in the site).
- **Attributes: GlobalId, Name, ObjectType, Tag, PredefinedType only.** Others are `not_evaluable`.
- **No geometry or georeferencing rules.** Those questions cannot be authored as rules.
- **XSD regex vs JavaScript regex.** Exotic `xs:pattern` can behave differently from a conforming IDS auditor.
- **Reserved NS 3451 codes fail** like unknown codes; no ruleset field accepts them yet.
- **Reals lose the trailing point** (`400.` reads `"400"`), so a real and a label `'400'` count as one value in `psets`.
