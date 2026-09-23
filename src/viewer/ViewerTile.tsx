/** The 3D tile body: a canvas, a count, and two explicit camera controls.
 *
 * It is a TILE, not a mode. There is no standalone viewer page and no full
 * screen here — the ruling is that 3D is folded into the surface that already
 * exists, and the tile is the second-largest thing on the board after the
 * verification focal.
 *
 * ── The canvas trap ──────────────────────────────────────────────────────
 * A `<canvas>` is a REPLACED element. `position: absolute; inset: 0` does not
 * stretch it — it keeps its intrinsic 300x150 and the box just sits there. Two
 * separate things have to be said: CSS `width/height: 100%` for the layout box
 * (`h-full w-full` below), and the DRAWING BUFFER size in device pixels, which
 * `ModelScene.resize` writes through `renderer.setSize(w, h, false)`. Setting
 * one without the other gives either a 300x150 picture in a big box or a
 * stretched, blurry one.
 *
 * ── What is NOT here ─────────────────────────────────────────────────────
 * No mode toggle (it lives in the filter bar with the chips, because mode is a
 * property of the cross-filter, not of the camera), no legend, no help text,
 * and no prose. Labels and numbers only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../ui/i18n";
import { t } from "../ui/i18n";
import { formatCount } from "../ui/format";
import {
  HOVER_FACE_BUDGET,
  buildMeshSet,
  framingBox,
  type MeshBatch,
  type MeshBudget,
  type MeshSet,
} from "./mesh-stream";
import { ModelScene, type Mode } from "./scene";

declare global {
  interface Window {
    /** Live scenes, in mount order. Written here, read only by the gates. */
    __ifcCheckScenes?: ModelScene[];
  }
}

/** The HUD chips sit over the top of the canvas and the camera buttons over
 *  its bottom-right, so a fit that filled the raw canvas would push content
 *  behind them. These are the usable-viewport insets the fit solver is given. */
const INSETS = { top: 22, right: 10, bottom: 24, left: 10 };

/** One HUD chip: counts only on the canvas, the full text in the title, so
 *  the chips stay one line at 1100 px instead of wrapping over the scene. */
function Chip({ tone, title, children }: { tone: string; title: string; children: string }) {
  return (
    <span
      title={title}
      className={`shrink-0 px-1.5 font-mono whitespace-nowrap tabular-nums [font-size:var(--bento-label,10px)] ${tone}`}
    >
      {children}
    </span>
  );
}

interface ViewerTileProps {
  lang: Lang;
  batches: MeshBatch[] | undefined;
  shift: [number, number, number] | undefined;
  budget: MeshBudget | undefined;
  meshError: string | undefined;
  /** `null` = no filter. An EMPTY set is a filter that matched nothing. */
  matched: Set<string> | null;
  mode: Mode;
  selection: string[];
  hover: string | null;
  /** Bumped by a TABLE selection that wants the camera on what it chose — a
   *  row of the derivation band. Never by a canvas pick, so the rule that a
   *  click in the 3D does not move the camera is kept by the prop not arriving
   *  rather than by a check here. Zero means nothing has asked yet. */
  frameSeq: number;
  onPick: (guid: string | null, additive: boolean) => void;
  onHover: (guid: string | null) => void;
}

