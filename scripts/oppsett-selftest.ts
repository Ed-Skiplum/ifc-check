/** Oppsett v2's merge rules (`src/ui/oppsett/merge.ts`, `items.ts`), run by
 *  `node scripts/ids-cli.ts selftest`: one requirement per role, one per
 *  source property, an IDS dropped MERGED (added, absorbed, adopted or a
 *  conflict, never a silent drop), re-dropping the same IDS adding nothing,
 *  and the custom property requirement evaluating with a report row. */

import type { IfcGraph, IfcSummary } from "../src/engine/types.ts";
import type { CodeEntry, IdsRule, IdsValue, Rule, Ruleset } from "../src/ids/types.ts";
import { phaseAccepted } from "../src/engine/standard-sources.ts";
import {
  assignCodes,
  codesOf,
  deletePhase,
  mmiCodes,
  otherPhaseSources,
  phaseMode,
  phaseNameTaken,
  phaseRows,
  renamePhase,
  unassigned,
  withMmiCodes,
  withOtherPhaseSources,
  withPhaseMode,
} from "../src/ui/oppsett/phase-mmi.ts";
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
import { ignoreIdOf, itemStatus, requirementItems, rowOf, sumHits, withIgnored } from "../src/ui/oppsett/items.ts";

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

  // Ignorer: every item can be ignored for the project by its report row id;
  // it stays listed, its status neutral; un-ignoring gives the ruleset back.
  record(
    "oppsett: each sidebar item's ignore id is its report row id (a mapping by its role)",
    "type-name system-classification component-classification copy-object progress-code phase material-product ifc-schema",
    items.map(ignoreIdOf).join(" "),
  );
  const phaseItem = items.find((i) => i.id === "phase")!;
  const sysItem = items.find((i) => i.role === "system-classification")!;
  const off = withIgnored(withIgnored(two.ruleset, phaseItem, true), sysItem, true);
  const offItems = requirementItems(off, two.conflicts);
  record(
    "oppsett: ignored items stay listed, marked, their status neutral whatever the rows say",
    `${items.length} rule:${sysItem.ruleId},phase ignored`,
    `${offItems.length} ${offItems.filter((i) => i.ignored).map((i) => i.id).join(",")} ${itemStatus(offItems.find((i) => i.id === "phase")!, true, [{ state: "fail" } as never])}`,
  );
  record("oppsett: the ignore list in the ruleset", "phase,system-classification", (off.ignore ?? []).join(","));
  const back = withIgnored(withIgnored(off, phaseItem, false), sysItem, false);
  record(
    "oppsett: un-ignoring restores the ruleset unchanged, the list left out when empty",
    "equal false",
    `${JSON.stringify(back) === JSON.stringify(two.ruleset) ? "equal" : "differs"} ${"ignore" in back}`,
  );

  phaseMmiSelftest(record, wall, summary);
}

/** Fase through MMI (`phase-mmi.ts`): the switch, the phase table's edits,
 *  and the result linting clean and evaluating on a synthetic model. */
