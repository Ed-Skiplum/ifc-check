import { useRef } from "react";
import type { Lang } from "./i18n";
import { LANGS, t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";

export function LangToggle({ lang, onLang }: { lang: Lang; onLang: (lang: Lang) => void }) {
  return (
    <div className="flex items-center overflow-hidden border border-line">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onLang(code)}
          aria-pressed={code === lang}
          className={
            "px-3 py-1 font-mono text-xs uppercase " +
            (code === lang ? "bg-green text-cream" : "bg-input text-muted hover:text-ink")
          }
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export function SetupToggle({
  lang,
  open,
  onToggle,
}: {
  lang: Lang;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={onToggle}
      className={
        "border px-2 py-1 text-[12px] " +
        (open
          ? "border-green bg-green text-cream"
          : "border-line bg-input text-ink hover:border-green hover:text-green")
      }
    >
      {t("action.setup", lang)}
    </button>
  );
}

interface AppBarProps {
  lang: Lang;
  onLang: (lang: Lang) => void;
  modelCount: number;
  onFiles: (files: File[]) => void;
  onClearAll: () => void;
  onClearCache: () => void;
  rulesetName: string | null;
  onRulesetFile: (file: File) => void;
  onClearRuleset: () => void;
  draggingRuleset: boolean;
  setupOpen: boolean;
  onSetup: () => void;
}

export function AppBar({
  lang,
  onLang,
  modelCount,
  onFiles,
  onClearAll,
  onClearCache,
  rulesetName,
  onRulesetFile,
  onClearRuleset,
  draggingRuleset,
  setupOpen,
  onSetup,
}: AppBarProps) {
  const ifcInput = useRef<HTMLInputElement>(null);
  const rulesetInput = useRef<HTMLInputElement>(null);

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-4 py-2">
      <button
        type="button"
        onClick={() => ifcInput.current?.click()}
        className="flex items-center gap-3 bg-green px-4 py-1.5 text-sm font-medium text-cream hover:bg-ink"
      >
        <span>{t("action.openIfc", lang)}</span>
        <span className="font-mono text-[11px] tracking-wide">{t("accept.ifc", lang)}</span>
      </button>
      <input
        ref={ifcInput}
        type="file"
        multiple
        accept=".ifc,.ifczip"
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
          {t("label.models", lang)}
        </span>
        <span className="font-mono text-sm tabular-nums text-ink">
          {formatCount(modelCount, lang)}
        </span>
      </div>

      <button
        type="button"
        onClick={onClearAll}
        className="border border-line bg-input px-2 py-1 text-[12px] text-ink hover:border-green hover:text-green"
      >
        {t("action.clearAll", lang)}
      </button>

      {/* Clears the STORE, not the board. "Tøm alle" empties the screen and
          keeps the cache so re-dropping is instant; this one throws the cache
          away and leaves the screen alone. Two different things, so two
          buttons rather than one that does both. */}
      <button
        type="button"
        onClick={onClearCache}
        className="border border-line bg-input px-2 py-1 text-[12px] text-ink hover:border-green hover:text-green"
      >
        {t("action.clearCache", lang)}
      </button>

      {rulesetName === null ? (
        <button
          type="button"
          onClick={() => rulesetInput.current?.click()}
          className={
            "flex items-center gap-2 border border-dashed px-3 py-1 text-[12px] " +
            (draggingRuleset
              ? "border-green bg-palegreen text-green"
              : "border-line bg-input text-muted hover:border-green hover:text-green")
          }
        >
          <span>{t("drop.ruleset", lang)}</span>
          <span className="font-mono text-[10px] tracking-wide">
            {t("accept.ruleset", lang)}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {t("label.ruleset", lang)}
          </span>
          <span
            onDoubleClick={copyOnDoubleClick(rulesetName)}
            className="cursor-copy font-mono text-[12px] text-ink"
          >
            {rulesetName}
          </span>
          <button
            type="button"
            onClick={onClearRuleset}
            className="border border-line bg-input px-2 py-0.5 text-[12px] text-ink hover:border-green hover:text-green"
          >
            {t("action.remove", lang)}
          </button>
        </div>
      )}
      <input
        ref={rulesetInput}
        type="file"
        accept=".ids,.xml,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onRulesetFile(file);
          event.target.value = "";
        }}
      />

      <div className="ml-auto flex items-center gap-3">
        <SetupToggle lang={lang} open={setupOpen} onToggle={onSetup} />
        <LangToggle lang={lang} onLang={onLang} />
      </div>
    </header>
  );
}
