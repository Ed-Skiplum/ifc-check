import { useLayoutEffect, useRef, useState } from "react";
import { MG_MARGIN } from "./alt/module-grid";

/** The tab fills the window down to the canon's 24 px foot margin, so the
 *  gallery scrolls inside it and the page does not (rule 1). Measured on the
 *  section's own top, again whenever it is shown or the window changes. */
export function useFillHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.getClientRects().length === 0) return;
      const next = Math.max(352, Math.floor(window.innerHeight - el.getBoundingClientRect().top - MG_MARGIN));
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, height };
}
