/** Which IfcSpace an element sits in, by geometry.
 *
 * The wasm graph carries no space containment and no IfcRelSpaceBoundary
 * (`contained_in` is storey-only, see `src/engine/types.ts`), so the space is
 * found geometrically: the element's mesh-box CENTRE is tested against each
 * space's own triangle MESH, not its box. A box prefilter picks candidates; a
 * ray cast straight up from the point counts crossings of the space's
 * triangles, and an odd count is inside (closed-mesh parity). When several
 * spaces contain the point, the one with the smallest box volume wins.
 *
 * Everything is in absolute IFC world metres, Z up: streamed positions plus
 * the model's stream shift. That is what lets the space model be a DIFFERENT
 * file from the element model (an ARK model's rooms, an RIV model's ducts):
 * both are brought to the same absolute frame. It is exactly as good as the
 * two files' shared coordinates, and no better.
 *
 * Positions are f32 at the stream (ifcfast#188 on the vendored build), so a
 * point within a few millimetres of a space face can land on either side.
 */

import type { MeshBatch } from "../viewer/mesh-stream.ts";
import type { BcfSpace } from "./plan.ts";

interface SpaceMesh {
  space: BcfSpace;
  min: [number, number, number];
  max: [number, number, number];
  volume: number;
  /** Nine doubles per triangle, absolute metres. */
  triangles: Float64Array;
}

export interface SpaceLocator {
  spaces: number;
  locate(point: readonly [number, number, number]): BcfSpace | null;
}

/** Count IfcSpace rows in a set of batches (cheap, for choosing a source). */
export function countSpaces(batches: readonly MeshBatch[]): number {
  let n = 0;
  for (const batch of batches) for (const row of batch.meta) if (row.entity === "IfcSpace") n += 1;
  return n;
}

export function buildSpaceLocator(
  batches: readonly MeshBatch[],
  shift: readonly [number, number, number],
  nameOf: (guid: string) => string | null,
): SpaceLocator {
  const meshes: SpaceMesh[] = [];
  for (const batch of batches) {
    for (const row of batch.meta) {
      if (row.entity !== "IfcSpace") continue;
      const faces = row.in / 3;
      const triangles = new Float64Array(faces * 9);
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let f = 0; f < faces; f += 1) {
        for (let k = 0; k < 3; k += 1) {
          const v = batch.indices[row.i0 + f * 3 + k];
          for (let a = 0; a < 3; a += 1) {
            const value = batch.positions[v * 3 + a] + shift[a];
            triangles[f * 9 + k * 3 + a] = value;
            if (value < min[a]) min[a] = value;
            if (value > max[a]) max[a] = value;
          }
        }
      }
      if (faces === 0) continue;
      const name = nameOf(row.guid);
      meshes.push({
        space: { guid: row.guid, name: name && name.trim() ? name : row.guid },
        min,
        max,
        volume: (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]),
        triangles,
      });
    }
  }

  return {
    spaces: meshes.length,
    locate(point) {
      // A fixed sub-millimetre nudge keeps the upward ray off shared edges and
      // vertices, where a crossing would be counted twice or not at all.
      const px = point[0] + 1.37e-7;
      const py = point[1] + 2.91e-7;
      const pz = point[2];
      let best: SpaceMesh | null = null;
      for (const mesh of meshes) {
        if (px < mesh.min[0] || px > mesh.max[0]) continue;
        if (py < mesh.min[1] || py > mesh.max[1]) continue;
        if (pz < mesh.min[2] || pz > mesh.max[2]) continue;
        if (best && mesh.volume >= best.volume) continue;
        if (insideMesh(mesh.triangles, px, py, pz)) best = mesh;
      }
      return best ? best.space : null;
    },
  };
}

/** Parity of crossings of the ray (px, py, pz) -> +Z with the triangles. */
function insideMesh(t: Float64Array, px: number, py: number, pz: number): boolean {
  let crossings = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2];
    const bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
    const cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    // Barycentric test in the XY projection.
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue; // vertical face: parallel to the ray
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
    const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * az + l2 * bz + l3 * cz;
    if (z > pz) crossings += 1;
  }
  return crossings % 2 === 1;
}
