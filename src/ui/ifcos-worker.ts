/** ifcopenshell, in the browser: the second check on every element ifcfast
 * streamed no mesh for (`ifcos-verify.ts` runs it after every model load).
 *
 * Pyodide from cdn.jsdelivr.net, then the ifcopenshell Pyodide wheel from
 * the IfcOpenShell project's own GitHub Pages (`wasm-wheels`, served with
 * `Access-Control-Allow-Origin: *`, which raw GitHub and release assets are
 * not). The file is opened once, then the GUIDs it is handed go through in
 * batches, one verdict each, and every batch is posted as it lands:
 *
 *   geometry  create_shape returned vertices (vertex and face counts)
 *   none      the element has no representation; or it has no Body and
 *             create_shape raised on it; or the shape has no vertices
 *   error     create_shape raised on an element that declares a Body (its
 *             message, as ifcopenshell wrote it)
 *
 * Nothing is guessed: a stage that fails (Pyodide, the wheel, opening the
 * file) is reported as that stage's failure with its message. The worker is
 * terminated after one run; Pyodide plus an opened model is too much memory
 * to keep.
 */

/** Pyodide 0.28 is the pyodide_2025_0 ABI (CPython 3.13) the wheel is built for. */
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
export const IFCOPENSHELL_WHEEL =
  "https://ifcopenshell.github.io/wasm-wheels/ifcopenshell-0.8.5-cp313-cp313-pyodide_2025_0_wasm32.whl";

/** Elements per batch: one progress message, one yield to the worker's
 *  event loop, per batch. */
const BATCH = 100;

import type { IfcosVerdict } from "../engine/body-mesh";

export type IfcosStage = "pyodide" | "wheel" | "open" | "shapes";

export type IfcosRequest = { kind: "verify"; bytes: ArrayBuffer; guids: string[] };

export type IfcosResponse =
  | { kind: "stage"; stage: IfcosStage }
  /** One batch's verdicts, and how far the run is. */
  | { kind: "batch"; done: number; total: number; verdicts: Record<string, IfcosVerdict> }
  | { kind: "done"; version: string }
  | { kind: "failed"; stage: IfcosStage; message: string };

interface Pyodide {
  loadPackage(names: string | string[]): Promise<unknown>;
  pyimport(name: string): { install(url: string): Promise<unknown> };
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void };
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
}

const post = (message: IfcosResponse) => (self.postMessage as (m: IfcosResponse) => void)(message);

const OPEN = `
import json
import ifcopenshell
import ifcopenshell.geom

model = ifcopenshell.open("/model.ifc")
settings = ifcopenshell.geom.settings()

def has_body(element):
    for rep in element.Representation.Representations or ():
        if (rep.RepresentationIdentifier or "").lower() == "body":
            return True
    return False

def verdict(guid):
    try:
        element = model.by_guid(guid)
    except Exception as error:
        return {"kind": "error", "message": (type(error).__name__ + ": " + str(error))[:300]}
    if getattr(element, "Representation", None) is None:
        return {"kind": "none", "why": "no-representation"}
    try:
        shape = ifcopenshell.geom.create_shape(settings, element)
    except Exception as error:
        if not has_body(element):
            return {"kind": "none", "why": "no-body"}
        return {"kind": "error", "message": (type(error).__name__ + ": " + str(error))[:300]}
    geometry = shape.geometry
    vertices = len(geometry.verts) // 3
    faces = len(geometry.faces) // 3
    if vertices > 0:
        return {"kind": "geometry", "vertices": vertices, "faces": faces}
    return {"kind": "none", "why": "empty"}
`;

const SHAPES = `json.dumps({guid: verdict(guid) for guid in batch})`;

// The wasm wheel's ifcopenshell.version reads 0.0.0; the installed
// distribution's metadata carries the wheel's own version.
const VERSION = `
try:
    import importlib.metadata
    _version = importlib.metadata.version("ifcopenshell")
except Exception:
    _version = ifcopenshell.version
_version
`;

async function verify(bytes: ArrayBuffer, guids: string[]) {
  let stage: IfcosStage = "pyodide";
  try {
    post({ kind: "stage", stage });
    const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as {
      loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
    };
    const py = await loadPyodide({ indexURL: PYODIDE_URL });

    stage = "wheel";
    post({ kind: "stage", stage });
    await py.loadPackage("micropip");
    await py.pyimport("micropip").install(IFCOPENSHELL_WHEEL);

    stage = "open";
    post({ kind: "stage", stage });
    py.FS.writeFile("/model.ifc", new Uint8Array(bytes));
    await py.runPythonAsync(OPEN);

    stage = "shapes";
    post({ kind: "stage", stage });
    for (let at = 0; at < guids.length; at += BATCH) {
      // `batch` arrives as a JsProxy of a JS array, which Python iterates.
      py.globals.set("batch", guids.slice(at, at + BATCH));
      const raw = (await py.runPythonAsync(SHAPES)) as string;
      const verdicts = JSON.parse(raw) as Record<string, IfcosVerdict>;
      post({ kind: "batch", done: Math.min(guids.length, at + BATCH), total: guids.length, verdicts });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const version = String(await py.runPythonAsync(VERSION));
    post({ kind: "done", version });
  } catch (err) {
    post({ kind: "failed", stage, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<IfcosRequest>) => {
  if (event.data.kind === "verify") void verify(event.data.bytes, event.data.guids);
};
