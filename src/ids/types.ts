/** The ruleset model — a superset of buildingSMART IDS 1.0.
 *
 * IDS 1.0 cannot express several checks a model actually needs: its `relations`
 * enumeration has no IFCRELDEFINESBYTYPE, it has no uniqueness or cross-instance
 * operator, no geometry access, and no route to IfcMapConversion, IfcProjectedCRS
 * or IfcUnitAssignment. So a rule here is either `ids` (exports into a valid
 * .ids) or `extended` (lives in the ruleset only, never in the .ids).
 *
 * This file is the authoring contract. The JSON on disk has exactly this shape,
 * and schema.ts publishes it as a JSON Schema so a ruleset can be validated
 * before it is run.
 */

import type { CodeListId } from "../codelists/index.ts";

/* ------------------------------------------------------------------ values */

/** XSD simple types usable as a restriction base. Emitted with the xs: prefix. */
export type RestrictionBase =
  | "string"
  | "boolean"
  | "integer"
  | "double"
  | "decimal"
  | "date"
  | "dateTime"
  | "duration";

/** An xs:restriction. Every facet present is emitted; an empty object is an error. */
export interface Restriction {
  /** Default "string". */
  base?: RestrictionBase;
  enumeration?: string[];
  /** XSD regular expression. XSD anchors implicitly: it must match the whole value. */
  pattern?: string;
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  length?: number;
  minLength?: number;
  maxLength?: number;
}

/** A value constraint: a literal string, or a restriction. */
export type IdsValue = string | { restriction: Restriction };

/* ------------------------------------------------------------------ facets */

/** Conceptual class groups. Each expands to an explicit enumeration of CONCRETE
 *  classes, because the IDS entity facet matches an exact class and never a
 *  subtype: naming an abstract class matches nothing. See ifc-classes.ts. */
export type ClassGroup =
  | "product"
  | "element"
  | "physicalElement"
  | "builtElement"
  | "distributionElement"
  | "spatialElement"
  | "featureElement"
  | "elementType"
  | "typeProduct"
  | "group";

/** Exactly one of `classes`, `group` or `name`. */
export interface EntityFacet {
  /** Concrete IFC class names, uppercase. One emits a simpleValue, several an enumeration. */
  classes?: string[];
  /** Conceptual group, expanded to concrete classes at emit time. */
  group?: ClassGroup;
  /** Escape hatch: the raw IDS name value. */
  name?: IdsValue;
  predefinedType?: IdsValue;
}

/** Facet cardinality. `optional` is rejected on partOf by the XSD. */
export type Cardinality = "required" | "optional" | "prohibited";

/** The complete IDS 1.0 relations enumeration. There is no IFCRELDEFINESBYTYPE:
 *  "every element is typed" is not an IDS rule, it is an extended one. */
export type PartOfRelation =
  | "IFCRELAGGREGATES"
  | "IFCRELASSIGNSTOGROUP"
  | "IFCRELCONTAINEDINSPATIALSTRUCTURE"
  | "IFCRELNESTS"
  | "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT";

export interface PartOfFacet {
  entity: EntityFacet;
  relation?: PartOfRelation;
  /** Requirements only. XSD simpleCardinality: `optional` is not allowed here. */
  cardinality?: "required" | "prohibited";
  instructions?: string;
}

export interface ClassificationFacet {
  system: IdsValue;
  value?: IdsValue;
  /** Requirements only. */
  uri?: string;
  cardinality?: Cardinality;
  instructions?: string;
}

export interface AttributeFacet {
  name: IdsValue;
  value?: IdsValue;
  cardinality?: Cardinality;
  instructions?: string;
}

export interface PropertyFacet {
  propertySet: IdsValue;
  baseName: IdsValue;
  value?: IdsValue;
  /** An IFC defined type, ALL UPPERCASE. The XSD pattern is [A-Z]+. */
  dataType?: string;
  uri?: string;
  cardinality?: Cardinality;
  instructions?: string;
}

export interface MaterialFacet {
  value?: IdsValue;
  uri?: string;
  cardinality?: Cardinality;
  instructions?: string;
}

/** What a specification applies to. minOccurs/maxOccurs belong HERE, never on
 *  the specification — the XSD rejects them there. */
export interface Applicability {
  minOccurs?: number;
  maxOccurs?: number | "unbounded";
  entity?: EntityFacet;
  partOf?: PartOfFacet[];
  classification?: ClassificationFacet[];
  attribute?: AttributeFacet[];
  property?: PropertyFacet[];
  material?: MaterialFacet[];
}

