/** Schema validation of every BCF document against buildingSMART's BCF 2.1
 *  XSDs, vendored byte-identical in `vendor/bcf-schema/`.
 *
 * The four BCF 2.1 schemas import nothing, so unlike the IDS schema there is no
 * location rewrite: each document is validated against its own XSD as shipped.
 * No I/O here; the caller hands in the schema text and xmllint-wasm's
 * `validateXML`, so the browser and Node run the same code.
 */

import type { ValidateXml } from "../ids/validate.ts";
import type { BcfDocumentKind, BcfValidateFn } from "./export.ts";

export interface BcfSchemaSources {
  markup: string;
  visinfo: string;
  version: string;
}

const SCHEMA_FILE: Record<BcfDocumentKind, keyof BcfSchemaSources> = {
  markup: "markup",
  visinfo: "visinfo",
  version: "version",
};

export function createBcfValidator(
  sources: BcfSchemaSources,
  validateXML: ValidateXml,
): BcfValidateFn {
  for (const [name, text] of Object.entries(sources)) {
    if (/schemaLocation\s*=/.test(text)) {
      throw new Error(`vendored BCF schema ${name}.xsd imports another schema; not supported offline`);
    }
  }
  return async (kind, xml, fileName) => {
    const schema = SCHEMA_FILE[kind];
    const result = await validateXML({
      xml: [{ fileName: fileName.replace(/[\\/]/g, "_"), contents: xml }],
      schema: [{ fileName: `${schema}.xsd`, contents: sources[schema] }],
      preload: [],
    });
    return {
      valid: result.valid,
      errors: result.errors.map((e) => ({ message: e.rawMessage || e.message })),
    };
  };
}
