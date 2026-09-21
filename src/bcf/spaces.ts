/** Which IfcSpace an element sits in, by geometry, and whether it is a
 *  DISCRETE object of that space rather than part of the enclosing mass.
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
 *
 * ── Discrete vs massing ─────────────────────────────────────────────────
 * Only a discrete object (furniture, fixtures, terminals, equipment) belongs
 * to a room; walls, slabs, coverings, openings and anything else that bounds
 * or spans rooms does not. Decided by geometry, no IFC class list. An element
 * is discrete in space S when all of:
 *   1. its mesh-box centre is inside S's mesh (smallest space wins);
 *   2. at least DISCRETE_MIN_INSIDE of a GRID^3 lattice of cell centres over
 *      its mesh box lies inside S's mesh;
 *   3. no lattice point lies inside ANOTHER space (it does not span rooms);
 *   4. its box height is at most DISCRETE_MAX_HEIGHT of S's box height (it
 *      does not run floor to ceiling like a wall or a lining).
 * Thresholds measured on HI90 ARK+RIE (140 spaces, 2026-09-21), elements whose
 * centre is in a space: height/space-height is <= 0.77 for every terminal,
 * appliance, alarm and furnishing and >= 1.10 for every wall, lining and
 * opening, so 0.9 sits in the gap. Inside-fraction (after 3 and 4) is >= 0.60
 * for every terminal (0.60 = a wall-mounted box half in the wall) and <= 0.40
 * for openings, so 0.5 sits in the gap. Known residue: thin slabs and
 * building-element parts lying wholly in a room pass as discrete.
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

export const DISCRETE_GRID = 5;
export const DISCRETE_MIN_INSIDE = 0.5;
export const DISCRETE_MAX_HEIGHT = 0.9;

export interface Box3 {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface SpaceLocator {
  spaces: number;
  locate(point: readonly [number, number, number]): BcfSpace | null;
  /** The space `box` is a discrete object of, or null when it is massing or
   *  in no space. See the rule above. */
  discreteSpace(box: Box3): BcfSpace | null;
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

  // A fixed sub-millimetre nudge keeps the upward ray off shared edges and
  // vertices, where a crossing would be counted twice or not at all.
  const inside = (mesh: SpaceMesh, x: number, y: number, z: number) => {
    const px = x + 1.37e-7;
    const py = y + 2.91e-7;
    if (px < mesh.min[0] || px > mesh.max[0]) return false;
    if (py < mesh.min[1] || py > mesh.max[1]) return false;
    if (z < mesh.min[2] || z > mesh.max[2]) return false;
    return insideMesh(mesh.triangles, px, py, z);
  };
  const locateMesh = (x: number, y: number, z: number): SpaceMesh | null => {
    let best: SpaceMesh | null = null;
    for (const mesh of meshes) {
      if (best && mesh.volume >= best.volume) continue;
      if (inside(mesh, x, y, z)) best = mesh;
    }
    return best;
  };

  return {
    spaces: meshes.length,
    locate(point) {
      return locateMesh(point[0], point[1], point[2])?.space ?? null;
    },
    discreteSpace(box) {
      const size = [0, 1, 2].map((a) => box.max[a] - box.min[a]);
      const own = locateMesh(box.min[0] + size[0] / 2, box.min[1] + size[1] / 2, box.min[2] + size[2] / 2);
      if (!own) return null;
      if (size[2] > DISCRETE_MAX_HEIGHT * (own.max[2] - own.min[2])) return null;
      const n = DISCRETE_GRID;
      let hits = 0;
      for (let i = 0; i < n; i += 1) {
        const x = box.min[0] + ((i + 0.5) / n) * size[0];
        for (let j = 0; j < n; j += 1) {
          const y = box.min[1] + ((j + 0.5) / n) * size[1];
          for (let k = 0; k < n; k += 1) {
            const z = box.min[2] + ((k + 0.5) / n) * size[2];
            if (inside(own, x, y, z)) {
              hits += 1;
              continue;
            }
            for (const mesh of meshes) if (mesh !== own && inside(mesh, x, y, z)) return null;
          }
        }
      }
      return hits >= DISCRETE_MIN_INSIDE * n ** 3 ? own.space : null;
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
