/** The treemaps' volume, area and length, held in the worker that holds the graph
 *  (the parse worker and the restore worker alike).
 *
 * The progressive rule (edkjo 2026-09-28: *"output the dash and then let the
 * geometric analysis happen in the background"*):
 *
 *   1  The board is posted with no geometric work done. Its measures carry the
 *      BaseQuantities at once; every element without one is `pending`.
 *   2  The main thread then hands the mesh batches it already holds for the
 *      viewer back one at a time (`{kind: "measure"}`), the next only when
 *      this worker has answered. Each batch is measured and dropped: only the
 *      per-element numbers stay, so the worker never holds the mesh set.
 *   3  Batches the triangle ceiling withheld from the viewer are measured
 *      inside the stream callback (they are dropped there anyway).
 *   4  A final `{kind: "measure", batch: null}` marks the pass complete: an
 *      element still without a measure has no mesh and is `missing`.
 *
 * Volum / Areal are selectable when their tree has no `pending` element, so a
 * model whose every element carries the BaseQuantity is ready with the board.
 * Lengde is always ready: it is the BaseQuantity `Length` only, never computed.
 */

import type { CodeTree } from "../engine/code-tree.ts";
import {
  elementQuantities,
  measureTree,
  meshMeasure,
  qtoLengths,
  qtoQuantities,
  type Authored,
  type ElementQuantity,
  type Measure,
  type MeshMeasure,
  type Picked,
  type TreeMeasures,
} from "../engine/quantities.ts";
import type { IfcGraph } from "../engine/types.ts";

/** One batch as the measuring needs it: the viewer's batch less the colour,
 *  storey and type. */
export interface MeasureBatch {
  meta: { guid: string; v0: number; vn: number; i0: number; in: number }[];
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BoardMeasures {
  system: TreeMeasures;
  function: TreeMeasures;
  /** Batches measured of the batches handed over; null before any. */
  progress: { done: number; total: number } | null;
}

export class MeasureState {
  private qto: Map<string, Authored>;
  private lengths: Map<string, Picked>;
  private guids: string[];
  private computed = new Map<string, MeshMeasure>();
  private complete = false;
  private done = 0;
  private total = 0;

  /** `prior`: measures taken before the graph existed (the capped batches,
   *  measured in the stream callback). `lengthScale`: metres per file length
   *  unit (`summary.unit_scale` when resolved), for the Length quantities. */
  constructor(graph: IfcGraph, prior?: ReadonlyMap<string, MeshMeasure>, lengthScale?: number | null) {
    const entityOf = new Map(graph.products.map((p) => [p.guid, p.entity]));
    this.guids = graph.products.map((p) => p.guid);
    this.qto = qtoQuantities(graph.quantities ?? [], entityOf, graph.quantity_units);
    this.lengths = qtoLengths(graph.quantities ?? [], graph.quantity_units, lengthScale);
    if (prior) for (const [guid, m] of prior) this.computed.set(guid, m);
  }

  /** Every product's resolved volume, area and length (the type page). */
  elements(): Record<string, ElementQuantity> {
    return elementQuantities(this.guids, this.qto, this.lengths, { byGuid: this.computed, complete: this.complete });
  }

  /** Measure one batch and keep only the numbers. */
  add(batch: MeasureBatch): void {
    for (const m of batch.meta) {
      this.computed.set(m.guid, meshMeasure(batch.positions, batch.indices, m.v0, m.vn, m.i0, m.in));
    }
  }

  /** A batch the main thread handed back, counted toward the progress. */
  fed(batch: MeasureBatch | null, total: number): void {
    this.total = total;
    if (batch) {
      this.add(batch);
      this.done += 1;
    } else this.complete = true;
  }

  get finished(): boolean {
    return this.complete;
  }

  get progress(): { done: number; total: number } | null {
    return this.total > 0 || this.complete ? { done: this.done, total: this.total } : null;
  }

  measures(trees: { system: CodeTree; function: CodeTree }): BoardMeasures {
    const computed = { byGuid: this.computed, complete: this.complete };
    return {
      system: measureTree(trees.system, this.qto, computed, this.lengths),
      function: measureTree(trees.function, this.qto, computed, this.lengths),
      progress: this.progress,
    };
  }
}

/** Whether a measure can be drawn: its tree has no element still waiting on
 *  the geometry pass. Count always can. */
export function measureReady(tree: CodeTree, measures: BoardMeasures | undefined, measure: Measure): boolean {
  if (measure === "count") return true;
  const m = measures?.[tree.axis]?.[measure];
  return !!m && m.pending === 0;
}

/** Measure one batch outside a `MeasureState` (the stream callback, before
 *  the graph exists), into `into`. */
export function measureInto(into: Map<string, MeshMeasure>, batch: MeasureBatch): void {
  for (const m of batch.meta) into.set(m.guid, meshMeasure(batch.positions, batch.indices, m.v0, m.vn, m.i0, m.in));
}

/** What the worker answers each `measure` request with. The measures ride
 *  along at most every `THROTTLE_MS` and always on completion; in between the
 *  answer is only the go-ahead for the next batch. */
export interface MeasuredMessage {
  kind: "measured";
  progress: { done: number; total: number };
  complete: boolean;
  /** Over the board as parsed (no ruleset). */
  base?: BoardMeasures;
  /** Over the last evaluated ruleset's board; null with none. */
  current?: BoardMeasures | null;
  /** Every product's volume, area and length with its source
   *  (`MeasureState.elements`), for the Typer type page. On the first answer
   *  (the BaseQuantities, the rest pending) and on completion only. */
  elements?: Record<string, ElementQuantity>;
}

const THROTTLE_MS = 250;

/** The worker side: the state plus the two boards' trees it measures over. */
export class MeasureChannel {
  private last = 0;
  private sentElements = false;
  private base: { system: CodeTree; function: CodeTree } | null = null;
  private current: { system: CodeTree; function: CodeTree } | null = null;

  readonly state: MeasureState;

  constructor(state: MeasureState) {
    this.state = state;
  }

  /** Attach the measures to a board built with no ruleset. */
  baseBoard<B extends { trees: { system: CodeTree; function: CodeTree }; measures?: BoardMeasures }>(board: B): B {
    this.base = board.trees;
    board.measures = this.state.measures(board.trees);
    return board;
  }

  /** Attach the measures to a board built over a ruleset. */
  currentBoard<B extends { trees: { system: CodeTree; function: CodeTree }; measures?: BoardMeasures }>(board: B): B {
    this.current = board.trees;
    board.measures = this.state.measures(board.trees);
    return board;
  }

  feed(batch: MeasureBatch | null, total: number): MeasuredMessage {
    this.state.fed(batch, total);
    const complete = this.state.finished;
    const now = performance.now();
    const progress = this.state.progress ?? { done: 0, total };
    if (!complete && now - this.last < THROTTLE_MS) return { kind: "measured", progress, complete };
    this.last = now;
    const first = !this.sentElements;
    this.sentElements = true;
    return {
      kind: "measured",
      progress,
      complete,
      base: this.base ? this.state.measures(this.base) : undefined,
      current: this.current ? this.state.measures(this.current) : null,
      ...(first || complete ? { elements: this.state.elements() } : {}),
    };
  }
}
