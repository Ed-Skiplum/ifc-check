/** The AEC turntable: target-centred orbit, roll locked, both polar limits set.
 *
 * Five degrees of freedom — azimuth, polar, distance, and the target's two
 * screen-plane axes — and no sixth. Roll is not an axis here, it is a FAILURE
 * MODE: near a pole, turntable yaw degenerates into rotation about the view
 * axis and the picture spins in place. That is why `POLAR_FLOOR` exists and why
 * BOTH limits are set; capping only the maximum and leaving the minimum at its
 * default 0 is the exact bug the canon records (measured on vrimlebim: at polar
 * 0.05 a 69 degree azimuth input spun the view 68.8 degrees while the eye moved
 * 5.7 % of its orbit radius).
 *
 * -- Up vector, and the IFC Z-up question --------------------------------
 * The model root is rotated -PI/2 about X (as the G55 viewer does), which maps
 * the file's +Z onto world +Y. The turntable's azimuth therefore spins about
 * world Y, which IS the model's Z, the up axis a building is drawn against.
 * `camera.up` is pinned to (0, 1, 0) and never touched, so there is no path by
 * which the horizon tilts.
 *
 * -- Wheel ---------------------------------------------------------------
 * Any wheel handler normalises `deltaY` by MAGNITUDE and `deltaMode`, converts
 * to a multiplicative factor exp(px * k) and clamps per event. Using the sign
 * alone gives one fixed step per event, and a trackpad emitting a burst of
 * twenty small events rockets into the stops, which is the "zoom saturation"
 * the owner named.
 *
 * -- Why zoom cannot saturate here ---------------------------------------
 * A percentage dolly against a fixed mid-air target asymptotes to zero while
 * the surface is still far away. So the target ADVANCES: on every wheel the
 * pivot is lerped toward the point under the cursor by the same fraction the
 * radius shrank. Distance-to-surface, not distance-to-an-abstract-point, is
 * what sets the speed, and the approach stays smooth all the way in.
 *
 * -- Re-targeting without a camera move ----------------------------------
 * The pose is (target, phi, theta, radius): `target` is the LOOK-AT point on
 * the view axis. The orbit CENTRE is a separate point, `pivot`. `setPivot`
 * stores it and touches nothing else, so the eye AND the view direction stay
 * exactly where they were: selecting never re-aims the camera. The next orbit
 * then rotates eye and target together about the pivot (world Y for azimuth,
 * the camera's horizontal right axis for polar), which keeps the pivot fixed
 * on screen while the model turns about it. An earlier version re-derived
 * target from the pivot while holding only the eye; `lookAt(target)` then
 * swung the view to centre the selection on every click. Camera moves stay an
 * explicit opt-in: `fit` and `zoomToSelection`.
 */

import type { PerspectiveCamera } from "three";
import { MathUtils, Quaternion, Vector3 } from "three";

/** Radians off vertical the eye may not pass, top or bottom. 0.25 rad is about
 *  14 degrees: still an almost-plan view, never degenerate. */
export const POLAR_FLOOR = 0.25;

/** The fraction of the shorter USABLE axis a fit aims to occupy. The canon
 *  window is 85-92 %; the midpoint leaves margin on all sides at both ends of
 *  the range without the model cowering in the tile. */
export const FIT_FRACTION = 0.88;

/** The entry pose, and the pose every fit is measured against. */
export const ENTRY_PHI = 1.05;
export const ENTRY_THETA = Math.PI * 0.25;

const MIN_RADIUS_FRACTION = 0.002;
const WHEEL_K = 0.0016;
const WHEEL_CLAMP = 180;

/** How far inside and outside a DELIBERATE frame the wheel may still travel.
 *
 * The radius window is scaled to the MODEL (`setExtent`), which is the right
 * scale for a model-wide view and the wrong one the moment the camera is
 * framed on a single element — see `allow`. A frame therefore widens the
 * window to admit its own subject: down to a fiftieth of the framed radius,
 * so a framed object can still be closed on, and out to four times it, so the
 * frame itself is never truncated by the ceiling. */
const FRAMED_MIN_FRACTION = 0.02;
const FRAMED_MAX_FACTOR = 4;

