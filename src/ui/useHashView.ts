/** View state lives in the URL hash so Back/Forward work and a view is a link.
 *
 * `?lang=` is read once on load and wins over everything, then the hash, then
 * the last choice in localStorage, then nb.
 */

import { useCallback, useEffect, useState } from "react";
import type { Lang } from "./i18n";
import { LANGS } from "./i18n";

const LANG_KEY = "ifc-check.lang";

export interface ViewState {
  lang: Lang;
  /** Id of the model whose value is open, or null. */
  model: string | null;
  /** Serialised drill target within that model, or null. See ui/trace.ts. */
  focus: string | null;
  /** A page other than the board, or null. */
  page: "setup" | null;
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
  };
}

function readPage(hash: URLSearchParams): ViewState["page"] {
  return hash.get("page") === "setup" ? "setup" : null;
}

function serialise(view: ViewState): string {
  const params = new URLSearchParams();
  params.set("lang", view.lang);
  if (view.model) params.set("model", view.model);
  if (view.focus) params.set("focus", view.focus);
  if (view.page) params.set("page", view.page);
  return `#${params.toString()}`;
}

export function useHashView(): [ViewState, (next: Partial<ViewState>) => void] {
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
      }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const update = useCallback((next: Partial<ViewState>) => {
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
        window.history.pushState(null, "", target);
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
      }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return [view, update];
}
