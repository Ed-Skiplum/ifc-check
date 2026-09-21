/** Rule-level checks that catch what the XSD would reject, plus the mistakes it
 *  accepts silently.
 *
 * The XSD rejects a cardinality on an applicability facet or a minOccurs on a
 * specification; it happily accepts an entity facet naming an abstract class,
 * which matches nothing and then reports as passing over zero entities. Both
 * kinds are errors here, so an unrunnable rule never reaches an export.
 */

import { CODE_LIST_IDS } from "../codelists/index.ts";
import { IFC_CLASSES } from "./ifc-classes.ts";
import type {
  Applicability,
  ClassGroup,
  CodeLookupCheck,
  EntityFacet,
  ExtendedRule,
  IdsValue,
  IfcVersion,
  LintIssue,
  MappingRole,
  PartOfRelation,
  Requirements,
  Restriction,
  Rule,
  Ruleset,
  Selector,
} from "./types.ts";

const RELATIONS: PartOfRelation[] = [
  "IFCRELAGGREGATES",
  "IFCRELASSIGNSTOGROUP",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  "IFCRELNESTS",
  "IFCRELVOIDSELEMENT IFCRELFILLSELEMENT",
];

export const PART_OF_RELATIONS = RELATIONS;

export const CLASS_GROUPS: ClassGroup[] = [
  "product",
  "element",
  "physicalElement",
  "builtElement",
  "distributionElement",
  "spatialElement",
  "featureElement",
  "elementType",
  "typeProduct",
  "group",
];

export const IFC_VERSIONS: IfcVersion[] = ["IFC2X3", "IFC4", "IFC4X3_ADD2"];

/** The XSD pattern on ids/info/author. */
const AUTHOR_PATTERN = /^[^@]+@[^.]+\..+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** ids:upperCaseName. */
const UPPER_CASE_NAME = /^[A-Z]+$/;

interface Ctx {
  issues: LintIssue[];
  ruleId: string | null;
}

function add(
  ctx: Ctx,
  severity: LintIssue["severity"],
  path: string,
  code: string,
  message: string,
): void {
  ctx.issues.push({ severity, ruleId: ctx.ruleId, path, code, message });
}

function checkRestriction(ctx: Ctx, path: string, restriction: Restriction): void {
  const keys = Object.keys(restriction).filter((k) => k !== "base");
  if (keys.length === 0) {
    add(ctx, "error", path, "restriction-empty", "restriction constrains nothing");
  }
  if (restriction.enumeration && restriction.enumeration.length === 0) {
    add(
      ctx,
      "error",
      `${path}.enumeration`,
      "enumeration-empty",
      "empty enumeration matches nothing",
    );
  }
  if (restriction.pattern !== undefined) {
    try {
      new RegExp(restriction.pattern);
    } catch {
      add(
        ctx,
        "warning",
        `${path}.pattern`,
        "pattern-not-js-regex",
        "pattern is not a valid JavaScript regular expression; XSD regex is a " +
          "different dialect, so this is only checkable at validation time",
      );
    }
  }
}

function checkValue(ctx: Ctx, path: string, value: IdsValue | undefined): void {
  if (value === undefined) return;
  if (typeof value === "string") {
    if (value === "") {
      add(ctx, "error", path, "value-empty", "empty simpleValue");
    }
    return;
  }
  checkRestriction(ctx, `${path}.restriction`, value.restriction);
}

function concreteClasses(versions: IfcVersion[]): Set<string> {
  const out = new Set<string>();
  for (const version of versions) {
    for (const name of IFC_CLASSES[version].entities) out.add(name);
  }
  return out;
}

