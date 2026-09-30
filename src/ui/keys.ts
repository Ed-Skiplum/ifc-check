/** Keyboard: one place for what a key does anywhere in the app (2026-09-30).
 *
 * The canon (data-workspace.md, ESC ESCALATES): *the first Esc clears the
 * selection, the second clears the filter (the same as the chip's ✕), from
 * anywhere in the app. Enter and Space both activate a focused row or card.*
 *
 *   - `escapeTarget` decides whether a window-level Esc is the app's: not
 *     when a text field, a select or an open dialog has it, and not when a
 *     component already handled it (`defaultPrevented`).
 *   - `activate` / `asButton` give a row, cell or card that is not a native
 *     `<button>` the button's keys: Enter and Space.
 *   - `tablistKeys` is the WAI-ARIA tabs pattern on a `role="tablist"`:
 *     arrows, Home and End move to a tab and select it (automatic
 *     activation); the tabs carry a roving tabindex.
 *
 * Pure DOM and React types, no state.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** True when a window-level Esc belongs to the app's selection/filter. */
export function escapeTarget(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target) {
    if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return false;
    if (target.closest("dialog, [role='dialog'], [role='alertdialog'], [aria-modal='true']")) return false;
  }
  // A modal open anywhere keeps its Esc even when focus sits outside it.
  if (typeof document !== "undefined" && document.querySelector("dialog[open], [aria-modal='true']")) return false;
  return true;
}

/** Enter or Space on the element itself (not on a control inside it). */
export function activate(handler: () => void) {
  return (event: ReactKeyboardEvent<Element>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handler();
  };
}

/** The props that make a row, cell or card a keyboard control. */
export function asButton(handler: () => void) {
  return { role: "button", tabIndex: 0, onKeyDown: activate(handler) } as const;
}

/** Arrow keys, Home and End across the tabs of a `role="tablist"`. */
export function tablistKeys(event: ReactKeyboardEvent<HTMLElement>): void {
  const { key } = event;
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
  // The list's own tabs, grouped or not, never those of a tablist nested in it.
  const list = event.currentTarget;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => !tab.hasAttribute("disabled") && tab.closest('[role="tablist"]') === list,
  );
  const at = tabs.findIndex((tab) => tab === event.target);
  if (at < 0 || tabs.length === 0) return;
  event.preventDefault();
  const next =
    key === "Home" ? 0 : key === "End" ? tabs.length - 1 : (at + (key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
}
