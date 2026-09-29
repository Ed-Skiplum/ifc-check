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

/** The Graf tab's stage (2026-09-29, edkjo: *"strictly not needed, so it
 *  just needs to be cool and inspiring"*): ONE large main surface and the
 *  other one as a small window.
 *
 *  The main is the whole stage where the stage is inside 9:16 to 16:9, else
 *  the largest box that is: on a desktop tab that is the widest 16:9 box at
 *  full height, set to the left so the column it leaves on the right holds
 *  the window, bottom-aligned, without covering the main. Where that column
 *  is too narrow for a window (a stage near 16:9 or narrower), the window
 *  floats over the main's lower-right corner instead. The window is 3:4 to
 *  16:9 and never wider than 30 % of the stage or 60 % of its height; `reserve` keeps its top clear
 *  of the stage's top-right control. */
export function graphStage(
  width: number,
  height: number,
  second: boolean,
  reserve = 56,
): { main: FieldRect; window: FieldRect | null; beside: boolean } {
  const INSET = 12;
  const MIN_WINDOW = 200;
  const aspect = width / height;
  let mainW = width;
  let mainH = height;
  if (aspect > CANVAS_ASPECT.max) mainW = Math.floor(height * CANVAS_ASPECT.max);
  else if (aspect < CANVAS_ASPECT.min) mainH = Math.floor(width / CANVAS_ASPECT.min);
  if (!second) {
    const left = Math.floor((width - mainW) / 2);
    return { main: { left, top: 0, width: mainW, height: mainH }, window: null, beside: false };
  }
  const main = { left: 0, top: 0, width: mainW, height: mainH };
  const column = width - mainW - 2 * INSET;
  if (column >= MIN_WINDOW) {
    const w = Math.floor(Math.min(column, 0.3 * width, 0.6 * height));
    const room = height - 2 * INSET - reserve;
    const h = Math.floor(Math.max(Math.min(room, (w * 4) / 3), (w * 9) / 16));
    return {
      main,
      window: { left: width - INSET - w, top: height - INSET - h, width: w, height: h },
      beside: true,
    };
  }
  const w = Math.floor(Math.max(MIN_WINDOW, Math.min(0.28 * mainW, 360)));
  const h = Math.floor((w * 3) / 4);
  return {
    main,
    window: { left: mainW - INSET - w, top: mainH - INSET - h, width: w, height: h },
    beside: false,
  };
}