/** Chrome that overlays the canvas, in CSS px. A fit must CONTAIN the model
 *  inside what is left, not inside the raw canvas: "fills 90 % of the canvas"
 *  is the wrong success metric when a HUD sits on top of the first 24 px. */
export interface FitInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: FitInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Viewport {
  width: number;
  height: number;
}

/** Wheel delta in device-independent pixels, sign preserved, clamped.
 *
 * `deltaMode` 1 is lines and 2 is pages; a browser reporting either would
 * otherwise deliver a delta orders of magnitude off the pixel case. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  return MathUtils.clamp(deltaY * scale, -WHEEL_CLAMP, WHEEL_CLAMP);
}

/** The direction from target to eye for a given turntable pose. */
export function eyeDirection(phi: number, theta: number): Vector3 {
  return new Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
}

function boxCorners(min: Vector3, max: Vector3): Vector3[] {
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, max.y, max.z),
  ];
}

/** Pose a probe camera at `radius` along the entry direction, looking at
 *  `centre`. Shared by the fit solver and the fill measurement so the number a
 *  gate reports is produced by the same arithmetic the viewer runs. */
function poseProbe(
  probe: PerspectiveCamera,
  centre: Vector3,
  radius: number,
  viewport: Viewport,
): void {
  probe.aspect = Math.max(1, viewport.width) / Math.max(1, viewport.height);
  probe.position.copy(centre).addScaledVector(eyeDirection(ENTRY_PHI, ENTRY_THETA), radius);
  probe.up.set(0, 1, 0);
  probe.near = Math.max(radius / 2000, 1e-3);
  probe.far = Math.max(radius * 50, 100);
  probe.lookAt(centre);
  probe.updateProjectionMatrix();
  probe.updateMatrixWorld();
}

export class Turntable {
  readonly target = new Vector3();
  /** Distance from target to eye. */
  radius = 10;
  /** Angle from +Y, radians. Clamped to [POLAR_FLOOR, PI - POLAR_FLOOR]. */
  phi = ENTRY_PHI;
  /** Azimuth about +Y, unbounded: eased as a running total rather than
   *  re-derived from the position, so there is no seam at +-180 degrees to
   *  unwind the long way round. */
  theta = ENTRY_THETA;
  /** The orbit centre, when it is not the look-at point. `null` orbits about
   *  `target`. Never moves the camera by itself; see `setPivot`. */
  pivot: Vector3 | null = null;

  private minRadius = 0.01;
  private maxRadius = 1e5;

