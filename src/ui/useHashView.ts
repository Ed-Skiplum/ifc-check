/** View state lives in the URL hash so Back/Forward work and a view is a link.
 *
 * `?lang=` is read once on load and wins over everything, then the hash, then
 * the last choice in localStorage, then nb.
 *
 * ── `design=` ────────────────────────────────────────────────────────────
 * One more key, and the cheapest honest mechanism for the three visual
 * directions: `#design=a` sets `data-design="a"` on the document element and
 * the whole stylesheet reads off that attribute. No route table, no server
 * rewrite, no second bundle — which matters, because this app is served as a
 * static site AND embedded in an iframe on skiplum.com, where a path route
 * would need the host's cooperation and a hash does not.
 *
 * Absent — the default — there is NO attribute, so the default look and every
 * gate that measures it are untouched by this file.
 */

import { useCallback, useEffect, useState } from "react";
import type { Lang } from "./i18n";
import { LANGS } from "./i18n";

const LANG_KEY = "ifc-check.lang";

/** The three directions. `null` is the shipped default. */
export const DESIGNS = ["a", "b", "c"] as const;
export type Design = (typeof DESIGNS)[number];

export interface ViewState {
  lang: Lang;
  /** Id of the model whose value is open, or null. */
  model: string | null;
  /** Serialised drill target within that model, or null. See ui/trace.ts. */
  focus: string | null;
  /** A page other than the board, or null. */
  page: "setup" | null;
  /** The model panel's tab. null is the first tab, Kontroll; it is left out
   *  of the hash so a bare URL and a board link stay short. */
  tab: "model" | "contents" | "graph" | "types" | "materials" | "project" | "rooms" | null;
  /** The Typer type page: a type card's key (`entity::typeName`), or null
   *  for the gallery. Its own route, so Back returns to the gallery and the
   *  page is a link. */
  type: string | null;
  /** The visual direction, or null for the shipped default. */
  design: Design | null;
}

/** b is the only version (edkjo 2026-09-28: "make b the new main version.
 *  Lets stop this multiple versions thing. we iterate on b"). The hash key is
 *  no longer read, so the plain URL and the skiplum.com embed render b and old
 *  `#design=` links still load. */
function readDesign(_hash: URLSearchParams): Design | null {
  return "b";
}

function isLang(value: string | null): value is Lang {
  return value !== null && (LANGS as readonly string[]).includes(value);
}

function readHash(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function storedLang(): Lang | null {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    return isLang(stored) ? stored : null;
  } catch {
    return null;
  }
}

function initialLang(hash: URLSearchParams): Lang {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (isLang(query)) return query;
  const fromHash = hash.get("lang");
  if (isLang(fromHash)) return fromHash;
  return storedLang() ?? "nb";
}

function parse(): ViewState {
  const hash = readHash();
  return {
    lang: initialLang(hash),
    model: hash.get("model"),
    focus: hash.get("focus"),
    page: readPage(hash),
    tab: readTab(hash),
    type: hash.get("type"),
    design: readDesign(hash),
  };
}

function readPage(hash: URLSearchParams): ViewState["page"] {
  return hash.get("page") === "setup" ? "setup" : null;
}

function readTab(hash: URLSearchParams): ViewState["tab"] {
  const tab = hash.get("tab");
  if (tab === "model") return "model";
  if (tab === "contents") return "contents";
  if (tab === "graph") return "graph";
  if (tab === "types") return "types";
  if (tab === "materials") return "materials";
  if (tab === "project") return "project";
  if (tab === "rooms") return "rooms";
  return null;
}

function serialise(view: ViewState): string {
  const params = new URLSearchParams();
  params.set("lang", view.lang);
  if (view.model) params.set("model", view.model);
  if (view.focus) params.set("focus", view.focus);
  if (view.page) params.set("page", view.page);
  if (view.tab) params.set("tab", view.tab);
  if (view.type) params.set("type", view.type);
  return `#${params.toString()}`;
}

export function useHashView(): [ViewState, (next: Partial<ViewState>, replace?: boolean) => void] {
  const [view, setView] = useState<ViewState>(parse);

  // Write the resolved state back once, so a bare URL becomes a shareable one.
  useEffect(() => {
    const target = serialise(view);
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
    // Deliberately once, on mount: later writes go through `update` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = readHash();
      const lang = hash.get("lang");
      setView((current) => ({
        lang: isLang(lang) ? lang : current.lang,
        model: hash.get("model"),
        focus: hash.get("focus"),
        page: readPage(hash),
        tab: readTab(hash),
        type: hash.get("type"),
        design: readDesign(hash),
      }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const update = useCallback((next: Partial<ViewState>, replace = false) => {
    setView((current) => {
      const merged: ViewState = { ...current, ...next };
      if (next.lang && next.lang !== current.lang) {
        try {
          window.localStorage.setItem(LANG_KEY, next.lang);
        } catch {
          // Private mode or blocked storage: the choice simply does not persist.
        }
      }
      const target = serialise(merged);
      if (window.location.hash !== target) {
        // pushState, not location.hash: this is what makes Back/Forward walk
        // the selections instead of the language toggle only.
        // `replace` for a step within one page (the type page's ← →), so
        // Back still returns to where that page was opened from.
        if (replace) window.history.replaceState(null, "", target);
        else window.history.pushState(null, "", target);
      }
      return merged;
    });
  }, []);

  // pushState does not fire hashchange, so popstate is what restores a state
  // the user walked back to.
  useEffect(() => {
    const onPopState = () => {
      const hash = readHash();
      const lang = hash.get("lang");
      setView((current) => ({
        lang: isLang(lang) ? lang : current.lang,
        model: hash.get("model"),
        focus: hash.get("focus"),
        page: readPage(hash),
        tab: readTab(hash),
        type: hash.get("type"),
        design: readDesign(hash),
      }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return [view, update];
}
