/** A LIVE force simulation for the Graf tab — the thing the settled embedder
 *  was not.
 *
 * What was here before ran 360 iterations inside a `useMemo` and handed the
 * drawing a finished set of coordinates. Correct, reproducible, and dead: the
 * picture appeared already arranged, nothing could be pushed, and a new
 * selection cut to a different arrangement with no relation to the last one.
 * edkjo: *"the graph for instance needs to be cool and smooth."*
 *
 * So the same physics, integrated over real frames instead of over a loop:
 *
 *   · velocity Verlet with a per-tick decay, so a node carries momentum and
 *     eases into place rather than snapping to it
 *   · `alpha` from 1 to 0 over the settle, and a REHEAT on every gesture that
 *     changes the field — a drag, a new node set, a resize
 *   · a collision radius, so labels have room by construction instead of by
 *     a repulsion constant that happened to be large enough
 *   · a node can be PINNED (`fx`/`fy`), which is both how the selected element
 *     holds the origin and how a drag works
 *
 * ── Why no d3-force ──────────────────────────────────────────────────────
 * d3-force is the obvious import and it was considered. It is ~26 kB min
 * (d3-force + d3-quadtree + d3-timer + d3-dispatch) and its value is
 * Barnes-Hut approximation, which pays at thousands of nodes. This graph is
 * capped at `MAX_NODES` = 180 by the build, deliberately, because a node-link
 * drawing of 851 products is a picture of nothing. 180 nodes is 16 110 pairs
 * per tick — about 0.15 ms measured, a tenth of a frame — so the exact O(n²)
 * sum is both cheaper than the import and more accurate than the
 * approximation. The reason to reach for d3-force would be scale this graph
 * does not have.
 *
 * ── Determinism survives ─────────────────────────────────────────────────
 * The old header's rule stands: *"a graph that reshuffles on each visit cannot
 * be read twice."* There is no randomness here either. Start positions come
 * from the same FNV hash of the node id, the tick order is the node order, and
 * the integration is fixed-step — so the same element settles into the same
 * arrangement every time it is opened. What is new is that you watch it get
 * there.
 */

/** Fixed integration step. The loop ticks once per animation frame, and a
 *  frame that arrives late must not take a bigger step — a variable step with
 *  this much repulsion in it goes unstable on the first dropped frame. A slow
 *  machine settles in more wall-clock time, which is the honest outcome. */
const VELOCITY_DECAY = 0.62;
const ALPHA_DECAY = 0.0175;
const ALPHA_MIN = 0.0015;
/** What a gesture reheats to. Not 1: a drag should disturb the neighbourhood,
 *  not re-throw the whole graph. */
export const REHEAT_ALPHA = 0.42;

const REPULSION = 7800;
const SPRING = 0.055;
const REST_LENGTH = 104;
const CENTRE_PULL = 0.021;
/** Below this the pair is treated as touching and pushed apart on the short
 *  axis, which is what keeps two labels off each other. */
const COLLIDE = 30;

