/** The faces a direction needs, fetched only when that direction is on.
 *
 * The default board keeps the stack it shipped with, so nothing about the
 * default route — its bytes, its first paint, or what a gate measures — moves
 * because three mockups exist. A `<link>` in `index.html` would have loaded
 * all three families for everybody.
 *
 * `display=swap`: the board draws immediately in the fallback and reflows the
 * glyphs when the face arrives. The alternative is a blank board waiting on a
 * font, which is the opposite of the verdict this work answers.
 *
 * Idempotent, so a walk between directions adds each stylesheet once and
 * leaves it: going back to a direction already seen costs nothing.
 */

import type { Design } from "../ui/useHashView";

const HREF: Record<Design, string> = {
  a: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
  b: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Schibsted+Grotesk:wght@400;500;700;800&display=swap",
  c: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
};

const loaded = new Set<Design>();

export function loadDesignFonts(design: Design): void {
  if (loaded.has(design)) return;
  loaded.add(design);
  if (typeof document === "undefined") return;

  // One preconnect pair for the whole session, so the second direction opened
  // does not pay the handshake again.
  if (!document.querySelector('link[data-design-preconnect]')) {
    for (const href of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      if (href.includes("gstatic")) link.crossOrigin = "";
      link.dataset.designPreconnect = "";
      document.head.appendChild(link);
    }
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = HREF[design];
  link.dataset.designFonts = design;
  document.head.appendChild(link);
}