/** What applicable entities must satisfy. The entity facet carries NO
 *  cardinality here — the XSD gives it `instructions` only. */
export interface Requirements {
  description?: string;
  entity?: EntityFacet & { instructions?: string };
  partOf?: PartOfFacet[];
  classification?: ClassificationFacet[];
  attribute?: AttributeFacet[];
  property?: PropertyFacet[];
  material?: MaterialFacet[];
}

/* ------------------------------------------------------------------- rules */

export type IfcVersion = "IFC2X3" | "IFC4" | "IFC4X3_ADD2";

export interface RuleBase {
  /** Stable, unique within the ruleset. Used in results and in the UI. */
  id: string;
  /** Human name. For an ids rule this becomes specification/@name. */
  name: string;
  /** What the rule checks. */
  description?: string;
  /** Where the requirement comes from: the BEP or manual section it is
   *  taken from ("BEP §6.12"). Not carried into the .ids: IDS has no field
   *  for a citation. */
  reference?: string;
  /** Guidance for the model author, carried into the .ids. */
  instructions?: string;
  /** Present only to switch the rule off: absent = on. A disabled rule is
   *  excluded from export and from evaluation. */
  enabled?: false;
}

export interface IdsRule extends RuleBase {
  kind: "ids";
  /** Overrides the ruleset's ifcVersions. Metadata only: it does NOT gate which
   *  files the rule runs against. */
  ifcVersions?: IfcVersion[];
  /** Machine-readable identifier carried into specification/@identifier. */
  identifier?: string;
  applicability: Applicability;
  requirements?: Requirements;
}

/** Element selection for an extended rule. Same facet shapes as an IDS
 *  applicability, without the occurrence bounds. */
export type Selector = Omit<Applicability, "minOccurs" | "maxOccurs">;

/** Every element in the selection must be linked to an IfcTypeObject.
 *  Not IDS: IFCRELDEFINESBYTYPE is absent from the relations enumeration. */
export interface ElementTypedCheck {
  type: "element-typed";
}

/** Attribute values must be unique. Not IDS: no cross-instance operator. */
export interface UniqueAttributeCheck {
  type: "unique-attribute";
  attribute: "GlobalId" | "Name" | "Tag" | "ObjectType" | "PredefinedType";
  /** "model" — unique across the whole selection. "class" — unique within each
   *  IFC class. Default "model". */
  scope?: "model" | "class";
  /** Default true: elements with no value are not compared. */
  ignoreEmpty?: boolean;
}

/** Each distinct type name in the selection must be used by between min and max
 *  elements. min 2 is "no types-of-one". Not IDS: counting is cross-instance. */
export interface TypeUsageCountCheck {
  type: "type-usage-count";
  min?: number;
  max?: number;
}

/** A model-level fact must satisfy a restriction. Not IDS: no facet reaches the
 *  header, IfcUnitAssignment or the parse statistics. Ignores `select`. */
export interface ModelMetadataCheck {
  type: "model-metadata";
  field:
    | "schema"
    | "length_unit"
    | "unit_scale"
    | "unit_resolved"
    | "authoring_app"
    | "project_name"
    | "duplicate_step_ids";
  value: IdsValue;
}

/** Where a code-lookup rule reads its value. Exactly one key.
 *
 *  All three are evaluable. A property is identified by SET plus NAME — never
 *  the name alone. A classification reads `identification`, which the parser
 *  normalises across schemas (IFC4 `.Identification`, IFC2x3 `.ItemReference`),
 *  and `system` narrows to one classification system when it is given.
 *
 *  An object carrying several values for the source (which only a
 *  classification realistically does) contributes the FIRST in file order, and
 *  the result carries a note counting the objects that had more. */
export type CodeSource =
  | { attribute: string }
  | { property: { propertySet: string; name: string } }
  | { classification: { system?: string } }
  | { material: MaterialSource };

/** The object's material names through IfcRelAssociatesMaterial: its own
 *  association, else the one its type carries; a layer set gives its layers'
 *  materials in order, the first is the value. No options: the key alone
 *  names the source. */
export type MaterialSource = Record<string, never>;

/** One code of a project's own code list. `name` is the code's meaning in the
 *  project's documents (the MMI table's description). `phase` is set only on
 *  the `progress-code` rule's codes: the phase the code implies (the MMI
 *  table's LCA column), read by a `{ progressCode: {} }` phase source. */
