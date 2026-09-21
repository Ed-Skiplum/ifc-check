/** The headless half of the rule builder: ruleset model, IDS emitter, linter,
 *  exporter, schema validator wrapper and evaluator. No React, no I/O. */

export * from "./types.ts";
export * from "./model.ts";
export { IFC_CLASSES, type IfcSchemaName, type SchemaClasses } from "./ifc-classes.ts";
export {
  IDS_NAMESPACE,
  XSD_NAMESPACE,
  XSI_NAMESPACE,
  emitIdsXml,
  entityNameValue,
  expandGroup,
  specificationNode,
} from "./emit.ts";
export {
  BOOLEAN_VALUES,
  CLASS_GROUPS,
  IFC_VERSIONS,
  MAPPING_ROLES,
  PART_OF_RELATIONS,
  hasErrors,
  lintRuleset,
} from "./lint.ts";
export {
  type ExclusionCode,
  type ExcludedRule,
  type ExportResult,
  exportRuleset,
  isEnabled,
  partitionRules,
} from "./export.ts";
export {
  type IdsValidator,
  type SchemaSources,
  type ValidateXml,
  type ValidationError,
  type ValidationResult,
  assertSchemaRewritten,
  createIdsValidator,
  rewriteSchemaLocations,
} from "./validate.ts";
export {
  type EvaluateOptions,
  type Finding,
  type ModelResult,
  type ResultState,
  type RuleResult,
  evaluateRuleset,
} from "./evaluate.ts";
export { RULESET_JSON_SCHEMA, RULESET_SCHEMA_ID } from "./schema.ts";
export { SAMPLE_RULESET } from "./sample.ts";
