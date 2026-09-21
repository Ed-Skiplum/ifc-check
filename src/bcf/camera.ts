/** The BCF camera for one topic: framed like zoom-to-selection, written in IFC
 *  world coordinates.
 *
 * ── Framing ─────────────────────────────────────────────────────────────
 * The chunk's box is `robustBounds` over the model's `framingBox` element boxes,
 * the same box and the same outlier verdict the viewer's pivot uses, so a chunk
 * holding the RIB beams that mesh to ~19,000 km (ifcfast#190) frames the bulk
 * of the chunk rather than a sub-pixel dot. The radius is `fitRadius` at the
 * entry pose (`ENTRY_PHI`, `ENTRY_THETA`), the solver the viewer's `frameBox`
 * runs, against the snapshot's own viewport and no insets.
 *
 * ── Viewer frame -> IFC frame ───────────────────────────────────────────
 * Measured on the vendored build (ifcfast 45f4562), the only two transforms
 * between a file coordinate and a viewer coordinate are:
 *
 *   1  the stream: positions = world METRES minus `streamShiftJson()` (the
 *      unit scale is already applied, the shift is read after the pass);
 *   2  the scene root's -PI/2 rotation about X: viewer (x, y, z) =
 *      model (x, z, -y) (`toWorld` in `scene.ts`).
 *
 * So IFC (x, y, z) = (vx, -vz, vy) + shift for a point, and without the shift
 * for a direction. There is no other recentring: the viewer frames by moving
 * the camera, never the model. Precision is the stream's f32 (ifcfast#188: the
 * vendored build casts at absolute magnitude BEFORE subtracting the shift), so
 * at NTM magnitudes a vertex sits on an ~8 mm (X) / ~128 mm (Y) lattice. That
 * is irrelevant to a camera framing whole elements.
 */

import { PerspectiveCamera, Vector3 } from "three";
import { ENTRY_PHI, ENTRY_THETA, NO_INSETS, eyeDirection, fitRadius, type Viewport } from "../viewer/camera.ts";
import { robustBounds, type FramingBox } from "../viewer/mesh-stream.ts";

/** Field of view the viewer renders with (`scene.ts`), vertical, degrees.
 *  Inside BCF 2.1's 45..60 restriction. */
export const BCF_FOV = 45;

export type Triple = [number, number, number];

/** The camera in the VIEWER frame, which is what the snapshot renders. */
export interface ViewerPose {
  eye: Triple;
  target: Triple;
  radius: number;
}

/** The camera in IFC world metres, which is what the viewpoint carries. */
export interface IfcCamera {
  viewPoint: Triple;
  direction: Triple;
  up: Triple;
  fov: number;
}

export interface TopicCamera {
  pose: ViewerPose;
  ifc: IfcCamera;
}

export function viewerToIfcPoint(v: Vector3, shift: readonly number[]): Triple {
  return [v.x + shift[0], -v.z + shift[1], v.y + shift[2]];
}

export function viewerToIfcDirection(v: Vector3): Triple {
  return [v.x, -v.z, v.y];
}

/** `null` when none of `guids` has geometry. */
export function topicCamera(
  framing: FramingBox,
  rows: Map<string, number>,
  guids: string[],
  shift: readonly [number, number, number],
  viewport: Viewport,
): TopicCamera | null {
  const box = robustBounds(framing.elements, rows, guids);
  if (!box) return null;
  const min = new Vector3(...box.min);
  const max = new Vector3(...box.max);
  const centre = new Vector3().addVectors(min, max).multiplyScalar(0.5);

  const camera = new PerspectiveCamera(BCF_FOV, viewport.width / viewport.height, 0.1, 1000);
  const radius = fitRadius(camera, min, max, centre, viewport, NO_INSETS);
  const eye = centre.clone().addScaledVector(eyeDirection(ENTRY_PHI, ENTRY_THETA), radius);

  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  // The camera's TRUE up (orthogonal to the view direction), not the world up
  // it was aimed with: some readers take the vector as given.
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const direction = new Vector3().subVectors(centre, eye).normalize();

  return {
    pose: { eye: [eye.x, eye.y, eye.z], target: [centre.x, centre.y, centre.z], radius },
    ifc: {
      viewPoint: viewerToIfcPoint(eye, shift),
      direction: viewerToIfcDirection(direction),
      up: viewerToIfcDirection(up),
      fov: BCF_FOV,
    },
  };
}
