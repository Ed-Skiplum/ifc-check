/** Build a BCF 2.1 archive from the loaded models' failing checks.
 *
 * One code path for the browser and `scripts/bcf-cli.ts`. What differs between
 * the two is injected: the strings (language), the snapshot renderer (WebGL,
 * browser only) and the XSD validator (xmllint-wasm, loaded differently).
 *
 * Only `fail` becomes a topic. `pass`, `review`, `not_applicable` and
 * `not_evaluable` do not: a topic is something to fix, and none of those is.
 */

import type { CheckResult, DisplayValue, Finding } from "../engine/types.ts";
import type { RuleResult } from "../ids/evaluate.ts";
import { collectBoxes, unshiftBoxes, type ElementBox } from "../engine/placement.ts";
import {
  buildMeshSet,
  elementRows,
  framingBox,
  type FramingBox,
  type MeshBatch,
  type MeshBudget,
} from "../viewer/mesh-stream.ts";
import type { Viewport } from "../viewer/camera.ts";
import { topicCamera, type TopicCamera, type ViewerPose } from "./camera.ts";
import {
  planTopics,
  type BcfCheck,
  type BcfModelPlanInput,
  type BcfPlan,
  type BcfStrings,
  type TopicPlan,
} from "./plan.ts";
import { buildSpaceLocator, countSpaces, type SpaceLocator } from "./spaces.ts";
import { markupXml, versionXml, viewpointXml } from "./xml.ts";
import { zipStore, type ZipEntry } from "./zip.ts";

export const DEFAULT_MAX_GUIDS = 500;
export const SNAPSHOT_VIEWPORT: Viewport = { width: 1024, height: 768 };

export interface BcfModelSource {
  fileName: string;
  /** ifcfast `cache_key`. Seeds the topic GUIDs. */
  cacheKey: string;
  checks: CheckResult[];
  results?: RuleResult[];
  /** Copy-object exclusions. Findings already leave them out; this is the
   *  belt to that brace. */
  excludedGuids?: string[];
  products: { guid: string; entity: string; name: string | null; storeyGuid: string | null }[];
  /** Elevation in FILE units (ifcfast#180); scaled by `unitScale` here. */
  storeys: { guid: string; name: string | null; elevation: number | null }[];
  unitScale: number;
  mesh: { batches: MeshBatch[]; shift: [number, number, number]; budget: MeshBudget } | null;
}

export interface BcfRender extends BcfStrings {
  checkLabel: (checkId: string) => string;
  reason: (finding: Finding) => string;
  displayValue: (value: DisplayValue) => string;
}

export type SnapshotFn = (
  model: number,
  topic: TopicPlan,
  pose: ViewerPose,
) => Promise<Uint8Array | null>;

export type BcfDocumentKind = "version" | "markup" | "visinfo";

export type BcfValidateFn = (
  kind: BcfDocumentKind,
  xml: string,
  fileName: string,
) => Promise<{ valid: boolean; errors: { message: string }[] }>;

export interface BcfExportOptions {
  maxGuids: number;
  author: string;
  date?: Date;
  viewport?: Viewport;
  snapshot?: SnapshotFn;
  validate?: BcfValidateFn;
}

/** Where spaces came from for one exported model. */
export interface SpaceSource {
  fileName: string;
  /** The space-bearing model used, or null when none was loaded. */
  source: string | null;
  spaces: number;
  /** Storey names the two models share (when source is another model). */
  sharedStoreys: number;
}

export interface BcfExportResult {
  bytes: Uint8Array;
  plan: BcfPlan;
  documents: { path: string; kind: BcfDocumentKind; xml: string }[];
  cameras: Map<string, TopicCamera>;
  snapshots: number;
  spaceSources: SpaceSource[];
  /** Models whose topics carry no camera, and why. */
  noCamera: { fileName: string; reason: string }[];
  invalid: { path: string; errors: string[] }[];
}

