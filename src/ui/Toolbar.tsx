import { useRef } from "react";
import type { Lang } from "./i18n";
import { LANGS, t } from "./i18n";

interface ToolbarProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
  modelCount: number;
  dragging: boolean;
  onFiles: (files: File[]) => void;
}

export function Toolbar({ lang, onLang, modelCount, dragging, onFiles }: ToolbarProps) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <header className="flex shrink-0 items-stretch gap-4 border-b border-line bg-panel px-4 py-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={
          "flex items-center gap-3 rounded-sm border-2 border-dashed px-4 py-1.5 text-sm font-medium transition-colors " +
          (dragging
            ? "border-green bg-palegreen text-green"
            : "border-line bg-input text-ink hover:border-green hover:text-green")
        }
      >
        <span>{t("toolbar.open", lang)}</span>
        <span className="font-mono text-[11px] tracking-wide text-muted">
          {t("toolbar.accept", lang)}
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

      <div className="flex items-center gap-2 self-center">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gold">
          {t("toolbar.models", lang)}
        </span>
        <span className="font-mono text-sm tabular-nums text-ink">{modelCount}</span>
      </div>

      <div className="ml-auto flex items-center self-center overflow-hidden rounded-sm border border-line">
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onLang(code)}
            aria-pressed={code === lang}
            className={
              "px-3 py-1 font-mono text-xs uppercase transition-colors " +
              (code === lang ? "bg-green text-cream" : "bg-input text-muted hover:text-ink")
            }
          >
            {code}
          </button>
        ))}
      </div>
    </header>
  );
}
