/** Oppsett v2's merge rules (`src/ui/oppsett/merge.ts`, `items.ts`), run by
 *  `node scripts/ids-cli.ts selftest`: one requirement per role, one per
 *  source property, an IDS dropped MERGED (added, absorbed, adopted or a
 *  conflict, never a silent drop), re-dropping the same IDS adding nothing,
 *  and the custom property requirement evaluating with a report row. */

import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";
import type { IdsRule, IdsValue, Rule, Ruleset } from "../src/ids/types.ts";
import type { ModelGraph, ModelSummary } from "../src/ids/model.ts";
import { emitIdsXml } from "../src/ids/emit.ts";
import { importIds } from "../src/ids/import.ts";
import { evaluateRuleset } from "../src/ids/evaluate.ts";
import { lintRuleset } from "../src/ids/lint.ts";
import { reportRows } from "../src/engine/report.ts";
import { pofinRuleset } from "../src/engine/pofin-ruleset.ts";
import {
  addableKinds,
  covers,
  idsReference,
  mergeIds,
  originOf,
  propertyRule,
  resolveConflict,
  ruleKeys,
  ruleReading,
  splitSpec,
  withSource,
} from "../src/ui/oppsett/merge.ts";
import { itemStatus, requirementItems, rowOf, sumHits } from "../src/ui/oppsett/items.ts";

type Record_ = (name: string, expected: string, actual: string) => void;

const base = (rules: Rule[], extra: Partial<Ruleset> = {}): Ruleset => ({
  formatVersion: 2,
  name: "T",
  ifcVersions: ["IFC4"],
  rules,
  ...extra,
});

const prop = (
  id: string,
  set: string,
  name: string,
  value?: IdsValue,
  applicability: IdsRule["applicability"] = { entity: { classes: ["IFCWALL"] } },
): IdsRule => ({
  id,
  kind: "ids",
  name: id,
  identifier: id,
  applicability,
  requirements: { property: [{ propertySet: set, baseName: name, ...(value !== undefined ? { value } : {}) }] },
});

/** An IDS file as a user would drop it: written by the emitter, read by the
 *  importer the page uses. */
function idsFile(fileName: string, rules: IdsRule[], mangle?: (xml: string) => string) {
  const xml = emitIdsXml(base(rules), rules);
  return importIds(mangle ? mangle(xml) : xml, fileName);
}

const ids = (r: Ruleset) => r.rules.map((x) => x.id).join(" ");

