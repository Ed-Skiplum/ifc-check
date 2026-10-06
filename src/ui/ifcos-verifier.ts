/** What the second check runs (`ifcos-worker.ts`), as one identity.
 *
 * Kept apart from the worker so the main thread can name the verifier
 * without loading the worker module. A stored verdict set
 * (`storage/model-cache.ts` `readVerification`) is reused only when it was
 * written by this same verifier; change the wheel, Pyodide or the verdict
 * rules in the worker, and bump `VERDICT_RULES` when only the rules change.
 */

/** Pyodide 0.28 is the pyodide_2025_0 ABI (CPython 3.13) the wheel is built for. */
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
export const IFCOPENSHELL_WHEEL =
  "https://ifcopenshell.github.io/wasm-wheels/ifcopenshell-0.8.5-cp313-cp313-pyodide_2025_0_wasm32.whl";

/** The worker's `verdict()` rules. */
export const VERDICT_RULES = 1;

export const VERIFIER = `${PYODIDE_URL}|${IFCOPENSHELL_WHEEL}|rules:${VERDICT_RULES}`;