  /** Write the pose onto the camera. The up vector is asserted every frame:
   *  nothing else in this module may change it, and this is the line that makes
   *  that true rather than merely intended. */
  apply(camera: PerspectiveCamera): void {
    this.phi = MathUtils.clamp(this.phi, POLAR_FLOOR, Math.PI - POLAR_FLOOR);
    this.radius = MathUtils.clamp(this.radius, this.minRadius, this.maxRadius);
    camera.position
      .copy(this.target)
      .addScaledVector(eyeDirection(this.phi, this.theta), this.radius);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    camera.near = Math.max(this.radius / 2000, 1e-3);
    camera.far = Math.max(this.radius * 50, 100);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** Left-drag. `dx`/`dy` are CSS px; a full canvas width is one turn of
   *  azimuth, which is the rate that reads as the model following the hand.
   *
   *  With a `pivot`, eye and target are rotated TOGETHER about it, so the
   *  view direction changes by exactly the same (dPhi, dTheta) as the plain
   *  turntable and the polar limits hold, while the pivot stays put on
   *  screen. */
  orbit(dx: number, dy: number, viewport: Viewport): void {
    const dTheta = -(dx / Math.max(1, viewport.width)) * Math.PI * 2;
    const phi = MathUtils.clamp(
      this.phi - (dy / Math.max(1, viewport.height)) * Math.PI,
      POLAR_FLOOR,
      Math.PI - POLAR_FLOOR,
    );
    const pivot = this.pivot;
    if (pivot) {
      const eye = this.eye();
      const polar = new Quaternion().setFromUnitVectors(
        eyeDirection(this.phi, this.theta),
        eyeDirection(phi, this.theta),
      );
      const rotation = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), dTheta)
        .multiply(polar);
      eye.sub(pivot).applyQuaternion(rotation).add(pivot);
      // Rebuild the target FROM the rotated eye and the new angles, so the
      // pose stays exactly consistent however the float rounding falls.
      this.phi = phi;
      this.theta += dTheta;
      this.target.copy(eye).addScaledVector(eyeDirection(this.phi, this.theta), -this.radius);
      return;
    }
    this.theta += dTheta;
    this.phi = phi;
  }

  /** Right- or middle-drag. Moves the TARGET in the camera's screen plane at
   *  the world scale one pixel covers at the target's depth, so a drag tracks
   *  the cursor whatever the zoom. */
  pan(dx: number, dy: number, camera: PerspectiveCamera, viewport: Viewport): void {
    const perPixel =
      (2 * this.radius * Math.tan(MathUtils.degToRad(camera.fov) / 2)) /
      Math.max(1, viewport.height);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
  }

  /**
   * Wheel zoom, anchored on `focus`: the real surface under the cursor when the
   * raycast hit something, otherwise where the cursor ray crosses the target's
   * depth plane.
   *
   * The target is lerped toward `focus` by exactly the fraction the radius
   * shrank, which is what keeps the anchor under the cursor AND pushes the
   * pivot ahead as the camera closes. Without the second effect the dolly
   * asymptotes and the model never gets closer.
   */
  zoom(pixels: number, focus: Vector3): void {
    const before = this.radius;
    // The stops ABSORB; they never reflect. A camera already outside the
    // window — framed closer than the model's own floor, or out past its
    // ceiling — must still be able to move AWAY from the stop. Clamping to
    // [min, max] alone answered a zoom-IN from inside the floor with a jump
    // OUTWARD, and then refused every tick after it: the wheel went dead with
    // the picture in the wrong place, which is the saturation the owner hit.
    const lo = Math.min(this.minRadius, before);
    const hi = Math.max(this.maxRadius, before);
    const after = MathUtils.clamp(before * Math.exp(pixels * WHEEL_K), lo, hi);
    if (after === before) return;
    const advance = MathUtils.clamp(1 - after / before, -1, 1);
    this.target.lerp(focus, advance);
    this.radius = after;
  }

  /** The world point under a cursor at `ndc`, on the plane through the target
   *  perpendicular to the view direction. The fallback anchor when nothing was
   *  hit: still cursor-anchored, just at the pivot's depth. */
  planePoint(ndc: { x: number; y: number }, camera: PerspectiveCamera): Vector3 {
    const point = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
    const direction = point.sub(camera.position).normalize();
    const view = new Vector3().subVectors(this.target, camera.position);
    const forward = view.clone().normalize();
    const denominator = direction.dot(forward);
    if (Math.abs(denominator) < 1e-6) return this.target.clone();
    return camera.position.clone().addScaledVector(direction, view.length() / denominator);
  }

  /** Where the eye sits for the current pose. Derived from the pose rather than
   *  read off the camera, so it is correct even on a frame where `apply` has
   *  not run yet — the render loop only applies when the scene is dirty. */
  eye(out: Vector3 = new Vector3()): Vector3 {
    return out.copy(this.target).addScaledVector(eyeDirection(this.phi, this.theta), this.radius);
  }

  /**
   * Make `pivot` the centre of the NEXT orbit, without moving the camera.
   *
   * Only the orbit centre is stored; eye, target and view direction are left
   * alone, so `apply` writes back the exact camera it had. Returns false and
   * changes nothing when the request is non-finite: a caller with nothing to
   * point at holds the pivot it had.
   */
  setPivot(pivot: Vector3): boolean {
    if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y) || !Number.isFinite(pivot.z)) {
      return false;
    }
    if (this.pivot) this.pivot.copy(pivot);
    else this.pivot = pivot.clone();
    return true;
  }

  /** Orbit about the look-at point again. */
  clearPivot(): void {
    this.pivot = null;
  }

  /** Scale the radius limits to the model, so a millimetre-unit model and a
   *  kilometre-wide site both behave. */
  setExtent(extent: number): void {
    this.minRadius = Math.max(extent * MIN_RADIUS_FRACTION, 1e-3);
    this.maxRadius = Math.max(extent * 50, 10);
  }

  /**
   * Admit a radius the camera is deliberately being placed at.
   *
   * `setExtent` derives the window from the model, and on a model-wide view
   * that is right. It is wrong the moment a frame lands on ONE element:
   * measured on KNM_ARK the model floor is metres, so framing a small object
   * puts the camera AT the floor and the next wheel tick in is refused —
   * nothing moves, however hard the wheel is turned. The same window from the
   * other end truncated `zoomToSelection` on a stray element: the ceiling is
   * 50x the robust framing box, and the KNM_RIB beams sit thousands of
   * kilometres outside it, so the frame was clamped to a camera that showed
   * nothing and could not zoom out either.
   *
   * So every explicit frame widens the window around what it framed. Limits
   * only ever widen — a frame grants reach, it never takes it away.
   */
  allow(radius: number): void {
    if (!Number.isFinite(radius) || radius <= 0) return;
    this.minRadius = Math.min(this.minRadius, Math.max(radius * FRAMED_MIN_FRACTION, 1e-4));
    this.maxRadius = Math.max(this.maxRadius, radius * FRAMED_MAX_FACTOR);
  }

  /** The window the wheel may travel in, for a gate that has to report what
   *  the stops actually are rather than recompute them. */
  limits(): { min: number; max: number } {
    return { min: this.minRadius, max: this.maxRadius };
  }
}

