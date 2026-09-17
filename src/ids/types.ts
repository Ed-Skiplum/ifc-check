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
  description?: string;
  /** Guidance for the model author, carried into the .ids. */
  instructions?: string;
  /** Default true. A disabled rule is excluded from export and from evaluation. */
  enabled?: boolean;
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

export type ExtendedCheck =
  | ElementTypedCheck
  | UniqueAttributeCheck
  | TypeUsageCountCheck
  | ModelMetadataCheck;

export type ExtendedCheckType = ExtendedCheck["type"];

export interface ExtendedRule extends RuleBase {
  kind: "extended";
  /** Omitted for model-metadata; required for every element-scoped check. */
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

export interface Ruleset {
  /** Bumped only on a breaking change to this format. */
  formatVersion: 1;
  name: string;
  description?: string;
  /** Default ifcVersion list for every ids rule. Metadata in the .ids; it does
   *  not gate which files a rule runs against. */
  ifcVersions: IfcVersion[];
  info?: RulesetInfo;
  rules: Rule[];
}

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
