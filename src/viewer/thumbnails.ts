/** Gallery thumbnails: one small render of ONE representative element.
 *
 * The Typer gallery shows each type as a picture of an element of that type
 * (owner, 2026-09-26: "the types and materials tabs need to be galleries, not
 * rows"). The cost rule: never a second copy of the model. So this reads the
 * streamed mesh batches the board already holds (`MeshBatch`, CPU side) and,
 * per thumbnail, builds a geometry of that ONE element's triangles, renders it
 * once into a small offscreen canvas, keeps the image and throws the geometry
 * away. The positions are a VIEW into the batch (no copy); only the element's
 * own index range is copied, re-based to 0.
 *
 * One WebGL context for every thumbnail of every model, created on the first
 * request. The board's scene is not borrowed: its `snapshot` replaces filter
 * and selection, which a visible tile must never have done to it.
 *
 * Lazy and cached: a card asks when it scrolls into view, requests run a few
 * per frame, and the image is kept per (batches, key), so a revisit costs a
 * map lookup. A type with no streamed geometry resolves to null, and the card
 * shows its class glyph instead of a render: a picture that is not of that
 * type's element would be fabricated.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import type { MeshBatch, MeshMetaRow } from "./mesh-stream";

/** Drawing buffer, px. The card shows it at about half, so it is sharp on a
 *  2x screen. */
export const THUMB_W = 320;
export const THUMB_H = 200;

/** Renders per animation frame. Each is one small geometry and one readback. */
const PER_FRAME = 3;

type Located = { batch: MeshBatch; row: MeshMetaRow };

const locators = new WeakMap<MeshBatch[], Map<string, Located>>();
const images = new WeakMap<MeshBatch[], Map<string, string | null>>();

function locate(batches: MeshBatch[]): Map<string, Located> {
  let index = locators.get(batches);
  if (!index) {
    index = new Map();
    for (const batch of batches) for (const row of batch.meta) index.set(row.guid, { batch, row });
    locators.set(batches, index);
  }
  return index;
}

/** The element a card stands for: the MEDIAN by triangle count among the
 *  instances that have geometry, so one odd element (the largest or a stub)
 *  does not speak for the type. */
function representative(batches: MeshBatch[], guids: readonly string[]): Located | null {
  const index = locate(batches);
  const found: Located[] = [];
  for (const guid of guids) {
    const hit = index.get(guid);
    if (hit && hit.row.in > 0) found.push(hit);
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.row.in - b.row.in);
  return found[Math.floor(found.length / 2)];
}

/* ── the one renderer ─────────────────────────────────────────────────── */

let renderer: WebGLRenderer | null = null;
let failed = false;
const scene = new Scene();
const camera = new PerspectiveCamera(30, THUMB_W / THUMB_H, 0.01, 1000);
const material = new MeshStandardMaterial({
  roughness: 0.86,
  metalness: 0.02,
  flatShading: true,
  side: DoubleSide,
});

function ensureRenderer(): WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_W, THUMB_H, false);
    renderer.setClearColor(0x000000, 0);
    scene.add(new HemisphereLight(0xffffff, 0x9a958b, 2.1));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.4, 0.9);
    scene.add(key);
  } catch {
    failed = true;
    renderer = null;
  }
  return renderer;
}

/** The eye direction: the board's entry view (from the front-right, above). */
const EYE = new Vector3(1, 0.75, 1.15).normalize();

function render(hit: Located): string | null {
  const gl = ensureRenderer();
  if (!gl) return null;
  const { batch, row } = hit;
  const positions = batch.positions.subarray(row.v0 * 3, (row.v0 + row.vn) * 3);
  const source = batch.indices.subarray(row.i0, row.i0 + row.in);
  const local = new Uint32Array(source.length);
  for (let i = 0; i < source.length; i += 1) local[i] = source[i] - row.v0;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(local, 1));
  // IFC is Z-up; the board turns its root the same way.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  const sphere: Sphere = geometry.boundingSphere ?? new Sphere(new Vector3(), 1);

  material.color = new Color(row.rgba[0], row.rgba[1], row.rgba[2]);
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  const radius = Math.max(sphere.radius, 1e-3);
  const fov = (camera.fov * Math.PI) / 180;
  const fitV = radius / Math.sin(fov / 2);
  const fitH = radius / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
  const distance = Math.max(fitV, fitH) * 1.08;
  camera.position.copy(sphere.center).addScaledVector(EYE, distance);
  camera.near = Math.max(distance - radius * 2, distance / 1000);
  camera.far = distance + radius * 2;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();

  gl.render(scene, camera);
  // Read back in the same task as the render, so no preserveDrawingBuffer.
  const url = gl.domElement.toDataURL("image/webp", 0.9);
  scene.remove(mesh);
  geometry.dispose();
  return url;
}

/* ── the queue ────────────────────────────────────────────────────────── */

interface Job {
  batches: MeshBatch[];
  key: string;
  guids: readonly string[];
  done: (url: string | null) => void;
}

const queue: Job[] = [];
let scheduled = false;

function pump() {
  scheduled = false;
  for (let n = 0; n < PER_FRAME && queue.length > 0; n += 1) {
    const job = queue.shift()!;
    const cache = images.get(job.batches) ?? new Map<string, string | null>();
    images.set(job.batches, cache);
    let url = cache.get(job.key);
    if (url === undefined) {
      const hit = representative(job.batches, job.guids);
      url = hit ? render(hit) : null;
      cache.set(job.key, url);
    }
    job.done(url);
  }
  if (queue.length > 0) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(pump);
}

/** The cached image, `null` for no geometry, or `undefined` when it has not
 *  been rendered yet. */
export function cachedThumb(batches: MeshBatch[], key: string): string | null | undefined {
  return images.get(batches)?.get(key);
}

/** Ask for a thumbnail. Returns a cancel for a card that left view first. */
export function requestThumb(
  batches: MeshBatch[],
  key: string,
  guids: readonly string[],
  done: (url: string | null) => void,
): () => void {
  const job: Job = { batches, key, guids, done };
  queue.push(job);
  schedule();
  return () => {
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  };
}
