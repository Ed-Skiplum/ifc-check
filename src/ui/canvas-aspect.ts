/** THE CANVAS ASPECT RULE, 2026-09-26.
 *
 * edkjo: *"tall/narrow and short/wide isnt good. Thats a relative term, and I
 * would classify full width/half height as in the bad category. A
 * viewer/canvas always needs to have an aspect ratio that is in the range of
 * square to monitor or phone aspect ratios."*
 *
 * So every 3D viewer and every graph canvas renders at width / height inside
 * [9/16, 16/9]: phone portrait, through square, to a 16:9 monitor. The TILE
 * gets that shape; nothing letterboxes or scales inside the canvas. Pure TS,
 * so the gates import the same numbers they assert.
 */

export const CANVAS_ASPECT = { min: 9 / 16, max: 16 / 9 } as const;

export interface FieldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The Graf tab's field: a main surface and, when the 3D is there, a second
 *  one. When the field itself is inside the bound the main fills it and the
 *  second is a 4:3 window over its corner (as before). When the field is
 *  wider than 16:9, which is every desktop screen at the tab's height, the
 *  main takes the widest 16:9 box and the second sits BESIDE it in the
 *  column that is left, never over a strip-shaped main. The second is the
 *  column's width and as tall as the field, but no narrower than 3:4 and no
 *  wider than 16:9. */
export function graphFieldLayout(
  width: number,
  height: number,
  second: boolean,
): { main: FieldRect; second: FieldRect | null; beside: boolean } {
  const GAP = 12;
  const INSET = 12;
  const MIN_SECOND = 208; // 13rem, the window's old minimum width
  if (width / height <= CANVAS_ASPECT.max) {
    const main = { left: 0, top: 0, width, height };
    if (!second) return { main, second: null, beside: false };
    const w = Math.max(MIN_SECOND, Math.min(width * 0.34, 416));
    return {
      main,
      second: { left: width - INSET - w, top: INSET, width: w, height: (w * 3) / 4 },
      beside: false,
    };
  }
  if (!second) {
    // Alone and too wide: the canvas takes the widest 16:9 box, centred.
    const w = Math.floor(height * CANVAS_ASPECT.max);
    return { main: { left: Math.floor((width - w) / 2), top: 0, width: w, height }, second: null, beside: false };
  }
  const widest = Math.floor(height * CANVAS_ASPECT.max);
  const mainW = Math.min(widest, Math.floor(width - GAP - MIN_SECOND));
  // On an ultra-wide field the second stops at 16:9 too, and the pair is
  // centred rather than either one stretched.
  const sideW = Math.min(widest, width - mainW - GAP);
  const sideH = Math.min(height, Math.floor(sideW / (3 / 4)));
  const left = Math.floor((width - mainW - GAP - sideW) / 2);
  return {
    main: { left, top: 0, width: mainW, height },
    second: { left: left + mainW + GAP, top: 0, width: sideW, height: sideH },
    beside: true,
  };
}