function checkEntity(
  ctx: Ctx,
  path: string,
  entity: EntityFacet,
  versions: IfcVersion[],
): void {
  const forms = (["classes", "group", "name"] as const).filter(
    (k) => entity[k] !== undefined,
  );
  if (forms.length === 0) {
    add(
      ctx,
      "error",
      path,
      "entity-no-name",
      "entity facet needs one of classes, group or name",
    );
    return;
  }
  if (forms.length > 1) {
    add(
      ctx,
      "error",
      path,
      "entity-ambiguous",
      `entity facet sets ${forms.join(" and ")}; exactly one is allowed`,
    );
  }
  if (entity.group !== undefined && !CLASS_GROUPS.includes(entity.group)) {
    add(
      ctx,
      "error",
      `${path}.group`,
      "group-unknown",
      `unknown class group "${entity.group}"`,
    );
  }
  if (entity.classes !== undefined) {
    if (entity.classes.length === 0) {
      add(ctx, "error", `${path}.classes`, "classes-empty", "classes is empty");
    }
    const known = concreteClasses(versions);
    for (const name of entity.classes) {
      if (name !== name.toUpperCase()) {
        add(
          ctx,
          "error",
          `${path}.classes`,
          "class-not-upper",
          `"${name}" must be uppercase`,
        );
        continue;
      }
      if (!known.has(name)) {
        add(
          ctx,
          "error",
          `${path}.classes`,
          "class-not-concrete",
          `"${name}" is not an instantiable class in ${versions.join("/")}; the ` +
            "entity facet matches an exact class and never a subtype, so this " +
            "would match nothing",
        );
      }
    }
  }
  checkValue(ctx, `${path}.name`, entity.name);
  checkValue(ctx, `${path}.predefinedType`, entity.predefinedType);
}

/** Shared by applicability and selector: the facet bodies, without cardinality. */
function checkFacets(
  ctx: Ctx,
  path: string,
  facets: Selector,
  versions: IfcVersion[],
  inRequirements: false,
): void;
function checkFacets(
  ctx: Ctx,
  path: string,
  facets: Requirements,
  versions: IfcVersion[],
  inRequirements: true,
): void;
function checkFacets(
  ctx: Ctx,
  path: string,
  facets: Selector | Requirements,
  versions: IfcVersion[],
  inRequirements: boolean,
): void {
  if (facets.entity) checkEntity(ctx, `${path}.entity`, facets.entity, versions);

  facets.partOf?.forEach((facet, i) => {
    const p = `${path}.partOf[${i}]`;
    if (!facet.entity) {
      add(ctx, "error", p, "partof-no-entity", "partOf needs an entity");
    } else {
      checkEntity(ctx, `${p}.entity`, facet.entity, versions);
    }
    if (facet.relation !== undefined && !RELATIONS.includes(facet.relation)) {
      add(
        ctx,
        "error",
        `${p}.relation`,
        "relation-unknown",
        `"${facet.relation}" is not in the IDS relations enumeration; there is ` +
          "no IFCRELDEFINESBYTYPE, so type linkage is an extended rule",
      );
    }
    if (!inRequirements && facet.cardinality !== undefined) {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "cardinality-in-applicability",
        "cardinality belongs on a requirement facet, not on applicability",
      );
    }
    if (inRequirements && (facet.cardinality as string) === "optional") {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "partof-cardinality-optional",
        "partOf takes simpleCardinality: required or prohibited only",
      );
    }
  });

  facets.classification?.forEach((facet, i) => {
    const p = `${path}.classification[${i}]`;
    if (facet.system === undefined) {
      add(ctx, "error", p, "classification-no-system", "classification needs a system");
    }
    checkValue(ctx, `${p}.system`, facet.system);
    checkValue(ctx, `${p}.value`, facet.value);
    if (!inRequirements && facet.cardinality !== undefined) {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "cardinality-in-applicability",
        "cardinality belongs on a requirement facet, not on applicability",
      );
    }
  });

  facets.attribute?.forEach((facet, i) => {
    const p = `${path}.attribute[${i}]`;
    if (facet.name === undefined) {
      add(ctx, "error", p, "attribute-no-name", "attribute needs a name");
    }
    checkValue(ctx, `${p}.name`, facet.name);
    checkValue(ctx, `${p}.value`, facet.value);
    if (!inRequirements && facet.cardinality !== undefined) {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "cardinality-in-applicability",
        "cardinality belongs on a requirement facet, not on applicability",
      );
    }
  });

  facets.property?.forEach((facet, i) => {
    const p = `${path}.property[${i}]`;
    if (facet.propertySet === undefined || facet.baseName === undefined) {
      add(
        ctx,
        "error",
        p,
        "property-incomplete",
        "property needs both propertySet and baseName",
      );
    }
    checkValue(ctx, `${p}.propertySet`, facet.propertySet);
    checkValue(ctx, `${p}.baseName`, facet.baseName);
    checkValue(ctx, `${p}.value`, facet.value);
    if (facet.dataType !== undefined && !UPPER_CASE_NAME.test(facet.dataType)) {
      add(
        ctx,
        "error",
        `${p}.dataType`,
        "datatype-not-upper",
        `dataType "${facet.dataType}" must match [A-Z]+, e.g. IFCLABEL`,
      );
    }
    if (!inRequirements && facet.cardinality !== undefined) {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "cardinality-in-applicability",
        "cardinality belongs on a requirement facet, not on applicability",
      );
    }
  });

  facets.material?.forEach((facet, i) => {
    const p = `${path}.material[${i}]`;
    checkValue(ctx, `${p}.value`, facet.value);
    if (!inRequirements && facet.cardinality !== undefined) {
      add(
        ctx,
        "error",
        `${p}.cardinality`,
        "cardinality-in-applicability",
        "cardinality belongs on a requirement facet, not on applicability",
      );
    }
  });
}

