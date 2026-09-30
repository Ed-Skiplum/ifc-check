import { useLayoutEffect, useRef, useState } from "react";

/** The box a tab's content has to fit: its tab panel, which the model panel
 *  sizes to the window less the chrome above it and the derivation band under
 *  it; outside a tab panel, the scrolling `main`. */
export function fitRegion(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[role="tabpanel"]') ?? el.closest("main");
}

/** Px from `el`'s top edge down to the foot of its region, measured, never
 *  assumed. The region ends at `main`'s padding, which is already the
 *  frame's foot margin (`directions.css`), or at the band under the tab. Both
 *  edges move together when the page scrolls, so a second model further down
 *  gets the same answer as the first. */
export function roomBelow(el: Element): number {
  const region = fitRegion(el);
  const bottom = region ? region.getBoundingClientRect().bottom : window.innerHeight;
  return bottom - el.getBoundingClientRect().top;
}

/** The tab fills its region (down to the frame's foot margin, or to
 *  the band), so the gallery scrolls inside it and the page does not
 *  (rule 1). Measured on the section's own top, again whenever it is shown,
 *  the band opens or closes, or the window changes. */
export function useFillHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.getClientRects().length === 0) return;
      const next = Math.max(0, Math.floor(roomBelow(el)));
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const region = fitRegion(el);
    if (region) observer.observe(region);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, height };
}
