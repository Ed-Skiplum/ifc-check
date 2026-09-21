/** On/off as a SWITCH: a track with a sliding knob, label beside it. Canon
 *  2026-08-19: a state is a switch, not a bordered button carrying the same
 *  word in both states. `SwitchGlyph` is the picture alone, for places that
 *  show the state without owning it (the landing's setup tile). */

export function SwitchGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        "relative inline-block h-3.5 w-6 shrink-0 border transition-colors " +
        (on ? "border-green bg-green" : "border-muted bg-input")
      }
    >
      <span
        className={
          "absolute top-px h-2.5 w-2.5 transition-[left] " +
          (on ? "left-[calc(100%-0.6875rem)] bg-cream" : "left-px bg-muted")
        }
      />
    </span>
  );
}

export function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className="flex items-center gap-2 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      <SwitchGlyph on={on} />
      <span>{label}</span>
    </button>
  );
}
