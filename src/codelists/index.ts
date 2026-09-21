/** The bundled code lists, by id. Lookups only: the `code-lookup` extended
 *  rule names one by id and checks extracted codes against its keys.
 *
 *  A list is added by extending scripts/gen-codelists.py and registering the
 *  generated module here. Nothing is assembled by hand. */

import { NS3457_8 } from "./ns3457-8.ts";
import type { CodeList } from "./types.ts";

export type { CodeList, CodeListMeta } from "./types.ts";

export const CODE_LISTS = {
  "ns3457-8": NS3457_8,
} as const satisfies Record<string, CodeList>;

export type CodeListId = keyof typeof CODE_LISTS;

export const CODE_LIST_IDS = Object.keys(CODE_LISTS) as CodeListId[];