function phaseMmiSelftest(
  record: Record_,
  wall: (guid: string, entity?: string) => ModelGraph["products"][number],
  summary: ModelSummary,
): void {
  const pofin = pofinRuleset();
  const phasesOf = (codes: CodeEntry[]) => phaseRows(codes, []).map((p) => `${p}:${codesOf(codes, p).map((c) => c.code).join(",")}`).join(" ");
  const errorCodes = (r: Ruleset) => lintRuleset(r).filter((i) => i.severity === "error").map((i) => i.code);

  // MMI on POFIN: its format-only rule takes «MMI for gjenbruk».
  const mmi = withPhaseMode(pofin, "mmi");
  record("fase/mmi: Status is the default on POFIN", "status", phaseMode(pofin));
  record(
    "fase/mmi: MMI on POFIN fills the format-only rule from «MMI for gjenbruk» and adds the MMI source",
    "mmi 22 Ny:000,100,125,150,175,200,225,250,275,300,325,350,375,400,425,450,475,500,600 Bevares:700 MMI 800:800 Gjenvinning/avfall:900",
    `${phaseMode(mmi)} ${mmiCodes(mmi).length} ${phasesOf(mmiCodes(mmi))}`,
  );
  record("fase/mmi: … and lints with no error (no progress-code-no-phase)", "", errorCodes(mmi).join(" "));
  record(
    "fase/mmi: … the accepted phases take the table's",
    "NEW EXISTING DEMOLISH TEMPORARY Ny Bevares MMI 800 Gjenvinning/avfall",
    phaseAccepted(mmi).join(" "),
  );
  record("fase/mmi: MMI twice is MMI once", JSON.stringify(mmi), JSON.stringify(withPhaseMode(mmi, "mmi")));
  const offAgain = withPhaseMode(mmi, "status");
  record(
    "fase/mmi: Status drops the MMI source, keeps the codes' phases, lints clean",
    "status false 22 ",
    `${phaseMode(offAgain)} ${offAgain.projectLayer?.phase !== undefined} ${mmiCodes(offAgain).filter((c) => c.phase).length} ${errorCodes(offAgain).join(" ")}`,
  );

  // No MMI rule: added as «Legg til krav» adds it; a disabled one enabled.
  const added = withPhaseMode(base([]), "mmi");
  const first = added.rules[0];
  record(
    "fase/mmi: MMI with no MMI rule adds POFIN's, filled, and lints clean",
    "progress-code progress-code 22 ",
    `${added.rules.map((r) => r.id).join(" ")} ${first?.kind === "extended" ? first.mapping : ""} ${mmiCodes(added).length} ${errorCodes(added).join(" ")}`,
  );
  const disabled = { ...pofin, rules: pofin.rules.map((r) => (r.id === "progress-code" ? { ...r, enabled: false } : r)) } as Ruleset;
  const enabled = withPhaseMode(disabled, "mmi");
  record(
    "fase/mmi: a disabled MMI rule is enabled",
    "true ",
    `${enabled.rules.find((r) => r.id === "progress-code")?.enabled !== false} ${errorCodes(enabled).join(" ")}`,
  );
  // Codes already set are kept, not replaced by the preset.
  const own = withPhaseMode(withMmiCodes(pofin, [{ code: "100", name: "A" }, { code: "200", name: "B", phase: "Ny" }]), "mmi");
  record("fase/mmi: codes already set are kept", "Ny:200", phasesOf(mmiCodes(own)));

  // The table's edits.
  const codes: CodeEntry[] = [
    { code: "100", name: "A", phase: "Ny" },
    { code: "200", name: "B", phase: "Ny" },
    { code: "700", name: "C", phase: "Bevares" },
    { code: "900", name: "D" },
  ];
  record("fase/mmi: rows: the page's order, then the codes' phases", "Tom Ny Bevares", phaseRows(codes, ["Tom", "Ny"]).join(" "));
  record("fase/mmi: unassigned codes", "900", unassigned(codes).map((c) => c.code).join(","));
  const moved = assignCodes(codes, ["200", "900"], "Bevares");
  record("fase/mmi: assign moves codes out of their phase into one", "Ny:100 Bevares:200,700,900", phasesOf(moved));
  const freed = assignCodes(moved, ["700"], null);
  record("fase/mmi: assign to none leaves no phase key", "false Ny:100 Bevares:200,900", `${"phase" in freed.find((c) => c.code === "700")!} ${phasesOf(freed)}`);
  const renamed = renamePhase(codes, "Ny", "Nybygg");
  record("fase/mmi: rename renames the phase on every code carrying it", "Nybygg:100,200 Bevares:700", phasesOf(renamed));
  const deleted = deletePhase(codes, "Ny");
  record("fase/mmi: delete un-assigns the phase's codes", "Bevares:700 | 100,200,900", `${phasesOf(deleted)} | ${unassigned(deleted).map((c) => c.code).join(",")}`);
  record(
    "fase/mmi: a name another row has is taken, ignoring case and space; its own is not",
    "true false false",
    `${phaseNameTaken(["Ny", "Bevares"], 1, " ny ")} ${phaseNameTaken(["Ny", "Bevares"], 0, "Ny")} ${phaseNameTaken(["Ny", "Bevares"], 1, "Rives")}`,
  );
  // A renamed table still lints clean and the new name is accepted.
  const renamedSet = withMmiCodes(mmi, renamePhase(mmiCodes(mmi), "Bevares", "Eksisterende bevares"));
  record(
    "fase/mmi: a renamed phase lints clean and is the accepted one",
    " true false",
    `${errorCodes(renamedSet).join(" ")} ${phaseAccepted(renamedSet).includes("Eksisterende bevares")} ${phaseAccepted(renamedSet).includes("Bevares")}`,
  );
  // The other phase sources keep the MMI source where it stood.
  const withProp = withPhaseMode(
    { ...pofin, projectLayer: { ...pofin.projectLayer, phase: { sources: [{ property: { propertySet: "A", name: "B" } }] } } },
    "mmi",
  );
  const swapped = withOtherPhaseSources(withProp, [{ property: { propertySet: "C", name: "D" } }, { property: { propertySet: "E", name: "F" } }]);
  record(
    "fase/mmi: editing the other sources keeps the MMI source after the ones before it",
    '[{"property":{"propertySet":"A","name":"B"}}] [{"property":{"propertySet":"C","name":"D"}},{"progressCode":{}},{"property":{"propertySet":"E","name":"F"}}]',
    `${JSON.stringify(otherPhaseSources(withProp))} ${JSON.stringify(swapped.projectLayer?.phase?.sources)}`,
  );

  // Fase evaluates through MMI on a synthetic model: 700 is Bevares (the MMI
  // source answered), 123 is in no phase (avvik), a Status NEW decides
  // first, nothing at all is mangler.
  const graph: ModelGraph = {
    schema: "IFC4",
    products: [wall("m1"), wall("m2"), wall("m3"), wall("m4"), wall("m5")],
    contained_in: [], aggregates: [], voids: [], buildings: [], sites: [], spaces: [], storeys: [], classifications: [],
    psets: [
      { guid: "m1", pset_name: "NONS_Process", prop_name: "ProcessStatus", value: "700" },
      { guid: "m2", pset_name: "NONS_Process", prop_name: "ProcessStatus", value: "700" },
      { guid: "m3", pset_name: "NONS_Process", prop_name: "ProcessStatus", value: "123" },
      { guid: "m4", pset_name: "Pset_WallCommon", prop_name: "Status", value: "NEW" },
      { guid: "m4", pset_name: "NONS_Process", prop_name: "ProcessStatus", value: "900" },
    ],
  };
  let text = "threw";
  try {
    const evaluation = evaluateRuleset(mmi, graph, summary, "T_ARK.ifc");
    const rows = reportRows({
      model: { file: "T_ARK.ifc", schema: "IFC4", sha256: "" },
      graph: graph as unknown as IfcGraph,
      summary: summary as unknown as IfcSummary,
      checks: [],
      ruleset: mmi,
      evaluation,
    });
    const row = rowOf(requirementItems(mmi, []).find((i) => i.id === "phase")!, rows);
    const d = row?.dekning;
    text = row
      ? `${d?.oppfylt}/${d?.avvik}/${d?.mangler} ${d?.kilder.map((k) => `${k.lag}=${k.n}`).join(",")} ${(row.fordeling ?? []).map((f) => `${f.verdi}:${f.n}${f.flagg ? `:${f.flagg}` : ""}`).join(" ")}`
      : "absent";
  } catch (error) {
    text = `threw ${error instanceof Error ? error.message : String(error)}`;
  }
  record(
    "fase/mmi: Fase evaluates through MMI on a synthetic model",
    "3/1/1 standard=1,prosjekt=3 Bevares:2 null:1:mangler 123:1:avvik NEW:1",
    text,
  );
}
