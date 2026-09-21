/** The BCF export's strings in one language: the board's own check labels,
 *  reason and found-value renderings. Nothing here is new prose. */

import type { StringKey, Lang } from "../ui/i18n.ts";
import { t } from "../ui/i18n.ts";
import { reasonText } from "../ui/reasons.ts";
import { displayText } from "../ui/display.ts";
import type { BcfRender } from "./export.ts";

export function bcfRender(lang: Lang): BcfRender {
  return {
    checkLabel: (id) => {
      const key = `check.${id}` as StringKey;
      try {
        return t(key, lang);
      } catch {
        return id;
      }
    },
    reason: (finding) => reasonText(finding, lang),
    displayValue: (value) => displayText(value, lang),
    noStorey: t("matrix.noStorey", lang),
    noSpace: t("bcf.noSpace", lang),
  };
}