function facetCount(facets: Selector | Requirements): number {
  return (
    (facets.entity ? 1 : 0) +
    (facets.partOf?.length ?? 0) +
    (facets.classification?.length ?? 0) +
    (facets.attribute?.length ?? 0) +
    (facets.property?.length ?? 0) +
    (facets.material?.length ?? 0)
  );
}

function checkApplicability(
  ctx: Ctx,
  path: string,
  app: Applicability,
  versions: IfcVersion[],
): void {
  checkFacets(ctx, path, app, versions, false);
  if (facetCount(app) === 0) {
    add(
      ctx,
      "warning",
      path,
      "applicability-empty",
      "applicability has no facets and therefore matches every entity",
    );
  }
  const { minOccurs, maxOccurs } = app;
  if (minOccurs !== undefined && (!Number.isInteger(minOccurs) || minOccurs < 0)) {
    add(
      ctx,
      "error",
      `${path}.minOccurs`,
      "occurs-not-integer",
      "minOccurs must be a non-negative integer",
    );
  }
  if (maxOccurs !== undefined && maxOccurs !== "unbounded") {
    if (!Number.isInteger(maxOccurs) || maxOccurs < 0) {
      add(
        ctx,
        "error",
        `${path}.maxOccurs`,
        "occurs-not-integer",
        'maxOccurs must be a non-negative integer or "unbounded"',
      );
    } else if (minOccurs !== undefined && maxOccurs < minOccurs) {
      add(
        ctx,
        "error",
        `${path}.maxOccurs`,
        "occurs-inverted",
        "maxOccurs is below minOccurs",
      );
    }
  }
}