/**
 * The radius at which the box is CONTAINED inside the usable viewport,
 * occupying `fraction` of the binding usable axis.
 *
 * Solved by measurement rather than by a closed form on the bounding SPHERE: a
 * sphere fit is exact for a ball and loose for everything else, and a flat
 * building fitted through its diagonal lands at about 70 % of the screen while
 * the arithmetic claims 88. So the eight corners are projected at a candidate
 * radius, the worst axis is read off, and the radius is scaled by the error.
 * Projection is very nearly linear in 1/d, so this converges in two or three
 * passes; six are run because they cost nothing.
 *
 * `insets` shrink the usable box. They are folded into the target FRACTION per
 * axis rather than by re-centring the camera, which keeps the model centred in
 * the canvas and makes containment conservative rather than exact.
 */
export function fitRadius(
  camera: PerspectiveCamera,
  min: Vector3,
  max: Vector3,
  centre: Vector3,
  viewport: Viewport,
  insets: FitInsets = NO_INSETS,
  fraction: number = FIT_FRACTION,
): number {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const usableWidth = Math.max(1, width - insets.left - insets.right);
  const usableHeight = Math.max(1, height - insets.top - insets.bottom);
  const targetX = fraction * (usableWidth / width);
  const targetY = fraction * (usableHeight / height);

  const corners = boxCorners(min, max);
  const extent = new Vector3().subVectors(max, min).length();
  const probe = camera.clone();

  let radius = Math.max(extent, 1e-3);
  for (let pass = 0; pass < 6; pass += 1) {
    poseProbe(probe, centre, radius, viewport);
    let worstX = 0;
    let worstY = 0;
    for (const corner of corners) {
      const ndc = corner.clone().project(probe);
      worstX = Math.max(worstX, Math.abs(ndc.x));
      worstY = Math.max(worstY, Math.abs(ndc.y));
    }
    if (worstX < 1e-9 && worstY < 1e-9) break;
    const error = Math.max(worstX / targetX, worstY / targetY);
    if (Math.abs(error - 1) < 1e-4) break;
    radius *= error;
  }

  return radius;
}

/** The measured screen fill at a given radius, per axis, as a fraction of the
 *  half-axis. Used by the headless gate: a fit that only CLAIMS to contain is
 *  not evidence that it does. */
export function measureFill(
  camera: PerspectiveCamera,
  min: Vector3,
  max: Vector3,
  centre: Vector3,
  radius: number,
  viewport: Viewport,
): { x: number; y: number } {
  const probe = camera.clone();
  poseProbe(probe, centre, radius, viewport);
  let worstX = 0;
  let worstY = 0;
  for (const corner of boxCorners(min, max)) {
    const ndc = corner.clone().project(probe);
    worstX = Math.max(worstX, Math.abs(ndc.x));
    worstY = Math.max(worstY, Math.abs(ndc.y));
  }
  return { x: worstX, y: worstY };
}