function toChecks(source: BcfModelSource, render: BcfRender): BcfCheck[] {
  const excluded = new Set(source.excludedGuids ?? []);
  const keep = (guid: string) => !excluded.has(guid);
  const checks: BcfCheck[] = [];
  for (const check of source.checks) {
    if (check.state !== "fail") continue;
    checks.push({
      key: `fundamental:${check.id}`,
      label: render.checkLabel(check.id),
      head: [render.displayValue(check.displayValue), check.detail].filter(Boolean),
      findings: check.findings
        .filter((f) => keep(f.guid))
        .map((f) => ({ guid: f.guid, reason: render.reason(f) })),
    });
  }
  for (const result of source.results ?? []) {
    if (result.state !== "fail") continue;
    checks.push({
      key: `rule:${result.ruleId}`,
      label: result.ruleName || result.ruleId,
      head: [result.detail].filter(Boolean),
      findings: result.findings.flatMap((f) =>
        (f.members && f.members.length > 0 ? f.members : [f.guid])
          .filter(keep)
          .map((guid) => ({ guid, reason: f.reason })),
      ),
    });
  }
  return checks;
}

/** Element centres in absolute IFC metres, Z up, from the streamed batches. */
function centresOf(mesh: NonNullable<BcfModelSource["mesh"]>): Map<string, [number, number, number]> {
  const boxes = new Map<string, ElementBox>();
  for (const batch of mesh.batches) collectBoxes(boxes, batch.meta, batch.positions);
  unshiftBoxes(boxes, mesh.shift);
  const centres = new Map<string, [number, number, number]>();
  for (const [guid, box] of boxes) {
    centres.set(guid, [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ]);
  }
  return centres;
}

function storeyKey(name: string | null): string {
  return (name ?? "").trim();
}

/** The space-bearing model for `model`: itself when it has spaces, otherwise
 *  the candidate sharing the most storey names with it (then the most storey
 *  elevations within 1 cm), then load order. */
function chooseSpaceSource(
  model: number,
  sources: BcfModelSource[],
  candidates: number[],
): { index: number; shared: number } | null {
  if (candidates.includes(model)) return { index: model, shared: sources[model].storeys.length };
  if (candidates.length === 0) return null;
  const mine = sources[model];
  const names = new Set(mine.storeys.map((s) => storeyKey(s.name)).filter(Boolean));
  const elevations = mine.storeys
    .filter((s) => s.elevation !== null)
    .map((s) => s.elevation! * mine.unitScale);
  let best: { index: number; shared: number; near: number } | null = null;
  for (const index of candidates) {
    const other = sources[index];
    const shared = other.storeys.filter((s) => names.has(storeyKey(s.name))).length;
    const near = other.storeys.filter(
      (s) =>
        s.elevation !== null &&
        elevations.some((e) => Math.abs(e - s.elevation! * other.unitScale) < 0.01),
    ).length;
    if (!best || shared > best.shared || (shared === best.shared && near > best.near)) {
      best = { index, shared, near };
    }
  }
  return best ? { index: best.index, shared: best.shared } : null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** `data:image/png;base64,...` -> bytes. For a snapshot renderer's output. */
export function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  return base64ToBytes(url.slice(comma + 1));
}

