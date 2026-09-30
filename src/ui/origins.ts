/** Which VIEW a board focus belongs to, for a filter restored from a link
 *  (every live click names its own origin). See `filter-state.ts`. */

import type { Focus } from "./trace";
import type { Origin } from "./filter-state";

/** What a view needs to know of the active filter: which view it came from
 *  and the elements it resolves to. */
export interface Xf {
  origin: Origin | null;
  matched: Set<string> | null;
}

export const NO_XF: Xf = { origin: null, matched: null };

/** The set a view isolates to: the filter's, unless the view IS the origin
 *  (it highlights instead) or there is no filter. */
export function isoOf(xf: Xf, self: Origin | readonly Origin[]): Set<string> | null {
  if (xf.origin === null || xf.matched === null) return null;
  const mine = typeof self === "string" ? xf.origin === self : self.includes(xf.origin);
  return mine ? null : xf.matched;
}

/** `data-xf` on a view's body: `origin` dims every item but the chosen one
 *  (the CSS in `index.css`); `whole` marks a view that keeps whole-model
 *  figures under a filter from elsewhere. */
export function xfMark(xf: Xf, self: Origin | readonly Origin[], whole = false): "origin" | "whole" | undefined {
  if (xf.origin === null) return undefined;
  const mine = typeof self === "string" ? xf.origin === self : self.includes(xf.origin);
  if (mine) return "origin";
  return whole && xf.matched !== null ? "whole" : undefined;
}

export function originOfFocus(focus: Focus): Origin {
  switch (focus.kind) {
    case "tree":
      return `tree-${focus.axis}`;
    case "code":
      return "codes";
    case "req":
      return "reqs";
    case "ids":
      return "ids";
    case "storey":
      return "floors";
    case "class":
    case "cell":
    case "type":
      return "census";
    case "element":
      return "viewer";
    default:
      return "checks";
  }
}
