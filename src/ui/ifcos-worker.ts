/** ifcopenshell, in the browser, on the elements `body-no-mesh` found.
 *
 * Pyodide from cdn.jsdelivr.net, then the ifcopenshell Pyodide wheel from
 * the IfcOpenShell project's own GitHub Pages (`wasm-wheels`, served with
 * `Access-Control-Allow-Origin: *`, which raw GitHub and release assets are
 * not). `ifcopenshell.geom.create_shape` runs on exactly the GUIDs it is
 * handed, one verdict each:
 *
 *   geometry  the shape has vertices (vertex and face counts)
 *   none      the shape came back with no vertices
 *   error     create_shape raised (its message, as ifcopenshell wrote it)
 *
 * Nothing is guessed: a stage that fails (Pyodide, the wheel, opening the
 * file) is reported as that stage's failure with its message, and no verdict
 * is sent. The worker is terminated after one run; Pyodide plus an opened
 * model is too much memory to keep.
 */

/** Pyodide 0.28 is the pyodide_2025_0 ABI (CPython 3.13) the wheel is built for. */
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
export const IFCOPENSHELL_WHEEL =
  "https://ifcopenshell.github.io/wasm-wheels/ifcopenshell-0.8.5-cp313-cp313-pyodide_2025_0_wasm32.whl";

import type { IfcosVerdict } from "../engine/body-mesh";

export type IfcosStage = "pyodide" | "wheel" | "open" | "shapes";

export type IfcosRequest = { kind: "verify"; bytes: ArrayBuffer; guids: string[] };

export type IfcosResponse =
  | { kind: "stage"; stage: IfcosStage }
  | { kind: "done"; version: string; verdicts: Record<string, IfcosVerdict> }
  | { kind: "failed"; stage: IfcosStage; message: string };

interface Pyodide {
  loadPackage(names: string | string[]): Promise<unknown>;
  pyimport(name: string): { install(url: string): Promise<unknown> };
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void };
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
}

const post = (message: IfcosResponse) => (self.postMessage as (m: IfcosResponse) => void)(message);

const SHAPES = `
import json
import ifcopenshell
import ifcopenshell.geom

model = ifcopenshell.open("/model.ifc")
settings = ifcopenshell.geom.settings()
out = {}
for guid in guids:
    try:
        element = model.by_guid(guid)
        shape = ifcopenshell.geom.create_shape(settings, element)
        geometry = shape.geometry
        vertices = len(geometry.verts) // 3
        faces = len(geometry.faces) // 3
        if vertices > 0:
            out[guid] = {"kind": "geometry", "vertices": vertices, "faces": faces}
        else:
            out[guid] = {"kind": "none"}
    except Exception as error:
        out[guid] = {"kind": "error", "message": (type(error).__name__ + ": " + str(error))[:300]}
# The wasm wheel's ifcopenshell.version reads 0.0.0; the installed
# distribution's metadata carries the wheel's own version.
try:
    import importlib.metadata
    version = importlib.metadata.version("ifcopenshell")
except Exception:
    version = ifcopenshell.version
json.dumps({"version": version, "verdicts": out})
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
    py.globals.set("guids", guids);

    stage = "shapes";
    post({ kind: "stage", stage });
    // `guids` arrives as a JsProxy of a JS array, which Python iterates.
    const raw = (await py.runPythonAsync(SHAPES)) as string;
    const parsed = JSON.parse(raw) as { version: string; verdicts: Record<string, IfcosVerdict> };
    post({ kind: "done", version: parsed.version, verdicts: parsed.verdicts });
  } catch (err) {
    post({ kind: "failed", stage, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<IfcosRequest>) => {
  if (event.data.kind === "verify") void verify(event.data.bytes, event.data.guids);
};
