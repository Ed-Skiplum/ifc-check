/** Which of a board's two AUTHORED layouts a container can carry.
 *
 * Mirror of `sprucelab/frontend/src/components/Layout/useBentoCols.ts`. Its
 * own module rather than a second export from `BentoGrid.tsx`: a file that
 * exports both a component and a hook breaks Fast Refresh, and the measurement
 * is a concern the grid itself does not have — the grid is told how many
 * tracks to draw; deciding is the page's job.
 *
 * Measured off the GRID's own box, never the viewport, so a board embedded in
 * a narrower column picks the layout that actually fits it. ifc-check is
 * iframed on skiplum.com, where `window.innerWidth` is the host page's.
 *
 * `cols` is `null` for exactly one render. The measurement runs in a LAYOUT
 * effect, so React re-renders with the answer before the browser paints and a
 * board is never SEEN at the wrong track count.
 */

import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { bentoColsForWidth, type BentoCols } from "./bento-spec";

/**
 * How much page height this board may fill before the page has to scroll:
 * the scroller's own content box, less the panel chrome standing above the
 * board (file line, filter bar, tab strip and their gaps).
 *
 * Measured from the board's offset INSIDE its panel, never from its position
 * in the viewport, so it does not move when the page scrolls and every panel
 * on a multi-model page gets the same answer instead of the second board
 * reading the first one's height as chrome.
 */
function boardSpace(element: HTMLElement): number | null {
  const main = element.closest("main");
  const panel = element.closest("section");
  if (!main || !panel) return null;
  const style = getComputedStyle(main);
  const inner =
    main.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
  const chrome = element.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  const space = inner - chrome;
  return Number.isFinite(space) && space > 0 ? Math.round(space) : null;
}

export function useBentoCols(): {
  ref: RefObject<HTMLDivElement | null>;
  cols: BentoCols | null;
  /** Px of page the board may occupy, or `null` before the first measurement
   *  and wherever it cannot be established. A board with no answer renders at
   *  its authored row unit — the size it had before this existed — so a missed
   *  measurement costs surplus height, never content. */
  space: number | null;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<BentoCols | null>(null);
  const [space, setSpace] = useState<number | null>(null);

  // The WIDTH ladder is still measurement-free — it is CSS all the way down
  // (`100cqw`), correct on the first paint. Only the height SURPLUS is
  // measured, because no container query can see the scroller's leftover room
  // from inside the board. The cost of being one frame late is that the board
  // paints at its authored size and then grows; nothing is ever clipped by it.
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.getBoundingClientRect().width;
    // A hidden tab panel has no box. Keep the last answer rather than reading
    // a zero rectangle as "this board starts above the page".
    if (width <= 0) return;
    setCols(bentoColsForWidth(width));
    const next = boardSpace(element);
    setSpace((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The board's own box, the scroller and the panel: the first two change
    // what there is to fill, the third changes how much chrome stands above
    // it. The board growing into the space it was given re-fires this and
    // measures the same number, which the equality guard drops — so the flex
    // settles rather than oscillating.
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    const main = element.closest("main");
    if (main) observer.observe(main);
    const panel = element.closest("section");
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, cols, space };
}