export async function exportBcf(
  sources: BcfModelSource[],
  render: BcfRender,
  options: BcfExportOptions,
): Promise<BcfExportResult> {
  const date = (options.date ?? new Date()).toISOString();
  const viewport = options.viewport ?? SNAPSHOT_VIEWPORT;

  // Spaces: any loaded model with IfcSpace geometry is a candidate.
  const candidates = sources
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.mesh && countSpaces(s.mesh.batches) > 0)
    .map(({ i }) => i);
  const locators = new Map<number, SpaceLocator>();
  const locatorOf = (index: number) => {
    let locator = locators.get(index);
    if (!locator) {
      const source = sources[index];
      const names = new Map(source.products.map((p) => [p.guid, p.name]));
      locator = buildSpaceLocator(source.mesh!.batches, source.mesh!.shift, (g) => names.get(g) ?? null);
      locators.set(index, locator);
    }
    return locator;
  };

  const spaceSources: SpaceSource[] = [];
  const inputs: BcfModelPlanInput[] = sources.map((source, index) => {
    const storeyOf = new Map(source.products.map((p) => [p.guid, p.storeyGuid]));
    const input: BcfModelPlanInput = {
      fileName: source.fileName,
      cacheKey: source.cacheKey,
      checks: toChecks(source, render),
      storeys: source.storeys.map((s) => ({
        guid: s.guid,
        name: s.name ?? "",
        elevation: s.elevation === null ? null : s.elevation * source.unitScale,
      })),
      storeyOf,
    };
    const chosen = chooseSpaceSource(index, sources, candidates);
    if (chosen && source.mesh) {
      const locator = locatorOf(chosen.index);
      let centres: Map<string, [number, number, number]> | null = null;
      input.spaceOf = (guid) => {
        centres ??= centresOf(source.mesh!);
        const centre = centres.get(guid);
        return centre ? locator.locate(centre) : null;
      };
      spaceSources.push({
        fileName: source.fileName,
        source: sources[chosen.index].fileName,
        spaces: locator.spaces,
        sharedStoreys: chosen.shared,
      });
    } else {
      spaceSources.push({ fileName: source.fileName, source: null, spaces: 0, sharedStoreys: 0 });
    }
    return input;
  });

  const plan = planTopics(inputs, options.maxGuids, render);

  // Cameras: per model, one framing pass; none at all on a capped model, where
  // an element missing geometry cannot be told from one that was withheld.
  const noCamera: BcfExportResult["noCamera"] = [];
  const framings = new Map<number, { framing: FramingBox; rows: Map<string, number>; shift: [number, number, number] }>();
  sources.forEach((source, index) => {
    if (!source.mesh) {
      noCamera.push({ fileName: source.fileName, reason: "no geometry" });
      return;
    }
    if (source.mesh.budget.capped) {
      noCamera.push({ fileName: source.fileName, reason: "geometry capped" });
      return;
    }
    const set = buildMeshSet(source.mesh.batches, source.mesh.shift, source.mesh.budget);
    const framing = framingBox(set);
    if (!framing) {
      noCamera.push({ fileName: source.fileName, reason: "no geometry" });
      return;
    }
    framings.set(index, { framing, rows: elementRows(framing.elements), shift: source.mesh.shift });
  });

  const cameras = new Map<string, TopicCamera>();
  const entries: ZipEntry[] = [];
  const documents: BcfExportResult["documents"] = [];
  const encoder = new TextEncoder();
  const add = (path: string, kind: BcfDocumentKind, xml: string) => {
    documents.push({ path, kind, xml });
    entries.push({ path, data: encoder.encode(xml) });
  };

  add("bcf.version", "version", versionXml());
  let snapshots = 0;
  for (const topic of plan.topics) {
    const framed = framings.get(topic.model);
    const camera =
      framed && topic.guids.length > 0
        ? topicCamera(framed.framing, framed.rows, topic.guids, framed.shift, viewport)
        : null;
    if (camera) cameras.set(topic.guid, camera);
    let png: Uint8Array | null = null;
    if (camera && options.snapshot) png = await options.snapshot(topic.model, topic, camera.pose);
    if (png) snapshots += 1;

    const hasViewpoint = topic.guids.length > 0;
    add(
      `${topic.guid}/markup.bcf`,
      "markup",
      markupXml(topic, { author: options.author, date, hasViewpoint, hasSnapshot: png !== null }),
    );
    if (hasViewpoint) {
      add(`${topic.guid}/viewpoint.bcfv`, "visinfo", viewpointXml(topic, camera?.ifc ?? null));
    }
    if (png) entries.push({ path: `${topic.guid}/snapshot.png`, data: png });
  }

  const invalid: BcfExportResult["invalid"] = [];
  if (options.validate) {
    for (const doc of documents) {
      const result = await options.validate(doc.kind, doc.xml, doc.path);
      if (!result.valid) invalid.push({ path: doc.path, errors: result.errors.map((e) => e.message) });
    }
  }

  return {
    bytes: zipStore(entries, options.date ?? new Date()),
    plan,
    documents,
    cameras,
    snapshots,
    spaceSources,
    noCamera,
    invalid,
  };
}
