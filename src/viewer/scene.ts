/** The three.js side of the viewer tile: one merged geometry per streamed
 *  batch, one element id per FACE, and a raycast that resolves straight to a
 *  GUID.
 *
 * ── What this is a port of ───────────────────────────────────────────────
 * The cross-filter mechanism is the G55 de-dup viewer's, at
 * `10027-grønland-55/underprosjekter/G55_QTO-LCA/02_arbeid/src/build_dedup_viewer.py`
 * lines 260-400: merge the meshes, carry an `Int32Array` of one element id per
 * triangle in `userData`, raycast the merged mesh, read `faceIndex` into that
 * array, and add the selection as an OVERLAY mesh rather than swapping the
 * merged material. Everything below is that, with two differences that come
 * from the data source rather than from taste:
 *
 *   * ifcfast streams geometry ALREADY merged per batch, so there is no merge
 *     step and no per-element `BufferGeometry` — an element is a RANGE.
 *   * G55 toggled whole CATEGORY meshes for visibility. Here the filter is
 *     per-element, so the index buffer is re-ordered into
 *     [matched faces | unmatched faces] and the two halves become two geometry
 *     GROUPS with two materials. One mesh, one upload, two draw calls, and
 *     `faceIndex` still resolves because the per-face id array is re-ordered in
 *     lockstep.
 *
 * ── Field colour: a deliberate resolution of a canon conflict ────────────
 * The design canon holds THREE incompatible entries for the 3D field: dark
 * `#1F271C` (2026-06-16, the G55 cream-dashboard token set), a neutral
 * low-chroma gray from the colour-science ruling (2026-06-17, `#b8b3a8` light),
 * and a bright warm ink-on-paper base (2026-08-07). This module takes the
 * SCIENCE ruling: a coloured or bright field distorts the model's own colours
 * and adds glare, and the model's colours are the payload here. `#b8b3a8` is
 * also warm and well short of `#fff`, so it does not contradict the later
 * ink-on-paper entry — only the cream-everywhere reading of it. Easy to revisit:
 * change `FIELD` and nothing else moves.
 *
 * ── The orbit pivot follows the eye, not the file ────────────────────────
 * The centre the camera turns about is NOT a property of the model, it is a
 * property of what is on screen: the selection if there is one, otherwise the
 * matched set, otherwise the model's robust framing box. A pivot fixed at fit
 * time is what makes an orbit feel broken — you filter to six columns, drag,
 * and the whole building swings about a centre two hundred metres behind them.
 *
 * Re-targeting is NOT a camera flight. `Turntable.setPivot` only stores the
 * orbit centre; eye and view direction are untouched, so the picture is
 * identical the frame before and after a click. Only the point the next drag
 * turns about has moved.
 * `Tilpass` and `Zoom til valg` stay the only two things that move the eye.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { NO_INSETS, Turntable, fitRadius, wheelPixels, type FitInsets } from "./camera";
import {
  HOVER_FACE_BUDGET,
  elementRows,
  partitionFaces,
  pivotBounds,
  type FramingBox,
  type MeshSet,
} from "./mesh-stream";

/** Non-matching elements are REMOVED from view (`filter`) or dimmed but never
 *  removed (`highlight`). The two names and their meanings are the sprucelab
 *  embed contract's — `sidehustles/sprucelab/frontend/src/lib/embed/types.ts`
 *  — copied rather than imported because the projects share no package
 *  boundary. There is deliberately no third, blended behaviour. */
export type Mode = "filter" | "highlight";

/** The scene field. See the module header: chosen resolution of a three-way
 *  canon conflict, taking the colour-science ruling. */
const FIELD = "#b8b3a8";
/** ATELIER ink. Selection is a crisp dark-ink edge on a light field — additive
 *  glow of a dark colour is invisible here, which is a burned lesson, not a
 *  preference. */
