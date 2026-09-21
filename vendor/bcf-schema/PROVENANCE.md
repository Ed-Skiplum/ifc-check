# vendor/bcf-schema

buildingSMART BCF 2.1 XML schemas, used to validate every document the BCF
export writes (`src/bcf/validate.ts`, xmllint-wasm, offline). Byte-identical to
the published files; the schemas import nothing, so nothing is rewritten.

| File | Validates | SHA-256 |
|---|---|---|
| `markup.xsd` | `<topic>/markup.bcf` | `15e9af22065870d93ad45431147748adc5b32ef830d6dfe7b4eb10cf5e6c4441` |
| `visinfo.xsd` | `<topic>/viewpoint.bcfv` | `ab11687511d9595fc136bcec57b4f640f0e8364d913f9b54c8dc267a13c6f247` |
| `version.xsd` | `bcf.version` | `bb1d108e349423fef4a69ecc1648797e7e73a18ee994bcdf98f978a6a3adf899` |

Source: `https://raw.githubusercontent.com/buildingSMART/BCF-XML/release_2_1/Schemas/<file>`,
branch `release_2_1` at `92fdcf4bfaa8f0576e7562730f341fc7781e2065` (last commit
touching `Schemas/`: `07a787689a1038f82ab801fa033d7ecdcbe66749`). Retrieved 2026-09-21.

`project.xsd` is not vendored: the export writes no `project.bcfp` (optional in 2.1).