export interface CodeEntry {
  code: string;
  name: string;
  phase?: string;
}

/** Extract a code from a value and look it up in a bundled code list
 *  (src/codelists). Not IDS: a restriction tests the whole value, so a lookup
 *  of an extracted part would need the list enumerated into every pattern.
 *
 *  `target` "occurrence" (default) checks the elements `select` picks.
 *  "type" checks the types OF those elements, one per type Name: a type object
 *  is reached through the elements that use it, so a type no element uses is
 *  never a subject here (`type-unused` in the fundamentals counts those), only
 *  its Name is readable, and the source must be an attribute. */
export interface CodeLookupCheck {
  type: "code-lookup";
  /** A bundled code list. Exactly one of `list` and `codes`. */
  list?: CodeListId;
  /** The project's own code list, when no bundled list applies. Exactly one
   *  of `list` and `codes`. */
  codes?: CodeEntry[];
  target?: "occurrence" | "type";
  source: CodeSource;
  /** JavaScript regular expression with exactly one capture group; the group
   *  is the code. Not anchored implicitly. */
  extract: string;
}

/** Which objects are this file's own and which are copies of another
 *  model's: a SCOPE FILTER, never a finding. A copy is excluded from every
 *  other rule's selection, fundamentals included. The check type is the
 *  `copy-object` role: at most one per ruleset.
 *
 *  Per object, the value read from `source`, compared ignoring case and
 *  whitespace:
 *    blank                            the file's own object
 *    in `own`                         the file's own object
 *    in this model's `ownerNames`     the file's own object (`models`)
 *    in `copy`                        a copy
 *    anything else                    a copy: it names another owner
 *
 *  When the ruleset declares `models` and this file is not among them, the
 *  owner cannot be told: the rule is not_evaluable and nothing is excluded. */
export interface CopyObjectCheck {
  type: "copy-object";
  /** Not a material source. */
  source: CodeSource;
  /** Values that mark a copy outright (`true`, `ja`, `kopi`). */
  copy: string[];
  /** Values that mark the file's own object outright (`false`, `nei`). */
  own: string[];
}

/** A kodeledd of a TFM string (tverrfaglig merkesystem), named as tfm-check
 *  names them (`backend/engine/constants.py` PART_TYPES). */
export type TfmPart =
  | "Lokasjon"
  | "Rom"
  | "Systemkode"
  | "Etasje"
  | "Subnr"
  | "Løpenummer"
  | "Komponent"
  | "Komp.nr"
  | "T-suffiks";

/** A separator between kodeledd, as the character itself (tfm-check's
 *  SEP_TO_CHAR values; `mellomrom` is " "). */
export type TfmSeparator = "+" | "." | "-" | "_" | "/" | " " | "=" | "++";

/** One token of a TFM sequence: a part, a separator, or literal text. A
 *  part's `digits` locks it to exactly that many digits; only the digit
 *  parts take it (Etasje, Subnr, Løpenummer, Komp.nr, Rom). */
export type TfmToken = { part: TfmPart; digits?: number } | { sep: TfmSeparator } | { text: string };

/** The property carrying each element's TFM string, checked twice per
 *  element (src/engine/tfm.ts, src/ids/evaluate.ts):
 *
 *    shape      the whole string matches `sequence`
 *    agreement  a parsed part equals the element's own value where the part
 *               is bound: Systemkode to the system-classification rule,
 *               Komponent to the component-classification rule, Etasje to
 *               `storeys` (the element's storey as a level), Lokasjon to
 *               `bindings.Lokasjon`. Compared literally, never translated
 *               between code lists. Any other part, and a bound part whose
 *               rule or setup is absent, is checked for shape only.
 *
 *  The check type is the `tfm` role: at most one per ruleset. */
export interface TfmCheck {
  type: "tfm";
  /** Not a material source. */
  source: CodeSource;
  sequence: TfmToken[];
  bindings?: { Lokasjon?: CodeSource };
}

/** One part of a type name scheme (2026-10-05, edkjo: "it should be possible
 *  to set a naming scheme by regex or by accepted value lists" · "NS3457-8
 *  and NS3451 as options to select. Can also be a hybrid: List item one
 *  part, regex another part"): a bundled code list's codes, the project's
 *  own accepted values, a regular expression, or literal text. */
export type NamePart =
  | { list: "ns3457-8" | "ns3451" }
  | { values: string[] }
  | { regex: string }
  | { text: string };

