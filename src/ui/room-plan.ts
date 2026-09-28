/** The Rom tab's plan: each space's floor, projected straight down, as 2D
 *  outlines (edkjo 2026-09-28: *"a floor plan per storey"*).
 *
 * Pure: it reads the streamed mesh batches the 3D already holds (`positions`
 * in the model's shifted metres, Z up) and returns plan shapes, never a
 * second copy of the model. Per space:
 *
 *   floor     the triangles that face up or down (|n_z| ≥ 0.5 |n|) in the
 *             LOWER half of the space's height, so a sloped or stepped
 *             ceiling is not read as floor. A space with none there falls
 *             back to every horizontal triangle.
 *   outline   the floor's boundary: its edges that belong to one floor
 *             triangle only, after welding vertices at identical
 *             coordinates.
 *
 * It is the space's footprint, not a mesh section at a cut height: the
 * spaces are the only thing drawn, and a prism's floor IS its cut.
 */

import type { MeshBatch } from "../viewer/mesh-stream";

export interface PlanShape {
  guid: string;
  /** Floor triangles, x y per corner, six numbers per triangle. */
  tris: Float32Array;
  /** Boundary segments, x1 y1 x2 y2 per segment. */
  outline: Float32Array;
  min: [number, number];
  max: [number, number];
  /** Area-weighted centre of the floor, for the label. */
  centre: [number, number];
  /** Floor area in the plane, m². */
  area: number;
}

/** Plan shapes for `guids`, from the batches. A guid with no geometry in
 *  the batches (none, or the triangle budget withheld its batch) is absent. */
export function planShapes(batches: readonly MeshBatch[] | undefined, guids: ReadonlySet<string>): Map<string, PlanShape> {
  const out = new Map<string, PlanShape>();
  if (!batches) return out;
  for (const batch of batches) {
    for (const row of batch.meta) {
      if (!guids.has(row.guid)) continue;
      const shape = shapeOf(row.guid, batch.positions, batch.indices, row.i0, row.in);
      if (shape) out.set(row.guid, shape);
    }
  }
  return out;
}

export function shapeOf(
  guid: string,
  positions: Float32Array,
  indices: Uint32Array,
  i0: number,
  count: number,
): PlanShape | null {
  const faces = Math.floor(count / 3);
  if (faces === 0) return null;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let k = i0; k < i0 + faces * 3; k += 1) {
    const z = positions[indices[k] * 3 + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const mid = (zMin + zMax) / 2;
  const horizontal: number[] = [];
  const lower: number[] = [];
  for (let f = 0; f < faces; f += 1) {
    const a = indices[i0 + f * 3] * 3;
    const b = indices[i0 + f * 3 + 1] * 3;
    const c = indices[i0 + f * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || Math.abs(nz) < 0.5 * len) continue;
    horizontal.push(f);
    const zc = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    if (zc <= mid) lower.push(f);
  }
  const floor = lower.length > 0 ? lower : horizontal;
  if (floor.length === 0) return null;

  const tris = new Float32Array(floor.length * 6);
  const edges = new Map<string, { n: number; seg: [number, number, number, number] }>();
  const key = (v: number) => `${positions[v]},${positions[v + 1]},${positions[v + 2]}`;
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  let area = 0;
  let cx = 0;
  let cy = 0;
  floor.forEach((f, i) => {
    const corners = [0, 1, 2].map((k) => indices[i0 + f * 3 + k] * 3);
    corners.forEach((v, k) => {
      const x = positions[v];
      const y = positions[v + 1];
      tris[i * 6 + k * 2] = x;
      tris[i * 6 + k * 2 + 1] = y;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
    });
    const [ax, ay, bx, by, qx, qy] = tris.subarray(i * 6, i * 6 + 6);
    const a = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
    area += a;
    cx += (a * (ax + bx + qx)) / 3;
    cy += (a * (ay + by + qy)) / 3;
    for (let k = 0; k < 3; k += 1) {
      const p = corners[k];
      const q = corners[(k + 1) % 3];
      const kp = key(p);
      const kq = key(q);
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const seen = edges.get(id);
      if (seen) seen.n += 1;
      else edges.set(id, { n: 1, seg: [positions[p], positions[p + 1], positions[q], positions[q + 1]] });
    }
  });
  const boundary = [...edges.values()].filter((e) => e.n === 1);
  const outline = new Float32Array(boundary.length * 4);
  boundary.forEach((e, i) => outline.set(e.seg, i * 4));
  const centre: [number, number] = area > 0 ? [cx / area, cy / area] : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return { guid, tris, outline, min, max, centre, area };
}

/** The box around `shapes`, or null for none. */
export function planBounds(shapes: Iterable<PlanShape>): { min: [number, number]; max: [number, number] } | null {
  let min: [number, number] | null = null;
  let max: [number, number] | null = null;
  for (const s of shapes) {
    min = min ? [Math.min(min[0], s.min[0]), Math.min(min[1], s.min[1])] : [...s.min];
    max = max ? [Math.max(max[0], s.max[0]), Math.max(max[1], s.max[1])] : [...s.max];
  }
  return min && max ? { min, max } : null;
}
