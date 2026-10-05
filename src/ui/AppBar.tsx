import { useRef } from "react";
import type { Lang } from "./i18n";
import { LANGS, t } from "./i18n";
import { copyOnDoubleClick } from "./copy";
import { formatCount } from "./format";
import { BcfExport } from "./BcfExport";
import { PdfExport } from "./PdfExport";
import type { Ruleset } from "../ids/types.ts";
import type { ModelEntry } from "./useModels";
import type { MeState } from "../account/konto";

export function LangToggle({ lang, onLang }: { lang: Lang; onLang: (lang: Lang) => void }) {
  return (
    <div className="flex items-center overflow-hidden border border-line">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onLang(code)}
          aria-pressed={code === lang}
          data-chrome={code === lang ? "primary" : undefined}
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

/** The account, on the bar's right. Signed out: «Logg inn», to the
 *  platform's sign-in and back here. Signed in: the name (else the e-mail),
 *  as text, and «Logg ut». The platform unavailable: nothing. */
export function AccountControl({
  lang,
  account,
  signInHref,
  onSignOut,
}: {
  lang: Lang;
  account: MeState;
  signInHref: string | null;
  onSignOut: () => void;
}) {
  const control = "border border-line bg-input px-2 py-1 text-[12px] text-ink hover:border-green hover:text-green";
  if (account.kind === "signed-out") {
    return signInHref ? (
      // _top: inside the skiplum.com embed the platform's page cannot be
      // framed (it sends X-Frame-Options), so sign-in takes the whole window.
      <a href={signInHref} target="_top" className={control}>
        {t("action.signIn", lang)}
      </a>
    ) : null;
  }
  if (account.kind !== "signed-in") return null;
  const who = account.user.name.trim() || account.user.email;
  return (
    <div className="flex items-center gap-2">
      <span title={who} className="max-w-[24ch] truncate text-[12px] text-ink">
        {who}
      </span>
      <button type="button" onClick={onSignOut} className={control}>
        {t("action.signOut", lang)}
      </button>
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
      data-chrome={open ? "primary" : undefined}
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
  models: ModelEntry[];
  onFiles: (files: File[]) => void;
  onClearAll: () => void;
  onClearCache: () => void;
  ruleset: Ruleset | null;
  rulesetName: string | null;
  onClearRuleset: () => void;
  setupOpen: boolean;
  onSetup: () => void;
  /** The account control (`AccountControl`), placed with Oppsett. */
  account: React.ReactNode;
}

export function AppBar({
  lang,
  onLang,
  modelCount,
  models,
  onFiles,
  onClearAll,
  onClearCache,
  ruleset,
  rulesetName,
  onClearRuleset,
  setupOpen,
  onSetup,
  account,
}: AppBarProps) {
  const ifcInput = useRef<HTMLInputElement>(null);

  return (
    // Wraps at narrow widths so every control stays reachable (review
    // 2026-09-21: at 390 px the bar ran 740-820 px wide and BCF, the ruleset,
    // Oppsett and NB/EN were off-screen). The board itself has no portrait
    // layout; the bar is chrome and must not lock anyone out.
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-1.5 py-1">
      {/* The filled primary only while nothing is open. Once a model is on the
          board it is the action least needed next, and a filled green block in
          the corner pulled the first look away from the verdicts (2026-09-24):
          it drops to the outlined style every other bar control has. */}
      <button
        type="button"
        onClick={() => ifcInput.current?.click()}
        data-chrome={modelCount === 0 ? "primary" : undefined}
        className={
          "flex items-center gap-3 " +
          (modelCount === 0
            ? "bg-green px-4 py-1.5 text-sm font-medium text-cream hover:bg-ink"
            : "border border-line bg-input px-2 py-1 text-[12px] text-ink hover:border-green hover:text-green")
        }
      >
        <span>{t("action.openIfc", lang)}</span>
        <span className="hidden font-mono text-[11px] tracking-wide sm:inline">
          {t("accept.ifc", lang)}
        </span>
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

      <BcfExport lang={lang} models={models} />
      <PdfExport lang={lang} models={models} ruleset={ruleset} />

      {rulesetName === null ? null : (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-gold uppercase">
            {t("label.ruleset", lang)}
          </span>
          <span
            onDoubleClick={copyOnDoubleClick(rulesetName)}
            title={rulesetName}
            className="max-w-[40ch] cursor-copy truncate font-mono text-[12px] text-ink"
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

      <div className="ml-auto flex items-center gap-3">
        {account}
        <SetupToggle lang={lang} open={setupOpen} onToggle={onSetup} />
        <LangToggle lang={lang} onLang={onLang} />
      </div>
    </header>
  );
}