/** The type objects' Name against a scheme, read through the elements that
 *  use each type (`typeSubjects`): one subject per type Name, a finding
 *  carrying the elements behind it (src/engine/type-name.ts). The check
 *  type is the `type-name` role: at most one per ruleset. */
export interface TypeNameCheck {
  type: "type-name";
  sequence: NamePart[];
}

export type ExtendedCheck =
  | ElementTypedCheck
  | UniqueAttributeCheck
  | TypeUsageCountCheck
  | ModelMetadataCheck
  | CodeLookupCheck
  | CopyObjectCheck
  | TfmCheck
  | TypeNameCheck;

export type ExtendedCheckType = ExtendedCheck["type"];

/** The project mappings: where in the IFC a project reads the concepts every
 *  project has but each one stores differently. At most one rule per role.
 *
 *  - `system-classification`, `component-classification`: a code-lookup rule
 *    carrying `mapping`, against a bundled `list`.
 *  - `progress-code`: a code-lookup rule carrying `mapping`, against the
 *    project's `codes`.
 *  - `copy-object`: the rule whose check is a `CopyObjectCheck`. It carries
 *    no `mapping` field: the check type is the role.
 *  - `tfm`: the rule whose check is a `TfmCheck`, the same way.
 *  - `type-name`: the rule whose check is a `TypeNameCheck`, the same way. */
export type MappingRole = CodeLookupRole | "copy-object" | "tfm" | "type-name";

/** The roles a code-lookup rule takes through its `mapping` field. */
export type CodeLookupRole = "system-classification" | "component-classification" | "progress-code";

export interface ExtendedRule extends RuleBase {
  kind: "extended";
  /** Set when this code-lookup rule is one of the project mappings. */
  mapping?: CodeLookupRole;
  /** Omitted for model-metadata; optional for code-lookup (omitted selects
   *  everything); required for every other element-scoped check. */
  select?: Selector;
  check: ExtendedCheck;
}

export type Rule = IdsRule | ExtendedRule;

/* ----------------------------------------------------------------- ruleset */

/** The info block of the emitted .ids. */
export interface RulesetInfo {
  title?: string;
  copyright?: string;
  version?: string;
  description?: string;
  /** Must be an e-mail address: the XSD enforces the pattern [^@]+@[^.]+..+ */
  author?: string;
  /** ISO date, YYYY-MM-DD. */
  date?: string;
  purpose?: string;
  milestone?: string;
}

/** The plane a storey elevation is measured to: OK ferdig gulv or OK
 *  bærende dekke. */
export type StoreyPlane = "OKFG" | "OKBD";

/** How far a file storey may sit from its level, in millimetres, file minus
 *  level. `aboveMm` bounds a storey higher than its level, `belowMm` one
 *  lower. null = no limit that way. 0 and 0 = exact. */
export interface StoreyTolerance {
  aboveMm: number | null;
  belowMm: number | null;
}

/** One level of the project's floor table. Order is the author's.
 *  `elevation` in METRES, measured to the setup's `plane`. */
export interface StoreyLevel {
  name: string;
  elevation: number;
}

/** A discipline that measures its storeys to another plane: its plane and
 *  tolerance replace the setup's for models of that discipline. With
 *  `requireAllNames` they hold only when every level is matched by a file
 *  storey of the same name and no file storey falls outside the table;
 *  otherwise the setup's tolerance applies. */
export interface StoreyDisciplineRule {
  /** A code from `disciplines`. */
  discipline: string;
  plane: StoreyPlane;
  tolerance: StoreyTolerance;
  requireAllNames: boolean;
}

/** The project's floor config (Etasjeoppsett): the level table, the plane it
 *  is measured to, and how a file storey is matched to a level. Checked by
 *  `storey-config` (src/engine/storey-config.ts). */
export interface StoreySetup {
  /** Where the table comes from ("BEP §3.2"). */
  reference?: string;
  plane: StoreyPlane;
  tolerance: StoreyTolerance;
  /** A file storey with a level's name is read as that level within this
   *  distance (mm); null = at any distance. */
  nameWindowMm: number | null;
  /** A file storey with another name is read as the nearest level within
   *  this distance (mm), a wrong name; 0 = only at the same millimetre. */
  nearMm: number;
  levels: StoreyLevel[];
  disciplines?: StoreyDisciplineRule[];
}