export function ViewerTile({
  lang,
  batches,
  shift,
  budget,
  meshError,
  matched,
  mode,
  selection,
  hover,
  frameSeq,
  onPick,
  onHover,
}: ViewerTileProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ModelScene | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The scene is built once and driven by effects. The callbacks go through
  // refs so a new closure identity on the parent's render never tears the
  // WebGL context down and back up. Written in an effect rather than during
  // render: a ref is not render state, and assigning one while rendering is
  // the shape that makes a component miss an update.
  const pickRef = useRef(onPick);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
  });

  const set: MeshSet | null = useMemo(() => {
    if (!batches || batches.length === 0 || !shift || !budget) return null;
    return buildMeshSet(batches, shift, budget);
  }, [batches, shift, budget]);

  useEffect(() => {
    const element = canvas.current;
    const box = holder.current;
    if (!element || !box) return;

    // A machine with no WebGL, or one that has run out of contexts, throws
    // here. Said in the tile's own rectangle: a board that took itself down
    // over a viewer would be worse than a board with no viewer.
    let instance: ModelScene;
    try {
      instance = new ModelScene(element, {
        onPick: (event) => pickRef.current(event.guid, event.additive),
        onHover: (guid) => hoverRef.current(guid),
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    // No `ready` flag: React runs a component's effects in declaration order
    // within a commit, and this one is declared first, so every effect below
    // already sees `scene.current`. StrictMode's double-invoke re-runs ALL of
    // them, in the same order, after the cleanup — so the rebuilt scene is
    // re-hydrated by the very effects that fed the first one.
    scene.current = instance;
    // A handle for the headless gates, in mount order — which is panel order.
    // `isolate-gate.mjs` asserts what the CAMERA did after a click, and there
    // is no way to read a pose out of rendered pixels that is not archaeology.
    // Read-only: the gates call `probe` and nothing else.
    const registry = (window.__ifcCheckScenes ??= []);
    registry.push(instance);

    const observer = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      instance.resize(rect.width, rect.height, INSETS);
    });
    observer.observe(box);
    const rect = box.getBoundingClientRect();
    instance.resize(rect.width, rect.height, INSETS);

    return () => {
      observer.disconnect();
      instance.dispose();
      scene.current = null;
      const at = registry.indexOf(instance);
      if (at >= 0) registry.splice(at, 1);
    };
  }, []);

  // Computed here rather than inside the scene so the outlier count can reach
  // the HUD without a second pass over every vertex.
  const framing = useMemo(() => (set ? framingBox(set) : null), [set]);

  useEffect(() => {
    if (!set) return;
    scene.current?.load(set, framing);
  }, [set, framing]);

  useEffect(() => {
    scene.current?.setFilter(matched, mode);
  }, [matched, mode]);

  useEffect(() => {
    scene.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    scene.current?.setHover(hover);
  }, [hover]);

  /* Frame what a table just selected.
   *
   * Declared AFTER the selection effect on purpose: React runs a component's
   * effects in declaration order within a commit, so the scene already holds
   * the new selection when this runs and `zoomToSelection` frames it rather
   * than the previous one. It is the SAME call `Zoom til valg` makes — one
   * framing rule, one piece of arithmetic, so the button and the row cannot
   * land the camera in two different places.
   *
   * The counter is remembered in a ref so a re-render at the same value never
   * re-frames: a camera that snapped back on an unrelated state change would
   * take the view away from someone who had just orbited it.
   *
   * An element with no mesh in this scene (budget capped, or no geometry at
   * all) leaves the camera alone — `zoomToSelection` finds no bounds and
   * returns. The HUD already says how much of the filter has geometry. */
  const framedSeq = useRef(0);
  useEffect(() => {
    if (frameSeq === 0 || frameSeq === framedSeq.current) return;
    framedSeq.current = frameSeq;
    scene.current?.zoomToSelection();
  }, [frameSeq]);

  const fit = useCallback(() => scene.current?.fit(INSETS), []);
  const zoom = useCallback(() => scene.current?.zoomToSelection(), []);

  /* How much of the filter actually has geometry in this scene. A filter that
     matches elements the budget withheld must say so rather than showing a
     smaller answer than the table. */
  const reach = useMemo(() => {
    if (!set) return null;
    if (matched === null) return { shown: set.index.size, asked: set.index.size };
    let shown = 0;
    for (const guid of matched) if (set.index.has(guid)) shown += 1;
    return { shown, asked: matched.size };
  }, [set, matched]);

  const capped = budget?.capped === true;
  const missing = reach ? reach.asked - reach.shown : 0;
  /* Mesh-to-row hover is off above the raycast budget. Row-to-mesh hover keeps
     working either way, so this says which half is missing rather than letting
     the pointer silently stop linking. */
  const faces = useMemo(
    () => (set ? set.batches.reduce((sum, b) => sum + b.indices.length / 3, 0) : 0),
    [set],
  );
  const hoverOff = faces > HOVER_FACE_BUDGET;

  return (
    <div ref={holder} className="relative min-h-0 flex-1 overflow-hidden">
      {/* CSS sizes the BOX; `ModelScene.resize` sizes the drawing buffer. */}
      <canvas
        ref={canvas}
        tabIndex={0}
        className="block h-full w-full cursor-crosshair outline-none"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-1.5 overflow-hidden px-1.5 py-1">
        {failure || meshError ? (
          <span className="bg-bad px-1.5 font-mono text-cream [font-size:var(--bento-label,10px)]">
            {failure ?? meshError}
          </span>
        ) : set ? (
          <Chip
            tone="bg-panel/85 text-ink"
            title={`${formatCount(reach?.shown ?? 0, lang)} / ${formatCount(set.index.size, lang)}`}
          >
            {reach && reach.shown !== set.index.size
              ? `${formatCount(reach.shown, lang)} / ${formatCount(set.index.size, lang)}`
              : formatCount(set.index.size, lang)}
          </Chip>
        ) : (
          <Chip tone="bg-panel/85 text-ink" title={t("viewer.loading", lang)}>
            {t("viewer.loading", lang)}
          </Chip>
        )}

        {/* A cap is legitimate; a SILENT cap is not. Numbers on the canvas,
            the reason in the title, never a quietly smaller model. */}
        {capped && budget ? (
          <Chip
            tone="bg-bad text-cream"
            title={`${t("viewer.budget", lang)} ${formatCount(budget.elements, lang)} / ${formatCount(
              budget.totalElements,
              lang,
            )} · ${formatCount(budget.triangles, lang)} / ${formatCount(budget.totalTriangles, lang)} tri`}
          >
            {`${formatCount(budget.elements, lang)} / ${formatCount(budget.totalElements, lang)}`}
          </Chip>
        ) : null}

        {missing > 0 ? (
          <Chip
            tone="bg-gold text-ink"
            title={`${t("viewer.outside", lang)} ${formatCount(missing, lang)}`}
          >
            {`∅ ${formatCount(missing, lang)}`}
          </Chip>
        ) : null}

        {/* The entry camera frames the bulk. Elements too far out to frame
            with it are still drawn and still pickable — the count says the
            camera skipped them, not the scene. */}
        {framing && framing.excluded > 0 ? (
          <Chip
            tone="bg-gold text-ink"
            title={`${t("viewer.framing", lang)} ${formatCount(framing.excluded, lang)} / ${formatCount(
              framing.total,
              lang,
            )}`}
          >
            {`${formatCount(framing.excluded, lang)} ${t("viewer.framingShort", lang)}`}
          </Chip>
        ) : null}

        {hoverOff ? (
          <Chip
            tone="bg-gold text-ink"
            title={`${t("viewer.hoverOff", lang)} ${formatCount(faces, lang)}`}
          >
            {t("viewer.hoverOffShort", lang)}
          </Chip>
        ) : null}
      </div>

      <span className="pointer-events-none absolute right-0 bottom-0 flex gap-1 px-1.5 py-1">
        <TileButton label={t("viewer.fit", lang)} onClick={fit} />
        <TileButton
          label={t("viewer.zoomSelection", lang)}
          onClick={zoom}
          disabled={selection.length === 0}
          live={selection.length > 0}
        />
      </span>
    </div>
  );
}

/** Camera moves are an explicit opt-in. Selecting a row never flies the
 *  camera, so the two that DO move it are buttons with names.
 *
 *  `live` is availability, not state: the moment an element is picked, zoom is
 *  the next click — the element may be small or behind the eye — so the button
 *  says it can be pressed instead of sitting in the same grey as when it
 *  cannot. It is not the whole-surface fill, which means ACTIVE. */
function TileButton({
  label,
  onClick,
  disabled,
  live,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  live?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "pointer-events-auto border px-1.5 disabled:opacity-40 [font-size:var(--bento-label,10px)] " +
        (live
          ? "border-green bg-input font-semibold text-green hover:bg-green hover:text-cream"
          : "border-line bg-input text-ink hover:bg-palegreen")
      }
    >
      {label}
    </button>
  );
}