function checkRule(ctx: Ctx, rule: Rule, index: number, ruleset: Ruleset): void {
  const path = `rules[${index}]`;
  if (!rule.id) {
    add(ctx, "error", `${path}.id`, "rule-no-id", "rule has no id");
  }
  if (!rule.name) {
    add(ctx, "error", `${path}.name`, "rule-no-name", "rule has no name");
  }

  if (rule.kind === "ids") {
    const versions = rule.ifcVersions ?? ruleset.ifcVersions;
    for (const version of versions) {
      if (!IFC_VERSIONS.includes(version)) {
        add(
          ctx,
          "error",
          `${path}.ifcVersions`,
          "ifcversion-unknown",
          `"${version}" is not in the IDS ifcVersion enumeration ` +
            `(${IFC_VERSIONS.join(", ")})`,
        );
      }
    }
    if (!rule.applicability) {
      add(
        ctx,
        "error",
        `${path}.applicability`,
        "applicability-missing",
        "an ids rule needs an applicability",
      );
      return;
    }
    checkApplicability(ctx, `${path}.applicability`, rule.applicability, versions);
    if (rule.requirements) {
      checkFacets(ctx, `${path}.requirements`, rule.requirements, versions, true);
      if (
        facetCount(rule.requirements) === 0 &&
        rule.applicability.minOccurs === undefined &&
        rule.applicability.maxOccurs === undefined
      ) {
        add(
          ctx,
          "warning",
          `${path}.requirements`,
          "requirements-empty",
          "no requirement facets and no occurrence bound: this asserts nothing",
        );
      }
      const entity = rule.requirements.entity;
      if (entity && (entity as { cardinality?: string }).cardinality !== undefined) {
        add(
          ctx,
          "error",
          `${path}.requirements.entity.cardinality`,
          "entity-requirement-cardinality",
          "a requirements entity facet takes no cardinality; it is always required",
        );
      }
    } else if (
      rule.applicability.minOccurs === undefined &&
      rule.applicability.maxOccurs === undefined
    ) {
      add(
        ctx,
        "warning",
        path,
        "no-requirements",
        "no requirements and no occurrence bound: this asserts nothing",
      );
    }
    return;
  }

  // extended
  const check = rule.check;
  if (!check || typeof check.type !== "string") {
    add(ctx, "error", `${path}.check`, "check-missing", "extended rule has no check");
    return;
  }
  if (check.type === "model-metadata") {
    if (rule.select) {
      add(
        ctx,
        "warning",
        `${path}.select`,
        "select-ignored",
        "model-metadata is model-scoped; select is ignored",
      );
    }
    checkValue(ctx, `${path}.check.value`, check.value);
    return;
  }
  if (rule.mapping !== undefined) checkMapping(ctx, path, rule);
  if (check.type === "code-lookup") {
    checkCodeLookup(ctx, path, check);
    if (rule.select) {
      checkFacets(ctx, `${path}.select`, rule.select, ruleset.ifcVersions, false);
    }
    return;
  }
  if (!rule.select) {
    add(
      ctx,
      "error",
      `${path}.select`,
      "select-missing",
      `${check.type} is element-scoped and needs a select`,
    );
  } else {
    checkFacets(ctx, `${path}.select`, rule.select, ruleset.ifcVersions, false);
    if (facetCount(rule.select) === 0) {
      add(
        ctx,
        "warning",
        `${path}.select`,
        "select-empty",
        "select has no facets and therefore matches every entity",
      );
    }
  }
  if (check.type === "type-usage-count") {
    if (check.min === undefined && check.max === undefined) {
      add(
        ctx,
        "error",
        `${path}.check`,
        "usage-count-unbounded",
        "type-usage-count needs min, max or both",
      );
    }
    if (
      check.min !== undefined &&
      check.max !== undefined &&
      check.max < check.min
    ) {
      add(ctx, "error", `${path}.check.max`, "usage-count-inverted", "max is below min");
    }
  }
}