export interface SimNode {
  id: string;
  /** Pinned position, or null when the node is free. The centre of an element
   *  graph is pinned at the origin; a dragged node is pinned under the
   *  pointer. */
  fx: number | null;
  fy: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimLink {
  a: number;
  b: number;
}

/** FNV-1a over the node id: the seed for its start position, so the same
 *  element lays out identically every time. Unchanged from the embedder this
 *  replaces. */
export function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class GraphSim {
  readonly nodes: SimNode[];
  private readonly links: SimLink[];
  private readonly at: Map<string, number>;
  /** The centre pull, split per axis. A relationship graph is a FAN, and a fan
   *  settles round — which leaves most of a 4:1 tile empty, the exact
   *  complaint this rewrite answers ("under-filling its tile"). So the pull is
   *  weakened along the box's long axis and strengthened across it, and the
   *  cloud grows into the shape of its own tile. Nothing is distorted: the
   *  drawing is still the physics, and distance between two nodes carries no
   *  metric meaning in a node-link diagram anyway. */
  private pullX = 1;
  private pullY = 1;
  alpha = 1;

  constructor(ids: string[], edges: [string, string][], centre: string | null) {
    this.at = new Map(ids.map((id, i) => [id, i]));
    this.nodes = ids.map((id) => {
      const seed = seedOf(id);
      const angle = ((seed % 4096) / 4096) * Math.PI * 2;
      // A tighter start than the settled radius: the graph OPENS by expanding,
      // which reads as the drawing assembling itself. Starting wide and
      // contracting reads as a mistake being corrected.
      const radius = 14 + (((seed >>> 12) % 1024) / 1024) * 62;
      return {
        id,
        fx: null,
        fy: null,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    const pinned = centre === null ? -1 : (this.at.get(centre) ?? -1);
    if (pinned >= 0) {
      this.nodes[pinned].x = 0;
      this.nodes[pinned].y = 0;
      this.nodes[pinned].fx = 0;
      this.nodes[pinned].fy = 0;
    }
    this.links = [];
    for (const [a, b] of edges) {
      const i = this.at.get(a);
      const j = this.at.get(b);
      if (i !== undefined && j !== undefined && i !== j) this.links.push({ a: i, b: j });
    }
  }

  index(id: string): number | undefined {
    return this.at.get(id);
  }

  /** Shape the cloud to the box it will be drawn in. `aspect` is width over
   *  height; the two factors stay at a geometric mean of 1, so the total pull
   *  is unchanged and only its direction is biased. Bounded, because a 6:1
   *  band should not flatten the graph into a line. */
  fitTo(aspect: number): void {
    const bias = Math.sqrt(Math.min(3.2, Math.max(1 / 3.2, aspect)));
    this.pullX = 1 / bias;
    this.pullY = bias;
  }

  /** True while there is still motion worth drawing. */
  get running(): boolean {
    return this.alpha > ALPHA_MIN;
  }

  reheat(to = REHEAT_ALPHA): void {
    if (this.alpha < to) this.alpha = to;
  }

  pin(index: number, x: number, y: number): void {
    const node = this.nodes[index];
    node.fx = x;
    node.fy = y;
    node.x = x;
    node.y = y;
  }

  unpin(index: number): void {
    this.nodes[index].fx = null;
    this.nodes[index].fy = null;
  }

  /** One fixed step. Forces accumulate into velocity, velocity decays, then
   *  position integrates — the order that makes a spring settle instead of
   *  ringing. */
  tick(): void {
    const nodes = this.nodes;
    const n = nodes.length;
    const alpha = this.alpha;

    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j];
        let ux = a.x - b.x;
        let uy = a.y - b.y;
        let d2 = ux * ux + uy * uy;
        if (d2 < 0.01) {
          // Two nodes on the same point have no direction to separate along;
          // take one from the indices rather than from a random number, so the
          // simulation stays reproducible.
          ux = ((i * 7 + 3) % 11) - 5;
          uy = ((j * 5 + 1) % 11) - 5;
          d2 = ux * ux + uy * uy || 1;
        }
        const d = Math.sqrt(d2);
        // Repulsion, plus a hard shove once the two are inside the collision
        // radius. The shove does not scale with alpha: overlap is wrong at rest
        // too, and a cooled graph that still has two glyphs on top of each
        // other is the crowding this replaces.
        const force = (REPULSION / d2) * alpha + (d < COLLIDE ? (COLLIDE - d) * 0.5 : 0);
        const nx = (ux / d) * force;
        const ny = (uy / d) * force;
        a.vx += nx;
        a.vy += ny;
        b.vx -= nx;
        b.vy -= ny;
      }
    }

    for (const link of this.links) {
      const a = nodes[link.a];
      const b = nodes[link.b];
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const d = Math.hypot(ux, uy) || 0.001;
      const force = SPRING * (d - REST_LENGTH) * alpha;
      const nx = (ux / d) * force;
      const ny = (uy / d) * force;
      a.vx += nx;
      a.vy += ny;
      b.vx -= nx;
      b.vy -= ny;
    }

    for (let i = 0; i < n; i += 1) {
      const node = nodes[i];
      if (node.fx !== null && node.fy !== null) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx -= node.x * CENTRE_PULL * alpha * this.pullX;
      node.vy -= node.y * CENTRE_PULL * alpha * this.pullY;
      node.vx *= VELOCITY_DECAY;
      node.vy *= VELOCITY_DECAY;
      node.x += node.vx;
      node.y += node.vy;
    }

    this.alpha += (0 - this.alpha) * ALPHA_DECAY;
  }

  /** Run the settle without drawing it. Used for the FIRST frame only, so the
   *  graph appears as a readable arrangement expanding into place rather than
   *  as a knot untying — and used by the gates, which measure a settled
   *  picture and cannot wait on frames. */
  settle(steps: number): void {
    for (let i = 0; i < steps; i += 1) this.tick();
  }

  /** The bounding box of the current arrangement, in simulation units. */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
    }
    if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return { minX, minY, maxX, maxY };
  }
}

/** The view transform: simulation units to px, and back for a pointer.
 *
 * Kept separate from the simulation because zoom and pan must NOT disturb the
 * physics — a wheel that changed the rest length would rearrange the graph
 * instead of magnifying it. */
export interface GraphView {
  /** px per simulation unit. */
  k: number;
  /** px offset of the simulation origin. */
  tx: number;
  ty: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX
 = 4;

export function toScreen(view: GraphView, x: number, y: number): { x: number; y: number } {
  return { x: x * view.k + view.tx, y: y * view.k + view.ty };
}

export function toSim(view: GraphView, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.tx) / view.k, y: (y - view.ty) / view.k };
}

/** Fit the arrangement into the box. The same job the old `fit` did, expressed
 *  as a view transform so a later wheel can compose with it. `pad` is px of
 *  margin, which is what keeps a label at the edge of the cloud inside the
 *  tile. */
export function fitView(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  pad = 42,
): GraphView {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  // The ceiling is what stops an eight-node graph from becoming five enormous
  // glyphs; 1.4 was low enough that the same eight nodes sat in a fifth of
  // their tile with the rest of it empty.
  const k = Math.min((width - pad * 2) / w, (height - pad * 2) / h, 2.6);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, tx: width / 2 - cx * k, ty: height / 2 - cy * k };
}

/** A wheel at a point: the point under the cursor stays under the cursor. */
export function zoomAt(view: GraphView, px: number, py: number, factor: number): GraphView {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
  if (k === view.k) return view;
  const at = toSim(view, px, py);
  return { k, tx: px - at.x * k, ty: py - at.y * k };
}
