/** The browser side of the BCF export: models off the board, snapshots from a
 *  hidden viewer scene, XSD validation with the vendored schemas, download.
 *
 * Validation is not optional here: an archive with any document that fails
 * its buildingSMART XSD is reported and NOT downloaded.
 */

import markupXsd from "../../vendor/bcf-schema/markup.xsd?raw";
import versionXsd from "../../vendor/bcf-schema/version.xsd?raw";
import visinfoXsd from "../../vendor/bcf-schema/visinfo.xsd?raw";
import type { ModelEntry } from "../ui/useModels";
import type { Lang } from "../ui/i18n";
import { cacheKeyOf } from "../storage/model-cache.ts";
import { buildMeshSet, framingBox } from "../viewer/mesh-stream.ts";
import { ModelScene } from "../viewer/scene.ts";
import {
  SNAPSHOT_VIEWPORT,
  dataUrlBytes,
  exportBcf,
  type BcfExportResult,
  type BcfModelSource,
  type BcfValidateFn,
  type SnapshotFn,
} from "./export.ts";
import { bcfRender } from "./render.ts";
import { createBcfValidator } from "./validate.ts";

let validator: Promise<BcfValidateFn> | null = null;

function loadValidator(): Promise<BcfValidateFn> {
  validator ??= import("xmllint-wasm").then(({ validateXML }) =>
    createBcfValidator(
      { markup: markupXsd, visinfo: visinfoXsd, version: versionXsd },
      validateXML as never,
    ),
  );
  return validator;
}

/** The ready models, as the exporter reads them. A model without a cache key
 *  cannot be given stable topic GUIDs and is left out, and named. */
export function sourcesOf(models: ModelEntry[]): { sources: BcfModelSource[]; skipped: string[] } {
  const sources: BcfModelSource[] = [];
  const skipped: string[] = [];
  for (const model of models) {
    if (model.state !== "ready" || !model.report || !model.profile) continue;
    const cacheKey = cacheKeyOf(model.report.summary);
    if (!cacheKey) {
      skipped.push(model.fileName);
      continue;
    }
    sources.push({
      fileName: model.fileName,
      cacheKey,
      checks: model.report.checks,
      results: model.evaluation?.results,
      excludedGuids: model.evaluation?.excludedGuids,
      products: model.profile.rows,
      storeys: model.profile.storeys,
      unitScale: model.report.summary.unit_scale,
      mesh:
        model.meshBatches && model.meshShift && model.meshBudget
          ? { batches: model.meshBatches, shift: model.meshShift, budget: model.meshBudget }
          : null,
    });
  }
  return { sources, skipped };
}

/** One hidden scene at a time: topics come ordered by model, so the scene for
 *  a model is built on its first topic and released on the next model's. */
function snapshotter(sources: BcfModelSource[]): { snap: SnapshotFn; release: () => void } {
  let current: { model: number; scene: ModelScene } | null = null;
  const release = () => {
    current?.scene.disposeContext();
    current = null;
  };
  const snap: SnapshotFn = async (model, topic, pose) => {
    if (!current || current.model !== model) {
      release();
      const mesh = sources[model].mesh;
      if (!mesh) return null;
      const canvas = document.createElement("canvas");
      canvas.width = SNAPSHOT_VIEWPORT.width;
      canvas.height = SNAPSHOT_VIEWPORT.height;
      const scene = new ModelScene(canvas, { onPick: () => {}, onHover: () => {} });
      const set = buildMeshSet(mesh.batches, mesh.shift, mesh.budget);
      scene.load(set, framingBox(set));
      current = { model, scene };
    }
    // Yield between frames so a long export does not freeze the page.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const url = current.scene.snapshot(
        topic.guids,
        pose,
        SNAPSHOT_VIEWPORT.width,
        SNAPSHOT_VIEWPORT.height,
      );
      return url.startsWith("data:image/png") ? dataUrlBytes(url) : null;
    } catch {
      return null;
    }
  };
  return { snap, release };
}

export async function exportBoardBcf(
  models: ModelEntry[],
  lang: Lang,
  maxGuids: number,
  author: string,
): Promise<{ result: BcfExportResult; skipped: string[] }> {
  const { sources, skipped } = sourcesOf(models);
  const validate = await loadValidator();
  const { snap, release } = snapshotter(sources);
  try {
    const result = await exportBcf(sources, bcfRender(lang), {
      maxGuids,
      author,
      snapshot: snap,
      validate,
    });
    return { result, skipped };
  } finally {
    release();
  }
}

export function downloadBcf(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
