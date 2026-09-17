/* tslint:disable */
/* eslint-disable */

export class IfcModel {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `{tag: count}` — what the mesh pass saw, including
     * `unhandled:IFCXXX` markers for representations it could not
     * tessellate (GH #166).
     */
    bySourceJson(): string;
    /**
     * Parse from bytes — plain STEP or `.ifczip`, dispatched on magic
     * bytes exactly like the native `source::open`. Throws an `Error`
     * carrying the core's message (truncated file, no STEP trailer,
     * broken zip) rather than serving a partial model.
     *
     * v2: parse + index + extractors only. No tessellation — call
     * [`IfcModel::stream_meshes`] for the incremental geometry, or just
     * touch any geometry-derived surface and the v1 batch pass runs
     * itself.
     */
    static fromBytes(bytes: Uint8Array, name: string): IfcModel;
    /**
     * `<prefix>.graph.json` — per-product rows (measures joined from the
     * mesh pass) plus the spatial graph.
     *
     * Runs the batch mesh pass if no geometry has been produced yet;
     * after `streamMeshes` it reuses the streamed per-product stats.
     */
    graphJson(): string;
    /**
     * `<prefix>.qto.json` — per-entity-class aggregates over the same
     * per-product mesh stats.
     */
    qtoJson(): string;
    /**
     * Engine counters for the UI: products seen / meshed / deferred,
     * triangles, mesh milliseconds.
     */
    statsJson(): string;
    /**
     * Run the mesh pass once, streaming merged batches through `cb` as
     * products are tessellated (GH #172 v2).
     *
     * `cb(metaJson, positions, indices, progressJson)` is called
     * synchronously from inside the pass, every `productsPerBatch`
     * drawable products and once more for the tail. A Web Worker
     * `postMessage`s from it, so the main thread paints the model as it
     * builds instead of waiting for one baked GLB.
     *
     *   * `positions` — `Float32Array`, world METRES minus
     *     [`IfcModel::stream_shift_json`]. A **copy** into JS memory,
     *     not a view: a view into the wasm heap would be detached by the
     *     next allocation the pass makes, and the callback is free to
     *     keep (or transfer) what it is handed.
     *   * `indices` — `Uint32Array`, batch-local (already offset by each
     *     product's `v0`), so a batch uploads as one merged
     *     `BufferGeometry`.
     *   * `metaJson` — `[{guid, entity, storey_guid, type_name, m3, m2,
     *     tri, v0, vn, i0, in, rgba}]`. `v0`/`vn` are the product's
     *     vertex offset/count inside `positions` (xyz triples),
     *     `i0`/`in` its index offset/count inside `indices`, and `rgba`
     *     is `mesh::gltf::resolve_product_color` — the same cascade the
     *     glTF writer paints with, not a second implementation of it.
     *     `m3`/`m2`/`tri` are the v1 per-product measures.
     *   * `progressJson` — `{seen, meshed, total}`: products handed to
     *     the sink so far, of those the ones that had drawable geometry
     *     after the cutter strip, and the index's product count.
     *
     * Products with no geometry left after the synthetic half-space
     * cutters are stripped (GH #66) still get their QTO row; they just
     * never reach a batch. Nothing is filtered by entity — `IfcSpace`
     * and opening solids stream like everything else, tagged in `meta`,
     * so the viewer decides what to draw. (`toGlb` still holds them
     * back; that is a glTF-export choice, not a data one.)
     *
     * Throwing from `cb` aborts the stream and surfaces as an `Error`
     * here; the per-product tables stay consistent for whatever ran.
     */
    streamMeshes(products_per_batch: number, cb: Function): void;
    /**
     * `[sx, sy, sz]` in METRES — the model-wide global shift the
     * streamed positions were reduced by. Add it back for absolute world
     * coordinates. `[0, 0, 0]` before the stream starts and for every
     * model within 10 km of the origin; same rule (and same value) as
     * `_core.extract_meshes`' `global_shift`.
     */
    streamShiftJson(): string;
    /**
     * `<prefix>.summary.json` — identity, counts, top types, and the
     * shape + loaded-state of every table.
     *
     * The one surface that never triggers a mesh pass: it is what the
     * drop zone shows the instant parsing finishes. Its `drift` and
     * `segments` tables therefore report `loaded: false` / `rows: 0`
     * until geometry has actually run.
     */
    summaryJson(): string;
    /**
     * glTF binary, same writer as `m.to_gltf()`:
     * `KHR_mesh_quantization`, `EXT_mesh_gpu_instancing` (when
     * `instancing` is on), `node.extras.guid`, and GUID-named materials
     * when `perProductMaterials` is on (GH #146).
     *
     * Two product classes are held back, matching what the desktop
     * `to_gltf()` default produces:
     *
     *   * `IfcSpace` — translucent space volumes envelop the building
     *     and read as clutter in a viewport. The sidecar generator
     *     carves a space-free subset before exporting for the same
     *     reason.
     *   * products on the `RelatedOpeningElement` side of an
     *     `IfcRelVoidsElement` — subtracted geometry, never element
     *     geometry. `cut_openings` folds them into the host; with no
     *     boolean kernel on wasm the honest approximation is to drop
     *     them rather than render a door-shaped solid inside the wall.
     *     The hole itself is therefore NOT cut in v1.
     *
     * Nothing is hidden from the data surfaces: openings and spaces
     * keep their rows in `graphJson` / `qtoJson` and their counts in
     * `statsJson`.
     */
    toGlb(per_product_materials?: boolean | null, instancing?: boolean | null): Uint8Array;
    /**
     * `types/manifest.json` — the type roster. `glb` / `bytes` are empty
     * in v1; see the module docs.
     */
    typesJson(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_ifcmodel_free: (a: number, b: number) => void;
    readonly ifcmodel_bySourceJson: (a: number) => [number, number];
    readonly ifcmodel_fromBytes: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly ifcmodel_graphJson: (a: number) => [number, number];
    readonly ifcmodel_qtoJson: (a: number) => [number, number];
    readonly ifcmodel_statsJson: (a: number) => [number, number];
    readonly ifcmodel_streamMeshes: (a: number, b: number, c: any) => [number, number];
    readonly ifcmodel_streamShiftJson: (a: number) => [number, number];
    readonly ifcmodel_summaryJson: (a: number) => [number, number];
    readonly ifcmodel_toGlb: (a: number, b: number, c: number) => [number, number, number, number];
    readonly ifcmodel_typesJson: (a: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
