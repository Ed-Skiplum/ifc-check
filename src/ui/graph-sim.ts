/** The LIVE force simulation behind the Graf tab.
 *
 * The forces are the ones the ifcfast demo's drill-down graph ran on
 * (`sidehustles/ifc-fast-demo/components/drill-graph.tsx`, d3-force), the
 * graph edkjo called "way better" (2026-09-25): a many-body charge that falls
 * off with distance, springs with a rest length per edge, a collision radius
 * per node, a fast cool-down, and a drag that reheats the neighbourhood. They
 * are written out here rather than imported (d3-force is ~26 kB). The charge
 * has a reach, d3's `distanceMax`, and pairs are found through a uniform grid,
 * so a drill of up to `MAX_NODES` stays inside a frame without Barnes-Hut.
 *
 * Kept from the ifc-check simulation it replaces:
 *
 *   · it runs over real frames and settles in view, and every gesture that
 *     changes the field reheats it
 *   · no randomness: start positions are an FNV-1a hash of the node id, the
 *     tick order is the node order and the step is fixed, so the same drill
 *     settles into the same arrangement every time it is opened
 *   · a weak pull to the origin, split per axis from the tile's aspect, which
 *     also holds together what no edge connects (a site roster, storeys the
 *     file never aggregated into a building)
 *   · pinned nodes (`fx`/`fy`): a node the reader dragged stays put
 */

/** Velocity kept per tick: d3's default `velocityDecay(0.4)`. */
const VELOCITY_KEEP = 0.6;
/** The demo's `alphaDecay(0.045)`. */
const ALPHA_DECAY = 0.045;
const ALPHA_MIN = 0.001;
/** What a gesture reheats to. d3's drag sets `alphaTarget(0.3)`. */
export const REHEAT_ALPHA = 0.3;

/** `forceManyBody().strength(-120)`: magnitude `CHARGE · alpha / d`. */
const CHARGE = 120;
/** `forceLink().strength(0.5)`. */
const LINK_STRENGTH = 0.5;
/** Pull towards the origin. Not in the demo, which had every node tied to the
 *  project; here a site roster has no edge, and without a pull it drifts off
 *  the tile. */
const CENTRE_PULL = 0.03;
/** Pairs further apart than this do not repel (d3's `distanceMax`). */
const CHARGE_REACH = 240;

export interface SimNode {
  id: string;
  fx: number | null;
  fy: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Collision radius. */
  r: number;
}

interface SimLink {
  a: number;
  b: number;
  rest: number;
  /** d3's link bias: the lighter end moves more. */
  bias: number;
}