/** One discipline of the project (fagkode). `report: false` marks a
 *  discipline whose models get no report of their own (a coordinator's
 *  models, controlled where they are built). Absent = reported. */
export interface Discipline {
  code: string;
  report?: false;
}

/** What the project states about one model file. */
export interface ModelFact {
  /** The IFC file name without its extension (`EKS_ARK` for
   *  `EKS_ARK.ifc`), matched exactly. */
  label: string;
  /** A code from `disciplines`. */
  discipline: string;
  /** Models reported together share a group. Absent = the model is its own
   *  group. */
  group?: string;
  /** The copy-object values that name THIS model as the owner. */
  ownerNames?: string[];
  /** Requirements that do not apply to this model: report row ids
   *  (`REQUIREMENT_IDS`, a mapping role, or a non-mapping rule's id). */
  exempt?: string[];
}

export interface Ruleset {
  /** Bumped only on a breaking change to this format. */
  formatVersion: 2;
  name: string;
  description?: string;
  /** Default ifcVersion list for every ids rule. Metadata in the .ids; it does
   *  not gate which files a rule runs against. */
  ifcVersions: IfcVersion[];
  info?: RulesetInfo;
  /** The project's floor config. Absent = none: `storey-config` is then
   *  not_configured. */
  storeys?: StoreySetup;
  disciplines?: Discipline[];
  models?: ModelFact[];
  /** This project's layer on the standard requirements, keyed by the
   *  requirement's report id. Absent = the standard layer alone. */
  projectLayer?: ProjectLayer;
  rules: Rule[];
}

/** The report row ids the engine produces besides the rules: the
 *  fundamentals, the geometry and floor checks, and the standard layer.
 *  With the mapping roles and the non-mapping rule ids they are what
 *  `ModelFact.exempt` may name. The selftest asserts the engine emits
 *  exactly these. */
export const REQUIREMENT_IDS = [
  "parse-integrity",
  "spatial-chain",
  "storey-containment",
  "storey-in-building",
  "storey-elevation",
  "guid-unique",
  "element-named",
  "element-typed",
  "type-name-placeholder",
  "single-instance-types",
  "type-unused",
  "element-material",
  "storey-config",
  "mesh-placement",
  "body-no-mesh",
  "ifc-schema",
  "phase",
  "material-product",
] as const;

export type RequirementId = (typeof REQUIREMENT_IDS)[number];

/** The project layer on the requirements the tool ships with a standard
 *  layer for (src/engine/standard-layer.ts). Modelled on HI90's
 *  standard.yaml + krav.yaml merge: a cascade the project names is APPENDED
 *  after the standard sources, so a standard source is always the preferred
 *  one; a list of accepted values REPLACES the standard's. */
export interface ProjectLayer {
  /** FILE_SCHEMA. `accepted` replaces the standard's [IFC2X3, IFC4]: schema
   *  families (`IFC4`, not `IFC4 ADD2 TC1`), meant to narrow the default.
   *  `recommended` is a subset of the accepted families: a recommended
   *  family passes, an accepted one only is a warn («Kan brukes»). */
  "ifc-schema"?: { reference?: string; accepted?: string[]; recommended?: string[] };
  /** Pset_*Common.Status. `sources` are read after it, in order. */
  phase?: { reference?: string; sources?: PhaseSource[] };
  /** Materiale / Produkt, switched by mengdetype. Each list is read after
   *  the standard's sources of its branch: `mengdetype` after the IFC class
   *  table and the NS 3457 code (a value `telleobjekt` / `mengdeobjekt`),
   *  `product` after Pset_ManufacturerTypeInformation, `material` after
   *  IfcMaterial and the layer set (so never a `material` source here). */
  "material-product"?: {
    reference?: string;
    mengdetype?: CodeSource[];
    product?: CodeSource[];
    material?: CodeSource[];
  };
}

/** A phase source: a `CodeSource`, or the phase the object's MMI code
 *  implies, through the `progress-code` rule's `codes[].phase`. */
export type PhaseSource = CodeSource | { progressCode: Record<string, never> };

export type StandardRequirementId = keyof ProjectLayer;

/* -------------------------------------------------------------------- lint */

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  /** Rule id, or null for a ruleset-level issue. */
  ruleId: string | null;
  /** Dotted path into the ruleset, e.g. rules[2].requirements.property[0].dataType */
  path: string;
  /** Stable key, so the UI can localise. */
  code: string;
  /** Factual English message. */
  message: string;
}