export function oppsettSelftest(record: Record_, shapeErrors: (ruleset: unknown) => { path: string; message: string }[]): void {
  const pofin = pofinRuleset();

  // One requirement per role: the popover lists only the absent kinds.
  record(
    "oppsett: «Legg til krav» on POFIN offers the absent kinds, then a property",
    "tfm storeys property",
    addableKinds(pofin).join(" "),
  );
  record("oppsett: an empty ruleset offers every fixed kind", "type-name system-classification component-classification copy-object progress-code tfm storeys property", addableKinds(base([])).join(" "));

  // One requirement per source property.
  record(
    "oppsett: POFIN Systemkode reads NONS_Reference.RefPriSysOcc",
    "system-classification",
    ruleReading(pofin, "NONS_Reference.RefPriSysOcc")?.id ?? "none",
  );
  record(
    "oppsett: a source another requirement reads is refused",
    "refused",
    withSource(pofin, "component-classification", { propertySet: "NONS_Reference", name: "RefPriSysOcc" }) === null ? "refused" : "taken",
  );
  const moved = withSource(pofin, "component-classification", { propertySet: "Pset_X", name: "Komp" });
  record(
    "oppsett: a free source is taken, read per occurrence",
    "Pset_X.Komp occurrence",
    (() => {
      const r = moved?.rules.find((x) => x.id === "component-classification");
      return r && r.kind === "extended" && r.check.type === "code-lookup" ? `${ruleKeys(r).join()} ${r.check.target}` : "absent";
    })(),
  );

  // Origin.
  record(
    "oppsett: origin from `reference`: POFIN rules, an IDS drop, own",
    "POFIN IDS null",
    [originOf(pofin.rules[0].reference), originOf(idsReference("x.ids")), originOf(undefined)].map(String).join(" "),
  );

  // The drop: a new property is added, origin IDS.
  const fresh = idsFile("A.ids", [prop("fire", "Pset_WallCommon", "FireRating", { restriction: { enumeration: ["EI30", "EI60"] } })]);
  const one = mergeIds(pofin, fresh);
  const added = one.ruleset.rules.find((r) => r.id === one.added[0]);
  record(
    "oppsett: IDS drop, a property nobody reads: one new row, origin IDS",
    "1 IDS Pset_WallCommon.FireRating",
    `${one.added.length} ${originOf(added?.reference)} ${added ? ruleKeys(added).join() : ""}`,
  );
  record(
    "oppsett: the merged ruleset lints clean and validates (origin in `reference`, formatVersion 2)",
    "0 valid",
    `${lintRuleset(one.ruleset).filter((i) => i.severity === "error").length} ${shapeErrors(one.ruleset).length === 0 ? "valid" : JSON.stringify(shapeErrors(one.ruleset))}`,
  );

  // Re-dropping the same IDS adds nothing.
  const again = mergeIds(one.ruleset, fresh, one.conflicts);
  record("oppsett: the same IDS dropped again adds nothing", `0 0 ${ids(one.ruleset)}`, `${again.added.length} ${again.conflicts.length} ${ids(again.ruleset)}`);

  // Conflict with a mapping: POFIN Systemkode (NS 3451 list) against an IDS pattern.
  const sys = idsFile("B.ids", [prop("sys", "NONS_Reference", "RefPriSysOcc", { restriction: { pattern: "[0-9]{4}\\.[0-9]{3}" } })]);
  const two = mergeIds(pofin, sys);
  record(
    "oppsett: IDS on a property a mapping reads, another value rule: no row, a conflict on the mapping",
    `0 system-classification false ${pofin.rules.length}`,
    `${two.added.length} ${two.conflicts.map((c) => `${c.ruleId} ${c.scope}`).join()} ${two.ruleset.rules.length}`,
  );
  const twice = mergeIds(two.ruleset, sys, two.conflicts);
  record("oppsett: the conflicting IDS dropped again: still one conflict, no row", "1 0", `${twice.conflicts.length} ${twice.added.length}`);
  const keptIds = resolveConflict(two.ruleset, two.conflicts, two.conflicts[0].id, "ids");
  record(
    "oppsett: «Behold IDS» puts the IDS rule in the mapping's place; the role is then absent and offered again",
    "sys IDS 0 system-classification",
    `${keptIds.ruleset.rules[1]?.id} ${originOf(keptIds.ruleset.rules[1]?.reference)} ${keptIds.conflicts.length} ${addableKinds(keptIds.ruleset).filter((k) => k === "system-classification").join()}`,
  );
  const keptCurrent = resolveConflict(two.ruleset, two.conflicts, two.conflicts[0].id, "current");
  record(
    "oppsett: «Behold nåværende» leaves the ruleset and drops the conflict",
    "same 0",
    `${JSON.stringify(keptCurrent.ruleset) === JSON.stringify(two.ruleset) ? "same" : "changed"} ${keptCurrent.conflicts.length}`,
  );

  // Absorbed: the same value rule, or none, on a covered selection.
  const custom = propertyRule(base([]), "Brann");
  const withCustom = withSource(base([custom]), custom.id, { propertySet: "Pset_WallCommon", name: "FireRating" })!;
  const anyValue = idsFile("C.ids", [prop("fire-any", "Pset_WallCommon", "FireRating")]);
  record(
    "oppsett: IDS with no value rule on a property already required: absorbed",
    "0 0",
    `${mergeIds(withCustom, anyValue).added.length} ${mergeIds(withCustom, anyValue).conflicts.length}`,
  );

  // Adopted: the existing requirement has no value rule, the IDS has one.
  const adopt = mergeIds(withCustom, fresh);
  const adoptedFacet = adopt.ruleset.rules[0].kind === "ids" ? adopt.ruleset.rules[0].requirements?.property?.[0] : undefined;
  record(
    "oppsett: the existing requirement has no value rule: the IDS one is adopted, no new row",
    `0 0 ${custom.id} EI30,EI60`,
    `${adopt.added.length} ${adopt.conflicts.length} ${adopt.adopted.join()} ${typeof adoptedFacet?.value === "object" ? adoptedFacet.value.restriction.enumeration?.join() : "none"}`,
  );

  // Two specs in one IDS on the same property: the second against the first.
  const pair = idsFile("D.ids", [
    prop("mmi-a", "KNM_Project", "MMI", { restriction: { enumeration: ["300", "400"] } }),
    prop("mmi-b", "KNM_Project", "MMI", { restriction: { enumeration: ["300", "400", "500"] } }),
  ]);
  const three = mergeIds(base([]), pair);
  record(
    "oppsett: two specs of one IDS on one property: one row, a conflict on it",
    "mmi-a mmi-a",
    `${three.added.join()} ${three.conflicts.map((c) => c.ruleId).join()}`,
  );

  // Scope: a selection the existing one covers is absorbed, another is a conflict.
  const physical = { entity: { group: "physicalElement" as const } };
  record(
    "oppsett: covers: physical elements cover IFCWALL, not IFCSPACE; the same selection covers itself",
    "true false true",
    [
      covers(physical, { entity: { classes: ["IFCWALL"] } }),
      covers(physical, { entity: { classes: ["IFCSPACE"] } }),
      covers({ entity: { classes: ["IFCSPACE"] } }, { entity: { classes: ["IFCSPACE"] } }),
    ].join(" "),
  );
  const spaceSpec = idsFile("E.ids", [prop("space-fire", "Pset_WallCommon", "FireRating", undefined, { entity: { classes: ["IFCSPACE"] } })]);
  const scoped = mergeIds(withCustom, spaceSpec);
  record("oppsett: IDS on a selection the existing requirement does not cover: a scope conflict, no row", "0 true", `${scoped.added.length} ${scoped.conflicts.map((c) => c.scope).join()}`);

  // Unreadable specs are listed with the importer's reason, never dropped silently.
  const broken = idsFile("F.ids", [prop("ok", "P", "A"), prop("bad", "P", "B")], (xml) =>
    xml.replace(/(<ids:specification [^>]*name="bad"[^>]*>)/, "$1<ids:foo/>"),
  );
  const four = mergeIds(base([]), broken);
  record(
    "oppsett: a spec the importer cannot read is listed with its reason",
    "1 bad unknown element <foo>",
    `${four.added.length} ${four.unreadable.map((u) => `${u.name} ${u.reason.replace(/^.*: /, "")}`).join()}`,
  );

  // Split: one keyed property facet per rule, the rest kept apart.
  const multi: IdsRule = {
    id: "m",
    kind: "ids",
    name: "M",
    applicability: { entity: { classes: ["IFCWALL"] } },
    requirements: {
      property: [
        { propertySet: "P", baseName: "A" },
        { propertySet: "P", baseName: "B" },
        { propertySet: { restriction: { pattern: "Pset_.*Common" } }, baseName: "IsExternal" },
      ],
      attribute: [{ name: "Name" }],
    },
  };
  record(
    "oppsett: split: one rule per literal property, one for the rest",
    "m-1:P.A m-2:P.B m-3:-",
    splitSpec(multi).map((r) => `${r.id}:${ruleKeys(r).join() || "-"}`).join(" "),
  );
  record("oppsett: split: a one-property spec is left whole", "x", splitSpec(prop("x", "P", "A")).map((r) => r.id).join(" "));

  // The custom property requirement evaluates and gets a report row.
  const filled = withSource(base([propertyRule(base([]), "Brann")]), "egenskap", { propertySet: "Pset_WallCommon", name: "FireRating" })!;
  const wall = (guid: string, entity = "IFCWALL") => ({
    guid, entity, name: guid, predefined_type: null, object_type: null, tag: null,
    storey_guid: null, parent_guid: null, type_name: null, typed: false, materials: [],
    is_external: null, fire_rating: null, load_bearing: null,
  });
  const graph: ModelGraph = {
    schema: "IFC4",
    products: [wall("w1"), wall("w2"), wall("w3"), wall("s1", "IFCSPACE")],
    contained_in: [], aggregates: [], voids: [], buildings: [], sites: [], spaces: [], storeys: [], classifications: [],
    psets: [
      { guid: "w1", pset_name: "Pset_WallCommon", prop_name: "FireRating", value: "EI60" },
      { guid: "w2", pset_name: "Pset_WallCommon", prop_name: "FireRating", value: "EI30" },
      { guid: "s1", pset_name: "Pset_WallCommon", prop_name: "FireRating", value: "EI30" },
    ],
  };
  const summary: ModelSummary = {
    schema: "IFC4", length_unit: "MILLIMETRE", unit_scale: 0.001, unit_resolved: true,
    authoring_app: null, project_name: null, duplicate_step_ids: 0, products: 4,
  };
  let evaluated = "threw";
  let rowText = "absent";
  try {
    const evaluation = evaluateRuleset(filled, graph, summary, "T_ARK.ifc");
    const r = evaluation.results.find((x) => x.ruleId === "egenskap");
    evaluated = r ? `${r.state} ${r.applicable} ${r.failed}` : "no result";
    const rows = reportRows({
      model: { file: "T_ARK.ifc", schema: "IFC4", sha256: "" },
      graph: graph as unknown as IfcGraph,
      summary: summary as unknown as IfcSummary,
      checks: [],
      ruleset: filled,
      evaluation,
    });
    const items = requirementItems(filled, []);
    const item = items.find((i) => i.ruleId === "egenskap")!;
    const row = rowOf(item, rows);
    const hits = sumHits([row]);
    rowText = row ? `${row.state} ${hits?.hits}/${hits?.of} ${itemStatus(item, true, [row])}` : "absent";
  } catch (error) {
    evaluated = `threw ${error instanceof Error ? error.message : String(error)}`;
  }
  record(
    "oppsett: a custom property requirement (IDS rule on the physical elements) evaluates: the space is out, one wall lacks it",
    "fail 3 1",
    evaluated,
  );
  record("oppsett: … and has a report row, its figure and a red dot", "fail 2/3 fail", rowText);
  record(
    "oppsett: a custom property requirement lints clean once filled; blank, its source is missing",
    "0 >0",
    `${lintRuleset(filled).filter((i) => i.severity === "error").length} ${lintRuleset(base([propertyRule(base([]), "Brann")])).some((i) => i.severity === "error") ? ">0" : "0"}`,
  );

  // The sidebar's items: the walk's order, the standard layer always, the
  // floor config when set, IDS rules after, a conflict marked.
  const items = requirementItems(two.ruleset, two.conflicts);
  record(
    "oppsett: the sidebar on POFIN: the walk's order, the standard layer, a conflict marked",
    "rule:type-name rule:system-classification! rule:component-classification rule:copy-object rule:progress-code phase materials ifc-schema",
    items.map((i) => i.id + (i.conflict ? "!" : "")).join(" "),
  );
  record(
    "oppsett: the sidebar's origin tags on POFIN",
    "POFIN POFIN POFIN POFIN POFIN null null POFIN",
    items.map((i) => String(i.origin)).join(" "),
  );
  record(
    "oppsett: a status with no model is never green",
    "saved open",
    `${itemStatus(items[1], false, [])} ${itemStatus({ ...items[1], source: null }, false, [])}`,
  );
}