const INK = "#23291e";
/** ATELIER gold, the deep value that survives on a light field. Hover only. */
const GOLD = "#a8821e";

const SELECT_EDGE_WIDTH = 2.0;
const HOVER_EDGE_WIDTH = 1.4;
/** Degrees below which an edge is not a silhouette. Low enough to keep the
 *  chamfers on a steel section, high enough not to draw every tessellation
 *  seam on a curved surface. */
const EDGE_THRESHOLD = 24;

const DRAG_SLOP = 3;

/** Entities a click or hover never lands on. */
const UNPICKABLE = new Set(["IfcSpace", "IfcOpeningElement"]);

interface BatchView {
  mesh: Mesh;
  /** The full index buffer, in stream order. Never mutated. */
  source: Uint32Array;
  /** Element slot per face, in stream order. Never mutated. */
  sourceSlots: Int32Array;
  /** The live index buffer, re-ordered per filter. */
  working: Uint32Array;
  /** Element slot per face of `working`. What `faceIndex` reads. */
  workingSlots: Int32Array;
  /** Faces currently in the matched group. */
  matchedFaces: number;
}

export interface PickEvent {
  guid: string | null;
  /** Shift or Ctrl was held: add/toggle rather than replace. */
  additive: boolean;
}

export interface SceneCallbacks {
  onPick: (event: PickEvent) => void;
  onHover: (guid: string | null) => void;
}

/** Model space is IFC's Z-up; the root carries the -PI/2 rotation about X that
 *  maps it to the renderer's Y-up. Anything that needs a world-space number
 *  goes through this, rather than a second copy of the convention. */
function toWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, z, -y);
}