/** FNV-1a over the node id: the seed for its start position. */
export function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A deterministic offset for a node that is born next to another one. */
export function seededOffset(id: string, spread: number): { x: number; y: number } {
  const seed = seedOf(id);
  const angle = ((seed % 4096) / 4096) * Math.PI * 2;
  const radius = spread * (0.35 + (((seed >>> 12) % 1024) / 1024) * 0.65);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export interface SimSpec {
  id: string;
  /** Collision radius: the glyph's radius plus the demo's 4 px of air. */
  r: number;
}

export class GraphSim {
  readonly nodes: SimNode[];
  private readonly links: SimLink[];
  private readonly at: Map<string, number>;
  private pullX = 1;
  private pullY = 1;
  alpha = 1;

  constructor(specs: SimSpec[], edges: { a: string; b: string; rest: number }[]) {
    this.at = new Map(specs.map((spec, i) => [spec.id, i]));
    this.nodes = specs.map((spec) => {
      const start = seededOffset(spec.id, 90);
      return { id: spec.id, fx: null, fy: null, x: start.x, y: start.y, vx: 0, vy: 0, r: spec.r };
    });
    const degree = new Array<number>(specs.length).fill(0);
    const pairs: { a: number; b: number; rest: number }[] = [];
    for (const edge of edges) {
      const a = this.at.get(edge.a);
      const b = this.at.get(edge.b);
      if (a === undefined || b === undefined || a === b) continue;
      pairs.push({ a, b, rest: edge.rest });
      degree[a] += 1;
      degree[b] += 1;
    }
    this.links = pairs.map((p) => ({ ...p, bias: degree[p.a] / (degree[p.a] + degree[p.b]) }));
  }

  index(id: string): number | undefined {
    return this.at.get(id);
  }

  /** Shape the cloud to the box it is drawn in; `aspect` is width over
   *  height. The two factors keep a geometric mean of 1. */
  fitTo(aspect: number): void {
    const bias = Math.sqrt(Math.min(3.2, Math.max(1 / 3.2, aspect)));
    this.pullX = 1 / bias;
    this.pullY = bias;
  }

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

  /** One fixed step, in d3's order: forces into velocity, then decay and
   *  integrate. */
  tick(): void {
    const nodes = this.nodes;
    const n = nodes.length;
    const alpha = this.alpha;

    for (const link of this.links) {
      const a = nodes[link.a];
      const b = nodes[link.b];
      let x = b.x + b.vx - a.x - a.vx;
      let y = b.y + b.vy - a.y - a.vy;
      if (x === 0 && y === 0) {
        x = 1e-6;
        y = 1e-6;
      }
      const l = Math.sqrt(x * x + y * y);
      const k = ((l - link.rest) / l) * alpha * LINK_STRENGTH;
      x *= k;
      y *= k;
      b.vx -= x * link.bias;
      b.vy -= y * link.bias;
      a.vx += x * (1 - link.bias);
      a.vy += y * (1 - link.bias);
    }

    // Pairs, through a uniform grid: only pairs closer than `CHARGE_REACH`
    // interact (d3's `distanceMax`), which keeps a 2000-node drill inside a
    // frame. Cells are visited in a fixed order, so it stays deterministic.
    const cell = CHARGE_REACH;
    const grid = new Map<number, number[]>();
    const keyOf = (cx: number, cy: number) => cx * 73856093 + cy * 19349663;
    for (let i = 0; i < n; i += 1) {
      const key = keyOf(Math.floor(nodes[i].x / cell), Math.floor(nodes[i].y / cell));
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    const reach2 = CHARGE_REACH * CHARGE_REACH;
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = grid.get(keyOf(cx + ox, cy + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = nodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            if (d2 < 1e-6) {
              dx = ((i * 7 + 3) % 11) - 5 || 1;
              dy = ((j * 5 + 1) % 11) - 5 || 1;
              d2 = dx * dx + dy * dy;
            }
            // Charge: CHARGE · alpha / d along the unit vector.
            const w = (CHARGE * alpha) / Math.max(d2, 1);
            a.vx += dx * w;
            a.vy += dy * w;
            b.vx -= dx * w;
            b.vy -= dy * w;
            // Collision: overlapping discs are pushed apart, the smaller one
            // moving more, as d3's forceCollide does.
            const rr = a.r + b.r;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2);
              const push = ((rr - d) / d) * 0.5;
              const share = (b.r * b.r) / (a.r * a.r + b.r * b.r);
              a.vx += dx * push * share;
              a.vy += dy * push * share;
              b.vx -= dx * push * (1 - share);
              b.vy -= dy * push * (1 - share);
            }
          }
        }
      }
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
      node.vx *= VELOCITY_KEEP;
      node.vy *= VELOCITY_KEEP;
      node.x += node.vx;
      node.y += node.vy;
    }

    this.alpha += (0 - this.alpha) * ALPHA_DECAY;
  }

  settle(steps: number): void {
    for (let i = 0; i < steps; i += 1) this.tick();
  }

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

/** The view transform: simulation units to px. Zoom and pan never touch the
 *  physics. Glyphs keep their pixel size; the wheel spreads the arrangement. */
export interface GraphView {
  k: number;
  tx: number;
  ty: number;
}

/** The demo's `scaleExtent([0.2, 6])`. */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 6;

export function toSim(view: GraphView, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.tx) / view.k, y: (y - view.ty) / view.k };
}

export function fitView(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  pad = 36,
): GraphView {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min((width - pad * 2) / w, (height - pad * 2) / h, 2.4);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, tx: width / 2 - cx * k, ty: height / 2 - cy * k };
}

export function zoomAt(view: GraphView, px: number, py: number, factor: number): GraphView {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
  if (k === view.k) return view;
  const at = toSim(view, px, py);
  return { k, tx: px - at.x * k, ty: py - at.y * k };
}
