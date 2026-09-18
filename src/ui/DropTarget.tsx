/** The entrance. One target, centered, on an otherwise empty screen.
 *
 * The deliberate exception to filling the width: a funnel, not a working
 * surface. Density governs what you land in, not the door.
 */

import { useRef } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";

interface DropTargetProps {
  lang: Lang;
  dragging: boolean;
  onFiles: (files: File[]) => void;
}

export function DropTarget({ lang, dragging, onFiles }: DropTargetProps) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={
          "flex h-[18rem] w-[34rem] max-w-full flex-col items-center justify-center gap-3 border-2 border-dashed " +
          (dragging
            ? "border-green bg-palegreen text-green"
            : "border-line bg-input text-ink hover:border-green hover:text-green")
        }
      >
        <span className="text-[20px] font-medium">{t("drop.ifc", lang)}</span>
        <span className="font-mono text-[12px] tracking-[0.12em] text-muted">
          {t("accept.ifc", lang)}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".ifc,.ifczip"
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