export class ModelScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  private readonly root = new Group();
  private readonly overlays = new Group();
  private readonly turntable = new Turntable();
  private readonly raycaster = new Raycaster();

  private readonly solid = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.02,
    flatShading: true,
    side: DoubleSide,
  });

  /** `highlight` mode: nothing is removed, the rest is ghosted. Depth-TESTED
   *  and depth-write off — an overlay that shows through walls is explicitly
   *  rejected, and a transparent surface that writes depth sorts wrong. */
  private readonly ghost = new MeshBasicMaterial({
    color: new Color("#6f6a60"),
    transparent: true,
    opacity: 0.16,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
  });

  private readonly selectEdge: LineMaterial;
  private readonly hoverEdge: LineMaterial;
  private readonly selectFill: MeshBasicMaterial;

  private readonly batches: BatchView[] = [];
  private set: MeshSet | null = null;
  private framing: FramingBox | null = null;
  /** guid -> row in `framing.elements`. The pivot is re-derived on every filter
   *  and selection change, so it reads cached per-element boxes rather than
   *  walking vertices on each one. */
  private boxRow = new Map<string, number>();
  /** Whether the camera has ever been framed at a real viewport. A tile that
   *  mounts before its container has a size fits against 1x1 and lands nowhere;
   *  the first resize that brings a real size re-runs it. */
  private framed = false;

  private readonly viewport = { width: 1, height: 1 };
  private insets: FitInsets = NO_INSETS;
  private dirty = true;
  private frame = 0;
  private disposed = false;

  private drag: { pointerId: number; mode: "orbit" | "pan"; x: number; y: number; moved: number } | null =
    null;
  private pendingHover: { x: number; y: number } | null = null;
  private lastHover: string | null = null;
  private hoverPickable = true;
  /** The zoom anchor is resolved by raycast on the FIRST wheel of a burst and
   *  then reused, which is the canon rule and also what keeps an 80 ms cast off
   *  every event of a trackpad flick. */
  private lastWheelAt = 0;
  private wheelFocus: Vector3 | null = null;

  private selection: string[] = [];
  private hover: string | null = null;
  private mode: Mode = "filter";
  private matched: Set<string> | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: SceneCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(new Color(FIELD), 1);
    // three owns the 3D field, not CSS: a `background-color` on the canvas
    // element is painted under a cleared framebuffer and never seen.
    this.scene.background = new Color(FIELD);

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.scene.add(this.overlays);

    this.scene.add(new HemisphereLight(0xffffff, 0x9a958b, 2.1));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.4, 0.9);
    this.scene.add(key);

    // Depth-tested, with a small negative polygon offset so the edge wins
    // against its OWN surface and still loses to nearer geometry. An
    // always-on-top selection that shows through walls is explicitly rejected.
    this.selectEdge = new LineMaterial({
      color: INK,
      linewidth: SELECT_EDGE_WIDTH,
      worldUnits: false,
      resolution: new Vector2(1, 1),
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.hoverEdge = new LineMaterial({
      color: GOLD,
      linewidth: HOVER_EDGE_WIDTH,
      worldUnits: false,
      resolution: new Vector2(1, 1),
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.selectFill = new MeshBasicMaterial({
      color: new Color(INK),
      transparent: true,
      opacity: 0.14,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: DoubleSide,
    });

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerup", this.onPointerUp);

    this.loop();
  }

  /* ------------------------------------------------------------- lifecycle */

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.clearOverlays();
    for (const view of this.batches) view.mesh.geometry.dispose();
    this.batches.length = 0;
    this.solid.dispose();
    this.ghost.dispose();
    this.selectEdge.dispose();
    this.hoverEdge.dispose();
    this.selectFill.dispose();
    this.renderer.dispose();
  }

  /** Upload the streamed batches. Called once per model. `framing` is computed
   *  by the caller so the tile can print its outlier count without a second
   *  pass over every vertex. */
  load(set: MeshSet, framing: FramingBox | null): void {
    this.set = set;
    this.framing = framing;
    this.framed = false;
    this.boxRow = framing ? elementRows(framing.elements) : new Map();
    for (const view of this.batches) {
      this.root.remove(view.mesh);
      view.mesh.geometry.dispose();
    }
    this.batches.length = 0;

    const colour = new Color();
    for (const batch of set.batches) {
      const vertices = batch.positions.length / 3;
      const colours = new Float32Array(vertices * 3);
      for (const row of batch.meta) {
        // `rgba` is sRGB 0..1 as the glTF writer resolves it. Converting on
        // the way in keeps the material in the renderer's working space, so
        // the model's own colours land where the file says they should.
        colour.setRGB(row.rgba[0], row.rgba[1], row.rgba[2], SRGBColorSpace);
        for (let v = row.v0; v < row.v0 + row.vn; v += 1) {
          colours[v * 3] = colour.r;
          colours[v * 3 + 1] = colour.g;
          colours[v * 3 + 2] = colour.b;
        }
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(batch.positions, 3));
      geometry.setAttribute("color", new BufferAttribute(colours, 3));
      const working = Uint32Array.from(batch.indices);
      geometry.setIndex(new BufferAttribute(working, 1));
      geometry.computeBoundingSphere();

      const mesh = new Mesh(geometry, [this.solid, this.ghost]);
      mesh.frustumCulled = false;
      mesh.userData = { batch: batch.batch };
      this.root.add(mesh);

      const slots = set.faceSlots[batch.batch];
      this.batches.push({
        mesh,
        source: batch.indices,
        sourceSlots: slots,
        working,
        workingSlots: Int32Array.from(slots),
        matchedFaces: working.length / 3,
      });
    }

    const faces = set.batches.reduce((sum, batch) => sum + batch.indices.length / 3, 0);
    this.hoverPickable = faces <= HOVER_FACE_BUDGET;

    if (this.framing) {
      // The radius limits ride the FRAMING extent, not the true one: on a
      // model with a broken element the true extent is thousands of kilometres
      // and every zoom step would be a kilometre.
      const extent = new Vector3()
        .subVectors(new Vector3(...this.framing.max), new Vector3(...this.framing.min))
        .length();
      this.turntable.setExtent(extent);
    }
    this.applyFilter();
    this.fit();
    // The entry FRAME is the model; the entry PIVOT is whatever is already
    // filtered or selected, because a model can be dropped onto a board that
    // carries a live cross-filter. The eye does not move either way.
    this.updatePivot();
  }

  /* ---------------------------------------------------------------- state */

  setFilter(matched: Set<string> | null, mode: Mode): void {
    this.matched = matched;
    this.mode = mode;
    this.applyFilter();
    this.updatePivot();
    this.invalidate();
  }

  setSelection(guids: string[]): void {
    this.selection = guids;
    this.rebuildOverlays();
    this.updatePivot();
    this.invalidate();
  }

  /** Hover is deliberately NOT a pivot source. It changes on every pointer
   *  move and on every row the cursor crosses in the table; a pivot that
   *  followed it would be a different orbit axis every few frames. */
  setHover(guid: string | null): void {
    if (this.hover === guid) return;
    this.hover = guid;
    this.rebuildOverlays();
    this.invalidate();
  }

  /** Explicit control, never a side effect of selecting a row. Frames the
   *  robust box; the outliers are still drawn, and zoom-to-selection reaches
   *  them exactly. */
  fit(insets: FitInsets = this.insets): void {
    this.insets = insets;
    const framing = this.framing;
    const bounds = framing
      ? { min: new Vector3(...framing.min), max: new Vector3(...framing.max) }
      : this.bounds(null);
    if (!bounds) return;
    this.frameBox(bounds);
  }

  /** Also explicit, and the only thing that moves the camera on a selection. */
  zoomToSelection(): void {
    const bounds = this.bounds(this.selection.length > 0 ? this.selection : null);
    if (!bounds) return;
    this.frameBox(bounds);
  }

  /**
   * One frame from an explicit camera, with `guids` shown the way the board
   * shows a selection under a highlight filter: the rest ghosted, the chunk
   * drawn with the selection wash and ink edges. Returned as a PNG data URL.
   *
   * For the BCF export, on a HIDDEN scene of its own: it resizes the drawing
   * buffer at pixel ratio 1 and replaces filter and selection, which a visible
   * tile must never have done to it. The camera is set directly rather than
   * through the turntable, whose radius clamp would otherwise move a camera
   * framed on far outliers away from the one written to the viewpoint.
   */
  snapshot(
    guids: string[],
    pose: { eye: [number, number, number]; target: [number, number, number] },
    width: number,
    height: number,
  ): string {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.selectEdge.resolution.set(width, height);
    this.hoverEdge.resolution.set(width, height);
    this.matched = new Set(guids);
    this.mode = "highlight";
    this.applyFilter();
    this.selection = guids;
    this.hover = null;
    this.rebuildOverlays();

    const eye = new Vector3(...pose.eye);
    const target = new Vector3(...pose.target);
    const radius = eye.distanceTo(target);
    this.camera.aspect = width / height;
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.near = Math.max(radius / 2000, 1e-3);
    this.camera.far = Math.max(radius * 50, 100);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    // Read back in the same task as the render: the drawing buffer is still
    // intact, so no `preserveDrawingBuffer` is needed.
    const url = this.canvas.toDataURL("image/png");
    this.dirty = false;
    return url;
  }

  /**
   * Read the camera back, and where a set of elements projects under it.
   *
   * The only way a headless gate can assert "the camera MOVED and the object
   * landed inside the viewport" — the two claims framing makes — without a
   * second copy of the projection arithmetic living in the gate. Read-only: it
   * touches no state and renders nothing.
   *
   * `box` is the NDC bounding box of the eight corners of those elements' world
   * box, i.e. the very box `zoomToSelection` framed. Inside the viewport means
   * every component within [-1, 1]. `null` when none of them has geometry in
   * this scene, which is also when framing declines to move.
   */
  probe(guids: string[]): {
    eye: [number, number, number];
    target: [number, number, number];
    radius: number;
    box: { x0: number; y0: number; x1: number; y1: number } | null;
    /** The wheel's own stops, so a gate reports the limits the viewer HAS
     *  rather than a second copy of the arithmetic that derives them. */
    limits: { min: number; max: number };
    near: number;
    far: number;
    /** The same elements' WORLD box. A gate that wants to follow one fixed
     *  point through a zoom needs a world coordinate; the NDC box's centre is
     *  not one — which corner is extreme changes as the camera moves. */
    world: { min: [number, number, number]; max: [number, number, number] } | null;
  } {
    const eye = this.turntable.eye();
    const target = this.turntable.target;
    const bounds = guids.length > 0 ? this.bounds(guids) : null;
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    if (bounds) {
      const { min, max } = bounds;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            const ndc = new Vector3(x, y, z).project(this.camera);
            x0 = Math.min(x0, ndc.x);
            y0 = Math.min(y0, ndc.y);
            x1 = Math.max(x1, ndc.x);
            y1 = Math.max(y1, ndc.y);
          }
        }
      }
      box = { x0, y0, x1, y1 };
    }
    return {
      eye: [eye.x, eye.y, eye.z],
      target: [target.x, target.y, target.z],
      radius: this.turntable.radius,
      box,
      limits: this.turntable.limits(),
      near: this.camera.near,
      far: this.camera.far,
      world: bounds
        ? {
            min: [bounds.min.x, bounds.min.y, bounds.min.z],
            max: [bounds.max.x, bounds.max.y, bounds.max.z],
          }
        : null,
    };
  }

  /**
   * Where world points land in NDC under the CURRENT camera. Read-only.
   *
   * The only honest way to assert "the point under the cursor stayed under the
   * cursor": zoom-to-cursor is a claim about ONE world point, and the NDC
   * bounding box of an element is not that point. The projection is the
   * shipped camera, never a copy living in a gate.
   */
  project(points: [number, number, number][]): { x: number; y: number }[] {
    return points.map((p) => {
      const ndc = new Vector3(p[0], p[1], p[2]).project(this.camera);
      return { x: ndc.x, y: ndc.y };
    });
  }

  /** Dispose and give the WebGL context back at once, for a hidden scene. */
  disposeContext(): void {
    this.dispose();
    this.renderer.forceContextLoss();
  }

  resize(width: number, height: number, insets: FitInsets = this.insets): void {
    // A canvas is a REPLACED element: CSS cannot stretch it, the drawing buffer
    // has to be told its size. `setSize(w, h, false)` writes width/height and
    // leaves the CSS box to the layout, which is what the tile controls.
    this.viewport.width = Math.max(1, Math.round(width));
    this.viewport.height = Math.max(1, Math.round(height));
    this.insets = insets;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(this.viewport.width, this.viewport.height, false);
    this.camera.aspect = this.viewport.width / this.viewport.height;
    this.selectEdge.resolution.set(this.viewport.width, this.viewport.height);
    this.hoverEdge.resolution.set(this.viewport.width, this.viewport.height);
    // A tile whose container has no size yet at mount fits against a 1x1
    // viewport, and the solved radius is meaningless — the model lands jammed
    // against an edge and nothing ever re-runs the fit, because a resize does
    // not re-frame (that would throw away the camera the user just set). So the
    // re-frame is conditional on never having framed at a real size. A resize
    // after a real fit still leaves the camera exactly alone.
    if (!this.framed && this.set && this.viewport.width > 1 && this.viewport.height > 1) {
      this.fit();
      this.updatePivot();
    }
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  /* --------------------------------------------------------------- filter */

  /**
   * Re-order every batch's index buffer into [matched | unmatched] and hand the
   * two halves to two groups. In `filter` mode the unmatched group is simply
   * not declared, so those faces are neither drawn NOR pickable — removed from
   * view, which is what the mode means.
   */
  private applyFilter(): void {
    const set = this.set;
    if (!set) return;
    const matched = this.matched;

    for (const view of this.batches) {
      const faces = view.source.length / 3;
      const head = partitionFaces(
        view.source,
        view.sourceSlots,
        set.slotGuid,
        matched,
        view.working,
        view.workingSlots,
      );

      view.matchedFaces = head;
      const geometry = view.mesh.geometry;
      geometry.clearGroups();
      if (head > 0) geometry.addGroup(0, head * 3, 0);
      if (this.mode === "highlight" && head < faces) {
        geometry.addGroup(head * 3, (faces - head) * 3, 1);
      }
      const index = geometry.getIndex();
      if (index) index.needsUpdate = true;
    }
  }

  /* ------------------------------------------------------------- overlays */

  private clearOverlays(): void {
    for (const child of [...this.overlays.children]) {
      this.overlays.remove(child);
      const holder = child as Mesh | LineSegments2;
      holder.geometry.dispose();
    }
  }

  private rebuildOverlays(): void {
    this.clearOverlays();
    // Selection is an overlay ADDED on top, never a material swap on the merged
    // geometry: the merged mesh is shared by hundreds of elements and there is
    // no per-element material to swap.
    if (this.selection.length > 0) {
      const geometry = this.geometryOf(this.selection);
      if (geometry) {
        // A faint ink wash under the edge, not a halo: a halo is an OUTWARD
        // additive bloom and is invisible on a light field. The wash stays
        // inside the silhouette and is what makes one column among fifty
        // identical ones read as chosen.
        const fill = new Mesh(geometry, this.selectFill);
        fill.rotation.x = -Math.PI / 2;
        fill.frustumCulled = false;
        this.overlays.add(fill);
        this.overlays.add(this.edgesOf(geometry, this.selectEdge));
      }
    }
    if (this.hover !== null && !this.selection.includes(this.hover)) {
      const geometry = this.geometryOf([this.hover]);
      if (geometry) {
        this.overlays.add(this.edgesOf(geometry, this.hoverEdge));
        geometry.dispose();
      }
    }
  }

  /** Real edges of real geometry, as fat lines. `EdgesGeometry` is an
   *  intermediate and is disposed here; the `LineSegmentsGeometry` it produces
   *  is what the overlay owns. */
  private edgesOf(geometry: BufferGeometry, material: LineMaterial): LineSegments2 {
    const source = new EdgesGeometry(geometry, EDGE_THRESHOLD);
    const lines = new LineSegments2(
      new LineSegmentsGeometry().fromEdgesGeometry(source),
      material,
    );
    source.dispose();
    lines.rotation.x = -Math.PI / 2;
    lines.frustumCulled = false;
    return lines;
  }

  /** A standalone geometry for a set of elements, in MODEL space. Copies the
   *  vertex ranges out of their batches and re-bases the indices. */
  private geometryOf(guids: string[]): BufferGeometry | null {
    const set = this.set;
    if (!set) return null;
    let vertices = 0;
    let indices = 0;
    const ranges = [];
    for (const guid of guids) {
      const range = set.index.get(guid);
      if (!range) continue;
      ranges.push(range);
      vertices += range.vn;
      indices += range.iCount;
    }
    if (ranges.length === 0) return null;

    const positions = new Float32Array(vertices * 3);
    const index = new Uint32Array(indices);
    let vAt = 0;
    let iAt = 0;
    for (const range of ranges) {
      const batch = set.batches[range.batch];
      positions.set(
        batch.positions.subarray(range.v0 * 3, (range.v0 + range.vn) * 3),
        vAt * 3,
      );
      for (let k = 0; k < range.iCount; k += 1) {
        index[iAt + k] = batch.indices[range.i0 + k] - range.v0 + vAt;
      }
      vAt += range.vn;
      iAt += range.iCount;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    return geometry;
  }

  /* --------------------------------------------------------------- bounds */

  /** World-space bounds of the whole model, or of `guids`. `null` when nothing
   *  in the request has geometry — a fit that silently framed the origin would
   *  look like a working viewer showing an empty scene. */
  private bounds(guids: string[] | null): { min: Vector3; max: Vector3 } | null {
    const set = this.set;
    if (!set) return null;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const point = new Vector3();
    let seen = false;

    const consume = (positions: Float32Array, from: number, count: number) => {
      for (let v = from; v < from + count; v += 1) {
        toWorld(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], point);
        min.min(point);
        max.max(point);
        seen = true;
      }
    };

    if (guids === null) {
      for (const batch of set.batches) consume(batch.positions, 0, batch.positions.length / 3);
    } else {
      for (const guid of guids) {
        const range = set.index.get(guid);
        if (!range) continue;
        consume(set.batches[range.batch].positions, range.v0, range.vn);
      }
    }
    return seen ? { min, max } : null;
  }

  private frameBox(bounds: { min: Vector3; max: Vector3 }): void {
    const centre = new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
    this.camera.aspect = this.viewport.width / this.viewport.height;
    const radius = fitRadius(
      this.camera,
      bounds.min,
      bounds.max,
      centre,
      this.viewport,
      this.insets,
    );
    // Widen the wheel's window around what is being framed BEFORE the radius
    // is written, or `apply` clamps the frame back to the model's own limits
    // and the camera lands somewhere the caller never asked for.
    this.turntable.allow(radius);
    this.turntable.target.copy(centre);
    this.turntable.radius = radius;
    this.turntable.clearPivot();
    this.updatePivot();
    this.framed = this.viewport.width > 1 && this.viewport.height > 1;
    this.invalidate();
  }

  /* --------------------------------------------------------------- pivot */

  /**
   * Point the orbit centre at what the user is actually looking at.
   *
   * Precedence: the selection, then the matched set, then the model's robust
   * framing box. `Turntable.setPivot` keeps the eye where it is, so this is
   * invisible until the next drag — which is the point. `false` from it, or no
   * bounds at all, means the previous pivot stands: a filter that matched
   * nothing must not drop the pivot on the origin or on a NaN.
   */
  private updatePivot(): void {
    const bounds = this.pivotBox();
    if (!bounds) return;
    const centre = new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
    if (this.turntable.setPivot(centre)) this.invalidate();
  }

  /**
   * The box the pivot is taken from. The precedence and the outlier rule are
   * `pivotBounds` / `robustBounds` in `mesh-stream` — pure and exported so the
   * headless gate runs the same arithmetic the viewer does.
   */
  private pivotBox(): { min: Vector3; max: Vector3 } | null {
    const framing = this.framing;
    // No framing pass means no outlier verdict to inherit; the honest answer is
    // the true box rather than a guess at which elements are broken.
    if (!framing) {
      if (this.selection.length > 0) {
        const chosen = this.bounds(this.selection);
        if (chosen) return chosen;
      }
      return this.bounds(this.matched === null ? null : [...this.matched]);
    }
    const box = pivotBounds(framing, this.boxRow, this.selection, this.matched);
    return box ? { min: new Vector3(...box.min), max: new Vector3(...box.max) } : null;
  }

  /* -------------------------------------------------------------- picking */

  private ndc(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    };
  }

  /** The element under `ndc`, plus where it was hit. */
  private pick(ndc: { x: number; y: number }): { guid: string; point: Vector3 } | null {
    const set = this.set;
    if (!set) return null;
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera);
    const hits = this.raycaster.intersectObjects(
      this.batches.map((view) => view.mesh),
      false,
    );
    // First in-filter product along the ray; a ghosted one (highlight mode's
    // unmatched faces) only when nothing in-filter lies behind it. Room and
    // opening volumes are never targets: a translucent IfcSpace otherwise wins
    // every click made from inside or through it.
    let ghost: { guid: string; point: Vector3 } | null = null;
    for (const hit of hits) {
      if (hit.faceIndex === undefined || hit.faceIndex === null) continue;
      const view = this.batches[(hit.object.userData as { batch: number }).batch];
      if (!view) continue;
      const slot = view.workingSlots[hit.faceIndex];
      if (slot < 0) continue;
      const guid = set.slotGuid[slot];
      const entity = set.index.get(guid)?.entity;
      if (entity !== undefined && UNPICKABLE.has(entity)) continue;
      if (hit.faceIndex < view.matchedFaces) return { guid, point: hit.point.clone() };
      ghost ??= { guid, point: hit.point.clone() };
    }
    return ghost;
  }

  /* --------------------------------------------------------------- events */

  private onPointerDown = (event: PointerEvent) => {
    this.canvas.focus({ preventScroll: true });
    // Left-drag is ORBIT and stays orbit. Right and middle pan. Nothing here
    // takes left-drag for a box-select; that gesture would have to be opt-in.
    const mode = event.button === 0 ? "orbit" : "pan";
    this.drag = { pointerId: event.pointerId, mode, x: event.clientX, y: event.clientY, moved: 0 };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      this.pendingHover = { x: event.clientX, y: event.clientY };
      this.invalidate();
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // Inside the click slop nothing moves: a click is press+release with hand
    // jitter, and that jitter must not turn the view. `drag.x/y` stay at the
    // press point until the slop is crossed, so the first real step carries
    // the whole distance and the drag does not lag the hand.
    if (drag.moved <= DRAG_SLOP && Math.abs(dx) + Math.abs(dy) <= DRAG_SLOP) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.mode === "orbit") this.turntable.orbit(dx, dy, this.viewport);
    else this.turntable.pan(dx, dy, this.camera, this.viewport);
    this.invalidate();
  };

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (drag.moved > DRAG_SLOP || drag.mode !== "orbit") return;
    const hit = this.pick(this.ndc(event));
    this.callbacks.onPick({
      guid: hit?.guid ?? null,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    });
  };

  private onPointerLeave = () => {
    this.pendingHover = null;
    if (this.lastHover !== null) {
      this.lastHover = null;
      this.callbacks.onHover(null);
    }
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const ndc = this.ndc(event);
    const now = performance.now();
    const newBurst = now - this.lastWheelAt > 300 || this.wheelFocus === null;
    this.lastWheelAt = now;
    if (newBurst) {
      // Anchor on the real surface under the cursor when there is one. Against
      // a mid-air pivot a percentage dolly asymptotes while the model is still
      // far away, which is the saturation the canon names. Resolved once per
      // burst, not once per event.
      const hit = this.pick(ndc);
      this.wheelFocus = hit ? hit.point : this.turntable.planePoint(ndc, this.camera);
    }
    const focus = this.wheelFocus ?? this.turntable.planePoint(ndc, this.camera);
    this.turntable.zoom(wheelPixels(event.deltaY, event.deltaMode), focus);
    this.invalidate();
  };

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    this.callbacks.onPick({ guid: null, additive: false });
  };

  /* ----------------------------------------------------------------- loop */

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);

    if (this.pendingHover && !this.hoverPickable) this.pendingHover = null;
    if (this.pendingHover && !this.drag) {
      const hit = this.pick(this.ndc({ clientX: this.pendingHover.x, clientY: this.pendingHover.y }));
      this.pendingHover = null;
      const guid = hit?.guid ?? null;
      if (guid !== this.lastHover) {
        this.lastHover = guid;
        this.callbacks.onHover(guid);
      }
    }

    if (!this.dirty) return;
    this.dirty = false;
    this.turntable.apply(this.camera);
    this.renderer.render(this.scene, this.camera);
  };
}