function checkCodeLookup(ctx: Ctx, path: string, check: CodeLookupCheck): void {
  const hasList = check.list !== undefined;
  const hasValues = check.values !== undefined;
  if (hasList === hasValues) {
    add(
      ctx,
      "error",
      `${path}.check`,
      "code-list-shape",
      "code-lookup needs exactly one of list or values",
    );
  }
  if (hasList && !(CODE_LIST_IDS as string[]).includes(check.list as string)) {
    add(
      ctx,
      "error",
      `${path}.check.list`,
      "code-list-unknown",
      `code list "${String(check.list)}" is not bundled; bundled lists are ${CODE_LIST_IDS.join(", ")}`,
    );
  }
  if (hasValues) {
    const values = check.values;
    if (!Array.isArray(values) || values.length === 0) {
      add(ctx, "error", `${path}.check.values`, "code-values-empty", "values lists no code");
    } else {
      values.forEach((value, i) => {
        if (typeof value !== "string" || value === "") {
          add(ctx, "error", `${path}.check.values[${i}]`, "code-value-empty", "empty code in values");
        } else if (values.indexOf(value) !== i) {
          add(ctx, "warning", `${path}.check.values[${i}]`, "code-value-duplicate", `"${value}" is listed twice`);
        }
      });
    }
  }
  const source = (check.source ?? {}) as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== 1 || !["attribute", "property", "classification"].includes(keys[0])) {
    add(
      ctx,
      "error",
      `${path}.check.source`,
      "code-source-shape",
      "source needs exactly one of attribute, property or classification",
    );
  } else if (keys[0] === "attribute" && !source.attribute) {
    add(ctx, "error", `${path}.check.source.attribute`, "code-source-empty", "source names no attribute");
  } else if (keys[0] === "property") {
    const property = (source.property ?? {}) as { propertySet?: string; name?: string };
    if (!property.propertySet) {
      add(ctx, "error", `${path}.check.source.property.propertySet`, "code-source-empty", "source names no property set");
    }
    if (!property.name) {
      add(ctx, "error", `${path}.check.source.property.name`, "code-source-empty", "source names no property");
    }
  }
  let groups = -1;
  try {
    new RegExp(check.extract);
    groups = (new RegExp(`${check.extract}|`).exec("")?.length ?? 1) - 1;
  } catch {
    add(
      ctx,
      "error",
      `${path}.check.extract`,
      "extract-invalid",
      `extract "${check.extract}" is not a valid regular expression`,
    );
  }
  if (groups >= 0 && groups !== 1) {
    add(
      ctx,
      "error",
      `${path}.check.extract`,
      "extract-groups",
      `extract has ${groups} capture groups; it needs exactly one, the code`,
    );
  }
}

export const MAPPING_ROLES: MappingRole[] = [
  "system-classification",
  "component-classification",
  "progress-code",
  "copy-object",
];

/** The values a copy-object mapping checks against in its boolean mode: an
 *  IFC BOOLEAN as this tool renders it, the xs:boolean lexical form IDS uses.
 *  Its other mode is a non-empty list of the project's own discipline codes
 *  (POFIN's `NONS_Process.DuplicateOwnedBy`, e.g. `RIV`). The mode is never
 *  stored separately — it is derived from `values` by `isBooleanValues` so it
 *  round-trips through the ruleset JSON as-is. */
export const BOOLEAN_VALUES = ["true", "false"] as const;

/** Whether a copy-object mapping's `values` are the boolean pair rather than
 *  the project's own codes. Order-independent, so `["false", "true"]` still
 *  reads as boolean mode. */
export function isBooleanValues(values: string[] | undefined): boolean {
  return (
    values !== undefined &&
    values.length === BOOLEAN_VALUES.length &&
    BOOLEAN_VALUES.every((v) => values.includes(v))
  );
}

/** A mapping is a role on a code-lookup rule; each role fixes which half of
 *  the lookup it uses. */
function checkMapping(ctx: Ctx, path: string, rule: ExtendedRule): void {
  const role = rule.mapping as string;
  if (!(MAPPING_ROLES as string[]).includes(role)) {
    add(ctx, "error", `${path}.mapping`, "mapping-unknown", `unknown mapping "${role}"; mappings are ${MAPPING_ROLES.join(", ")}`);
    return;
  }
  const check = rule.check;
  if (check.type !== "code-lookup") {
    add(ctx, "error", `${path}.mapping`, "mapping-check", `mapping ${role} needs a code-lookup check, not ${check.type}`);
    return;
  }
  if (role === "system-classification" || role === "component-classification") {
    if (check.list === undefined) {
      add(ctx, "error", `${path}.check.list`, "mapping-list", `mapping ${role} reads a bundled code list; set list`);
    }
  } else if (check.values === undefined) {
    // progress-code and copy-object both check the value against `values`;
    // copy-object accepts either the boolean pair (BOOLEAN_VALUES) or the
    // project's own discipline codes — `code-values-empty` already rejects an
    // empty list, so no further shape is imposed here.
    add(ctx, "error", `${path}.check.values`, "mapping-values", `mapping ${role} checks against values; set values`);
  }
}

