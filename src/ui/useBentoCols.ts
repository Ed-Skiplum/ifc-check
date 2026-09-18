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
import { useLayoutEffect, useRef, useState } from "react";
import { bentoColsForWidth, type BentoCols } from "./bento-spec";

export function useBentoCols(): {
  ref: RefObject<HTMLDivElement | null>;
  cols: BentoCols | null;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<BentoCols | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = (width: number) => {
      if (width > 0) setCols(bentoColsForWidth(width));
    };
    apply(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, cols };
}
