/** A list of values typed or pasted as one text: comma- or line-separated.
 *  Moved out of `SetupPage.tsx` (Duplikat objekt's copy and own values) so
 *  the type name's accepted values (`TypeNameStep.tsx`) are entered alike. */

import { useState } from "react";

export const INPUT =
  "border border-line bg-input px-2 py-1 font-mono text-[12px] text-ink " +
  "disabled:text-muted aria-[invalid=true]:border-bad";

export function parseValues(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** The draft keeps what is typed, trailing comma and all; the list is parsed
 *  on every keystroke. `multiline`: a text area, so a pasted column of values
 *  keeps its line breaks. */
export function ValuesInput({
  values,
  invalid,
  multiline = false,
  label,
  onChange,
}: {
  values: string[];
  invalid: boolean;
  multiline?: boolean;
  label?: string;
  onChange: (next: string[]) => void;
}) {
  const joined = values.join(", ");
  const [draft, setDraft] = useState(joined);
  // A new list from outside (a loaded file) replaces the draft; the list this
  // draft itself produced does not.
  const [seen, setSeen] = useState(joined);
  if (seen !== joined) {
    setSeen(joined);
    if (parseValues(draft).join(", ") !== joined) setDraft(joined);
  }
  const change = (text: string) => {
    setDraft(text);
    onChange(parseValues(text));
  };
  return multiline ? (
    <textarea
      rows={4}
      autoFocus
      aria-label={label}
      className={INPUT + " min-w-64 resize-y"}
      aria-invalid={invalid}
      value={draft}
      onChange={(e) => change(e.target.value)}
    />
  ) : (
    <input type="text" aria-label={label} className={INPUT} aria-invalid={invalid} value={draft} onChange={(e) => change(e.target.value)} />
  );
}