export function lintRuleset(ruleset: Ruleset): LintIssue[] {
  const ctx: Ctx = { issues: [], ruleId: null };

  if (ruleset.formatVersion !== 1) {
    add(
      ctx,
      "error",
      "formatVersion",
      "format-version",
      `unsupported formatVersion ${String(ruleset.formatVersion)}; this build reads 1`,
    );
  }
  if (!ruleset.name) {
    add(ctx, "error", "name", "ruleset-no-name", "ruleset has no name");
  }
  if (!Array.isArray(ruleset.ifcVersions) || ruleset.ifcVersions.length === 0) {
    add(
      ctx,
      "error",
      "ifcVersions",
      "ifcversions-empty",
      "ifcVersions must list at least one of " + IFC_VERSIONS.join(", "),
    );
  }
  const info = ruleset.info;
  if (info?.author !== undefined && !AUTHOR_PATTERN.test(info.author)) {
    add(
      ctx,
      "error",
      "info.author",
      "author-not-email",
      "the XSD requires info/author to be an e-mail address",
    );
  }
  if (info?.date !== undefined && !ISO_DATE.test(info.date)) {
    add(ctx, "error", "info.date", "date-not-iso", "info/date must be YYYY-MM-DD");
  }

  if (ruleset.storeys !== undefined) {
    if (!Array.isArray(ruleset.storeys)) {
      add(ctx, "error", "storeys", "storeys-not-array", "storeys must be an array");
    } else {
      const names = new Set<string>();
      const levels = new Set<number>();
      ruleset.storeys.forEach((storey, i) => {
        const path = `storeys[${i}]`;
        const name = typeof storey?.name === "string" ? storey.name : "";
        if (name.trim() === "") {
          add(ctx, "error", `${path}.name`, "storey-name-empty", "storey has no name");
        } else {
          if (name !== name.trim()) {
            add(ctx, "warning", `${path}.name`, "storey-name-whitespace", `storey name "${name}" has leading or trailing whitespace`);
          }
          if (names.has(name)) {
            add(ctx, "error", `${path}.name`, "storey-name-duplicate", `storey name "${name}" appears twice`);
          }
          names.add(name);
        }
        if (typeof storey?.elevation !== "number" || !Number.isFinite(storey.elevation)) {
          add(ctx, "error", `${path}.elevation`, "storey-elevation-invalid", "storey elevation must be a number (metres)");
        } else {
          const key = Math.round(storey.elevation * 1000);
          if (levels.has(key)) {
            add(ctx, "warning", `${path}.elevation`, "storey-elevation-duplicate", `elevation ${storey.elevation} m appears twice`);
          }
          levels.add(key);
        }
      });
    }
  }

  const seen = new Set<string>();
  const roles = new Set<string>();
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  rules.forEach((rule, index) => {
    ctx.ruleId = rule?.id ?? null;
    if (rule?.id) {
      if (seen.has(rule.id)) {
        add(ctx, "error", `rules[${index}].id`, "rule-id-duplicate", `duplicate rule id "${rule.id}"`);
      }
      seen.add(rule.id);
    }
    checkRule(ctx, rule, index, ruleset);
    if (rule?.kind === "extended" && rule.mapping !== undefined) {
      if (roles.has(rule.mapping)) {
        add(ctx, "error", `rules[${index}].mapping`, "mapping-duplicate", `mapping ${rule.mapping} is set on more than one rule`);
      }
      roles.add(rule.mapping);
    }
  });
  ctx.ruleId = null;
  if (rules.length === 0) {
    add(ctx, "warning", "rules", "rules-empty", "ruleset has no rules");
  }
  return ctx.issues;
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
