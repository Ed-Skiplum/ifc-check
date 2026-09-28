/** Writes the .xlsx config template from `CONFIG_TEMPLATE`
 *  (src/ids/config-template.ts) to `examples/` and to `public/`, where the
 *  app's "Last ned mal" serves it.
 *
 *   node scripts/gen-config-template.ts
 *
 * The bytes are deterministic, so `ids-cli selftest` asserts both files are
 * current.
 */

import { writeFileSync } from "node:fs";
import { CONFIG_TEMPLATE, CONFIG_TEMPLATE_FILE } from "../src/ids/config-template.ts";
import { writeRulesetXlsx } from "../src/ids/xlsx.ts";

const bytes = writeRulesetXlsx(CONFIG_TEMPLATE);
for (const dir of ["examples", "public"]) {
  const url = new URL(`../${dir}/${CONFIG_TEMPLATE_FILE}`, import.meta.url);
  writeFileSync(url, bytes);
  process.stderr.write(`wrote ${dir}/${CONFIG_TEMPLATE_FILE} (${bytes.length} bytes)\n`);
}
