/** Real schema validation against the vendored buildingSMART IDS 1.0 XSD.
 *
 * ids.xsd imports the W3C schemas by absolute http URL, which no browser-side
 * validator can fetch, so those are vendored too and the import locations are
 * rewritten to local file names before the schema is handed to libxml2. The
 * rewrite is the only change made to buildingSMART's file; it is done here in
 * code so vendor/ids-schema/ids.xsd stays byte-identical to the shipped schema.
 *
 * The XMLSchema-instance import is dropped: its schemaLocation is the namespace
 * URI, not a schema document, so libxml2 reports "failed to locate a schema"
 * and skips it anyway. ids.xsd references no xsi: component.
 *
 * This module holds no I/O. The caller supplies the schema sources and the
 * xmllint-wasm `validateXML` binding, so the same code path runs in the browser
 * (vendored files imported with ?raw) and in Node (read from disk).
 */

/** The five files libxml2 needs in its virtual working directory. */
export interface SchemaSources {
  /** vendor/ids-schema/ids.xsd, verbatim. */
  ids: string;
  /** www.w3.org/2001/xml.xsd */
  xml: string;
  /** www.w3.org/2001/XMLSchema.xsd */
  xmlSchema: string;
  /** www.w3.org/2001/XMLSchema.dtd */
  xmlSchemaDtd: string;
  /** www.w3.org/2001/datatypes.dtd */
  datatypesDtd: string;
}

export interface ValidationError {
  message: string;
  line: number | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  rawOutput: string;
}

interface XmllintFile {
  fileName: string;
  contents: string;
}

interface XmllintResult {
  valid: boolean;
  errors: ReadonlyArray<{
    message: string;
    rawMessage: string;
    loc: null | { fileName: string; lineNumber: number | null };
  }>;
  rawOutput: string;
}

/** The subset of xmllint-wasm's validateXML this wrapper uses. */
export type ValidateXml = (options: {
  xml: XmllintFile[];
  schema: XmllintFile[];
  preload: XmllintFile[];
}) => Promise<XmllintResult>;

export function rewriteSchemaLocations(sources: SchemaSources): SchemaSources {
  const ids = sources.ids
    .replace(
      'schemaLocation="http://www.w3.org/2001/xml.xsd"',
      'schemaLocation="xml.xsd"',
    )
    .replace(
      'schemaLocation="http://www.w3.org/2001/XMLSchema.xsd"',
      'schemaLocation="XMLSchema.xsd"',
    )
    .replace(
      /[ \t]*<xs:import\s+namespace="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"[^>]*\/>\s*\n/,
      "",
    );
  const xmlSchema = sources.xmlSchema.replace(
    'schemaLocation="http://www.w3.org/2001/xml.xsd"',
    'schemaLocation="xml.xsd"',
  );
  return { ...sources, ids, xmlSchema };
}

/** Guard against a silent no-op rewrite: if buildingSMART or the W3C change a
 *  schemaLocation string, the replace above stops matching and the validator
 *  would try the network and report a schema-parse failure instead of a real
 *  result. Fail on the spot instead. */
export function assertSchemaRewritten(rewritten: SchemaSources): void {
  const leftovers: string[] = [];
  if (rewritten.ids.includes("http://www.w3.org/2001/xml.xsd")) leftovers.push("ids.xsd -> xml.xsd");
  if (rewritten.ids.includes("http://www.w3.org/2001/XMLSchema.xsd")) {
    leftovers.push("ids.xsd -> XMLSchema.xsd");
  }
  // The root element also declares xmlns:xsi, so look for the import itself.
  if (/<xs:import[^>]*XMLSchema-instance/.test(rewritten.ids)) {
    leftovers.push("ids.xsd -> XMLSchema-instance import");
  }
  if (rewritten.xmlSchema.includes("http://www.w3.org/2001/xml.xsd")) {
    leftovers.push("XMLSchema.xsd -> xml.xsd");
  }
  if (leftovers.length > 0) {
    throw new Error(
      "vendored schema imports were not rewritten to local files: " +
        leftovers.join(", ") +
        " — validation would depend on the network",
    );
  }
}

export type IdsValidator = (xml: string, fileName?: string) => Promise<ValidationResult>;

/** Bind the vendored schema and an xmllint-wasm build into a validator. */
export function createIdsValidator(
  sources: SchemaSources,
  validateXML: ValidateXml,
): IdsValidator {
  const local = rewriteSchemaLocations(sources);
  assertSchemaRewritten(local);
  const preload: XmllintFile[] = [
    { fileName: "xml.xsd", contents: local.xml },
    { fileName: "XMLSchema.xsd", contents: local.xmlSchema },
    { fileName: "XMLSchema.dtd", contents: local.xmlSchemaDtd },
    { fileName: "datatypes.dtd", contents: local.datatypesDtd },
  ];
  return async (xml, fileName = "ruleset.ids") => {
    const result = await validateXML({
      xml: [{ fileName, contents: xml }],
      schema: [{ fileName: "ids.xsd", contents: local.ids }],
      preload,
    });
    return {
      valid: result.valid,
      errors: result.errors.map((e) => ({
        message: e.rawMessage || e.message,
        line: e.loc?.lineNumber ?? null,
      })),
      rawOutput: result.rawOutput,
    };
  };
}
