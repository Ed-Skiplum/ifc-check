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
import { ownerKey, ruleRole } from "./models.ts";
import { REQUIREMENT_IDS } from "./types.ts";
import type {
  Applicability,
  ClassGroup,
  CodeLookupCheck,
  CodeLookupRole,
  CopyObjectCheck,
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
  StandardRequirementId,
  StoreyTolerance,
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

/** The requirements with a standard layer a ruleset's `projectLayer` may
 *  extend (src/engine/standard-layer.ts). */
export const STANDARD_REQUIREMENT_IDS: StandardRequirementId[] = ["ifc-schema", "phase", "material-product"];

/** The standard layer's accepted schema families, as HI90's standard.yaml
 *  has them. */
export const DEFAULT_ACCEPTED_SCHEMAS = ["IFC2X3", "IFC4"] as const;

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
  if (rule.enabled !== undefined && (rule.enabled as unknown) !== false) {
    add(ctx, "error", `${path}.enabled`, "enabled-not-false", "enabled is present only as false; an enabled rule leaves it out");
  }
  if (rule.reference !== undefined && rule.reference.trim() === "") {
    add(ctx, "error", `${path}.reference`, "reference-empty", "reference is empty; leave it out");
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
  if (check.type === "copy-object") {
    checkCopyObject(ctx, path, check);
    if (rule.select) {
      checkFacets(ctx, `${path}.select`, rule.select, ruleset.ifcVersions, false);
    }
    return;
  }
  if (check.type === "code-lookup") {
    checkCodeLookup(ctx, path, check, rule.mapping);
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

/** Where a source sits decides which kinds it may be. */
type SourceSlot = "code-lookup" | "copy-object" | "phase" | "mengdetype" | "product" | "material";

/** One source: a code-lookup's or copy-object's, or one entry of a
 *  project-layer cascade. `material` is a code-lookup source only: the
 *  standard layer already reads IfcRelAssociatesMaterial first in
 *  `material-product.material`, and a phase, mengdetype, product or owner is
 *  no material name. `progressCode` is a phase source only. */
function checkCodeSource(ctx: Ctx, path: string, raw: unknown, slot: SourceSlot): void {
  const source = (raw ?? {}) as Record<string, unknown>;
  const keys = Object.keys(source);
  const kinds = ["attribute", "property", "classification", "material", "progressCode"];
  if (keys.length !== 1 || !kinds.includes(keys[0])) {
    add(
      ctx,
      "error",
      path,
      "code-source-shape",
      "source needs exactly one of attribute, property, classification" +
        (slot === "code-lookup" ? " or material" : slot === "phase" ? " or progressCode" : ""),
    );
  } else if (keys[0] === "material" && slot !== "code-lookup") {
    add(
      ctx,
      "error",
      path,
      "material-source-slot",
      slot === "material"
        ? "the standard layer reads IfcRelAssociatesMaterial first; a project layer only adds sources after it"
        : `a material source is not a ${slot} source`,
    );
  } else if (keys[0] === "progressCode" && slot !== "phase") {
    add(ctx, "error", path, "progress-code-source-slot", "progressCode is a phase source only");
  } else if (keys[0] === "attribute" && !source.attribute) {
    add(ctx, "error", `${path}.attribute`, "code-source-empty", "source names no attribute");
  } else if (keys[0] === "property") {
    const property = (source.property ?? {}) as { propertySet?: string; name?: string };
    if (!property.propertySet) {
      add(ctx, "error", `${path}.property.propertySet`, "code-source-empty", "source names no property set");
    }
    if (!property.name) {
      add(ctx, "error", `${path}.property.name`, "code-source-empty", "source names no property");
    }
  }
}

/** The project layer (`projectLayer`). An id the standard layer does not
 *  know is an error, as in HI90's konfig.py: a requirement is defined once,
 *  in the standard layer, and a project can only add to it. */
function checkProjectLayer(ctx: Ctx, layer: unknown, ruleset: Ruleset): void {
  if (layer === null || typeof layer !== "object" || Array.isArray(layer)) {
    add(ctx, "error", "projectLayer", "project-layer-shape", "projectLayer must be an object keyed by requirement id");
    return;
  }
  for (const [id, entry] of Object.entries(layer as Record<string, unknown>)) {
    const path = `projectLayer.${id}`;
    if (!(STANDARD_REQUIREMENT_IDS as string[]).includes(id)) {
      add(
        ctx,
        "error",
        path,
        "project-layer-unknown",
        `"${id}" is not a standard requirement; the standard layer has ${STANDARD_REQUIREMENT_IDS.join(", ")}`,
      );
      continue;
    }
    const e = (entry ?? {}) as Record<string, unknown>;
    if (e.reference !== undefined && (typeof e.reference !== "string" || e.reference.trim() === "")) {
      add(ctx, "error", `${path}.reference`, "reference-empty", "reference is empty; leave it out");
    }
    if (id === "ifc-schema" && e.recommended !== undefined) {
      const accepted = Array.isArray(e.accepted) ? (e.accepted as string[]) : [...DEFAULT_ACCEPTED_SCHEMAS];
      const recommended = e.recommended;
      if (!Array.isArray(recommended) || recommended.length === 0) {
        add(ctx, "error", `${path}.recommended`, "schema-recommended-empty", "recommended lists no schema");
      } else {
        recommended.forEach((value, i) => {
          if (!accepted.includes(value as string)) {
            add(
              ctx,
              "error",
              `${path}.recommended[${i}]`,
              "schema-recommended-not-accepted",
              `${String(value)} is recommended but not accepted (${accepted.join(", ")})`,
            );
          }
        });
      }
    }
    if (id === "ifc-schema" && e.accepted !== undefined) {
      const accepted = e.accepted;
      if (!Array.isArray(accepted) || accepted.length === 0) {
        add(ctx, "error", `${path}.accepted`, "schema-accepted-empty", "accepted lists no schema");
      } else {
        accepted.forEach((value, i) => {
          if (typeof value !== "string" || !/^IFC\d+(X\d+)?$/.test(value)) {
            add(
              ctx,
              "error",
              `${path}.accepted[${i}]`,
              "schema-accepted-form",
              `"${String(value)}" is not a schema family (IFC2X3, IFC4, IFC4X3 ...)`,
            );
          } else if (!(DEFAULT_ACCEPTED_SCHEMAS as readonly string[]).includes(value)) {
            add(
              ctx,
              "warning",
              `${path}.accepted[${i}]`,
              "schema-accepted-widens",
              `${value} is outside the standard layer's ${DEFAULT_ACCEPTED_SCHEMAS.join(", ")}: the project layer widens it`,
            );
          }
        });
      }
    }
    if (id === "phase" && e.sources !== undefined) {
      if (!Array.isArray(e.sources) || e.sources.length === 0) {
        add(ctx, "error", `${path}.sources`, "cascade-sources-empty", "sources lists no source");
      } else {
        e.sources.forEach((source, i) => {
          checkCodeSource(ctx, `${path}.sources[${i}]`, source, "phase");
          if (source && typeof source === "object" && "progressCode" in source) {
            const mmi = ruleset.rules?.find(
              (r): r is ExtendedRule => r?.kind === "extended" && r.mapping === "progress-code" && r.enabled !== false,
            );
            const check = mmi?.check;
            const phases = check?.type === "code-lookup" ? (check.codes ?? []).filter((c) => c.phase) : [];
            if (phases.length === 0) {
              add(
                ctx,
                "error",
                `${path}.sources[${i}]`,
                "progress-code-no-phase",
                "progressCode reads the phase of the MMI code; no enabled progress-code rule has codes with a phase",
              );
            }
          }
        });
      }
    }
    if (id === "material-product") {
      for (const branch of ["mengdetype", "product", "material"] as const) {
        const list = e[branch];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.length === 0) {
          add(ctx, "error", `${path}.${branch}`, "cascade-sources-empty", `${branch} lists no source`);
        } else {
          list.forEach((source, i) => checkCodeSource(ctx, `${path}.${branch}[${i}]`, source, branch));
        }
      }
    }
  }
}

function checkCodeLookup(ctx: Ctx, path: string, check: CodeLookupCheck, role: CodeLookupRole | undefined): void {
  const hasList = check.list !== undefined;
  const hasCodes = check.codes !== undefined;
  if (hasList === hasCodes) {
    add(
      ctx,
      "error",
      `${path}.check`,
      "code-list-shape",
      "code-lookup needs exactly one of list or codes",
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
  if (hasCodes) {
    const codes = check.codes;
    if (!Array.isArray(codes)) {
      add(ctx, "error", `${path}.check.codes`, "code-values-empty", "codes lists no code");
    } else if (codes.length === 0) {
      // On MMI an empty list checks the format alone: the Uttrekk decides.
      if (role !== "progress-code") add(ctx, "error", `${path}.check.codes`, "code-values-empty", "codes lists no code");
    } else {
      const seen = new Set<string>();
      codes.forEach((entry, i) => {
        const at = `${path}.check.codes[${i}]`;
        const code = typeof entry?.code === "string" ? entry.code : "";
        if (code === "") {
          add(ctx, "error", `${at}.code`, "code-value-empty", "empty code in codes");
        } else if (seen.has(code)) {
          add(ctx, "error", `${at}.code`, "code-value-duplicate", `"${code}" is listed twice`);
        }
        seen.add(code);
        if (typeof entry?.name !== "string" || entry.name.trim() === "") {
          add(ctx, "error", `${at}.name`, "code-name-empty", `code "${code}" has no name`);
        }
        if (entry?.phase !== undefined) {
          if (role !== "progress-code") {
            add(ctx, "error", `${at}.phase`, "code-phase-role", "a phase belongs on the progress-code rule's codes only");
          } else if (typeof entry.phase !== "string" || entry.phase.trim() === "") {
            add(ctx, "error", `${at}.phase`, "code-phase-empty", "phase is empty; leave it out");
          }
        }
      });
    }
  }
  checkCodeSource(ctx, `${path}.check.source`, check.source, "code-lookup");
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

const CODE_LOOKUP_ROLES: CodeLookupRole[] = ["system-classification", "component-classification", "progress-code"];

/** A mapping is a role on a code-lookup rule; each role fixes which half of
 *  the lookup it uses. The copy-object role is its own check type. */
function checkMapping(ctx: Ctx, path: string, rule: ExtendedRule): void {
  const role = rule.mapping as string;
  if (!(CODE_LOOKUP_ROLES as string[]).includes(role)) {
    add(
      ctx,
      "error",
      `${path}.mapping`,
      "mapping-unknown",
      `unknown mapping "${role}"; mappings are ${CODE_LOOKUP_ROLES.join(", ")}` +
        (role === "copy-object" ? " (copy-object is the check type itself)" : ""),
    );
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
  } else if (check.codes === undefined) {
    add(ctx, "error", `${path}.check.codes`, "mapping-codes", `mapping ${role} checks against the project's codes; set codes`);
  }
}

/** The copy-object role. `copy` and `own` must not share a value, as
 *  compared (case and whitespace ignored). */
function checkCopyObject(ctx: Ctx, path: string, check: CopyObjectCheck): void {
  checkCodeSource(ctx, `${path}.check.source`, check.source, "copy-object");
  for (const key of ["copy", "own"] as const) {
    const list = check[key];
    if (!Array.isArray(list)) {
      add(ctx, "error", `${path}.check.${key}`, "copy-list-shape", `${key} must be a list (it may be empty)`);
      continue;
    }
    list.forEach((value, i) => {
      if (typeof value !== "string" || value.trim() === "") {
        add(ctx, "error", `${path}.check.${key}[${i}]`, "copy-value-empty", `empty value in ${key}`);
      }
    });
  }
  if (Array.isArray(check.copy) && Array.isArray(check.own)) {
    const own = new Set(check.own.map(ownerKey));
    check.copy.forEach((value, i) => {
      if (own.has(ownerKey(value))) {
        add(ctx, "error", `${path}.check.copy[${i}]`, "copy-own-overlap", `"${value}" is both a copy value and an own value`);
      }
    });
  }
}

function checkTolerance(ctx: Ctx, path: string, tolerance: StoreyTolerance | undefined): void {
  if (tolerance === undefined || tolerance === null || typeof tolerance !== "object") {
    add(ctx, "error", path, "storey-tolerance-missing", "tolerance needs aboveMm and belowMm (a number, or null for no limit)");
    return;
  }
  for (const key of ["aboveMm", "belowMm"] as const) {
    const v = tolerance[key];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      add(ctx, "error", `${path}.${key}`, "storey-tolerance-invalid", `${key} must be a number >= 0 (mm), or null for no limit`);
    }
  }
}

const PLANES = ["OKFG", "OKBD"];

/** The floor config: its matching rules, then its levels. */
function checkStoreys(ctx: Ctx, ruleset: Ruleset): void {
  const setup = ruleset.storeys as unknown;
  if (setup === null || typeof setup !== "object" || Array.isArray(setup)) {
    add(ctx, "error", "storeys", "storeys-shape", "storeys is an object: plane, tolerance, nameWindowMm, nearMm, levels");
    return;
  }
  const s = ruleset.storeys!;
  if (!PLANES.includes(s.plane as string)) {
    add(ctx, "error", "storeys.plane", "storey-plane", `plane names what the elevations are measured to: ${PLANES.join(" or ")}`);
  }
  if (s.reference !== undefined && s.reference.trim() === "") {
    add(ctx, "error", "storeys.reference", "reference-empty", "reference is empty; leave it out");
  }
  checkTolerance(ctx, "storeys.tolerance", s.tolerance);
  if (s.nameWindowMm !== null && (typeof s.nameWindowMm !== "number" || !(s.nameWindowMm >= 0))) {
    add(ctx, "error", "storeys.nameWindowMm", "storey-window-invalid", "nameWindowMm must be a number >= 0 (mm), or null for any distance");
  }
  if (typeof s.nearMm !== "number" || !(s.nearMm >= 0)) {
    add(ctx, "error", "storeys.nearMm", "storey-window-invalid", "nearMm must be a number >= 0 (mm)");
  }

  if (!Array.isArray(s.levels) || s.levels.length === 0) {
    add(ctx, "error", "storeys.levels", "storey-levels-empty", "levels lists no level; leave storeys out instead");
  } else {
    const names = new Set<string>();
    const levels = new Set<number>();
    s.levels.forEach((storey, i) => {
      const path = `storeys.levels[${i}]`;
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

  const codes = new Set((ruleset.disciplines ?? []).map((d) => d?.code));
  const seen = new Set<string>();
  (s.disciplines ?? []).forEach((rule, i) => {
    const path = `storeys.disciplines[${i}]`;
    if (!codes.has(rule?.discipline)) {
      add(ctx, "error", `${path}.discipline`, "discipline-unknown", `"${String(rule?.discipline)}" is not in disciplines`);
    }
    if (seen.has(rule?.discipline)) {
      add(ctx, "error", `${path}.discipline`, "storey-discipline-duplicate", `"${rule.discipline}" has two storey rules`);
    }
    seen.add(rule?.discipline);
    if (!PLANES.includes(rule?.plane as string)) {
      add(ctx, "error", `${path}.plane`, "storey-plane", `plane names what the elevations are measured to: ${PLANES.join(" or ")}`);
    }
    checkTolerance(ctx, `${path}.tolerance`, rule?.tolerance);
    if (typeof rule?.requireAllNames !== "boolean") {
      add(ctx, "error", `${path}.requireAllNames`, "storey-require-names", "requireAllNames must be true or false");
    }
  });
}

/** Disciplines and the per-model facts. An exemption names a report row id:
 *  a fixed requirement, a mapping role, or a non-mapping rule's id. */
function checkModels(ctx: Ctx, ruleset: Ruleset): void {
  const codes = new Set<string>();
  (ruleset.disciplines ?? []).forEach((d, i) => {
    const code = typeof d?.code === "string" ? d.code : "";
    if (code.trim() === "") add(ctx, "error", `disciplines[${i}].code`, "discipline-empty", "discipline has no code");
    else if (codes.has(code)) add(ctx, "error", `disciplines[${i}].code`, "discipline-duplicate", `"${code}" appears twice`);
    codes.add(code);
    if (d?.report !== undefined && (d.report as unknown) !== false) {
      add(ctx, "error", `disciplines[${i}].report`, "report-not-false", "report is present only as false");
    }
  });

  const exemptable = new Set<string>([...REQUIREMENT_IDS, ...MAPPING_ROLES]);
  for (const rule of ruleset.rules ?? []) if (rule && ruleRole(rule) === null && rule.id) exemptable.add(rule.id);

  const labels = new Set<string>();
  (ruleset.models ?? []).forEach((m, i) => {
    const path = `models[${i}]`;
    const label = typeof m?.label === "string" ? m.label : "";
    if (label.trim() === "") add(ctx, "error", `${path}.label`, "model-label-empty", "model has no label");
    else if (/\.(ifc|ifczip|ifcxml)$/i.test(label)) {
      add(ctx, "error", `${path}.label`, "model-label-extension", `label "${label}" is the file name without its extension`);
    } else if (labels.has(label)) add(ctx, "error", `${path}.label`, "model-label-duplicate", `"${label}" appears twice`);
    labels.add(label);
    if (!codes.has(m?.discipline)) {
      add(ctx, "error", `${path}.discipline`, "discipline-unknown", `"${String(m?.discipline)}" is not in disciplines`);
    }
    if (m?.group !== undefined && (typeof m.group !== "string" || m.group.trim() === "")) {
      add(ctx, "error", `${path}.group`, "model-group-empty", "group is empty; leave it out");
    }
    // The same owner name may sit on several models: it is read in one file
    // at a time, where it names that file (a MMI700 cut of each discipline).
    (m?.ownerNames ?? []).forEach((name, j) => {
      if (ownerKey(String(name)) === "") add(ctx, "error", `${path}.ownerNames[${j}]`, "owner-name-empty", "empty owner name");
    });
    (m?.exempt ?? []).forEach((id, j) => {
      if (!exemptable.has(id)) {
        add(
          ctx,
          "error",
          `${path}.exempt[${j}]`,
          "exempt-unknown",
          `"${id}" is not a requirement id: a report row id, a mapping role or a non-mapping rule's id`,
        );
      }
    });
  });
}

export function lintRuleset(ruleset: Ruleset): LintIssue[] {
  const ctx: Ctx = { issues: [], ruleId: null };

  if (ruleset.formatVersion !== 2) {
    add(
      ctx,
      "error",
      "formatVersion",
      "format-version",
      `unsupported formatVersion ${String(ruleset.formatVersion)}; this build reads 2` +
        ((ruleset.formatVersion as unknown) === 1 ? " (docs/config-template.md lists what changed)" : ""),
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

  if (ruleset.storeys !== undefined) checkStoreys(ctx, ruleset);
  checkModels(ctx, ruleset);
  if (ruleset.projectLayer !== undefined) checkProjectLayer(ctx, ruleset.projectLayer, ruleset);

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
    const role = rule ? ruleRole(rule) : null;
    if (role !== null) {
      if (roles.has(role)) {
        add(
          ctx,
          "error",
          role === "copy-object" ? `rules[${index}].check` : `rules[${index}].mapping`,
          "mapping-duplicate",
          `mapping ${role} is set on more than one rule`,
        );
      }
      roles.add(role);
    }
  });
  ctx.ruleId = null;
  if (rules.length === 0) {
    add(ctx, "warning", "rules", "rules-empty", "ruleset has no rules");
  }
  checkPlaceholders(ctx, ruleset, "");
  ctx.ruleId = null;
  return ctx.issues;
}

/** The marker the config templates (docs/agent-guide.md, the .xlsx template)
 *  put where a value must come from the project. A string still carrying it
 *  is an unfilled template, so it is an error wherever it sits. */
export const FROM_PROJECT = "<FROM PROJECT";

function checkPlaceholders(ctx: Ctx, value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value.includes(FROM_PROJECT)) {
      add(ctx, "error", path, "from-project", `"${value}" is a template placeholder; fill in the project's value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (path === "rules") ctx.ruleId = (item as { id?: string } | null)?.id ?? null;
      checkPlaceholders(ctx, item, `${path}[${i}]`);
    });
    if (path === "rules") ctx.ruleId = null;
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      checkPlaceholders(ctx, item, path === "" ? key : `${path}.${key}`);
    }
  }
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
