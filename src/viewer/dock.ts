/** Lending the ONE viewer to another surface.
 *
 * The Graf tab shows the 3D beside the graph (edkjo, 2026-09-25: *"lets add
 * the viewer here as well … toggle between model and graph as main and the
 * other windowed"*). A second `ModelScene` would be a second WebGL context and
 * a second copy of every mesh on the GPU, so the tab BORROWS the board's: the
 * scene's `<canvas>` is moved into the tab's slot, resized there, and moved
 * back when the tab lets go. The scene's pointer handlers live on the canvas,
 * so picking, orbit and hover travel with it, and selection is already one
 * state for both surfaces.
 *
 * Keyed by the model's mesh batches — the one object both the board's tile and
 * the tab receive for the same model — so a panel can never borrow another
 * model's scene.
 */

import type { MeshBatch } from "./mesh-stream";
import type { ModelScene } from "./scene";

interface Dock {
  scene: ModelScene;
  canvas: HTMLCanvasElement;
  home: HTMLElement;
  /** Put the canvas back and size the scene to its home. */
  restore: () => void;
  /** The mark every host draws centred over the canvas while the filter
   *  matches no objects («Ingen objekter»), else null. Set by the home tile,
   *  which knows the filter and the language (`setDockEmpty`). */
  empty?: string | null;
}

const docks = new Map<MeshBatch[], Dock>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function registerDock(key: MeshBatch[], dock: Dock): () => void {
  docks.set(key, dock);
  changed();
  return () => {
    if (docks.get(key) === dock) docks.delete(key);
    changed();
  };
}

/** The home tile's word for an empty canvas, or null; every host re-renders. */
export function setDockEmpty(key: MeshBatch[], empty: string | null): void {
  const dock = docks.get(key);
  if (!dock || (dock.empty ?? null) === empty) return;
  dock.empty = empty;
  changed();
}

export function findDock(key: MeshBatch[] | undefined): Dock | null {
  return key ? (docks.get(key) ?? null) : null;
}

export function onDocksChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Move the canvas into `slot` and keep the scene sized to it. The release
 *  hands it home only while it is still in `slot`: when two surfaces trade it
 *  (Graf to Typer, the Typer gallery to its type view) the one letting go
 *  must not pull it out of the one that has just taken it. */
export function lend(dock: Dock, slot: HTMLElement): () => void {
  slot.appendChild(dock.canvas);
  const size = () => {
    const rect = slot.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) dock.scene.resize(rect.width, rect.height);
  };
  size();
  const observer = new ResizeObserver(size);
  observer.observe(slot);
  return () => {
    observer.disconnect();
    if (dock.canvas.parentElement === slot) dock.restore();
  };
}

/** True while the canvas is somewhere other than its own tile. */
export function isLent(dock: Dock): boolean {
  return dock.canvas.parentElement !== dock.home;
}
