/** Browser-side IDS schema validation.
 *
 * Same code path as the CLI: the vendored buildingSMART XSD plus the four W3C
 * files it needs, handed to xmllint-wasm. Vite resolves `xmllint-wasm` to its
 * browser build through the package's `browser` field, and the 780 kB wasm is
 * only fetched when a validation is actually asked for.
 */

import datatypesDtd from "../../vendor/ids-schema/datatypes.dtd?raw";
import idsXsd from "../../vendor/ids-schema/ids.xsd?raw";
import xmlSchemaDtd from "../../vendor/ids-schema/XMLSchema.dtd?raw";
import xmlSchemaXsd from "../../vendor/ids-schema/XMLSchema.xsd?raw";
import xmlXsd from "../../vendor/ids-schema/xml.xsd?raw";
import { createIdsValidator, type IdsValidator, type ValidationResult } from "../ids/validate.ts";

let validator: Promise<IdsValidator> | null = null;

function load(): Promise<IdsValidator> {
  validator ??= import("xmllint-wasm").then(({ validateXML }) =>
    createIdsValidator(
      {
        ids: idsXsd,
        xml: xmlXsd,
        xmlSchema: xmlSchemaXsd,
        xmlSchemaDtd,
        datatypesDtd,
      },
      validateXML as never,
    ),
  );
  return validator;
}

export function validateIdsXml(xml: string): Promise<ValidationResult> {
  return load().then((validate) => validate(xml));
}

export type { ValidationResult };
