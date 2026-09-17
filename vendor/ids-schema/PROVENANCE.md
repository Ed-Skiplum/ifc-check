# vendor/ids-schema

Schemas used to validate emitted `.ids` documents with `xmllint-wasm`. A browser
cannot fetch a schema import over the network, so every file `ids.xsd` imports is
vendored beside it.

| File | Source | Version |
|---|---|---|
| `ids.xsd` | buildingSMART IDS, `xs:schema/@version` = 1.0.0. Copied verbatim from `ifctester` 0.8.5 (`site-packages/ifctester/ids.xsd`), which ships buildingSMART's schema unmodified. | 1.0.0 |
| `xml.xsd` | `https://www.w3.org/2001/xml.xsd` | W3C |
| `XMLSchema.xsd` | `https://www.w3.org/2001/XMLSchema.xsd` | W3C |
| `XMLSchema.dtd` | `https://www.w3.org/2001/XMLSchema.dtd` | W3C |
| `datatypes.dtd` | `https://www.w3.org/2001/datatypes.dtd` | W3C |

Retrieved 2026-09-17.

## Why the W3C files are here

`ids.xsd` needs the schema-for-schemas for real: `ids:idsValue` has
`<xs:element ref="xs:restriction"/>` and `applicabilityType` has
`<xs:attributeGroup ref="xs:occurs"/>`. Both come from `XMLSchema.xsd`, which in
turn imports `xml.xsd` and carries a `DOCTYPE` pointing at `XMLSchema.dtd` (which
references `datatypes.dtd`). All five have to sit in libxml2's working directory
or the schema will not parse.

## The one modification, and where it lives

The files here are byte-identical to what was retrieved. The `schemaLocation`
attributes are absolute `http://www.w3.org/...` URLs, and those are rewritten to
the local file names **in code**, by `rewriteSchemaLocations` in
`src/ids/validate.ts`, at load time. Keeping the rewrite in code rather than in
the file means the vendored schema stays comparable to the published one.

The `XMLSchema-instance` import is dropped by the same function. Its
`schemaLocation` is the namespace URI rather than a schema document, so libxml2
reports `Failed to locate a schema at location
'http://www.w3.org/2001/XMLSchema-instance'. Skipping the import.` either way.
`ids.xsd` references no `xsi:` component.

`assertSchemaRewritten` fails loudly if any absolute import survives the rewrite,
so a changed upstream string can never silently turn validation into a
network-dependent no-op.
